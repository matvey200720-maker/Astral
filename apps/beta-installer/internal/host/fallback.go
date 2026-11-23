package host

import (
	"errors"
	"io/fs"
	"strings"
	"time"
)

// pageName — файл, вместо которого подставляется страница-заглушка.
const pageName = "index.html"

// Страница вместо отсутствующего ui/index.html. Английская намеренно,
// без перевода строки в конце.
const missingUIPage = `<!doctype html><meta charset="utf-8"><title>Astral Beta</title>
<body style="margin:0;background:#0a0a0b;color:#f4f4f5;font:15px system-ui;display:grid;place-items:center;height:100vh">
<div style="max-width:520px;text-align:center"><p style="font-size:20px">Astral Beta</p>
<p style="color:#a6a6ac">UI is missing in this build: ui/index.html was not embedded.</p></div></body>`

// stubFile — открытая страница-заглушка; у каждого Open свой читатель.
type stubFile struct{ *strings.Reader }

func (stubFile) Close() error { return nil }

func (stubFile) Stat() (fs.FileInfo, error) { return stubInfo{}, nil }

// stubInfo — обычный файл без режима и времени изменения.
type stubInfo struct{}

func (stubInfo) Name() string       { return pageName }
func (stubInfo) Size() int64        { return int64(len(missingUIPage)) }
func (stubInfo) Mode() fs.FileMode  { return 0 }
func (stubInfo) ModTime() time.Time { return time.Time{} }
func (stubInfo) IsDir() bool        { return false }
func (stubInfo) Sys() any           { return nil }

type fallbackFS struct{ inner fs.FS }

// WithFallback оборачивает inner: если корневого index.html там нет, его
// открытие отдаёт страницу-заглушку. Остальное делегируется inner как есть.
func WithFallback(inner fs.FS) fs.FS { return fallbackFS{inner} }

func (f fallbackFS) Open(name string) (fs.File, error) {
	file, err := f.inner.Open(name)
	if name == pageName && errors.Is(err, fs.ErrNotExist) {
		return stubFile{strings.NewReader(missingUIPage)}, nil
	}
	return file, err
}
