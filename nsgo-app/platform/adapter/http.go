package adapter

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Request struct {
	URL     string            `json:"url"`
	Method  string            `json:"method"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
	As      string            `json:"as"`
}

var endpoints = map[string]map[string]string{
	KuGou: {
		"login-user.kugou.com/v2/qrcode": "GET", "login-user.kugou.com/v2/get_userinfo_qrcode": "GET",
		"gateway.kugou.com/v2/search/song": "GET", "gateway.kugou.com/v7/get_all_list": "POST",
		"gateway.kugou.com/cloudlist.service/v6/add_song": "POST", "gateway.kugou.com/cloudlist.service/v5/add_list": "POST",
		"gateway.kugou.com/v2/delete_list": "POST",
	},
	NetEase: {
		"interfacepc.music.163.com/eapi/login/qrcode/unikey": "POST", "interfacepc.music.163.com/eapi/login/qrcode/client/login": "POST",
		"music.163.com/weapi/w/nuser/account/get": "POST", "music.163.com/weapi/cloudsearch/pc": "POST",
		"music.163.com/weapi/user/playlist": "POST", "music.163.com/weapi/playlist/create": "POST",
		"music.163.com/weapi/playlist/manipulate/tracks": "POST", "music.163.com/weapi/playlist/delete": "POST",
	},
}

var platformHTTP = &http.Client{
	Timeout: 10 * time.Second,
	Transport: &http.Transport{ForceAttemptHTTP2: true, MaxIdleConns: 8, IdleConnTimeout: 30 * time.Second,
		MaxResponseHeaderBytes: 32 << 10},
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

func requestPlatform(ctx context.Context, provider, operation string, input Request) (any, error) {
	return sendRequest(ctx, platformHTTP, provider, operation, input)
}

func sendRequest(ctx context.Context, client *http.Client, provider, operation string, input Request) (any, error) {
	parsed, err := url.Parse(input.URL)
	if err != nil || parsed.Scheme != "https" || parsed.User != nil || parsed.Fragment != "" || parsed.Port() != "" || parsed.RawPath != "" || len(input.URL) > 8192 || len(input.Body) > 128<<10 {
		return nil, errors.New("platform request is not permitted")
	}
	endpoint := parsed.Host + parsed.Path
	method := endpoints[provider][endpoint]
	if method == "" || method != input.Method || (method == "GET" && input.Body != "") {
		return nil, errors.New("platform endpoint is not permitted")
	}
	raw := operation == "http.raw"
	if (raw && (provider != NetEase || endpoint != "interfacepc.music.163.com/eapi/login/qrcode/client/login")) || (!raw && operation != "http.json") {
		return nil, errors.New("platform network operation is not permitted")
	}
	request, err := http.NewRequestWithContext(ctx, method, input.URL, strings.NewReader(input.Body))
	if err != nil {
		return nil, errors.New("invalid platform request")
	}
	for name, value := range input.Headers {
		switch strings.ToLower(name) {
		case "user-agent", "content-type", "dfid", "mid", "clienttime", "uuid", "x-router", "referer", "origin", "cookie", "kg-rc", "kg-thash", "kg-rec", "kg-rf":
			if strings.ContainsAny(value, "\r\n\x00") || len(value) > 8192 {
				return nil, errors.New("invalid platform request header")
			}
			request.Header.Set(name, value)
		default:
			return nil, errors.New("platform request header is not permitted")
		}
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, errors.New("platform network request failed")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("music platform returned HTTP %d", response.StatusCode)
	}
	const maxResponse = 4 << 20
	body, err := io.ReadAll(io.LimitReader(response.Body, maxResponse+1))
	if err != nil || len(body) > maxResponse {
		return nil, errors.New("invalid platform response size")
	}
	if raw {
		var cookies []string
		for _, cookie := range response.Cookies() {
			switch cookie.Name {
			case "MUSIC_U", "__csrf", "NMTID":
				cookies = append(cookies, cookie.Name+"="+cookie.Value)
			}
		}
		return map[string]any{"body": string(body), "setCookie": strings.Join(cookies, "; ")}, nil
	}
	switch input.As {
	case "text":
		return string(body), nil
	case "base64":
		return base64.StdEncoding.EncodeToString(body), nil
	case "", "json":
		var result any
		if err := json.Unmarshal(body, &result); err != nil {
			return nil, errors.New("music platform did not return JSON")
		}
		return result, nil
	default:
		return nil, errors.New("unsupported platform response format")
	}
}
