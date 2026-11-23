//go:build windows

// Command desktoprun запускает программу на отдельном невидимом рабочем столе Windows
// и дожидается её завершения вместе со всеми процессами, которые она породила.
// Нужна проверкам вида интерфейса установщика (tools/shots): окна потомка на таком
// столе рисуются (WebView2 успевает отрисовать кадры), но человек их не видит.
//
// Всё, что идёт после собственного имени в исходной строке запуска, передаётся
// потомку одной строкой без изменений. Код выхода — код потомка.
//
//	desktoprun.exe "C:\проба\AstralBetaSetup.exe" --sandbox "C:\проба\sb" --drive "C:\проба\scenario.js"
//
// Коды выхода собственных отказов: 64 — не хватает аргументов или строку нельзя
// передать, 70 — не создан стол или задание, 71 — не создан процесс, 72 — сбой после
// создания (назначение в задание, возобновление, ожидание), 73 — потомок завершился,
// но его код выхода узнать не удалось. Выход всегда через os.Exit:
// дескрипторы стола, задания и потомка освобождает система.
package main

import "fmt"
import "os"
import "runtime"
import "strconv"
import "strings"
import "time"
import "unsafe"

import "golang.org/x/sys/windows"

const blanks = " \t"

// Все права на созданный стол для того, кто его создал; UOI_NAME — запрос имени объекта.
const deskAllAccess, uoiName = 0x000F01FF, 2

// Станция интерактивного сеанса; на неё же откатываемся, если имя спросить не вышло.
const interactiveStation = "WinSta0"

const pollPause = 200 * time.Millisecond

var user32 = windows.NewLazySystemDLL("user32.dll")

// jobAccounting — JOBOBJECT_BASIC_ACCOUNTING_INFORMATION (48 байт, выравнивание 8):
// четыре времени по 8 байт, затем четыре счётчика по 4. Читается только ActiveProcesses.
type jobAccounting struct {
	Times [4]int64
	Page  uint32
	Total uint32
	// ActiveProcesses стоит по смещению 40.
	ActiveProcesses uint32
	Terminated      uint32
}

// user32Call вызывает процедуру user32 по имени. Директива нужна по той же причине, что и у
// самого LazyProc.Call: адреса буферов приходят сюда числами, и объекты должны оставаться
// на месте до возврата.
//
//go:uintptrescapes
func user32Call(name string, args ...uintptr) (uintptr, error) {
	ret, _, err := user32.NewProc(name).Call(args...)
	return ret, err
}

// queryJob спрашивает у задания базовый учёт процессов (класс 1) в буфер по адресу info.
//
//go:uintptrescapes
func queryJob(job windows.Handle, info uintptr, size uint32) error {
	return windows.QueryInformationJobObject(job, windows.JobObjectBasicAccountingInformation, info, size, nil)
}

// bail печатает причину в стандартную ошибку и выходит с кодом.
func bail(code int, text string) {
	fmt.Fprintln(os.Stderr, text)
	os.Exit(code)
}

// argTail отрезает от строки запуска первое слово (имя программы) и возвращает остаток
// как есть, только без пробелов и табуляций в начале; справа он не обрезается.
// Первое слово в двойных кавычках кончается на следующей кавычке (нет её — остатка нет);
// иначе — на первом пробеле или табуляции. Перевод строки словом-разделителем не считается.
func argTail(cmdline string) string {
	rest := strings.TrimLeft(cmdline, blanks)
	var after string
	switch {
	case rest == "":
	case rest[0] == '"':
		if end := strings.IndexByte(rest[1:], '"'); end >= 0 {
			after = rest[end+2:]
		}
	default:
		if end := strings.IndexAny(rest, blanks); end >= 0 {
			after = rest[end+1:]
		}
	}
	return strings.TrimLeft(after, blanks)
}

// stationName — имя оконной станции, на которой работает сам процесс. Потомку нужна
// именно она: интерактивный сеанс даёт WinSta0, а процесс из SSH или службы — станцию
// вида Service-0x0-…$, и с чужим именем у потомка не поднимается user32 (код 1114).
// Любой отказ вызовов (в том числе имя длиннее буфера) — WinSta0.
func stationName() string {
	var (
		name [128]uint16
		need uint32
	)
	station, _ := user32Call("GetProcessWindowStation")
	if station != 0 {
		got, _ := user32Call("GetUserObjectInformationW", station, uoiName,
			uintptr(unsafe.Pointer(&name[0])), unsafe.Sizeof(name), uintptr(unsafe.Pointer(&need)))
		if got != 0 {
			return windows.UTF16ToString(name[:])
		}
	}
	return interactiveStation
}

