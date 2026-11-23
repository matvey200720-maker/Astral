//go:build !windows

// Установщик работает только под Windows. Этот файл нужен, чтобы
// `go build ./...` и `go vet ./...` проходили и на Mac, где пишется код.
package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Fprintln(os.Stderr, "AstralBetaSetup works on Windows only; build it with GOOS=windows (see build.sh)")
	os.Exit(2)
}
