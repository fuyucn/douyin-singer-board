package adapter

import (
	"context"
	"crypto/rand"
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"strings"
	"sync"
	"time"

	"github.com/dop251/goja"
)

const (
	KuGou   = "kugou-web"
	NetEase = "netease-web"
)

//go:embed assets/*.js
var sources embed.FS

func embedded(file string) func() (*goja.Program, error) {
	return sync.OnceValues(func() (*goja.Program, error) {
		data, err := sources.ReadFile(file)
		if err != nil {
			return nil, err
		}
		return goja.Compile(file, string(data), true)
	})
}

var programs = map[string]func() (*goja.Program, error){KuGou: embedded("assets/kugou.js"), NetEase: embedded("assets/netease.js")}

var deviceID = sync.OnceValue(func() string {
	number, err := rand.Int(rand.Reader, big.NewInt(8_000_000_000_000_000))
	if err != nil {
		panic("secure device identifier could not be generated")
	}
	return number.Add(number, big.NewInt(1_000_000_000_000_000)).String()
})

func Known(id string) bool { return programs[id] != nil }

type Client struct {
	ID string
	Do func(context.Context, string, string, Request) (any, error)
}

func (client Client) Call(ctx context.Context, method string, params any, result any) error {
	compile := programs[client.ID]
	if compile == nil {
		return errors.New("unsupported music platform")
	}
	switch method {
	case "search", "loginQrKey", "loginQrCheck", "playlists", "addTrack", "resolvePlaylist", "clearPlaylist", "loginCookie", "selftest":
	default:
		return errors.New("unsupported platform operation")
	}
	program, err := compile()
	if err != nil {
		return errors.New("music adapter compilation failed")
	}
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	vm := goja.New()
	vm.SetMaxCallStackSize(512)
	vm.SetFieldNameMapper(goja.TagFieldNameMapper("json", true))
	interrupted := make(chan struct{})
	stop := context.AfterFunc(ctx, func() { defer close(interrupted); vm.Interrupt("music adapter timed out") })
	defer func() {
		if !stop() {
			<-interrupted
		}
	}()
	var methods *goja.Object
	_ = vm.Set("plugin", map[string]any{"define": func(call goja.FunctionCall) goja.Value {
		methods = call.Argument(0).ToObject(vm)
		return goja.Undefined()
	}})
	_ = vm.Set("app", map[string]any{"call": func(call goja.FunctionCall) goja.Value {
		if err := ctx.Err(); err != nil {
			panic(vm.NewGoError(err))
		}
		var request Request
		if err := vm.ExportTo(call.Argument(1), &request); err != nil {
			panic(vm.NewTypeError("invalid platform request"))
		}
		do := client.Do
		if do == nil {
			do = requestPlatform
		}
		value, err := do(ctx, client.ID, call.Argument(0).String(), request)
		if err != nil {
			panic(vm.NewGoError(err))
		}
		return vm.ToValue(value)
	}})
	if err := browserPrimitives(vm); err != nil {
		return errors.New("music adapter runtime setup failed")
	}
	if _, err := vm.RunProgram(program); err != nil || methods == nil {
		return errors.New("music adapter initialization failed")
	}
	if client.ID == KuGou {
		_ = vm.Set("MID", deviceID())
	} else {
		_ = vm.Set("DEVICE_ID", "nsgo-"+deviceID())
	}
	fn, ok := goja.AssertFunction(methods.Get(method))
	if !ok {
		return errors.New("operation is not supported by this platform")
	}
	encoded, err := json.Marshal(params)
	if err != nil {
		return errors.New("invalid platform arguments")
	}
	jsonObject := vm.Get("JSON").ToObject(vm)
	parse, _ := goja.AssertFunction(jsonObject.Get("parse"))
	argument, err := parse(jsonObject, vm.ToValue(string(encoded)))
	if err != nil {
		return errors.New("invalid platform arguments")
	}
	value, err := fn(methods, argument)
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err != nil {
		return errors.New("music adapter execution failed")
	}
	if promise, ok := value.Export().(*goja.Promise); ok {
		if promise.State() != goja.PromiseStateFulfilled {
			return errors.New("music platform request failed or was rejected")
		}
		value = promise.Result()
	}
	if result == nil {
		return nil
	}
	stringify, _ := goja.AssertFunction(jsonObject.Get("stringify"))
	output, err := stringify(jsonObject, value)
	if err != nil || goja.IsUndefined(output) || json.Unmarshal([]byte(output.String()), result) != nil {
		return errors.New("music platform returned invalid data")
	}
	return nil
}

func browserPrimitives(vm *goja.Runtime) error {
	_ = vm.Set("encodeUTF8", func(value string) goja.ArrayBuffer { return vm.NewArrayBuffer([]byte(value)) })
	_ = vm.Set("decodeUTF8", func(value goja.ArrayBuffer) string {
		return strings.TrimPrefix(strings.ToValidUTF8(string(value.Bytes()), "�"), string(rune(0xfeff)))
	})
	_ = vm.Set("fillRandom", func(buffer goja.ArrayBuffer, offset, length int) {
		if length < 0 || length > 65536 || offset < 0 || offset > len(buffer.Bytes())-length {
			panic(vm.NewTypeError("invalid random byte buffer"))
		}
		_, _ = rand.Read(buffer.Bytes()[offset : offset+length])
	})
	_ = vm.Set("atob", func(value string) string {
		value = strings.Map(func(char rune) rune {
			if strings.ContainsRune(" \t\n\r\f", char) {
				return -1
			}
			return char
		}, value)
		encoding := base64.RawStdEncoding
		if strings.HasSuffix(value, "=") {
			encoding = base64.StdEncoding
		}
		decoded, err := encoding.DecodeString(value)
		if err != nil {
			panic(vm.NewTypeError("invalid base64 data"))
		}
		var binary strings.Builder
		for _, octet := range decoded {
			binary.WriteRune(rune(octet))
		}
		return binary.String()
	})
	_ = vm.Set("btoa", func(value string) string {
		binary := make([]byte, 0, len(value))
		for _, char := range value {
			if char > 255 {
				panic(vm.NewTypeError("invalid binary string"))
			}
			binary = append(binary, byte(char))
		}
		return base64.StdEncoding.EncodeToString(binary)
	})
	_, err := vm.RunString("class TextEncoder { encode(value) { return new Uint8Array(encodeUTF8(String(value))); } };" +
		"class TextDecoder { decode(value) { var bytes=value instanceof ArrayBuffer ? new Uint8Array(value) : value; return decodeUTF8(Uint8Array.from(bytes || []).buffer); } };" +
		"const crypto = { getRandomValues(value) { fillRandom(value.buffer, value.byteOffset, value.byteLength); return value; } };")
	return err
}
