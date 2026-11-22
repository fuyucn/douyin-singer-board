package main

import (
	"fmt"
	"strings"

	"github.com/sususongboard/nsgo-app/queue"
)

func isMaskedNickname(name string) bool {
	name = strings.TrimSpace(name)
	if name == "" || strings.Contains(name, "*") {
		return true
	}
	lower := strings.ToLower(name)
	return strings.HasPrefix(lower, "匿名") || strings.HasPrefix(lower, "游客")
}

func chatUserID(message queue.ChatMessage) string {
	userID := strings.TrimSpace(message.UserID)
	validUID := userID != "" && userID != "0"
	name := strings.TrimSpace(message.Nickname)
	if isMaskedNickname(name) {
		if validUID {
			return "anon:uid:" + userID
		}
		if name != "" {
			return "anon:name:" + name
		}
		return "anonymous"
	}
	if validUID {
		return userID
	}
	if name != "" {
		return "anon:name:" + name
	}
	return "anonymous"
}

func isAnonymousUserID(userID string) bool {
	return userID == "anonymous" || strings.HasPrefix(userID, "anon:")
}

func maskUserID(userID string) string {
	userID = strings.TrimSpace(userID)
	if len(userID) <= 4 {
		return userID
	}
	return "…" + userID[len(userID)-4:]
}

func maskIdentity(userID string) string {
	if strings.HasPrefix(userID, "anon:uid:") {
		return "anon:uid:" + maskUserID(strings.TrimPrefix(userID, "anon:uid:"))
	}
	if strings.HasPrefix(userID, "anon:name:") {
		return userID
	}
	return maskUserID(userID)
}

func (board *boardState) handleChat(message queue.ChatMessage) {
	rawUID, rawNickname := message.UserID, message.Nickname
	message.UserID = chatUserID(message)
	result := board.matcher.Match(message)
	if result.Ignored != "" {
		board.logRequestRejection(message.Nickname, message.Content, result.Ignored)
		return
	}
	if result.Added == nil {
		board.log(message.Nickname + ": " + message.Content)
		return
	}
	song := result.Added
	board.logDebug(fmt.Sprintf("弹幕识别 rawUID=%q uid=%q nickname=%q masked=%t", maskUserID(rawUID), maskIdentity(song.UserID), rawNickname, isMaskedNickname(rawNickname)))
	admitted := board.admitSong(*song)
	board.logDebug(fmt.Sprintf("点歌决策 uid=%s anonymous=%t count=%d limit=%d admitted=%t", maskIdentity(song.UserID), isAnonymousUserID(song.UserID), board.successCount(song.UserID), board.settings.Rules.Limit, admitted))
	if admitted {
		board.log(message.Nickname + ": " + message.Content)
	}
}

func (board *boardState) logRequestRejection(nickname, request, reason string) {
	board.logWarn(fmt.Sprintf("点歌拒绝：%s「%s」— %s", nickname, request, reason))
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
	count := board.successCount(song.UserID)
	for _, existing := range board.played {
		if strings.TrimSpace(existing.Song.Name) == strings.TrimSpace(song.Name) {
			duplicate = true
		}
	}
	if duplicate {
		board.matcher.RemoveByID(song.ID)
		board.notify("已在列表中：" + song.Name)
		board.logRequestRejection(song.Nickname, song.RawMessage, "已在待点或已点列表中")
		return false
	}
	if !song.Manual && !isAnonymousUserID(song.UserID) && board.settings.Rules.Limit > 0 && count >= board.settings.Rules.Limit {
		board.matcher.RemoveByID(song.ID)
		board.notify("已达每人单场点歌上限")
		board.logRequestRejection(song.Nickname, song.RawMessage, fmt.Sprintf("已达每人单场点歌上限（%d/%d）", count, board.settings.Rules.Limit))
		return false
	}
	board.scheduleSync()
	return true
}
