//go:build !windows

package pack

import (
	"errors"
	"io/fs"
)

// isBusy сообщает, что операция с файлом или каталогом не удалась из-за занятости объекта.
// Вне Windows занятость и нехватка прав не различаются: годится любой отказ в доступе.
func isBusy(err error) bool {
	return errors.Is(err, fs.ErrPermission)
}
