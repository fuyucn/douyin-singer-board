package adapter

import (
	"context"
	"testing"
)

func TestKuGouDeviceRemainsStableAcrossQRCalls(t *testing.T) {
	devices := []string{}
	client := Client{ID: KuGou, Do: func(_ context.Context, _, _ string, request Request) (any, error) {
		devices = append(devices, request.Headers["mid"])
		return map[string]any{"data": map[string]any{"qrcode": "key", "status": 1}}, nil
	}}
	var result any
	if err := client.Call(context.Background(), "loginQrKey", struct{}{}, &result); err != nil {
		t.Fatal(err)
	}
	if err := client.Call(context.Background(), "loginQrCheck", map[string]string{"key": "key"}, &result); err != nil {
		t.Fatal(err)
	}
	if len(devices) != 2 || devices[0] == "" || devices[0] != devices[1] {
		t.Fatal("QR operations changed the platform device identity")
	}
}
