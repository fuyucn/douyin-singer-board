package listener

import (
	"context"
	"crypto/md5"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/coder/websocket"
)

const (
	userAgent      = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
	roomAgent      = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
	browserVersion = "5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
	websocketHost  = "webcast100-ws-web-hl.douyin.com"
)

var roomIDPattern = regexp.MustCompile(`roomId\\":\\"([0-9]{15,})`)

type Callbacks struct {
	OnStatus func(string)
	OnFrame  func()
	OnChat   func(ChatMessage)
	OnAck    func()
}

func Run(ctx context.Context, roomID string, callbacks Callbacks) error {
	if ctx == nil {
		return errors.New("listener context is nil")
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	if strings.TrimSpace(roomID) == "" {
		return errors.New("room ID is empty")
	}
	status(callbacks, "正在读取直播间")
	client := &http.Client{Timeout: 20 * time.Second}
	room, err := fetchRoom(ctx, client, roomID)
	if err != nil {
		return err
	}
	cookies, err := fetchCookies(ctx, client)
	if err != nil {
		return err
	}
	socketURL, err := signedWebsocketURL(room, websocketHost)
	if err != nil {
		return err
	}
	status(callbacks, "正在连接弹幕流")
	conn, response, err := websocket.Dial(ctx, socketURL, &websocket.DialOptions{HTTPHeader: http.Header{
		"Cookie":     []string{cookies},
		"User-Agent": []string{userAgent},
		"Origin":     []string{"https://live.douyin.com"},
		"Referer":    []string{"https://live.douyin.com/"},
	}})
	if err != nil {
		if response != nil {
			return fmt.Errorf("connect Douyin websocket (HTTP %s): %w", response.Status, err)
		}
		return fmt.Errorf("connect Douyin websocket: %w", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "listener stopped")
	status(callbacks, "已连接，等待弹幕")

	closed := make(chan struct{})
	defer close(closed)
	go func() {
		select {
		case <-ctx.Done():
			conn.Close(websocket.StatusNormalClosure, "listener stopped")
		case <-closed:
		}
	}()

	heartbeat := time.NewTicker(10 * time.Second)
	defer heartbeat.Stop()
	type readResult struct {
		kind websocket.MessageType
		data []byte
		err  error
	}
	results := make(chan readResult, 1)
	read := func() {
		go func() {
			kind, data, err := conn.Read(ctx)
			results <- readResult{kind: kind, data: data, err: err}
		}()
	}
	read()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-heartbeat.C:
			writeCtx, cancelWrite := context.WithTimeout(ctx, 5*time.Second)
			err := conn.Write(writeCtx, websocket.MessageText, []byte(":\x02hb"))
			cancelWrite()
			if err != nil {
				return fmt.Errorf("send Douyin heartbeat: %w", err)
			}
		case received := <-results:
			if received.err != nil {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				return fmt.Errorf("read Douyin websocket frame: %w", received.err)
			}
			if callbacks.OnFrame != nil {
				callbacks.OnFrame()
			}
			if received.kind != websocket.MessageBinary {
				read()
				continue
			}
			frame, err := decodeFrame(received.data)
			if err != nil {
				return err
			}
			for _, chat := range frame.Chats {
				if callbacks.OnChat != nil {
					callbacks.OnChat(chat)
				}
			}
			if frame.NeedAck {
				writeCtx, cancelWrite := context.WithTimeout(ctx, 5*time.Second)
				err := conn.Write(writeCtx, websocket.MessageBinary, encodeAck(frame.LogID, frame.Internal))
				cancelWrite()
				if err != nil {
					return fmt.Errorf("acknowledge Douyin frame: %w", err)
				}
				if callbacks.OnAck != nil {
					callbacks.OnAck()
				}
			}
			read()
		}
	}
}

func status(callbacks Callbacks, value string) {
	if callbacks.OnStatus != nil {
		callbacks.OnStatus(value)
	}
}

