//go:build windows

package pack

import (
	"errors"

	"golang.org/x/sys/windows"
)

// IsDiskFull сообщает, что запись не удалась из-за нехватки места: в цепочке ошибки
// (обёртки %w, *fs.PathError, *os.LinkError, errors.Join) есть код 112 или 39.
// ENOSPC стандартной библиотеки на Windows — выдуманный код, не 112, поэтому он не
// годится; квоты (1295, 1816), нехватка памяти (8) и io.ErrShortWrite сюда не относятся.
func IsDiskFull(err error) bool {
	switch {
	case errors.Is(err, windows.ERROR_DISK_FULL): // 112: на диске не хватает места
		return true
	case errors.Is(err, windows.ERROR_HANDLE_DISK_FULL): // 39: диск заполнен
		return true
	}
	return false
}
