//go:build windows

package winsys

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
	"unsafe"
)

import "golang.org/x/sys/windows"

import (
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/comutil"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/sysapi"
)

// Ярлыки .lnk через COM-объект оболочки ShellLink (IShellLinkW и IPersistFile)
// вызовами по номерам слотов, без cgo.
//
// Адреса буферов и строк превращаются в uintptr только прямо в списке
// аргументов вызова, помеченного go:uintptrescapes (vtbl.call, vtbl.must,
// comutil.Call, LazyProc.Call). Заранее посчитанный uintptr терялся, когда
// стек горутины переезжал, и у прочитанного ярлыка пропадал путь.

// guidOf разбирает «{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}».
func guidOf(text string) windows.GUID {
	g, err := windows.GUIDFromString(text)
	if err != nil {
		panic(err)
	}
	return g
}

var ole32 = windows.NewLazySystemDLL("ole32.dll")

var (
	procCoCreateInstance = ole32.NewProc("CoCreateInstance")

	// CLSID_ShellLink, IID_IShellLinkW, IID_IPersistFile.
	clsidShellLink = guidOf("{00021401-0000-0000-C000-000000000046}")
	iidShellLinkW  = guidOf("{000214F9-0000-0000-C000-000000000046}")
	iidPersistFile = guidOf("{0000010B-0000-0000-C000-000000000046}")
)

// Слоты IShellLinkW после трёх методов IUnknown; безымянные — методы, которые
// нам не нужны.
const (
	vtGetPath = 3 + iota
	_         // GetIDList
	_         // SetIDList
	vtGetDescription
	vtSetDescription
	vtGetWorkingDirectory
	vtSetWorkingDirectory
	vtGetArguments
	vtSetArguments
	_ // GetHotkey
	_ // SetHotkey
	_ // GetShowCmd
	_ // SetShowCmd
	vtGetIconLocation
	vtSetIconLocation
	_ // SetRelativePath
	_ // Resolve
	vtSetPath
)

// Слоты IPersistFile (после IPersist).
const (
	_ = 3 + iota // GetClassID
	_            // IsDirty
	vtLoad
	vtSave
)

// shortcutBuf — размер буфера под строки, читаемые из ярлыка, в знаках UTF-16;
// более длинное значение читается обрезанным (1023 знака) без ошибки.
const shortcutBuf = 1 << 10

// slab — буфер под одну такую строку.
type slab [shortcutBuf]uint16

// ShortcutInfo — то, что лежит в ярлыке.
type ShortcutInfo struct {
	Target, WorkDir, Args, Description, Icon string
}

// utf16 — указатель на строку UTF-16. Строка с NUL внутри превращается в пустую:
// ярлык создаётся без этого значения, а не с ошибкой.
func utf16(s string) *uint16 {
	p, err := windows.UTF16PtrFromString(s)
	if err != nil {
		p, _ = windows.UTF16PtrFromString("")
	}
	return p
}

// vtbl — COM-объект: вызовы идут по номеру слота таблицы виртуальных методов.
type vtbl struct{ raw unsafe.Pointer }

// call вызывает метод и отдаёт HRESULT как есть.
//
//go:uintptrescapes
func (o vtbl) call(slot int, args ...uintptr) int32 {
	return comutil.Call(o.raw, slot, args...)
}

// must вызывает метод и превращает отрицательный HRESULT в ошибку «<op>: HRESULT 0x…».
//
//go:uintptrescapes
func (o vtbl) must(op string, slot int, args ...uintptr) error {
	return comutil.Check(op, o.call(slot, args...))
}

// drop отпускает ссылку; пустой объект допустим.
func (o vtbl) drop() { comutil.Release(o.raw) }

// persist спрашивает у объекта интерфейс IPersistFile (QueryInterface — слот 0).
func (o vtbl) persist() (vtbl, error) {
	var pf unsafe.Pointer
	err := o.must("QueryInterface(IPersistFile)", 0,
		uintptr(unsafe.Pointer(&iidPersistFile)), uintptr(unsafe.Pointer(&pf)))
	return vtbl{pf}, err
}

// coCreate создаёт COM-объект класса class и сразу запрашивает интерфейс iid.
func coCreate(class, iid *windows.GUID, label string) (vtbl, error) {
	var raw unsafe.Pointer
	hr, _, _ := procCoCreateInstance.Call(
		uintptr(unsafe.Pointer(class)), 0, windows.CLSCTX_INPROC_SERVER,
		uintptr(unsafe.Pointer(iid)), uintptr(unsafe.Pointer(&raw)))
	return vtbl{raw}, comutil.Check("CoCreateInstance("+label+")", int32(hr))
}

// Коды, которые CoInitializeEx отдаёт не как отказ.
const (
	hrFalse       = syscall.Errno(1)          // S_FALSE: поток уже в COM
	hrChangedMode = syscall.Errno(0x80010106) // RPC_E_CHANGED_MODE: поток уже в другой квартире
)

