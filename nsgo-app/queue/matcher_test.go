package queue

import (
	"testing"
	"time"
)

func TestSongOnlyTemplateMatchesWholeChat(t *testing.T) {
	matcher, err := New(Config{Template: "[song]"})
	if err != nil {
		t.Fatal(err)
	}
	for _, message := range []string{"随便聊聊", "点歌 晴天"} {
		result := matcher.Match(ChatMessage{UserID: message, Content: message})
		if result.Added == nil || result.Added.Name != message {
			t.Fatalf("[song] should capture the whole message %q, got %#v", message, result)
		}
	}
}

func TestDefaultAndLegacyChineseTemplates(t *testing.T) {
	matcher, err := New(Config{Template: DefaultTemplate})
	if err != nil {
		t.Fatal(err)
	}
	if result := matcher.Match(ChatMessage{UserID: "ordinary", Content: "普通聊天"}); result.Added != nil {
		t.Fatalf("ordinary chat was queued: %#v", result)
	}
	if result := matcher.Match(ChatMessage{UserID: "u1", Content: "点歌   晴天"}); result.Added == nil || result.Added.Name != "晴天" {
		t.Fatalf("default command failed: %#v", result)
	}
	legacy, err := New(Config{Template: "点歌[空格][歌曲]"})
	if err != nil {
		t.Fatal(err)
	}
	if result := legacy.Match(ChatMessage{UserID: "u2", Content: "点歌 稻香"}); result.Added == nil || result.Added.Name != "稻香" {
		t.Fatalf("legacy template failed: %#v", result)
	}
}

func TestBlacklistFansCooldownAndDuplicate(t *testing.T) {
	matcher, err := New(Config{Template: DefaultTemplate, FansLevel: 3, SingCooldown: time.Hour, BlacklistSongs: []string{"稻香"}, BlacklistSingers: []string{"禁歌手"}})
	if err != nil {
		t.Fatal(err)
	}
	for _, chat := range []ChatMessage{{UserID: "b", Content: "点歌 稻香", MedalLevel: 9}, {UserID: "b", Content: "点歌 禁歌手-示例", MedalLevel: 9}, {UserID: "c", Content: "点歌 晴天", MedalLevel: 2}} {
		if result := matcher.Match(chat); result.Added != nil {
			t.Fatalf("filtered request was queued: %#v", result)
		}
	}
	first := matcher.Match(ChatMessage{ID: "live-1", UserID: "a", Content: "点歌 晴天", MedalLevel: 4})
	if first.Added == nil {
		t.Fatal("qualified request was skipped")
	}
	if matcher.Match(ChatMessage{UserID: "b", Content: "点歌 晴天", MedalLevel: 4}).Added == nil {
		t.Fatal("the matcher should not own Board's songs+played dedup check")
	}
	if matcher.Match(ChatMessage{UserID: "a", Content: "点歌 稻香2", MedalLevel: 4}).Added == nil {
		t.Fatal("a different song should not be limited by the queue-size preference before played-history is migrated")
	}
}

func TestManualRemovalCancelAndCooldownReset(t *testing.T) {
	matcher, err := New(Config{Template: DefaultTemplate, SingCooldown: time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	first := matcher.Match(ChatMessage{ID: "live-1", UserID: "u1", Content: "点歌 晴天"})
	if first.Added == nil {
		t.Fatal("initial request was skipped")
	}
	if matcher.Match(ChatMessage{UserID: "u1", Content: "点歌 稻香"}).Added == nil {
		t.Fatal("the matcher should not apply played-history cooldown to requests")
	}
	manual, err := matcher.AddManual("夜曲")
	if err != nil {
		t.Fatal(err)
	}
	if !matcher.RemoveByID(manual.ID) || !matcher.RemoveByID(first.Added.ID) {
		t.Fatal("queue row removal failed")
	}
	if matcher.Match(ChatMessage{UserID: "u1", Content: "点歌 七里香"}).Added == nil {
		t.Fatal("the matcher should not count pending requests as played songs")
	}
	cancelled := matcher.Match(ChatMessage{UserID: "u1", Content: "取消点歌 不要了"})
	if cancelled.Cancelled != 2 {
		t.Fatalf("cancel result: %#v", cancelled)
	}
	if matcher.Match(ChatMessage{UserID: "u1", Content: "点歌 夜曲"}).Added == nil {
		t.Fatal("the matcher should remain independent of history cooldown")
	}
}
