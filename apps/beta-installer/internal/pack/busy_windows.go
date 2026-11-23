//go:build windows

package pack

import (
	"errors"
	"io/fs"

	"golang.org/x/sys/windows"
)

// isBusy: операцию с файлом или папкой не удалось выполнить, потому что объект занят.
// Признаки ищутся по всей цепочке обёрток (errors.Join и несколько %w тоже); ошибка,
// превращённая в текст без %w, не распознаётся. Отказ в доступе (код 5) приходит как
// fs.ErrPermission, поэтому любой отказ в доступе считается занятостью: настоящую
// нехватку прав от неё здесь не отличить.
func isBusy(err error) bool {
	return errors.Is(err, fs.ErrPermission) ||
		errors.Is(err, windows.ERROR_SHARING_VIOLATION) || // 32: файл открыт без права на удаление или переименование
		errors.Is(err, windows.ERROR_LOCK_VIOLATION) // 33: часть файла заблокирована другим процессом
}
