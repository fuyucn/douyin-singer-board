package listener

import (
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"net/url"
	"testing"
)

func TestDecodeFrameChatAndAck(t *testing.T) {
	user := appendVarintField(nil, 1, 123456789)
	user = appendBytesField(user, 3, []byte("观众"))
	chat := appendBytesField(nil, 2, user)
	chat = appendBytesField(chat, 3, []byte("点歌 晴天"))
	message := appendBytesField(nil, 1, []byte("WebcastChatMessage"))
	message = appendBytesField(message, 2, chat)
	response := appendBytesField(nil, 1, message)
	response = appendBytesField(response, 5, []byte("cursor"))
	response = appendVarintField(response, 9, 1)

	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	if _, err := writer.Write(response); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	frame := appendVarintField(nil, 2, 987654321)
	frame = appendBytesField(frame, 8, compressed.Bytes())

	got, err := decodeFrame(frame)
	if err != nil {
		t.Fatal(err)
	}
	if got.LogID != 987654321 || !got.NeedAck || got.Internal != "cursor" {
		t.Fatalf("unexpected response metadata: %#v", got)
	}
	if len(got.Chats) != 1 || got.Chats[0].UserID != "123456789" || got.Chats[0].Nickname != "观众" || got.Chats[0].Content != "点歌 晴天" {
		t.Fatalf("unexpected chat: %#v", got.Chats)
	}
	ack := encodeAck(got.LogID, got.Internal)
	ackLogID, n := binary.Uvarint(ack[1:])
	if ack[0] != 16 || n <= 0 || ackLogID != got.LogID {
		t.Fatalf("invalid ack frame: %x", ack)
	}
}

func TestSignedWebsocketURLIncludesSignerOutput(t *testing.T) {
	signature, err := signXMSStub("0123456789abcdef0123456789abcdef")
	if err != nil {
		t.Fatal(err)
	}
	if len(signature) != 16 || signature == "00000000" {
		t.Fatalf("Goja signer returned invalid X-Bogus signature %q", signature)
	}
	value, err := signedWebsocketURL("123456789", "example.com")
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(value)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Scheme != "wss" || parsed.Host != "example.com" || parsed.Query().Get("signature") == "" || parsed.Query().Get("signature") == "00000000" {
		t.Fatalf("invalid signed websocket URL: %s", value)
	}
}

func TestDecodeFrameRejectsTruncatedInput(t *testing.T) {
	if _, err := decodeFrame([]byte{0x12, 0x05, 0x01}); err == nil {
		t.Fatal("expected malformed protobuf error")
	}
}

func TestResolvedRoomIDUsesRoomPageValue(t *testing.T) {
	body := []byte("roomId\\\":\\\"1234567890123456789")
	if got := resolvedRoomID(body, "695340048764"); got != "1234567890123456789" {
		t.Fatalf("resolved room ID = %q", got)
	}
	if got := resolvedRoomID([]byte("room page without an ID"), "695340048764"); got != "695340048764" {
		t.Fatalf("fallback room ID = %q", got)
	}
}
