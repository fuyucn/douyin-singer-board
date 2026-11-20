package adapter

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestBothAdaptersPassThroughRestrictedHTTPBridge(t *testing.T) {
	for _, provider := range []string{KuGou, NetEase} {
		t.Run(provider, func(t *testing.T) {
			calls := 0
			network := &http.Client{Transport: fakeTransport(func(request *http.Request) (*http.Response, error) {
				calls++
				response := `{"data":{"lists":[{"SongName":"Test song","SingerName":"Artist","FileHash":"track"}]}}`
				if provider == NetEase {
					body, _ := io.ReadAll(request.Body)
					if !strings.Contains(string(body), "encSecKey=") {
						t.Error("NetEase encryption envelope missing")
					}
					response = `{"result":{"songs":[{"id":42,"name":"Test song","ar":[{"name":"Artist"}]}]}}`
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(response))}, nil
			})}
			client := Client{ID: provider, Do: func(ctx context.Context, provider, operation string, input Request) (any, error) {
				return sendRequest(ctx, network, provider, operation, input)
			}}
			var results []struct{ Name string }
			if err := client.Call(context.Background(), "search", map[string]string{"keyword": "Test song"}, &results); err != nil {
				t.Fatal(err)
			}
			if calls != 1 || len(results) != 1 || results[0].Name != "Test song" {
				t.Fatal("end-to-end adapter bridge did not return the expected result")
			}
		})
	}
}

func TestKuGouClearThroughRestrictedHTTPBridge(test *testing.T) {
	var paths []string
	network := &http.Client{Transport: fakeTransport(func(request *http.Request) (*http.Response, error) {
		paths = append(paths, request.URL.Path)
		var response string
		switch request.URL.Path {
		case "/v7/get_all_list":
			response = `{"status":1,"data":{"userid":"123","info":[{"listid":1,"name":"Target"},{"listid":2,"name":"Target"}]}}`
		case "/v2/delete_list":
			response = `{"status":1}`
		case "/cloudlist.service/v5/add_list":
			response = `{"status":1,"data":{"info":{"listid":3}}}`
		default:
			test.Fatalf("unexpected playlist request: %s", request.URL.Path)
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(response))}, nil
	})}
	client := Client{ID: KuGou, Do: func(ctx context.Context, provider, operation string, input Request) (any, error) {
		return sendRequest(ctx, network, provider, operation, input)
	}}
	var result struct {
		ListID    int64 `json:"listid"`
		DeletedID int64 `json:"deletedId"`
	}
	input := map[string]any{"name": "Target", "currentId": 2, "token": "TEST_ONLY", "userid": "123"}
	if err := client.Call(context.Background(), "clearPlaylist", input, &result); err != nil {
		test.Fatalf("clear failed after %v: %v", paths, err)
	}
	if result.ListID != 3 || result.DeletedID != 2 || strings.Join(paths, ",") != "/v7/get_all_list,/v2/delete_list,/cloudlist.service/v5/add_list" {
		test.Fatalf("unexpected delete/recreate result: %+v, requests: %v", result, paths)
	}
}
