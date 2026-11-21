package main

import (
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"image/png"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

var requiredTests = []string{
	"TestWorkbenchNativeScreenshot",
	"TestWorkbenchNarrowLayoutAndPlatformSettings",
	"TestStartControlUsesReferencePalette",
	"TestWorkbenchPointerTooltip",
	"TestWorkbenchFixtureReleasesResources",
}

var screenshotStates = []string{
	"nsgo-workbench", "nsgo-workbench-queue", "nsgo-platforms",
	"susu-settings-toast", "susu-workbench-playlists", "susu-clear-confirmation",
	"susu-song-tooltip", "susu-song-actions", "susu-workbench-ready",
	"susu-blacklist", "susu-log-panel", "susu-played", "susu-reset-confirmation",
	"susu-narrow-workbench", "susu-narrow-configuration",
}

type testReport struct {
	XMLName  xml.Name `xml:"testsuites"`
	Tests    int      `xml:"tests,attr"`
	Failures int      `xml:"failures,attr"`
	Errors   int      `xml:"errors,attr"`
	Skipped  int      `xml:"skipped,attr"`
	Suites   []struct {
		Failures int `xml:"failures,attr"`
		Errors   int `xml:"errors,attr"`
		Skipped  int `xml:"skipped,attr"`
		Cases    []struct {
			Name    string    `xml:"name,attr"`
			Failure *struct{} `xml:"failure"`
			Error   *struct{} `xml:"error"`
			Skipped *struct{} `xml:"skipped"`
		} `xml:"testcase"`
	} `xml:"testsuite"`
}

func verifyReport(data []byte) error {
	var report testReport
	if err := xml.Unmarshal(data, &report); err != nil {
		return err
	}
	if report.Failures != 0 || report.Errors != 0 || report.Skipped != 0 {
		return errors.New("native report contains failed, errored, or skipped tests")
	}
	passed := map[string]bool{}
	for _, suite := range report.Suites {
		if suite.Failures != 0 || suite.Errors != 0 || suite.Skipped != 0 {
			return errors.New("native report contains failed, errored, or skipped tests")
		}
		for _, result := range suite.Cases {
			if result.Name == "" || passed[result.Name] || result.Failure != nil || result.Error != nil || result.Skipped != nil {
				return fmt.Errorf("native test is missing, duplicated, failed, or skipped: %q", result.Name)
			}
			passed[result.Name] = true
		}
	}
	for _, name := range requiredTests {
		if !passed[name] {
			return fmt.Errorf("required native test did not pass: %s", name)
		}
	}
	if report.Tests != len(passed) {
		return errors.New("native report test count does not match its results")
	}
	return nil
}

func verifyScreenshots(directory string) error {
	for _, theme := range []string{"dark", "light"} {
		for _, state := range screenshotStates {
			name := filepath.Join(directory, theme+"-"+state+".png")
			file, err := os.Open(name)
			if err != nil {
				return err
			}
			config, err := png.DecodeConfig(file)
			file.Close()
			if err != nil {
				return fmt.Errorf("invalid native screenshot %s: %w", name, err)
			}
			width, height := 1000, 680
			if strings.Contains(state, "narrow") {
				width, height = 390, 700
			}
			delta := config.Width*height - config.Height*width
			if config.Width < width || config.Height < height || delta < -max(config.Width, config.Height) || delta > max(config.Width, config.Height) {
				return fmt.Errorf("screenshot %s has size %dx%d, expected a scaled %dx%d viewport", name, config.Width, config.Height, width, height)
			}
		}
	}
	return nil
}

func run() error {
	target := map[string]string{"darwin": "macos", "windows": "windows"}[runtime.GOOS]
	if target == "" {
		return errors.New("run native acceptance on macOS or Windows itself")
	}
	if _, err := os.Stat("nsgo.yaml"); err != nil {
		return errors.New("run native acceptance from the nsgo-app directory")
	}
	parent := filepath.Join(".nsgo", "acceptance")
	if err := os.MkdirAll(parent, 0700); err != nil {
		return err
	}
	directory, err := os.MkdirTemp(parent, target+"-")
	if err != nil {
		return err
	}
	log, err := os.Create(filepath.Join(directory, "native.log"))
	if err != nil {
		return err
	}
	defer log.Close()
	reportPath := filepath.Join(directory, "native.xml")
	screenshots := filepath.Join(directory, "screenshots")
	args := []string{"tool", "nsgo", "test", "-target", target, "-run", "^(" + strings.Join(requiredTests, "|") + ")$", "-timeout", "90s", "-junit", reportPath, "-screenshots", screenshots}
	command := exec.Command("go", args...)
	command.Stdout, command.Stderr = io.MultiWriter(os.Stdout, log), io.MultiWriter(os.Stderr, log)
	started := time.Now().UTC()
	result := command.Run()
	if result == nil {
		data, readErr := os.ReadFile(reportPath)
		result = readErr
		if result == nil {
			result = verifyReport(data)
		}
	}
	if result == nil {
		result = verifyScreenshots(screenshots)
	}
	head, _ := exec.Command("git", "rev-parse", "HEAD").Output()
	status, _ := exec.Command("git", "status", "--porcelain", "--untracked-files=all").Output()
	check := "PASS"
	if result != nil {
		check = "FAIL"
	}
	evidence := map[string]any{
		"startedAt": started, "completedAt": time.Now().UTC(), "target": target, "architecture": runtime.GOARCH,
		"commit": strings.TrimSpace(string(head)), "worktreeStatus": string(status), "command": append([]string{"go"}, args...),
		"nativeChecks": check, "visualReview": "NOT RUN", "overall": "NOT ACCEPTED",
		"screenshots": screenshots, "junit": reportPath,
	}
	if result != nil {
		evidence["error"] = result.Error()
	}
	data, err := json.MarshalIndent(evidence, "", "  ")
	if err == nil {
		err = os.WriteFile(filepath.Join(directory, "result.json"), append(data, '\n'), 0600)
	}
	fmt.Printf("Native checks: %s; visual review: NOT RUN; overall: NOT ACCEPTED. Evidence: %s\n", check, directory)
	return errors.Join(result, err)
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
