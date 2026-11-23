//go:build windows

package winsys

import (
	"errors"
	"os"
	"unsafe"
)

import "golang.org/x/sys/windows"

import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/comutil"

// Системное окно выбора папки («Обзор…»): IFileOpenDialog в режиме выбора
// папок, показанное поверх окна установщика. Адреса и буферы, как и в
// shortcut_windows.go, превращаются в uintptr прямо в списке аргументов вызова.

// Отдельная переменная под user32: само имя user32 в пакете winsys не объявлено.
var user32Folder = windows.NewLazySystemDLL("user32.dll")

var pGetForegroundWindow = user32Folder.NewProc("GetForegroundWindow")

var pGetWindowThreadProcessID = user32Folder.NewProc("GetWindowThreadProcessId")

var shell32 = windows.NewLazySystemDLL("shell32.dll")

var procSHCreateItemFromParsingName = shell32.NewProc("SHCreateItemFromParsingName")

// CLSID_FileOpenDialog, IID_IFileOpenDialog, IID_IShellItem.
var (
	clsidFileOpenDialog = guidOf("{DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7}")
	iidFileOpenDialog   = guidOf("{D57C7288-D4AD-4768-BE02-9D969532D960}")
	iidShellItem        = guidOf("{43826D1E-E718-42EE-BC55-A1E261C37BFE}")
)

// IModalWindow::Show стоит сразу после IUnknown.
const vtShow = 3

// Слоты IFileDialog после Show; безымянные — методы, которые нам не нужны.
const (
	_ = 4 + iota // SetFileTypes
	_            // SetFileTypeIndex
	_            // GetFileTypeIndex
	_            // Advise
	_            // Unadvise
	vtSetOptions
	vtGetOptions
	_ // SetDefaultFolder
	vtSetFolder
	_ // GetFolder
	_ // GetCurrentSelection
	_ // SetFileName
	_ // GetFileName
	vtSetTitle
	_ // SetOkButtonLabel
	_ // SetFileNameLabel
	vtGetResult
)

// Слоты IShellItem после IUnknown.
const (
	_ = 3 + iota // BindToHandler
	_            // GetParent
	vtGetDisplayName
)

// Параметры диалога (FOS_*) и вид имени элемента (SIGDN_FILESYSPATH).
const (
	fosPickFolders     = 1 << 5  // выбираем папки, а не файлы
	fosForceFileSystem = 1 << 6  // только объекты файловой системы
	fosPathMustExist   = 1 << 11 // путь обязан существовать

	sigdnFileSysPath = 1<<31 | 0x58000
)

// hrCancelled — ERROR_CANCELLED (1223) в виде HRESULT: человек закрыл окно.
const hrCancelled int32 = -1<<31 + 0x704C7

// errClosed — служебная остановка цепочки: окно закрыто без выбора.
var errClosed = errors.New("folder dialog closed")

// ownWindow — окно-владелец диалога: окно переднего плана, но только если оно
// принадлежит этому процессу (человек только что нажал «Изменить» в
// установщике). Чужое окно владельцем не делается; без владельца — 0.
func ownWindow() (owned uintptr) {
	front, _, _ := pGetForegroundWindow.Call()
	if front == 0 {
		return
	}
	var owner uint32
	pGetWindowThreadProcessID.Call(front, uintptr(unsafe.Pointer(&owner)))
	if int(owner) == os.Getpid() {
		owned = front
	}
	return
}

// openAt ставит диалог в папку folder. SetFolder, а не SetDefaultFolder: окно
// должно встать именно сюда, а не в «последнюю использованную». Любая ошибка
// тут не важна, окно откроется в папке по умолчанию.
func (o vtbl) openAt(folder string) {
	if item := shellItemAt(folder); item != nil {
		defer comutil.Release(item)
		o.call(vtSetFolder, uintptr(item))
	}
}

// shellItemAt создаёт элемент оболочки для пути; nil, если не вышло.
func shellItemAt(path string) (item unsafe.Pointer) {
	hr, _, _ := procSHCreateItemFromParsingName.Call(
		uintptr(unsafe.Pointer(utf16(path))), 0,
		uintptr(unsafe.Pointer(&iidShellItem)), uintptr(unsafe.Pointer(&item)))
	if int32(hr) < 0 {
		item = nil
	}
	return
}

// PickFolder показывает окно выбора папки. Пустая строка без ошибки — человек
// закрыл окно; иначе путь в виде файловой системы. title и start необязательны.
func (*System) PickFolder(title, start string) (picked string, err error) {
	err = inCOM(func() error {
		var (
			dialog, chosen vtbl
			options        uint32
			name           *uint16
		)
		// Освобождаем в обратном порядке получения.
		defer func() { chosen.drop(); dialog.drop() }()
		return chain(
			func() (e error) {
				dialog, e = coCreate(&clsidFileOpenDialog, &iidFileOpenDialog, "FileOpenDialog")
				return
			},
			func() error { return dialog.must("GetOptions", vtGetOptions, uintptr(unsafe.Pointer(&options))) },
			// К параметрам по умолчанию добавляем наши три флага.
			func() error {
				return dialog.must("SetOptions", vtSetOptions, uintptr(options|fosPickFolders|fosForceFileSystem|fosPathMustExist))
			},
			func() error {
				if title != "" {
					dialog.call(vtSetTitle, uintptr(unsafe.Pointer(utf16(title))))
				}
				if start != "" {
					dialog.openAt(start)
				}
				return nil
			},
			func() error {
				switch shown := dialog.call(vtShow, ownWindow()); shown {
				case hrCancelled:
					return errClosed
				default:
					return comutil.Check("Show", shown)
				}
			},
			func() error { return dialog.must("GetResult", vtGetResult, uintptr(unsafe.Pointer(&chosen.raw))) },
			func() error {
				return chosen.must("GetDisplayName", vtGetDisplayName, sigdnFileSysPath, uintptr(unsafe.Pointer(&name)))
			},
			// Строку выделила оболочка: копируем и отдаём ей обратно.
			func() error {
				picked = windows.UTF16PtrToString(name)
				windows.CoTaskMemFree(unsafe.Pointer(name))
				return nil
			},
		)
	})
	if errors.Is(err, errClosed) {
		err = nil
	}
	return picked, err
}
