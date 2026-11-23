//go:build windows

package host

import (
	"encoding/binary"
	"unsafe"
)

import "golang.org/x/sys/windows"

// Здесь только привязки к Win32: библиотеки, процедуры, числа и раскладки
// структур. Логики окна в файле нет; её держат window_windows.go,
// selftest_windows.go и drive_windows.go.

// Библиотеки грузятся лениво и только из системной папки Windows; рядом с
// каждой — её процедуры (адрес разрешается при первом вызове).

var user32 = windows.NewLazySystemDLL("user32.dll")

var fromUser32 = user32.NewProc

// Окно: жизненный цикл, показ, положение.
var pRegisterClassExW, pCreateWindowExW, pDestroyWindow = fromUser32("RegisterClassExW"), fromUser32("CreateWindowExW"), fromUser32("DestroyWindow")

var pShowWindow, pSetWindowPos, pGetClientRect = fromUser32("ShowWindow"), fromUser32("SetWindowPos"), fromUser32("GetClientRect")

var pFindWindowW, pIsIconic, pIsWindowVisible = fromUser32("FindWindowW"), fromUser32("IsIconic"), fromUser32("IsWindowVisible")

var pSetForegroundWindow, pLoadIconW, pLoadCursorW = fromUser32("SetForegroundWindow"), fromUser32("LoadIconW"), fromUser32("LoadCursorW")

// pSetFocus объявлена про запас, никто не зовёт.
var pSetFocus = fromUser32("SetFocus")

// Очередь сообщений потока и их отправка.
var pDefWindowProcW, pGetMessageW, pTranslateMessage = fromUser32("DefWindowProcW"), fromUser32("GetMessageW"), fromUser32("TranslateMessage")

var pDispatchMessageW, pPostMessageW, pPostQuitMessage = fromUser32("DispatchMessageW"), fromUser32("PostMessageW"), fromUser32("PostQuitMessage")

var pSendMessageW, pReleaseCapture = fromUser32("SendMessageW"), fromUser32("ReleaseCapture")

// Мониторы, курсор, DPI, рабочий стол потока.
var pGetCursorPos, pMonitorFromPoint, pGetMonitorInfoW = fromUser32("GetCursorPos"), fromUser32("MonitorFromPoint"), fromUser32("GetMonitorInfoW")

var pGetDpiForWindow, pAdjustWindowRectExForDpi = fromUser32("GetDpiForWindow"), fromUser32("AdjustWindowRectExForDpi")

var pSetProcessDpiAwarenessContext = fromUser32("SetProcessDpiAwarenessContext")

var pGetThreadDesktop, pGetUserObjectInformationW = fromUser32("GetThreadDesktop"), fromUser32("GetUserObjectInformationW")

var dwmapi = windows.NewLazySystemDLL("dwmapi.dll")

var pDwmSetWindowAttribute, pDwmExtendFrameIntoClientArea = dwmapi.NewProc("DwmSetWindowAttribute"), dwmapi.NewProc("DwmExtendFrameIntoClientArea")

var gdi32 = windows.NewLazySystemDLL("gdi32.dll")

var pCreateSolidBrush = gdi32.NewProc("CreateSolidBrush")

var kernel32 = windows.NewLazySystemDLL("kernel32.dll")

var pGetModuleHandleW = kernel32.NewProc("GetModuleHandleW")

// Сообщения окна. Подряд идущие номера выписаны через iota, пропуск помечен.
const (
	wmDestroy  = 2 + iota // 0x2
	wmMove                // 0x3
	_                     // 0x4 — нам не нужен
	wmSize                // 0x5
	wmActivate            // 0x6
)

const wmClose = 1 << 4

const wmEraseBkgnd = wmClose + 4

const wmSetIcon, wmMoving, wmDpiChanged = 1 << 7, 0x200 | 0x16, 0x2E0

const wmNCLButtonDown = wmSetIcon + 0x21

// Свои сообщения лежат выше WM_APP: «выполнить поставленную функцию» и
// «закрыть окно мимо стража».
const wmApp = 1 << 15

const wmDispatch, wmExit = wmApp + 1, wmApp + 2

// htCaption — «заголовок окна» для WM_NCLBUTTONDOWN (так перетаскивают окно без рамки).
const htCaption = 0x2

// Стили окна. WS_POPUP — старший бит.
const wsPopup, wsCaption = 1 << 31, 0xC00000

const wsSysMenu, wsMinimizeBox = 1 << 19, 1 << 17

const wsClipChildren, wsClipSiblings = 1 << 25, 1 << 26

const wsExAppWindow = 1 << 18

// ShowWindow.
const swHide, swShow, swMinimize, swRestore = 0, 5, 6, 9

// Флаги SetWindowPos: степени двойки подряд, четвёртый бит (NOREDRAW) не нужен.
const (
	swpNoSize     = 1 << iota // 0x1
	swpNoMove                 // 0x2
	swpNoZOrder               // 0x4
	_                         // 0x8
	swpNoActivate             // 0x10
)