// comInit входит в COM на этом потоке и закрепляет за ним горутину. Возвращает
// функцию выхода, которую надо вызвать (по defer) на той же горутине.
func comInit() (leave func(), err error) {
	runtime.LockOSThread()
	switch err = windows.CoInitializeEx(0, windows.COINIT_APARTMENTTHREADED); {
	case err == nil, errors.Is(err, hrFalse):
		// S_FALSE тоже увеличил счётчик, так что выход нужен в обоих случаях.
		err = nil
		leave = func() {
			windows.CoUninitialize()
			runtime.UnlockOSThread()
		}
	case errors.Is(err, hrChangedMode):
		// Поток уже в многопоточной квартире: COM доступен, но своей
		// инициализации не было, и CoUninitialize звать нельзя.
		leave, err = runtime.UnlockOSThread, nil
	default:
		runtime.UnlockOSThread()
		err = fmt.Errorf("CoInitializeEx: %w", err)
	}
	return
}

// inCOM выполняет work на закреплённом потоке внутри COM.
func inCOM(work func() error) error {
	leave, err := comInit()
	if err == nil {
		defer leave()
		err = work()
	}
	return err
}

// fill записывает в ярлык поля sp, кроме пути самого файла. Пустые поля тоже
// пишутся (пустой строкой); значок только если он задан и всегда с индексом 0.
func (o vtbl) fill(sp sysapi.ShortcutSpec) error {
	props := [...]struct {
		slot  int
		op    string
		value string
	}{
		{vtSetPath, "SetPath", sp.Target},
		{vtSetWorkingDirectory, "SetWorkingDirectory", sp.WorkDir},
		{vtSetArguments, "SetArguments", sp.Args},
		{vtSetDescription, "SetDescription", sp.Description},
	}
	for _, p := range props {
		if err := o.must("IShellLink::"+p.op, p.slot, uintptr(unsafe.Pointer(utf16(p.value)))); err != nil {
			return err
		}
	}
	if sp.IconPath == "" {
		return nil
	}
	return o.must("IShellLink::SetIconLocation", vtSetIconLocation, uintptr(unsafe.Pointer(utf16(sp.IconPath))), 0)
}

// CreateShortcut пишет ярлык sp.Path. Первая ошибка прекращает работу; уже
// записанное не откатывается. Перезапись существующего ярлыка допустима, а
// поля, не заданные заново, становятся пустыми.
func (*System) CreateShortcut(sp sysapi.ShortcutSpec) error {
	return inCOM(func() error {
		var link, file vtbl
		defer func() { file.drop(); link.drop() }()
		return chain(
			func() (e error) { link, e = coCreate(&clsidShellLink, &iidShellLinkW, "ShellLink"); return },
			func() error { return link.fill(sp) },
			func() (e error) { file, e = link.persist(); return },
			func() error { return os.MkdirAll(filepath.Dir(sp.Path), 0o755) },
			// Второй аргумент Save — fRemember = TRUE.
			func() error {
				return file.must("IPersistFile::Save", vtSave, uintptr(unsafe.Pointer(utf16(sp.Path))), 1)
			},
		)
	})
}

// pull заводит буфер, даёт fill его заполнить и возвращает строку до первого
// нулевого знака.
func pull(fill func(into *slab) error) (string, error) {
	into := new(slab)
	if err := fill(into); err != nil {
		return "", err
	}
	return windows.UTF16ToString(into[:]), nil
}

// text читает поле вида Get…(LPWSTR, int). Пустое поле и S_FALSE — не ошибка.
func (o vtbl) text(op string, slot int) (string, error) {
	return pull(func(into *slab) error {
		return o.must("IShellLink::"+op, slot, uintptr(unsafe.Pointer(into)), shortcutBuf)
	})
}

// target читает цель: GetPath(буфер, размер, без WIN32_FIND_DATA, флаги 0).
func (o vtbl) target() (string, error) {
	return pull(func(into *slab) error {
		return o.must("IShellLink::GetPath", vtGetPath, uintptr(unsafe.Pointer(into)), shortcutBuf, 0, 0)
	})
}

// icon читает путь значка; индекс значка отбрасывается.
func (o vtbl) icon() (string, error) {
	var index int32
	return pull(func(into *slab) error {
		return o.must("IShellLink::GetIconLocation", vtGetIconLocation,
			uintptr(unsafe.Pointer(into)), shortcutBuf, uintptr(unsafe.Pointer(&index)))
	})
}

// ReadShortcut читает ярлык. Пустой файл .lnk — не ошибка: все поля пустые.
func ReadShortcut(path string) (*ShortcutInfo, error) {
	var result *ShortcutInfo
	err := inCOM(func() error {
		var link, file vtbl
		defer func() { file.drop(); link.drop() }()
		info := new(ShortcutInfo)
		readers := [...]struct {
			slot int
			op   string
			into *string
		}{
			{vtGetWorkingDirectory, "GetWorkingDirectory", &info.WorkDir},
			{vtGetArguments, "GetArguments", &info.Args},
			{vtGetDescription, "GetDescription", &info.Description},
		}
		steps := []func() error{
			func() (e error) { link, e = coCreate(&clsidShellLink, &iidShellLinkW, "ShellLink"); return },
			func() (e error) { file, e = link.persist(); return },
			// Второй аргумент Load — режим чтения (0).
			func() error { return file.must("IPersistFile::Load", vtLoad, uintptr(unsafe.Pointer(utf16(path))), 0) },
			func() (e error) { info.Target, e = link.target(); return },
		}
		for _, r := range readers {
			steps = append(steps, func() (e error) { *r.into, e = link.text(r.op, r.slot); return })
		}
		steps = append(steps, func() (e error) { info.Icon, e = link.icon(); return })
		err := chain(steps...)
		if err == nil {
			result = info
		}
		return err
	})
	return result, err
}
