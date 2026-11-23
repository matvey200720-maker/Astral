//go:build !windows

// Command desktoprun работает только под Windows (см. main_windows.go).
package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Fprintln(os.Stderr, "desktoprun works on Windows only")
	os.Exit(1)
}
