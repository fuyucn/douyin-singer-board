package main

import (
	"bytes"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func passingReport() string {
	var cases strings.Builder
	for _, name := range requiredTests {
		fmt.Fprintf(&cases, `<testcase name="%s"></testcase>`, name)
	}
	return fmt.Sprintf(`<testsuites tests="%d"><testsuite failures="0" skipped="0">%s</testsuite></testsuites>`, len(requiredTests), cases.String())
}

func TestVerifyReportRequiresEveryNativeTestWithoutSkips(t *testing.T) {
	valid := passingReport()
	first := `<testcase name="TestWorkbenchNativeScreenshot"></testcase>`
	for _, check := range []struct {
		name      string
		report    string
		wantError bool
	}{
		{"passing", valid, false},
		{"empty", `<testsuites tests="0"></testsuites>`, true},
		{"missing", strings.Replace(valid, first, "", 1), true},
		{"duplicate", strings.Replace(valid, first, first+first, 1), true},
		{"skipped case", strings.Replace(valid, first, strings.Replace(first, "</testcase>", "<skipped/></testcase>", 1), 1), true},
		{"failed case", strings.Replace(valid, first, strings.Replace(first, "</testcase>", "<failure/></testcase>", 1), 1), true},
		{"errored case", strings.Replace(valid, first, strings.Replace(first, "</testcase>", "<error/></testcase>", 1), 1), true},
		{"skipped suite", strings.Replace(valid, `skipped="0"`, `skipped="1"`, 1), true},
		{"failed root", strings.Replace(valid, "<testsuites ", `<testsuites failures="1" `, 1), true},
		{"wrong count", strings.Replace(valid, fmt.Sprintf(`tests="%d"`, len(requiredTests)), fmt.Sprintf(`tests="%d"`, len(requiredTests)+1), 1), true},
		{"invalid xml", "<testsuites", true},
	} {
		t.Run(check.name, func(t *testing.T) {
			if err := verifyReport([]byte(check.report)); (err != nil) != check.wantError {
				t.Fatalf("verifyReport error = %v, wantError %t", err, check.wantError)
			}
		})
	}
}

func screenshotFixtures(t *testing.T, directory string) {
	t.Helper()
	var desktop, narrow bytes.Buffer
	if err := png.Encode(&desktop, image.NewRGBA(image.Rect(0, 0, 1000, 680))); err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(&narrow, image.NewRGBA(image.Rect(0, 0, 390, 700))); err != nil {
		t.Fatal(err)
	}
	for _, theme := range []string{"dark", "light"} {
		for _, state := range screenshotStates {
			data := desktop.Bytes()
			if strings.Contains(state, "narrow") {
				data = narrow.Bytes()
			}
			if err := os.WriteFile(filepath.Join(directory, theme+"-"+state+".png"), data, 0600); err != nil {
				t.Fatal(err)
			}
		}
	}
}

func TestVerifyScreenshotsRequiresBothThemesAndViewports(t *testing.T) {
	directory := t.TempDir()
	if err := verifyScreenshots(directory); err == nil {
		t.Fatal("missing screenshots passed")
	}
	screenshotFixtures(t, directory)
	if err := verifyScreenshots(directory); err != nil {
		t.Fatal(err)
	}
	name := filepath.Join(directory, "light-susu-narrow-workbench.png")
	if err := os.WriteFile(name, []byte("not a PNG"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := verifyScreenshots(directory); err == nil {
		t.Fatal("invalid screenshot passed")
	}
	data, err := os.ReadFile(filepath.Join(directory, "dark-nsgo-workbench.png"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(name, data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := verifyScreenshots(directory); err == nil {
		t.Fatal("wrong viewport screenshot passed")
	}
}
