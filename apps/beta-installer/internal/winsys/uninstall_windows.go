//go:build windows

package winsys

import (
	"errors"
	"fmt"
	"strings"

	"golang.org/x/sys/windows/registry"

	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/layout"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/sysapi"
)

// Запись о ветке в «Приложениях и возможностях» Windows. Идёт в HKCU, так что
// права администратора не нужны; у каждой ветки своя запись.

// uninstallRoot — системный список «Приложения» в HKCU.
const uninstallRoot = `Software\Microsoft\Windows\CurrentVersion\Uninstall`

// Имена значений записи: строковые (REG_SZ) и числовые (REG_DWORD).
var (
	uninstallTextValues   = strings.Fields("DisplayName DisplayVersion Publisher InstallLocation DisplayIcon UninstallString QuietUninstallString InstallDate")
	uninstallNumberValues = strings.Fields("NoModify NoRepair EstimatedSize")
)

// regWrite — одна запись значения в ключ.
type regWrite struct {
	name string
	put  func() error
}

// textWrites — записи строковых значений: пустые строки пропускаются.
func textWrites(key registry.Key, info sysapi.UninstallInfo) (plan []regWrite) {
	texts := []string{
		info.DisplayName, info.DisplayVersion, info.Publisher, info.InstallLocation,
		info.DisplayIcon, info.UninstallString, info.QuietUninstallString, info.InstallDate,
	}
	for i, value := range texts {
		if value == "" {
			continue
		}
		name := uninstallTextValues[i]
		plan = append(plan, regWrite{name, func() error { return key.SetStringValue(name, value) }})
	}
	return
}

// numberWrites — записи трёх чисел: два флага и размер; пишутся всегда.
func numberWrites(key registry.Key, sizeKB uint32) (plan []regWrite) {
	for i, number := range [...]uint32{1, 1, sizeKB} {
		name := uninstallNumberValues[i]
		plan = append(plan, regWrite{name, func() error { return key.SetDWordValue(name, number) }})
	}
	return
}

// writesFor составляет записи по порядку: непустые строки, затем три числа.
func writesFor(key registry.Key, info sysapi.UninstallInfo) []regWrite {
	return append(textWrites(key, info), numberWrites(key, info.EstimatedSizeKB)...)
}

// playOut выполняет записи до первой ошибки; её текст — «set <имя>: <ошибка>».
func playOut(plan []regWrite) error {
	for _, w := range plan {
		err := w.put()
		if err == nil {
			continue
		}
		return fmt.Errorf("set %s: %w", w.name, err)
	}
	return nil
}

// hive — ключ HKCU, открытый на чтение; чего нет или не того типа, того «нет» и здесь.
type hive struct{ registry.Key }

func (h hive) text(name string) (string, bool) {
	got, _, err := h.GetStringValue(name)
	return got, err == nil
}

func (h hive) number(name string) (uint64, bool) {
	got, _, err := h.GetIntegerValue(name)
	return got, err == nil
}

// peek открывает ключ path в HKCU на чтение и отдаёт его read. Ошибка
// открытия возвращается как есть, и read тогда не зовётся.
func peek(path string, read func(hive)) error {
	k, err := registry.OpenKey(registry.CURRENT_USER, path, registry.QUERY_VALUE)
	if err == nil {
		defer k.Close()
		read(hive{k})
	}
	return err
}

// uninstallPath — путь ключа записи внутри HKCU. С приставкой System.UninstallKey
// имя становится «<приставка>-<ветка>» (ветка подставляется как есть, даже пустая
// или неизвестная); база — System.UninstallBase, если она задана. Пути склеиваются
// простой косой, без очистки: база с завершающей «\» даст две подряд.
func (s *System) uninstallPath(ch layout.Channel) string {
	var leaf string
	if s.UninstallKey == "" {
		leaf = ch.UninstallKey()
	} else {
		leaf = s.UninstallKey + "-" + string(ch)
	}
	return strings.Join([]string{orElse(s.UninstallBase, uninstallRoot), leaf}, `\`)
}

// ReadUninstall читает запись обратно (самопроверка и тесты; в sysapi.System не входит).
// Карта не nil, если ключ открылся; в неё попадают только значения нужного типа,
// числа — десятичной строкой.
func (s *System) ReadUninstall(ch layout.Channel) (values map[string]string, err error) {
	err = peek(s.uninstallPath(ch), func(h hive) {
		values = make(map[string]string)
		collect := func(names []string, fetch func(string) (string, bool)) {
			for _, name := range names {
				if v, ok := fetch(name); ok {
					values[name] = v
				}
			}
		}
		collect(uninstallTextValues, h.text)
		collect(uninstallNumberValues, func(name string) (string, bool) {
			n, ok := h.number(name)
			return fmt.Sprint(n), ok
		})
	})
	return values, err
}

// UninstallRoot — место установки из записи; пусто, если записи, значения или
// строкового типа нет. REG_EXPAND_SZ отдаётся без раскрытия переменных.
func (s *System) UninstallRoot(ch layout.Channel) string {
	var where string
	peek(s.uninstallPath(ch), func(h hive) { where, _ = h.text("InstallLocation") })
	return where
}

// UnregisterUninstall удаляет запись ветки; её отсутствие — не ошибка. Ключ с
// подключами не удаляется, ошибка реестра возвращается как есть.
func (s *System) UnregisterUninstall(ch layout.Channel) error {
	return missingIsFine(registry.DeleteKey(registry.CURRENT_USER, s.uninstallPath(ch)))
}

// missingIsFine убирает ошибку «ключа нет»; прочие ошибки проходят как есть.
func missingIsFine(err error) error {
	switch {
	case errors.Is(err, registry.ErrNotExist):
		return nil
	default:
		return err
	}
}

// RegisterUninstall создаёт или обновляет запись. Пустые строки не пишутся и не
// стирают прежние значения; числа пишутся всегда. Чужие значения в ключе не трогаются.
func (s *System) RegisterUninstall(ch layout.Channel, info sysapi.UninstallInfo) error {
	where := s.uninstallPath(ch)
	key, _, err := registry.CreateKey(registry.CURRENT_USER, where, registry.SET_VALUE)
	if err == nil {
		defer key.Close()
		return playOut(writesFor(key, info))
	}
	return fmt.Errorf("create uninstall key: %w", err)
}
