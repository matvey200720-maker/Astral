// Command fakeastral — пустышка Astral.exe для проверки сигнала stable на Windows
// (scripts/windows-e2e/stable-signal.ps1): дописывает в <корень>\launched.txt метку
// версии из tag.txt рядом с собой и выходит. Собирать без консоли, чтобы запуск
// хелпером не открыл окно:
//
//	GOOS=windows go build -ldflags "-H=windowsgui -s -w" -o Astral.exe ./cmd/fakeastral
//
// В exe установщика не попадает.
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// must отдаёт значение; провал — выход с кодом 1.
func must[T any](value T, err error) T {
	if err != nil {
		os.Exit(1)
	}
	return value
}

// run — один запуск пустышки: папка, где лежит сам exe.
type run struct {
	home string
}

// tag читает tag.txt рядом с exe; нет файла — пустая строка.
func (r run) tag() string {
	raw, _ := os.ReadFile(filepath.Join(r.home, "tag.txt"))
	return strings.TrimSpace(string(raw))
}

// line: метка версии, момент запуска, аргументы — через пробел, в конце перевод строки.
func (r run) line() string {
	stamp := time.Now().Format(time.RFC3339Nano)
	return fmt.Sprintf("%s %s %s\n", r.tag(), stamp, strings.Join(os.Args[1:], " "))
}

// record дописывает text в launched.txt родительской папки; провал открытия — выход с кодом 1.
func (r run) record(text string) {
	file := must(os.OpenFile(filepath.Join(filepath.Dir(r.home), "launched.txt"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644))
	_, _ = file.WriteString(text)
	_ = file.Close()
}

func main() {
	self := run{home: filepath.Dir(must(os.Executable()))}
	self.record(self.line())
}
