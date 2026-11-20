package main

import (
	"context"
	"strings"
	"time"

	"github.com/sususongboard/nsgo-app/platform/adapter"
	"github.com/sususongboard/nsgo-app/queue"
)

type songMatch struct {
	Status   string
	Track    track
	Attempts int
}

func (board *boardState) resetMatches() {
	for _, cancel := range board.matchRetries {
		cancel()
	}
	clear(board.matchRetries)
	if board.matchCancel != nil {
		board.matchCancel()
	}
	board.matchCancel = nil
	board.matchGeneration++
	board.matchWorkers = 0
	clear(board.matches)
}

func (board *boardState) scheduleMatches() {
	if board.settingsInvalid || !adapter.Known(board.settings.Platform) {
		return
	}
	if board.matchCancel == nil {
		var ctx context.Context
		ctx, board.matchCancel = context.WithCancel(board.ctx)
		board.matchContext = ctx
	}
	for _, song := range board.matcher.Queue() {
		name := strings.TrimSpace(song.Name)
		if board.matchWorkers >= 2 {
			return
		}
		previous, exists := board.matches[name]
		if exists && previous.Status != "retry" {
			continue
		}
		attempts := previous.Attempts
		board.matches[name] = songMatch{Status: "pending", Attempts: attempts}
		board.matchWorkers++
		generation, provider, services, ctx := board.matchGeneration, board.settings.Platform, board.services, board.matchContext
		go func() {
			select {
			case board.matchSlots <- struct{}{}:
			case <-ctx.Done():
				return
			}
			defer func() { <-board.matchSlots }()
			var tracks []track
			err := services.invoke(ctx, provider, "search", map[string]any{"keyword": name, "pagesize": 5}, &tracks)
			board.scope.Post(func() {
				if generation != board.matchGeneration {
					return
				}
				board.matchWorkers--
				entry := songMatch{Status: "not_found"}
				if err != nil {
					entry.Status = "error"
					entry.Attempts = attempts + 1
					if entry.Attempts <= 3 {
						board.matchRetries[name] = board.scope.AfterFunc(time.Duration(entry.Attempts)*2*time.Second, func() {
							if generation != board.matchGeneration {
								return
							}
							delete(board.matchRetries, name)
							current := board.matches[name]
							if current.Status != "error" {
								return
							}
							current.Status = "retry"
							board.matches[name] = current
							board.publish()
						})
					}
				} else {
					for _, candidate := range tracks {
						if candidate.identity() != "" && candidate.Name != "" {
							entry = songMatch{Status: "found", Track: candidate}
							break
						}
					}
				}
				board.matches[name] = entry
				board.scheduleSync()
				board.publish()
			})
		}()
	}
}

func (board *boardState) blocked(song queue.Song, candidate track) bool {
	for _, entry := range board.settings.Blacklist {
		if entry.Kind == "song" && (strings.EqualFold(entry.Name, song.Name) || strings.EqualFold(entry.Name, candidate.Name)) {
			return true
		}
		if entry.Kind == "singer" && candidate.Artist != "" && strings.Contains(strings.ToLower(candidate.Artist), strings.ToLower(entry.Name)) {
			return true
		}
	}
	return false
}
