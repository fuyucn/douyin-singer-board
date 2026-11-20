package listener

import (
	"bytes"
	"crypto/md5"
	_ "embed"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"

	"github.com/dop251/goja"
)

//go:embed webmssdk.js
var signingSource string

var signer struct {
	sync.Mutex
	runtime  *goja.Runtime
	function goja.Callable
	err      error
}

func signXMSStub(stub string) (string, error) {
	signer.Lock()
	defer signer.Unlock()
	if signer.runtime == nil && signer.err == nil {
		signer.runtime = goja.New()
		signer.runtime.Set("createHash", func(call goja.FunctionCall) goja.Value {
			algorithm := call.Argument(0).String()
			data := bytes.NewBuffer(nil)
			object := signer.runtime.NewObject()
			_ = object.Set("update", func(call goja.FunctionCall) goja.Value {
				value := call.Argument(0)
				if call.Argument(1).String() == "hex" {
					decoded, err := hex.DecodeString(value.String())
					if err != nil {
						panic(signer.runtime.NewGoError(err))
					}
					_, _ = data.Write(decoded)
				} else if raw, ok := value.Export().([]byte); ok {
					_, _ = data.Write(raw)
				} else {
					_, _ = data.WriteString(value.String())
				}
				return object
			})
			_ = object.Set("digest", func(call goja.FunctionCall) goja.Value {
				if algorithm != "md5" {
					panic(signer.runtime.NewGoError(fmt.Errorf("unsupported hash algorithm %q", algorithm)))
				}
				digest := md5.Sum(data.Bytes())
				if call.Argument(0).String() == "hex" {
					return signer.runtime.ToValue(hex.EncodeToString(digest[:]))
				}
				return signer.runtime.ToValue(digest[:])
			})
			return object
		})
		signer.runtime.Set("Buffer", signer.runtime.Get("Uint8Array"))
		source, err := prepareSigningSource(signingSource)
		if err != nil {
			signer.err = err
		} else if _, err := signer.runtime.RunString(source); err != nil {
			signer.err = fmt.Errorf("initialize embedded Douyin signer: %w", err)
		} else if function, ok := goja.AssertFunction(signer.runtime.Get("__getSign")); !ok {
			signer.err = fmt.Errorf("embedded Douyin signer function is unavailable")
		} else {
			signer.function = function
		}
	}
	if signer.err != nil {
		return "", signer.err
	}
	value, err := signer.function(goja.Undefined(), signer.runtime.ToValue(stub))
	if err != nil {
		return "", fmt.Errorf("execute embedded Douyin signer: %w", err)
	}
	signature := value.String()
	if signature == "" || signature == "undefined" || signature == "00000000" {
		return "", fmt.Errorf("embedded Douyin signer returned an invalid signature")
	}
	return signature, nil
}

func prepareSigningSource(source string) (string, error) {
	source = strings.ReplaceAll(source, "\r\n", "\n")
	source = strings.ReplaceAll(source, "\r", "\n")
	source = strings.Replace(source,
		"import { createHash } from \"crypto\";\nimport { Buffer } from \"buffer\";", "", 1)
	source = strings.Replace(source, "export function get_sign(md5)", "globalThis.__getSign = function get_sign(md5)", 1)
	if strings.Contains(source, "import { createHash } from \"crypto\";") || strings.Contains(source, "export function get_sign(md5)") {
		return "", fmt.Errorf("could not prepare the embedded Douyin signer")
	}
	return source, nil
}
