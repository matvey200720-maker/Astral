//go:build windows

// Package comutil — минимум для работы с COM без cgo: вызов метода по номеру
// в таблице виртуальных методов, освобождение объекта и перевод HRESULT в ошибку.
package comutil

import (
	"fmt"
	"syscall"
	"unsafe"
)

// Номер Release в таблице любого COM-интерфейса: 0 — QueryInterface, 1 — AddRef, 2 — Release,
// дальше идут методы самого интерфейса в порядке объявления.
const slotRelease = 2

// object — то, что лежит в памяти по адресу COM-объекта: первое слово хранит адрес таблицы методов.
type object struct {
	vtbl unsafe.Pointer
}

// entry возвращает адрес метода номер n. Номер не проверяется: чужой номер читает чужую память.
func (o *object) entry(n int) uintptr {
	step := int(unsafe.Sizeof(uintptr(0)))
	return *(*uintptr)(unsafe.Add(o.vtbl, n*step))
}

// firstWord берёт из трёх результатов SyscallN только первый — сырое значение возврата.
func firstWord(r1, _ uintptr, _ syscall.Errno) uintptr {
	return r1
}

// Call вызывает метод номер method у COM-объекта obj. Первым аргументом метода всегда
// уходит сам объект, дальше args в том порядке, в каком переданы. Результат — младшие
// 32 бита со знаком: HRESULT, а для AddRef и Release — счётчик ссылок.
//
// Директива ниже обязательна. Вызывающие пишут адреса прямо в списке аргументов:
// uintptr(unsafe.Pointer(&буфер[0])). Она заставляет компилятор держать такой объект
// в куче и живым до возврата: иначе стек горутины мог переехать после расчёта адреса,
// и метод записал бы результат по устаревшему адресу.
//
//go:uintptrescapes
func Call(obj unsafe.Pointer, method int, args ...uintptr) (hr int32) {
	full := make([]uintptr, len(args)+1)
	full[0] = uintptr(obj)
	copy(full[1:], args)
	hr = int32(firstWord(syscall.SyscallN((*object)(obj).entry(method), full...)))
	return hr
}

// Release отпускает ссылку на объект; nil пропускается.
func Release(obj unsafe.Pointer) {
	if obj == nil {
		return
	}
	Call(obj, slotRelease)
}

// Check превращает отрицательный HRESULT в ошибку «<op>: HRESULT 0x........».
// Успех, S_FALSE и любое другое неотрицательное значение дают nil.
func Check(op string, hr int32) (err error) {
	if hr < 0 {
		err = fmt.Errorf("%s: HRESULT 0x%08X", op, uint32(hr))
	}
	return err
}
