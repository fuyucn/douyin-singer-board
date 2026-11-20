package adapter

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestPublicPlatformSearch(t *testing.T) {
	if os.Getenv("SONGBOARD_PUBLIC_SEARCH") != "1" {
		t.Skip("opt-in public search; no login or playlist mutations")
	}
	for _, provider := range []string{KuGou, NetEase} {
		t.Run(provider, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			var results []struct{ Name string }
			if err := (Client{ID: provider}).Call(ctx, "search", map[string]any{"keyword": "晴天", "pagesize": 3}, &results); err != nil {
				t.Fatal(err)
			}
			if len(results) == 0 || results[0].Name == "" {
				t.Fatal("public search returned no usable songs")
			}
			t.Logf("public search returned %d songs", len(results))
		})
	}
}