// Стили класса окна.
const (
	csVRedraw = 1 << iota // 0x1
	csHRedraw             // 0x2
)

const idcArrow, monitorDefaultToNearest = 0x7F00, 0x2

const waInactive, iconSmall, iconBig = 0, 0, 1

// Атрибуты DWM и их значения.
const dwmwaNCRenderingPolicy, dwmwaUseImmersiveDarkMode = 2, 0x14

const dwmwaWindowCornerPref, dwmwaCaptionColor, dwmwaTextColor = 0x21, 0x23, 0x24

const dwmncrpEnabled, dwmwcpRound = 2, 2

// dpiPerMonitorV2 — DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, то есть −4. В
// uintptr отрицательный литерал не записать, поэтому это побитовое
// отрицание тройки: 0xFFFFFFFFFFFFFFFC.
const dpiPerMonitorV2 uintptr = ^uintptr(3)

// Раскладки структур Win32 (amd64): размеры 8, 16, 16, 40, 48 и 80 байт.

type point struct {
	X int32
	Y int32
}

type rect struct {
	Left   int32
	Top    int32
	Right  int32
	Bottom int32
}

// margins идёт в порядке MARGINS: левая, правая, верхняя, нижняя.
type margins struct {
	Left   int32
	Right  int32
	Top    int32
	Bottom int32
}

type monitorInfo struct {
	Size          uint32
	Monitor, Work rect
	Flags         uint32
}

type msg struct {
	Hwnd           uintptr
	Message        uint32
	WParam, LParam uintptr
	Time           uint32
	Pt             point
	Private        uint32
}

type wndClassEx struct {
	Size, Style                        uint32
	WndProc                            uintptr
	ClsExtra, WndExtra                 int32
	Instance, Icon, Cursor, Background uintptr
	MenuName, ClassName                *uint16
	IconSm                             uintptr
}

// ask зовёт процедуру и отдаёт только первый результат. Адреса в аргументах
// пишутся как uintptr(unsafe.Pointer(&x)) прямо в списке вызова: функция
// помечена go:uintptrescapes, как и сам LazyProc.Call.
//
//go:uintptrescapes
func ask(p *windows.LazyProc, args ...uintptr) uintptr {
	first, _, _ := p.Call(args...)
	return first
}

// askLast — то же, но с кодом GetLastError (смысл имеет только при отказе процедуры).
//
//go:uintptrescapes
func askLast(p *windows.LazyProc, args ...uintptr) (uintptr, error) {
	first, _, last := p.Call(args...)
	return first, last
}

// makeLParam кладёт младшие 16 бит lo и hi в одно 32-битное слово (lo — внизу).
// Отрицательные координаты уходят дополнением до двух, получатель читает их
// со знаком; всё, что шире 16 бит, обрезается.
func makeLParam(lo, hi int32) uintptr {
	halves := [4]byte{byte(lo), byte(lo >> 8), byte(hi), byte(hi >> 8)}
	return uintptr(binary.LittleEndian.Uint32(halves[:]))
}

// rgb собирает COLORREF 0x00BBGGRR: красный в младшем байте.
func rgb(r, g, b uint8) uintptr {
	return uintptr(binary.LittleEndian.Uint32([]byte{r, g, b, 0}))
}

// utf16p — указатель на строку в UTF-16. Строка с NUL внутри даёт nil.
func utf16p(s string) *uint16 {
	if p, err := windows.UTF16PtrFromString(s); err == nil {
		return p
	}
	return nil
}

// dwmSet пишет один атрибут DWM. HRESULT не проверяется: система, не знающая
// атрибута, просто ничего не меняет.
func dwmSet(hwnd uintptr, attr uint32, value uint32) {
	cell := [1]uint32{value}
	ask(pDwmSetWindowAttribute, hwnd, uintptr(attr), uintptr(unsafe.Pointer(&cell[0])), unsafe.Sizeof(cell))
}

// postMessage кладёт сообщение в очередь окна без ожидания. При hwnd == 0
// сообщение уходит в очередь самого потока.
func postMessage(hwnd uintptr, m uint32, wp, lp uintptr) {
	letter := [...]uintptr{hwnd, uintptr(m), wp, lp}
	ask(pPostMessageW, letter[:]...)
}

// desktopName — имя рабочего стола текущего потока («Default» у обычного
// человека; под cmd/desktoprun — другое). Дескриптор стола, который отдаёт
// GetThreadDesktop, закрывать нельзя.
func desktopName() string {
	const uoiName = 2
	desk := ask(pGetThreadDesktop, uintptr(windows.GetCurrentThreadId()))
	if desk == 0 {
		return ""
	}
	var (
		text [128]uint16
		need uint32
	)
	got := ask(pGetUserObjectInformationW, desk, uoiName,
		uintptr(unsafe.Pointer(&text[0])), unsafe.Sizeof(text), uintptr(unsafe.Pointer(&need)))
	if got == 0 {
		return ""
	}
	return windows.UTF16ToString(text[:])
}
