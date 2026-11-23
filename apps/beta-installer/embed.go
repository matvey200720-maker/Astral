// Package installer вшивает интерфейс установщика (каталог ui/) в exe.
package installer

import (
	"embed"
	"io/fs"
)

// Интерфейс делает сессия «Система автообновления и интерфейс»: чистая
// статика, без сборщика. all: нужен, чтобы вшилась и .gitkeep пустого
// каталога, иначе go:embed не соберётся до появления настоящих файлов.
//
//go:embed all:ui
var content embed.FS

// UI возвращает корень интерфейса: index.html лежит прямо в нём.
func UI() fs.FS {
	sub, err := fs.Sub(content, "ui")
	if err != nil {
		panic(err) // каталог ui вшит при сборке, ошибки быть не может
	}
	return sub
}
