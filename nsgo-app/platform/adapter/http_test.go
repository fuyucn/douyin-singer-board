package adapter

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

type fakeTransport func(*http.Request) (*http.Response, error)

func (send fakeTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return send(request)
}

func TestHTTPRejectsUnexpectedEndpointsBeforeNetwork(t *testing.T) {
	client := &http.Client{Transport: fakeTransport(func(*http.Request) (*http.Response, error) {
		t.Fatal("forbidden request reached network")
		return nil, nil
	})}
	for _, address := range []string{"http://music.163.com/weapi/user/playlist", "https://music.163.com:443/weapi/user/playlist", "https://music.163.com@evil.test/weapi/user/playlist", "https://music.163.com/weapi/unknown", "https://127.0.0.1/", "https://music.163.com/%77eapi/user/playlist"} {
		if _, err := sendRequest(context.Background(), client, NetEase, "http.json", Request{URL: address, Method: "POST"}); err == nil {
			t.Errorf("allowed %s", address)
		}
	}
}

func TestHTTPRejectsRedirectAndCapsResponse(t *testing.T) {
	for _, status := range []int{302, 200} {
		client := &http.Client{CheckRedirect: platformHTTP.CheckRedirect, Transport: fakeTransport(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: status, Header: http.Header{"Location": []string{"https://evil.test"}}, Body: io.NopCloser(strings.NewReader(strings.Repeat("x", (4<<20)+1)))}, nil
		})}
		if _, err := sendRequest(context.Background(), client, NetEase, "http.json", Request{URL: "https://music.163.com/weapi/user/playlist", Method: "POST"}); err == nil {
			t.Fatal("unbounded or redirected response accepted")
		}
	}
}

func TestRawCookieResponseIsOnlyExposedForNetEaseAuth(t *testing.T) {
	client := &http.Client{Transport: fakeTransport(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Header: http.Header{"Set-Cookie": []string{"MUSIC_U=TEST; Secure", "other=private; Secure"}}, Body: io.NopCloser(strings.NewReader(`{"code":803}`))}, nil
	})}
	result, err := sendRequest(context.Background(), client, NetEase, "http.raw", Request{URL: "https://interfacepc.music.163.com/eapi/login/qrcode/client/login", Method: "POST"})
	if err != nil || result.(map[string]any)["setCookie"] != "MUSIC_U=TEST" {
		t.Fatal("incorrect auth cookie filtering")
	}
	if _, err := sendRequest(context.Background(), client, NetEase, "http.raw", Request{URL: "https://music.163.com/weapi/user/playlist", Method: "POST"}); err == nil {
		t.Fatal("raw cookies exposed outside authentication")
	}
}
