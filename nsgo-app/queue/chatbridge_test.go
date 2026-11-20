package queue

import (
	"reflect"
	"testing"
)

func TestListenerChatHandlerRoutesRequestAndCancelToQueue(t *testing.T) {
	matcher, err := New(Config{Template: DefaultTemplate})
	if err != nil {
		t.Fatal(err)
	}
	var lines []string
	var statuses []string
	var queueUpdates [][]Song
	handler := NewChatHandler(matcher, func(line string) { lines = append(lines, line) }, func(songs []Song) { queueUpdates = append(queueUpdates, append([]Song(nil), songs...)) }, func(status string) { statuses = append(statuses, status) })
	if got := handler.OnFrame(); got != 1 {
		t.Fatalf("frame count=%d", got)
	}
	result := handler.OnChat(ChatMessage{ID: "msg-1", UserID: "u1", Nickname: "Alice", Content: "点歌 晴天"})
	if result.Added == nil || result.Added.Name != "晴天" {
		t.Fatalf("song chat result=%#v", result)
	}
	if len(queueUpdates) != 1 || len(queueUpdates[0]) != 1 || queueUpdates[0][0].ID != "msg-1" {
		t.Fatalf("request did not publish queue: %#v", queueUpdates)
	}
	handler.OnChat(ChatMessage{ID: "msg-2", UserID: "u1", Nickname: "Alice", Content: "取消点歌"})
	if len(queueUpdates) != 2 || len(queueUpdates[1]) != 0 {
		t.Fatalf("cancel did not publish empty queue: %#v", queueUpdates)
	}
	if statuses[0] != "新增点歌: 晴天" || statuses[1] != "已取消 1 条待点" {
		t.Fatalf("statuses=%#v", statuses)
	}
	if !reflect.DeepEqual(lines, []string{"Alice: 点歌 晴天", "Alice: 取消点歌"}) {
		t.Fatalf("event lines=%#v", lines)
	}
}
