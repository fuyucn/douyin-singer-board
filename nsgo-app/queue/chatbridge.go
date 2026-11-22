package queue

import (
	"fmt"
	"sync/atomic"
)

type ChatHandler struct {
	matcher *Matcher
	append  func(string)
	changed func([]Song)
	status  func(string)
	frames  atomic.Int64
}

func NewChatHandler(matcher *Matcher, appendLine func(string), changed func([]Song), status func(string)) *ChatHandler {
	return &ChatHandler{matcher: matcher, append: appendLine, changed: changed, status: status}
}

func (h *ChatHandler) OnFrame() int64 {
	if h == nil || h.matcher == nil {
		return 0
	}
	return h.frames.Add(1)
}

func (h *ChatHandler) OnChat(message ChatMessage) Result {
	if h == nil || h.matcher == nil {
		return Result{Ignored: "song matcher is unavailable"}
	}
	if h.append != nil {
		h.append(fmt.Sprintf("%s: %s", message.Nickname, message.Content))
	}
	result := h.matcher.Match(message)
	if result.Added != nil {
		if h.status != nil {
			h.status("新增点歌: " + result.Added.Name)
		}
		if h.changed != nil {
			h.changed(h.matcher.Queue())
		}
	}
	if result.Cancelled > 0 {
		if h.status != nil {
			h.status(fmt.Sprintf("已取消 %d 条待点", result.Cancelled))
		}
		if h.changed != nil {
			h.changed(h.matcher.Queue())
		}
	}
	if result.Ignored != "" && h.append != nil {
		h.append("已忽略: " + result.Ignored)
	}
	return result
}