// launcher — всё, что нужно запуску потомка; шаги заполняют его по очереди.
type launcher struct {
	tail string
	desk *uint16 // «станция\стол» для структуры запуска
	cmd  []uint16
	job  windows.Handle
	proc windows.ProcessInformation
}

// stage — один шаг запуска: чем подписать отказ и каким кодом выйти.
type stage struct {
	label string
	code  int
	run   func() error
}

func (l *launcher) stages() []stage {
	return []stage{
		{"CreateDesktop", 70, l.makeDesktop},
		{"command line", 64, l.encodeTail},
		{"CreateJobObject", 70, l.makeJob},
		{"CreateProcess", 71, l.spawnFrozen},
		{"AssignProcessToJobObject", 72, l.assign},
		{"ResumeThread", 72, l.resume},
	}
}

// makeDesktop создаёт стол AstralShots-<pid> на станции процесса. Закрывать стол не надо.
// Отказ отдаёт ошибку самого вызова, даже когда она «нулевая».
func (l *launcher) makeDesktop() error {
	short := "AstralShots-" + strconv.Itoa(os.Getpid())
	shortName, _ := windows.UTF16PtrFromString(short)
	handle, err := user32Call("CreateDesktopW", uintptr(unsafe.Pointer(shortName)), 0, 0, 0, deskAllAccess, 0)
	if handle == 0 {
		return err
	}
	l.desk, _ = windows.UTF16PtrFromString(stationName() + `\` + short)
	return nil
}

func (l *launcher) encodeTail() (err error) {
	l.cmd, err = windows.UTF16FromString(l.tail)
	return
}

// makeJob создаёт задание без ограничений и без KILL_ON_JOB_CLOSE: оно нужно только для
// учёта — программа, которая стартует свою копию и сразу выходит, не должна уйти из виду.
func (l *launcher) makeJob() (err error) {
	l.job, err = windows.CreateJobObject(nil, nil)
	return
}

// spawnFrozen создаёт потомка приостановленным на нашем столе. Дескрипторы не
// наследуются, окружение и текущая папка берутся от нас.
func (l *launcher) spawnFrozen() error {
	var si windows.StartupInfo
	si.Cb, si.Desktop = uint32(unsafe.Sizeof(si)), l.desk
	flags := uint32(windows.CREATE_UNICODE_ENVIRONMENT | windows.CREATE_SUSPENDED)
	return windows.CreateProcess(nil, &l.cmd[0], nil, nil, false, flags, nil, nil, &si, &l.proc)
}

// assign назначает потомка в задание до его первого шага: ни один его потомок не должен
// уйти мимо задания. Не вышло — потомка принудительно завершаем.
func (l *launcher) assign() error {
	err := windows.AssignProcessToJobObject(l.job, l.proc.Process)
	if err != nil {
		_ = windows.TerminateProcess(l.proc.Process, 1)
	}
	return err
}

func (l *launcher) resume() error {
	_, err := windows.ResumeThread(l.proc.Thread)
	return err
}

// activeProcesses — сколько процессов ещё живо в задании; false — запрос не удался.
func (l *launcher) activeProcesses() (uint32, bool) {
	acct := new(jobAccounting)
	err := queryJob(l.job, uintptr(unsafe.Pointer(acct)), uint32(unsafe.Sizeof(*acct)))
	return acct.ActiveProcesses, err == nil
}

// supervise ждёт потомка, затем всё его дерево, и выходит с кодом потомка.
func (l *launcher) supervise() {
	event, err := windows.WaitForSingleObject(l.proc.Process, windows.INFINITE)
	switch {
	case err != nil, event != windows.WAIT_OBJECT_0:
		bail(72, fmt.Sprintf("wait: %v (%d)", err, event))
	}

	var status uint32
	codeErr := windows.GetExitCodeProcess(l.proc.Process, &status)

	// Ошибка запроса (например, закрытый дескриптор) тоже прекращает ожидание.
	for active, ok := l.activeProcesses(); ok && active > 0; active, ok = l.activeProcesses() {
		time.Sleep(pollPause)
	}
	// Код, которого мы не узнали, нельзя выдавать за ноль («успех»): дерево дождались,
	// но отвечаем отказом.
	if codeErr != nil {
		bail(73, fmt.Sprintf("exit code: %v", codeErr))
	}
	os.Exit(int(status))
}

func main() {
	runtime.LockOSThread()

	run := &launcher{tail: argTail(windows.UTF16PtrToString(windows.GetCommandLine()))}
	if run.tail == "" {
		bail(64, "usage: desktoprun <program> [arguments]")
	}
	for _, step := range run.stages() {
		if err := step.run(); err != nil {
			bail(step.code, step.label+": "+err.Error())
		}
	}
	run.supervise()
}
