package listener

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestLiveDouyinConnection(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	connected := make(chan struct{}, 1)
	frameReceived := make(chan struct{}, 1)
	ackSent := make(chan struct{}, 1)
	finished := make(chan error, 1)
	go func() {
		finished <- Run(ctx, "145997388006", Callbacks{
			OnStatus: func(value string) {
				if value == "已连接，等待弹幕" {
					select {
					case connected <- struct{}{}:
					default:
					}
				}
			},
			OnFrame: func() {
				select {
				case frameReceived <- struct{}{}:
				default:
				}
			},
			OnAck: func() {
				select {
				case ackSent <- struct{}{}:
				default:
				}
			},
		})
	}()
	select {
	case <-connected:
		select {
		case <-frameReceived:
			select {
			case <-ackSent:
				cancel()
				if err := <-finished; err != nil && !errors.Is(err, context.Canceled) {
					t.Fatalf("listener stopped unexpectedly after acknowledging a frame: %v", err)
				}
			case err := <-finished:
				if err != nil {
					t.Fatalf("listener disconnected before its first ACK: %v", err)
				}
				t.Fatal("listener stopped before sending its first ACK")
			case <-ctx.Done():
				t.Fatalf("received a frame but sent no ACK: %v", ctx.Err())
			}
		case err := <-finished:
			if err != nil {
				t.Fatalf("listener disconnected before its first frame: %v", err)
			}
			t.Fatal("listener stopped before receiving its first frame")
		case <-ctx.Done():
			t.Fatalf("connected but received no frames: %v", ctx.Err())
		}
	case err := <-finished:
		if err != nil {
			t.Fatalf("live connection failed: %v", err)
		}
		t.Fatal("listener stopped without connecting")
	case <-ctx.Done():
		t.Fatalf("timed out before the Douyin WebSocket connected: %v", ctx.Err())
	}
}
