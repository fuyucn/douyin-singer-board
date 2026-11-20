package adapter

import (
	"context"
	"strings"
	"testing"
)

func TestNetEaseOnlyReturnsPlaylistsOwnedByVerifiedAccount(t *testing.T) {
	client := Client{ID: NetEase, Do: func(_ context.Context, _, _ string, request Request) (any, error) {
		if strings.Contains(request.URL, "account/get") {
			return map[string]any{"profile": map[string]any{"userId": 123}}, nil
		}
		return map[string]any{"code": 200, "playlist": []any{
			map[string]any{"id": 1, "name": "owned", "creator": map[string]any{"userId": 123}},
			map[string]any{"id": 2, "name": "other", "creator": map[string]any{"userId": 456}},
			map[string]any{"id": 3, "name": "subscribed", "subscribed": true, "creator": map[string]any{"userId": 123}},
		}}, nil
	}}
	var lists []struct{ Name string }
	if err := client.Call(context.Background(), "playlists", map[string]string{"token": "MUSIC_U=TEST", "userid": "123"}, &lists); err != nil {
		t.Fatal(err)
	}
	if len(lists) != 1 || lists[0].Name != "owned" {
		t.Fatal("unowned playlists were offered for mutation")
	}
	if err := client.Call(context.Background(), "playlists", map[string]string{"token": "MUSIC_U=TEST", "userid": "456"}, &lists); err == nil {
		t.Fatal("session/account mismatch was accepted")
	}
}
