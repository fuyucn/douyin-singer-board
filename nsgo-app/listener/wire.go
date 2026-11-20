package listener

import (
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
)

type ChatMessage struct {
	ID         string
	UserID     string
	Nickname   string
	Content    string
	MedalName  string
	MedalLevel int
}

type decodedFrame struct {
	LogID    uint64
	NeedAck  bool
	Internal string
	Chats    []ChatMessage
}

type protobufField struct {
	number int
	wire   int
	value  uint64
	bytes  []byte
}

func fields(data []byte) ([]protobufField, error) {
	result := make([]protobufField, 0, 8)
	for len(data) > 0 {
		tag, size := binary.Uvarint(data)
		if size <= 0 {
			return nil, errors.New("invalid protobuf tag")
		}
		data = data[size:]
		field := protobufField{number: int(tag >> 3), wire: int(tag & 7)}
		if field.number == 0 {
			return nil, errors.New("protobuf field number is zero")
		}
		switch field.wire {
		case 0:
			field.value, size = binary.Uvarint(data)
			if size <= 0 {
				return nil, errors.New("invalid protobuf varint")
			}
			data = data[size:]
		case 1:
			if len(data) < 8 {
				return nil, errors.New("truncated protobuf fixed64")
			}
			field.value = binary.LittleEndian.Uint64(data[:8])
			data = data[8:]
		case 2:
			length, n := binary.Uvarint(data)
			if n <= 0 || length > uint64(len(data)-n) {
				return nil, errors.New("invalid protobuf byte length")
			}
			field.bytes = data[n : n+int(length)]
			data = data[n+int(length):]
		case 5:
			if len(data) < 4 {
				return nil, errors.New("truncated protobuf fixed32")
			}
			field.value = uint64(binary.LittleEndian.Uint32(data[:4]))
			data = data[4:]
		default:
			return nil, fmt.Errorf("unsupported protobuf wire type %d", field.wire)
		}
		result = append(result, field)
	}
	return result, nil
}

func decodeFrame(data []byte) (decodedFrame, error) {
	var result decodedFrame
	frameFields, err := fields(data)
	if err != nil {
		return result, fmt.Errorf("decode push frame: %w", err)
	}
	var payload []byte
	for _, field := range frameFields {
		switch field.number {
		case 2:
			result.LogID = field.value
		case 8:
			payload = field.bytes
		}
	}
	if len(payload) == 0 {
		return result, nil
	}
	var response bytes.Buffer
	reader, err := gzip.NewReader(bytes.NewReader(payload))
	if err != nil {
		return result, fmt.Errorf("open gzip response: %w", err)
	}
	if _, err := io.Copy(&response, io.LimitReader(reader, 16<<20)); err != nil {
		reader.Close()
		return result, fmt.Errorf("decompress response: %w", err)
	}
	if err := reader.Close(); err != nil {
		return result, fmt.Errorf("finish gzip response: %w", err)
	}
	responseFields, err := fields(response.Bytes())
	if err != nil {
		return result, fmt.Errorf("decode response: %w", err)
	}
	for _, field := range responseFields {
		switch field.number {
		case 1:
			message, err := decodeMessage(field.bytes)
			if err != nil {
				return result, err
			}
			if message != nil {
				message.ID = fmt.Sprintf("%d_%d", result.LogID, len(result.Chats))
				result.Chats = append(result.Chats, *message)
			}
		case 5:
			result.Internal = string(field.bytes)
		case 9:
			result.NeedAck = field.value != 0
		}
	}
	return result, nil
}

func decodeMessage(data []byte) (*ChatMessage, error) {
	messageFields, err := fields(data)
	if err != nil {
		return nil, fmt.Errorf("decode response message: %w", err)
	}
	var method string
	var payload []byte
	for _, field := range messageFields {
		if field.number == 1 {
			method = string(field.bytes)
		} else if field.number == 2 {
			payload = field.bytes
		}
	}
	if method != "WebcastChatMessage" {
		return nil, nil
	}
	chatFields, err := fields(payload)
	if err != nil {
		return nil, fmt.Errorf("decode chat message: %w", err)
	}
	chat := &ChatMessage{}
	for _, field := range chatFields {
		switch field.number {
		case 2:
			if err := decodeUser(field.bytes, chat); err != nil {
				return nil, err
			}
		case 3:
			chat.Content = string(field.bytes)
		case 24:
			if err := decodeFansClub(field.bytes, chat); err != nil {
				return nil, err
			}
		}
	}
	return chat, nil
}

func decodeUser(data []byte, chat *ChatMessage) error {
	userFields, err := fields(data)
	if err != nil {
		return fmt.Errorf("decode chat user: %w", err)
	}
	for _, field := range userFields {
		switch field.number {
		case 1:
			chat.UserID = formatInt64(field.value)
		case 3:
			chat.Nickname = string(field.bytes)
		case 21:
			if err := decodeBadgeImage(field.bytes, chat); err != nil {
				return err
			}
		case 24:
			if err := decodeFansClub(field.bytes, chat); err != nil {
				return err
			}
		}
	}
	return nil
}

func decodeBadgeImage(data []byte, chat *ChatMessage) error {
	image, err := fields(data)
	if err != nil {
		return fmt.Errorf("decode badge image: %w", err)
	}
	for _, field := range image {
		if field.number != 8 {
			continue
		}
		content, err := fields(field.bytes)
		if err != nil {
			return fmt.Errorf("decode badge content: %w", err)
		}
		for _, part := range content {
			switch part.number {
			case 3:
				chat.MedalLevel = int(part.value)
			case 4:
				chat.MedalName = string(part.bytes)
			}
		}
	}
	return nil
}

func decodeFansClub(data []byte, chat *ChatMessage) error {
	club, err := fields(data)
	if err != nil {
		return fmt.Errorf("decode fan club: %w", err)
	}
	for _, field := range club {
		if field.number != 1 {
			continue
		}
		clubData, err := fields(field.bytes)
		if err != nil {
			return fmt.Errorf("decode fan club data: %w", err)
		}
		for _, part := range clubData {
			switch part.number {
			case 1:
				if chat.MedalName == "" {
					chat.MedalName = string(part.bytes)
				}
			case 2:
				if int(part.value) > chat.MedalLevel {
					chat.MedalLevel = int(part.value)
				}
			}
		}
	}
	return nil
}

func formatInt64(value uint64) string {
	if value <= math.MaxInt64 {
		return fmt.Sprintf("%d", value)
	}
	return fmt.Sprintf("%d", int64(value))
}

func encodeAck(logID uint64, internal string) []byte {
	var frame []byte
	frame = appendVarintField(frame, 2, logID)
	frame = appendBytesField(frame, 7, []byte(internal))
	return frame
}

func appendVarintField(dst []byte, number int, value uint64) []byte {
	dst = binary.AppendUvarint(dst, uint64(number<<3))
	return binary.AppendUvarint(dst, value)
}

func appendBytesField(dst []byte, number int, value []byte) []byte {
	dst = binary.AppendUvarint(dst, uint64(number<<3|2))
	dst = binary.AppendUvarint(dst, uint64(len(value)))
	return append(dst, value...)
}
