package main

import (
	"fmt"
	"strings"

	"github.com/sususongboard/nsgo-app/queue"
)

func (board *boardState) handleChat(message queue.ChatMessage) {
	result := board.matcher.Match(message)
	if result.Ignored != "" {
		board.logRequestRejection(message.Nickname, message.Content, result.Ignored)
	} else if result.Added == nil || board.admitSong(*result.Added) {
		board.log(message.Nickname + ": " + message.Content)
	}
}

func (board *boardState) logRequestRejection(nickname, request, reason string) {
	board.log(fmt.Sprintf("点歌拒绝：%s「%s」— %s", nickname, request, reason))
}

func (board *boardState) admitSong(song queue.Song) bool {
	queued := board.matcher.Queue()
	duplicate := false
	for index, existing := range queued {
		if index > 0 && strings.TrimSpace(existing.Name) == strings.TrimSpace(song.Name) {
			duplicate = true
			break
		}
	}
	count := 0
	for _, existing := range board.played {
		if strings.TrimSpace(existing.Song.Name) == strings.TrimSpace(song.Name) {
			duplicate = true
		}
		if existing.Song.UserID == song.UserID {
			count++
		}
	}
	if duplicate {
		board.matcher.RemoveByID(song.ID)
		board.notify("已在列表中：" + song.Name)
		board.logRequestRejection(song.Nickname, song.RawMessage, "已在待点或已点列表中")
		return false
	}
	if !song.Manual && board.settings.Rules.Limit > 0 && count >= board.settings.Rules.Limit {
		board.matcher.RemoveByID(song.ID)
		board.notify("已达每人单场点歌上限")
		board.logRequestRejection(song.Nickname, song.RawMessage, fmt.Sprintf("已达每人单场点歌上限（%d/%d）", count, board.settings.Rules.Limit))
		return false
	}
	board.scheduleSync()
	return true
}
