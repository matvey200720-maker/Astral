//go:build !windows

package pack

import (
	"errors"
	"syscall"
)

// IsDiskFull сообщает, что запись не удалась из-за нехватки места.
func IsDiskFull(err error) bool {
	return errors.Is(err, syscall.ENOSPC)
}
