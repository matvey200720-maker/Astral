//go:build windows

package machine

import (
	"errors"
	"fmt"

	"golang.org/x/sys/windows/registry"
)

// Лаунчер на Electron x64 смотрит в 64-битный вид реестра; установщик обязан смотреть
// в тот же, иначе три стороны увидят разные машины.
const wow64Query uint32 = registry.QUERY_VALUE | registry.WOW64_64KEY

// guidSource — где лежит идентификатор машины.
var guidSource = struct{ path, value string }{`SOFTWARE\Microsoft\Cryptography`, "MachineGuid"}

func openGUIDKey() (registry.Key, error) {
	return registry.OpenKey(registry.LOCAL_MACHINE, guidSource.path, wow64Query)
}

// ReadGUID возвращает MachineGuid из HKLM как есть: без обрезки, без смены регистра,
// без проверки вида. Реестр читается при каждом вызове, кэша нет.
func ReadGUID() (guid string, err error) {
	key, err := openGUIDKey()
	if err != nil {
		err = fmt.Errorf("open Cryptography key: %w", err)
		return
	}
	defer func() { _ = key.Close() }()

	switch guid, _, err = key.GetStringValue(guidSource.value); {
	case err != nil:
		return "", fmt.Errorf("read %s: %w", guidSource.value, err)
	case guid == "":
		return "", errors.New(guidSource.value + " is empty")
	}
	return guid, nil
}
