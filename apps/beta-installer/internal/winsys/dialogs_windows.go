//go:build windows

package winsys

import (
	"errors"
	"unsafe"
)

import "golang.org/x/sys/windows"

// Нативные окна сообщений до того, как поднимется интерфейс (нет WebView2,
// битая сборка, паника), и защита от второго экземпляра установщика.

// Флаги MessageBox. mbTopmost нигде не используется.
const (
	mbOK        = 0
	mbYesNo     = 1 << 2
	mbIconError = 1 << (iota + 2) // 0x10
	mbIconQuest                   // 0x20
	mbIconInfo                    // 0x40

	mbSetForeground = 1 << 16
	mbTopmost       = 1 << 18

	idYes = 6
)

var pPeekMessageW = user32Folder.NewProc("PeekMessageW")

// threadMsg — раскладка MSG на 64-разрядной Windows, 48 байт.
type threadMsg struct {
	hwnd           uintptr
	message        uint32
	wParam, lParam uintptr
	time           uint32
	pt             [2]int32
	private        uint32
}

// takeQuit вынимает из очереди потока сообщение WM_QUIT, если оно там есть.
func (m *threadMsg) takeQuit() bool {
	const wmQuit, pmRemove = 0x12, 1
	hit, _, _ := pPeekMessageW.Call(uintptr(unsafe.Pointer(m)), 0, wmQuit, wmQuit, pmRemove)
	return hit != 0
}

// drainQuit убирает из очереди потока WM_QUIT. Закрытое окно, позвав
// PostQuitMessage, оставляет его там, и модальное окно сообщения, встретив
// WM_QUIT, тут же закрывалось бы: текст ошибки человек не увидел бы.
// Сообщение в очереди одно (повторные склеиваются), а восемь попыток — запас.
func drainQuit() {
	var m threadMsg
	for tries := 8; tries > 0 && m.takeQuit(); tries-- {
	}
}

// wide — строка в UTF-16; с NUL внутри получится пустой указатель, то есть окно
// без этого текста: ошибки перевода не важны, человеку нужно хоть что-то показать.
func wide(s string) *uint16 {
	p, _ := windows.UTF16PtrFromString(s)
	return p
}

// boxKind — вид окна сообщения: набор кнопок и значок.
type boxKind uint32

const (
	kindError boxKind = mbOK | mbIconError
	kindInfo  boxKind = mbOK | mbIconInfo
	kindAsk   boxKind = mbYesNo | mbIconQuest
)

// show открывает окно без владельца, модальное для потока, и возвращает
// нажатую кнопку (0 при отказе).
func (k boxKind) show(title, text string) int32 {
	drainQuit()
	pressed, _ := windows.MessageBox(0, wide(text), wide(title), uint32(k)|mbSetForeground)
	return pressed
}

// ErrorBox — окно с ошибкой и кнопкой «ОК».
func ErrorBox(title, text string) { kindError.show(title, text) }

// InfoBox — окно с сообщением и кнопкой «ОК».
func InfoBox(title, text string) { kindInfo.show(title, text) }

// AskYesNo спрашивает «Да/Нет»; «Нет», закрытие и отказ вызова дают false.
func AskYesNo(title, text string) bool { return kindAsk.show(title, text) == idYes }

// claimMutex занимает мьютекс id. already — его уже держит кто-то другой;
// release закрывает дескриптор (после «уже есть» он пустой).
func claimMutex(id *uint16) (release func(), already bool, err error) {
	handle, err := windows.CreateMutex(nil, false, id)
	closeIt := func() { _ = windows.CloseHandle(handle) }
	switch {
	case errors.Is(err, windows.ERROR_ALREADY_EXISTS):
		// Дескриптор в этом случае действителен, но нам не нужен.
		closeIt()
		return func() {}, true, nil
	case err != nil:
		return nil, false, err
	}
	return closeIt, false, nil
}

// SingleInstance занимает именованный мьютекс name. already == true — его уже
// держит другой экземпляр (release тогда пустая, но вызывать её безопасно).
// release закрывает дескриптор, после чего имя снова свободно.
func SingleInstance(name string) (release func(), already bool, err error) {
	err = withUTF16(name, func(id *uint16) (e error) {
		release, already, e = claimMutex(id)
		return
	})
	return
}
