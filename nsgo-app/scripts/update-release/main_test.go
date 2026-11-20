package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReleaseFeed(t *testing.T) {
	const direct = "https://github.com/example/project/releases/download/nsgo-preview/"
	const proxied = "https://gh-proxy.com/" + direct
	for _, input := range []string{
		"", "http://example.com/updates/", "https://user@example.com/updates/", "https://example.com/updates/?token=unsafe",
		"https://github.com/example/project/releases/latest/download/",
		"https://gh-proxy.com/https://github.com/example/project/releases/latest/download/",
		"https://gh-proxy.com/https://example.com/updates/",
		"https://gh-proxy.com/" + proxied,
		"https://GH-PROXY.com/" + direct,
		"https://github.com./example/project/releases/latest/download/",
		"https://github.com:443/example/project/releases/download/nsgo-preview/",
		"https://github.com/example%2Fproject/releases/download/nsgo-preview/",
		"https://github.com/example/../releases/download/nsgo-preview/",
		"https://github.com/example/project/archive/releases/download/nsgo-preview/",
		proxied + "appcast-macos_arm64.xml",
		proxied + "#fragment",
	} {
		if _, err := releaseFeed(input, "preview"); err == nil {
			t.Errorf("accepted unsafe or shared feed %q", input)
		}
	}
	for input, expected := range map[string]string{
		"https://example.com/updates": "https://example.com/updates/",
		direct:                        proxied, strings.TrimSuffix(direct, "/"): proxied,
		proxied: proxied, strings.TrimSuffix(proxied, "/"): proxied,
	} {
		if feed, err := releaseFeed(input, "preview"); err != nil || feed != expected {
			t.Errorf("releaseFeed(%q) = %q, %v; want %q", input, feed, err, expected)
		}
	}
}

func TestStableReleaseFeed(t *testing.T) {
	const origin = "https://github.com/example/project/releases/download/nsgo-stable/"
	const expected = githubProxy + origin
	for _, input := range []string{origin, expected} {
		if feed, err := releaseFeed(input, "stable"); err != nil || feed != expected {
			t.Errorf("releaseFeed(%q, stable) = %q, %v; want %q", input, feed, err, expected)
		}
	}
	for _, input := range []string{
		strings.Replace(origin, "nsgo-stable", "nsgo-preview", 1),
		strings.Replace(origin, "nsgo-stable", "v0.43.0", 1),
		"https://github.com/example/project/releases/latest/download/",
	} {
		if _, err := releaseFeed(input, "stable"); err == nil {
			t.Errorf("stable update accepted an unrelated feed %q", input)
		}
	}
	if _, err := releaseFeed(origin, "preview"); err == nil {
		t.Fatal("preview update accepted the stable feed")
	}
}

func TestStableUpdateTestFeedIsIsolated(t *testing.T) {
	const origin = "https://github.com/example/project/releases/download/nsgo-stable-test/"
	const expected = githubProxy + origin
	for _, input := range []string{origin, expected} {
		if feed, err := releaseFeed(input, "stable-test"); err != nil || feed != expected {
			t.Errorf("releaseFeed(%q, stable-test) = %q, %v; want %q", input, feed, err, expected)
		}
	}
	if _, err := releaseFeed("https://github.com/example/project/releases/download/nsgo-stable/", "stable-test"); err == nil {
		t.Fatal("stable test updater accepted the production stable feed")
	}
	config := map[string]any{"id": "com.sususongboard.nsgo", "name": "SUSUSongBoard"}
	configureUpdateTestIdentity(config, "stable-test")
	if config["id"] != "com.sususongboard.nsgo.updatetest" || config["name"] != "SUSUSongBoard Update Test" {
		t.Fatalf("update test shares its app identity: %#v", config)
	}
}

func TestBuildReleaseRejectsWrongChannelVersion(t *testing.T) {
	for channel, version := range map[string]string{"preview": "0.43.0", "stable": "0.43.0-preview.1"} {
		t.Run(channel, func(t *testing.T) {
			t.Chdir(t.TempDir())
			if err := os.WriteFile("nsgo.yaml", []byte("version: "+version+"\n"), 0o600); err != nil {
				t.Fatal(err)
			}
			if err := buildRelease(channel, "windows_x64", 4300, "output"); err == nil || !strings.Contains(err.Error(), "does not match the "+channel+" update channel") {
				t.Fatalf("wrong version error: %v", err)
			}
		})
	}
}

func TestVerifySignedPreview(t *testing.T) {
	public, secret, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	const version, build = "0.43.0-preview.2", "12"
	const origin = "https://github.com/example/project/releases/download/nsgo-preview/"
	feed, err := releaseFeed(origin, "preview")
	if err != nil {
		t.Fatal(err)
	}
	installer := []byte("signed test installer")
	checksum := fmt.Sprintf("%x", sha256.Sum256(installer))
	signature := base64.StdEncoding.EncodeToString(ed25519.Sign(secret, installer))
	filename := "songboard-0.43.0-preview.2-windows-x64-setup.exe"
	dir := t.TempDir()
	artifact, appcast := filepath.Join(dir, filename), filepath.Join(dir, "appcast-windows_x64.xml")
	content := fmt.Sprintf(`<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><item><sparkle:version>%s</sparkle:version><sparkle:shortVersionString>%s</sparkle:shortVersionString><enclosure url="%s%s" length="%d" sparkle:os="windows" sparkle:version="%s" sparkle:shortVersionString="%s" sparkle:sha256="%s" sparkle:edSignature="%s" sparkle:installerArguments="/S /RELAUNCH"/></item></channel></rss>`,
		build, version, feed, filename, len(installer), build, version, checksum, signature)
	write := func(path string, data []byte) {
		t.Helper()
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write(artifact, installer)
	write(artifact+".sha256", []byte(checksum+"  "+filename+"\n"))
	write(appcast, []byte(content))
	verify := func() error { return verifyRelease(appcast, artifact, "windows_x64", feed, version, build, public) }
	if err := verify(); err != nil {
		t.Fatal(err)
	}
	for _, modified := range []string{
		strings.ReplaceAll(content, signature, ""),
		strings.ReplaceAll(content, feed, origin),
		strings.ReplaceAll(content, "/S /RELAUNCH", "/S"),
		strings.ReplaceAll(content, version, "0.43.0-preview.1"),
	} {
		write(appcast, []byte(modified))
		if verify() == nil {
			t.Fatal("accepted modified appcast")
		}
	}
	write(appcast, []byte(content))
	write(artifact, []byte("modified test installer"))
	if verify() == nil {
		t.Fatal("accepted modified installer")
	}
}
