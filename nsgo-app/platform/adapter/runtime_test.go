package adapter

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/md5"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/dop251/goja"
)

func TestKuGouCryptoKnownAnswers(t *testing.T) {
	var result struct{ MD5, MD5Utf8, SignParamsKey, AesB64, RsaHex string }
	client := Client{ID: KuGou, Do: func(context.Context, string, string, Request) (any, error) {
		t.Fatal("selftest attempted network")
		return nil, nil
	}}
	if err := client.Call(context.Background(), "selftest", struct{}{}, &result); err != nil {
		t.Fatal(err)
	}
	hash := func(text string) string { sum := md5.Sum([]byte(text)); return hex.EncodeToString(sum[:]) }
	if result.MD5 != hash("abc") || result.MD5Utf8 != hash("酷狗音乐 123") || result.SignParamsKey != hash("1005OIlwieks28dk2k092lksi2UIkp204891700000000") {
		t.Fatalf("incorrect hash vectors: %+v", result)
	}
	key := hash("a1b2c3")
	block, err := aes.NewCipher([]byte(key[:16]))
	if err != nil {
		t.Fatal(err)
	}
	plain := []byte(`{"listid":29,"total_ver":0,"type":1}`)
	padding := aes.BlockSize - len(plain)%aes.BlockSize
	plain = append(plain, []byte(strings.Repeat(string(byte(padding)), padding))...)
	cipher.NewCBCEncrypter(block, []byte(key[16:])).CryptBlocks(plain, plain)
	if result.AesB64 != base64.StdEncoding.EncodeToString(plain) {
		t.Fatal("AES vector differs from Go crypto")
	}
	source, _ := sources.ReadFile("assets/kugou.js")
	encoded := regexp.MustCompile(`var KUGOU_PUBLIC_KEY_B64 = "([^"]+)"`).FindSubmatch(source)
	der, err := base64.StdEncoding.DecodeString(string(encoded[1]))
	if err != nil {
		t.Fatal(err)
	}
	public, err := x509.ParsePKIXPublicKey(der)
	if err != nil {
		t.Fatal(err)
	}
	pub := public.(*rsa.PublicKey)
	message := []byte(`{"aes":"a1b2c3","uid":"123456","token":"TESTTOKEN"}`)
	em := append([]byte{0, 2}, []byte(strings.Repeat(string(byte(1)), pub.Size()-len(message)-3))...)
	em = append(em, 0)
	em = append(em, message...)
	wantRSA := new(big.Int).Exp(new(big.Int).SetBytes(em), big.NewInt(int64(pub.E)), pub.N)
	if result.RsaHex != fmt.Sprintf("%0*X", pub.Size()*2, wantRSA) {
		t.Fatal("RSA vector differs from Go crypto")
	}
}

func TestBrowserUTF8AndBinarySemantics(t *testing.T) {
	vm := goja.New()
	if err := browserPrimitives(vm); err != nil {
		t.Fatal(err)
	}
	value, err := vm.RunString(`new TextDecoder().decode(new TextEncoder().encode("酷狗音乐 🎵")) + ":" + btoa(atob("AP+A"))`)
	if err != nil || value.String() != "酷狗音乐 🎵:AP+A" {
		t.Fatalf("encoding error: %v %v", value, err)
	}
}

func TestBothAdaptersSearchAndPromises(t *testing.T) {
	for _, id := range []string{KuGou, NetEase} {
		t.Run(id, func(t *testing.T) {
			calls := 0
			client := Client{ID: id, Do: func(ctx context.Context, provider, method string, request Request) (any, error) {
				calls++
				if method != "http.json" || provider != id {
					t.Fatal("wrong provider bridge")
				}
				if id == KuGou {
					return map[string]any{"data": map[string]any{"lists": []any{map[string]any{"SongName": "晴天", "SingerName": "周杰伦", "FileHash": "hash1"}}}}, nil
				}
				return map[string]any{"result": map[string]any{"songs": []any{map[string]any{"id": 42, "name": "晴天", "ar": []any{map[string]any{"name": "周杰伦"}}}}}}, nil
			}}
			var result []struct{ Name, Artist, Key, Hash string }
			if err := client.Call(context.Background(), "search", map[string]string{"keyword": "晴天"}, &result); err != nil {
				t.Fatal(err)
			}
			if calls != 1 || len(result) != 1 || result[0].Name != "晴天" || result[0].Artist != "周杰伦" {
				t.Fatalf("unexpected search result: %+v", result)
			}
		})
	}
}

func TestNetEaseCookieAndQRLogin(t *testing.T) {
	client := Client{ID: NetEase, Do: func(_ context.Context, _, method string, request Request) (any, error) {
		if method == "http.raw" {
			return map[string]any{"body": `{"code":803}`, "setCookie": "MUSIC_U=TEST; __csrf=CSRF"}, nil
		}
		return map[string]any{"profile": map[string]any{"userId": 123, "nickname": "测试用户"}}, nil
	}}
	for _, method := range []string{"loginCookie", "loginQrCheck"} {
		var result struct{ Token, Userid, Nickname string }
		if err := client.Call(context.Background(), method, map[string]string{"token": "MUSIC_U=TEST", "key": "test"}, &result); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(result.Token, "MUSIC_U=TEST") || result.Userid != "123" {
			t.Fatal("login was not normalized")
		}
	}
}

