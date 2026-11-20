package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"flag"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/nsgo-dev/nsgo/tsx/pkg"
	"go.yaml.in/yaml/v3"
)

var channelVersions = map[string]*regexp.Regexp{
	"preview":     regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+-preview\.[1-9][0-9]*$`),
	"stable":      regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+$`),
	"stable-test": regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+$`),
}
var githubReleasePath = regexp.MustCompile(`^/[A-Za-z0-9-]+/([A-Za-z0-9._-]+)/releases/download/(nsgo-preview|nsgo-stable|nsgo-stable-test)/?$`)

const githubProxy = "https://gh-proxy.com/"

func main() {
	channel := flag.String("channel", "preview", "preview or stable update channel")
	target := flag.String("target", "", "macos_arm64 or windows_x64")
	build := flag.Int("build-number", 0, "monotonically increasing numeric build")
	output := flag.String("output", "", "new directory for verified release assets")
	flag.Parse()
	if err := buildRelease(*channel, *target, *build, *output); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func buildRelease(channel, target string, build int, output string) error {
	suffixes := map[string]string{"macos_arm64": ".dmg", "windows_x64": "-setup.exe"}
	suffix, ok := suffixes[target]
	if !ok || build <= 0 || build > 2147483647 || output == "" {
		return errors.New("target, positive 32-bit build number and new output directory are required")
	}
	versionPattern, ok := channelVersions[channel]
	if !ok {
		return errors.New("update channel must be preview, stable, or stable-test")
	}
	data, err := os.ReadFile("nsgo.yaml")
	if err != nil {
		return err
	}
	var config map[string]any
	if err := yaml.Unmarshal(data, &config); err != nil {
		return err
	}
	version, _ := config["version"].(string)
	if !versionPattern.MatchString(version) {
		return fmt.Errorf("nsgo.yaml version %q does not match the %s update channel", version, channel)
	}
	configureUpdateTestIdentity(config, channel)
	feed, err := releaseFeed(os.Getenv("SONGBOARD_UPDATE_FEED"), channel)
	if err != nil {
		return err
	}
	public, keyErr := pkg.DecodePublicKey(os.Getenv("SONGBOARD_UPDATE_PUBLIC_KEY"))
	secret, secretErr := pkg.DecodeSecretKey(os.Getenv("NSGO_UPDATES_KEY"))
	if keyErr != nil || secretErr != nil || !secret.Public().(ed25519.PublicKey).Equal(public) {
		return errors.New("set matching SONGBOARD_UPDATE_PUBLIC_KEY and NSGO_UPDATES_KEY before building")
	}
	config["build_number"] = build
	config["updates"] = map[string]any{"channel": "direct", "automatic": true, "key": pkg.EncodePublicKey(public), "feed": feed}
	output, err = filepath.Abs(output)
	if err != nil {
		return err
	}
	if _, err := os.Lstat(output); !errors.Is(err, os.ErrNotExist) {
		return errors.New("update output directory must not exist")
	}
	stage, err := os.MkdirTemp("", "songboard-update-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	for _, dir := range []string{"assets", "listener", "platform", "queue", "store"} {
		if err := os.CopyFS(filepath.Join(stage, dir), os.DirFS(dir)); err != nil {
			return err
		}
	}
	for _, pattern := range []string{"*.go", "*.tsx", "go.mod", "go.sum", "theme.yaml"} {
		files, err := filepath.Glob(pattern)
		if err != nil {
			return err
		}
		for _, file := range files {
			if strings.HasSuffix(file, "_test.go") {
				continue
			}
			data, err := os.ReadFile(file)
			if err != nil {
				return err
			}
			if err := os.WriteFile(filepath.Join(stage, file), data, 0o644); err != nil {
				return err
			}
		}
	}
	data, err = yaml.Marshal(config)
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(stage, "nsgo.yaml"), data, 0o644); err != nil {
		return err
	}
	buildCmd := exec.Command("go", "tool", "nsgo", "build", "-target", target, "-installers=true", "-output", "update-dist")
	if target == "macos_arm64" {
		if identity := os.Getenv("SONGBOARD_MAC_SIGN_IDENTITY"); identity != "" {
			buildCmd.Args = append(buildCmd.Args, "-sign", identity)
		}
		if profile := os.Getenv("SONGBOARD_MAC_NOTARY_PROFILE"); profile != "" {
			buildCmd.Args = append(buildCmd.Args, "-notarize", profile)
		}
	}
	buildCmd.Dir, buildCmd.Stdout, buildCmd.Stderr = stage, os.Stdout, os.Stderr
	if err := buildCmd.Run(); err != nil {
		return err
	}
	releases := filepath.Join(stage, "update-dist", "releases")
	artifacts, err := filepath.Glob(filepath.Join(releases, "*-"+version+"-"+strings.ReplaceAll(target, "_", "-")+suffix))
	if err != nil || len(artifacts) != 1 {
		return fmt.Errorf("expected one %s installer; Windows requires NSIS", target)
	}
	appcast := filepath.Join(releases, "appcast-"+target+".xml")
	if err := verifyRelease(appcast, artifacts[0], target, feed, version, strconv.Itoa(build), public); err != nil {
		return err
	}
	files := []string{artifacts[0], artifacts[0] + ".sha256", appcast}
	assets := make([][]byte, len(files))
	for index, file := range files {
		assets[index], err = os.ReadFile(file)
		if err != nil {
			return err
		}
	}
	if err := os.MkdirAll(filepath.Dir(output), 0o755); err != nil {
		return err
	}
	if err := os.Mkdir(output, 0o755); err != nil {
		return err
	}
	for index, file := range files {
		if err := os.WriteFile(filepath.Join(output, filepath.Base(file)), assets[index], 0o644); err != nil {
			return err
		}
	}
	fmt.Println("Verified signed update assets:", output)
	return nil
}

func configureUpdateTestIdentity(config map[string]any, channel string) {
	if channel == "stable-test" {
		config["id"] = "com.sususongboard.nsgo.updatetest"
		config["name"] = "SUSUSongBoard Update Test"
	}
}

func releaseFeed(value, channel string) (string, error) {
	origin, proxied := strings.CutPrefix(value, githubProxy)
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil ||
		parsed.RawQuery != "" || parsed.ForceQuery || strings.ContainsAny(value, "\r\n\t # '\"") {
		return "", errors.New("SONGBOARD_UPDATE_FEED must be an HTTPS asset directory URL without credentials, query or fragment")
	}
	host := strings.TrimSuffix(strings.ToLower(parsed.Hostname()), ".")
	if proxied || host == "github.com" || host == "gh-proxy.com" {
		tag := "nsgo-" + channel
		if channel == "stable-test" {
			tag = "nsgo-stable-test"
		}
		parts := githubReleasePath.FindStringSubmatch(parsed.Path)
		if parsed.Host != "github.com" || parsed.RawPath != "" || parts == nil || parts[1] == "." || parts[1] == ".." || parts[2] != tag {
			return "", fmt.Errorf("GitHub update feed must point to https://github.com/OWNER/REPO/releases/download/%s/ with at most one GH Proxy prefix", tag)
		}
		return githubProxy + "https://github.com" + strings.TrimSuffix(parsed.Path, "/") + "/", nil
	}
	return strings.TrimRight(value, "/") + "/", nil
}

func verifyRelease(appcast, artifact, target, feed, version, build string, public ed25519.PublicKey) error {
	var document struct {
		Items []struct {
			Version string `xml:"http://www.andymatuschak.org/xml-namespaces/sparkle shortVersionString"`
			Build   string `xml:"http://www.andymatuschak.org/xml-namespaces/sparkle version"`
			Files   []struct {
				URL       string `xml:"url,attr"`
				Length    int    `xml:"length,attr"`
				OS        string `xml:"http://www.andymatuschak.org/xml-namespaces/sparkle os,attr"`
				Version   string `xml:"http://www.andymatuschak.org/xml-namespaces/sparkle shortVersionString,attr"`
				Build     string `xml:"http://www.andymatuschak.org/xml-namespaces/sparkle version,attr"`
				SHA256    string `xml:"http://www.andymatuschak.org/xml-namespaces/sparkle sha256,attr"`
				Signature string `xml:"http://www.andymatuschak.org/xml-namespaces/sparkle edSignature,attr"`
				Arguments string `xml:"http://www.andymatuschak.org/xml-namespaces/sparkle installerArguments,attr"`
			} `xml:"enclosure"`
		} `xml:"channel>item"`
	}
	data, err := os.ReadFile(appcast)
	if err != nil {
		return fmt.Errorf("signed appcast missing: %w", err)
	}
	if xml.Unmarshal(data, &document) != nil || len(document.Items) != 1 || len(document.Items[0].Files) != 1 {
		return errors.New("expected one appcast item and one enclosure")
	}
	item := document.Items[0]
	file := item.Files[0]
	system, _, _ := strings.Cut(target, "_")
	if item.Version != version || item.Build != build || file.Version != version || file.Build != build ||
		file.URL != feed+url.PathEscape(filepath.Base(artifact)) || file.OS != system || (system == "windows" && file.Arguments != "/S /RELAUNCH") {
		return errors.New("appcast version, target, installer URL or arguments do not match")
	}
	data, err = os.ReadFile(artifact)
	if err != nil {
		return err
	}
	digest := sha256.Sum256(data)
	checksum, err := os.ReadFile(artifact + ".sha256")
	hexDigest := hex.EncodeToString(digest[:])
	signature, signatureErr := base64.StdEncoding.DecodeString(file.Signature)
	if err != nil || strings.TrimSpace(string(checksum)) != hexDigest+"  "+filepath.Base(artifact) ||
		file.Length != len(data) || file.SHA256 != hexDigest || signatureErr != nil || !ed25519.Verify(public, data, signature) {
		return errors.New("installer checksum, length or Ed25519 signature did not verify")
	}
	return nil
}