func fetchRoom(ctx context.Context, client *http.Client, roomID string) (string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://live.douyin.com/"+url.PathEscape(roomID), nil)
	if err != nil {
		return "", fmt.Errorf("create room request: %w", err)
	}
	request.Header.Set("User-Agent", roomAgent)
	response, err := client.Do(request)
	if err != nil {
		return "", fmt.Errorf("fetch Douyin room: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", fmt.Errorf("fetch Douyin room: HTTP %s", response.Status)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 16<<20))
	if err != nil {
		return "", fmt.Errorf("read Douyin room response: %w", err)
	}
	return resolvedRoomID(body, roomID), nil
}

func resolvedRoomID(body []byte, fallback string) string {
	match := roomIDPattern.FindSubmatch(body)
	if len(match) > 1 {
		return string(match[1])
	}
	return fallback
}

func fetchCookies(ctx context.Context, client *http.Client) (string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://live.douyin.com/", nil)
	if err != nil {
		return "", fmt.Errorf("create cookie request: %w", err)
	}
	request.Header.Set("User-Agent", roomAgent)
	response, err := client.Do(request)
	if err != nil {
		return "", fmt.Errorf("fetch Douyin cookies: %w", err)
	}
	defer response.Body.Close()
	var values []string
	for _, cookie := range response.Cookies() {
		if cookie.Name != "" {
			values = append(values, cookie.Name+"="+cookie.Value)
		}
	}
	if len(values) == 0 {
		return "", errors.New("Douyin did not return a session cookie")
	}
	return strings.Join(values, "; "), nil
}

func signedWebsocketURL(roomID, host string) (string, error) {
	uniqueID, err := uniqueUserID()
	if err != nil {
		return "", err
	}
	const versionCode = "180800"
	const sdkVersion = "1.0.15"
	signatureParams := []string{
		"live_id=1", "aid=6383", "version_code=180800", "webcast_sdk_version=1.0.15",
		"room_id=" + roomID, "sub_room_id=", "sub_channel_id=", "did_rule=3",
		"user_unique_id=" + uniqueID, "device_platform=web", "device_type=", "ac=", "identity=audience",
	}
	digest := md5.Sum([]byte(strings.Join(signatureParams, ",")))
	signature, err := signXMSStub(hex.EncodeToString(digest[:]))
	if err != nil {
		return "", fmt.Errorf("sign Douyin websocket request: %w", err)
	}
	params := url.Values{
		"app_name": {"douyin_web"}, "room_id": {roomID}, "compress": {"gzip"},
		"version_code": {versionCode}, "webcast_sdk_version": {sdkVersion}, "update_version_code": {sdkVersion},
		"live_id": {"1"}, "did_rule": {"3"}, "user_unique_id": {uniqueID}, "identity": {"audience"},
		"signature": {signature}, "device_platform": {"web"}, "cookie_enabled": {"true"},
		"screen_width": {"1920"}, "screen_height": {"1080"}, "browser_language": {"zh-CN"},
		"browser_platform": {"Win32"}, "browser_name": {"Mozilla"}, "browser_version": {browserVersion},
		"browser_online": {"true"}, "tz_name": {"Etc/GMT-8"}, "host": {"https://live.douyin.com"},
		"aid": {"6383"}, "endpoint": {"live_pc"}, "support_wrds": {"1"},
		"im_path": {"/webcast/im/fetch/"}, "need_persist_msg_count": {"15"}, "heartbeatDuration": {"0"},
	}
	return "wss://" + host + "/webcast/im/push/v2/?" + params.Encode(), nil
}

func uniqueUserID() (string, error) {
	span := big.NewInt(699999999999999999)
	n, err := rand.Int(rand.Reader, span)
	if err != nil {
		return "", fmt.Errorf("generate Douyin visitor ID: %w", err)
	}
	return new(big.Int).Add(n, big.NewInt(7300000000000000000)).String(), nil
}