func TestCancelledAndRejectedCallsDoNotExposeSecrets(t *testing.T) {
	client := Client{ID: NetEase, Do: func(ctx context.Context, _, _ string, _ Request) (any, error) {
		<-ctx.Done()
		return nil, errors.New("credential-secret")
	}}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	var result any
	err := client.Call(ctx, "search", map[string]string{"keyword": "song"}, &result)
	if err == nil || strings.Contains(err.Error(), "credential-secret") {
		t.Fatalf("unsafe error: %v", err)
	}
}

func TestResolvePlaylistReusesBoundDuplicateOrCreatesMissingPlaylist(t *testing.T) {
	for _, provider := range []string{KuGou, NetEase} {
		for _, existing := range []bool{true, false} {
			t.Run(provider+map[bool]string{true: "/existing", false: "/missing"}[existing], func(t *testing.T) {
				creates := 0
				client := Client{ID: provider, Do: func(_ context.Context, _, _ string, request Request) (any, error) {
					switch {
					case strings.Contains(request.URL, "account/get"):
						return map[string]any{"profile": map[string]any{"userId": 123}}, nil
					case strings.Contains(request.URL, "user/playlist"):
						lists := []any{}
						if existing {
							lists = []any{map[string]any{"id": 1, "name": "Target", "creator": map[string]any{"userId": 123}}, map[string]any{"id": 2, "name": "Target", "creator": map[string]any{"userId": 123}}}
						}
						return map[string]any{"code": 200, "playlist": lists}, nil
					case strings.Contains(request.URL, "get_all_list"):
						info := []any{}
						if existing {
							info = []any{map[string]any{"listid": 1, "name": "Target"}, map[string]any{"listid": 2, "name": "Target"}}
						}
						return map[string]any{"status": 1, "data": map[string]any{"userid": "123", "info": info}}, nil
					case strings.Contains(request.URL, "playlist/create"):
						creates++
						return map[string]any{"id": 99}, nil
					case strings.Contains(request.URL, "add_list"):
						creates++
						return map[string]any{"status": 1, "data": map[string]any{"info": map[string]any{"listid": 99}}}, nil
					default:
						return nil, errors.New("unexpected playlist request: " + request.URL)
					}
				}}
				currentID := int64(0)
				if existing {
					currentID = 2
				}
				var result struct {
					ID      int64 `json:"listid"`
					Created bool  `json:"created"`
				}
				input := map[string]any{"name": "Target", "currentId": currentID, "token": "MUSIC_U=TEST", "userid": "123"}
				if err := client.Call(context.Background(), "resolvePlaylist", input, &result); err != nil {
					t.Fatal(err)
				}
				if existing && (result.ID != 2 || result.Created || creates != 0) {
					t.Fatalf("did not reuse the currently bound playlist: %+v, creates=%d", result, creates)
				}
				if !existing && (result.ID != 99 || !result.Created || creates != 1) {
					t.Fatalf("did not create the missing playlist: %+v, creates=%d", result, creates)
				}
			})
		}
	}
}

func TestClearNeverDeletesOtherSameNamePlaylists(t *testing.T) {
	for _, id := range []string{KuGou, NetEase} {
		t.Run(id, func(t *testing.T) {
			deletes := 0
			client := Client{ID: id, Do: func(_ context.Context, _, _ string, request Request) (any, error) {
				switch {
				case strings.Contains(request.URL, "get_all_list"):
					return map[string]any{"status": 1, "data": map[string]any{"info": []any{map[string]any{"listid": 1, "name": "same"}, map[string]any{"listid": 2, "name": "same"}}}}, nil
				case strings.Contains(request.URL, "user/playlist"):
					return map[string]any{"code": 200, "playlist": []any{map[string]any{"id": 1, "name": "same", "creator": map[string]any{"userId": 123}}, map[string]any{"id": 2, "name": "same", "creator": map[string]any{"userId": 123}}}}, nil
				case strings.Contains(request.URL, "account/get"):
					return map[string]any{"profile": map[string]any{"userId": 123}}, nil
				default:
					deletes++
					return nil, errors.New("mutation blocked in test")
				}
			}}
			var response struct{ Refused bool }
			if err := client.Call(context.Background(), "clearPlaylist", map[string]any{"name": "same", "currentId": 99, "userid": "123", "token": "MUSIC_U=TEST"}, &response); err != nil {
				t.Fatal(err)
			}
			if !response.Refused || deletes != 0 {
				t.Fatal("clear attempted unbound playlist mutations")
			}
		})
	}
}
