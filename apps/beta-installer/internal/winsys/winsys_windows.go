//go:build windows

// Package winsys — боевая реализация sysapi.System под Windows без cgo:
// реестр, ярлыки (COM), процессы и оболочка. Повышение прав нигде не нужно.
package winsys

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
)

import (
	"path/filepath"
	"slices"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

import "golang.org/x/sys/windows"

import (
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/machine"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/sysapi"
)

// System — настройки нужны только тестам и песочнице; пустое значение — боевой режим.
type System struct {
	// UninstallKey — приставка имён записей об удалении (пусто — настоящие имена
	// веток, иначе «<приставка>-<ветка>»); UninstallBase — ключ в HKCU, внутри
	// которого лежат записи (пусто — системный список «Приложения»);
	// HomeOverride подменяет папку данных установщика (журналы, WebView2).
	UninstallKey, UninstallBase, HomeOverride string
	// StartMenuOverride и DesktopOverride переносят папки ярлыков.
	StartMenuOverride, DesktopOverride string
	// Sandbox — корень песочницы: всё, что установщик обычно кладёт вне своей
	// папки, уходит внутрь неё; адреса и папки не открываются, а дописываются в
	// opened.txt; запускать можно только файлы внутри.
	Sandbox string
}

var _ sysapi.System = new(System)

// New — система с настоящими именами записей.
func New() *System { return new(System) }

var kernel32 = windows.NewLazySystemDLL("kernel32.dll")

var procGetUserDefaultLocaleName = kernel32.NewProc("GetUserDefaultLocaleName")

const (
	stillActive   = 259  // код «процесс ещё работает» у GetExitCodeProcess
	localeNameMax = 85   // LOCALE_NAME_MAX_LENGTH
	imageBuf      = 1024 // буфер пути образа процесса, знаков UTF-16

	openedLog  = "opened.txt" // файл песочницы: что «открывали» и что не дали запустить
	pollPeriod = 100 * time.Millisecond
)

// uiLanguages — языки интерфейса Astral.
var uiLanguages = [...]string{"ru", "uk", "en", "de", "pl", "fr"}

// orElse возвращает первую непустую строку из списка (или пустую).
func orElse(options ...string) (chosen string) {
	for _, s := range options {
		if chosen = s; chosen != "" {
			break
		}
	}
	return
}

// chain выполняет шаги по порядку и останавливается на первой ошибке.
func chain(steps ...func() error) (err error) {
	for i := 0; err == nil && i < len(steps); i++ {
		err = steps[i]()
	}
	return
}

// withUTF16 передаёт use указатель на строку в UTF-16; NUL внутри строки —
// это ошибка преобразования (EINVAL), и use тогда не зовётся.
func withUTF16(s string, use func(*uint16) error) (err error) {
	var p *uint16
	if p, err = windows.UTF16PtrFromString(s); err == nil {
		err = use(p)
	}
	return
}

// process — открытый дескриптор процесса; err — почему открыть не удалось.
type process struct {
	h   windows.Handle
	err error
}

func attach(access, pid uint32) (p process) {
	p.h, p.err = windows.OpenProcess(access, false, pid)
	return
}

func (p process) detach() {
	if p.err == nil {
		_ = windows.CloseHandle(p.h)
	}
}

// failedWith — открыть не удалось именно из-за code.
func (p process) failedWith(code syscall.Errno) bool { return errors.Is(p.err, code) }

// gone — процесса нет (или pid не бывает такого); denied — нет прав на нужный доступ.
func (p process) gone() bool   { return p.failedWith(windows.ERROR_INVALID_PARAMETER) }
func (p process) denied() bool { return p.failedWith(windows.ERROR_ACCESS_DENIED) }

// known — известная папка Windows; при отказе — значение запасной переменной
// окружения целиком (без подпапки), а если и её нет — ошибка.
func known(id *windows.KNOWNFOLDERID, envFallback string) (string, error) {
	sources := [...]func() string{
		func() string { dir, _ := windows.KnownFolderPath(id, windows.KF_FLAG_DEFAULT); return dir },
		func() string { return os.Getenv(envFallback) },
	}
	for _, source := range sources {
		if dir := source(); dir != "" {
			return dir, nil
		}
	}
	return "", errors.New("known folder is unavailable")
}

// isDir — существует ли path и является ли он папкой (файл с таким именем не считается).
func isDir(path string) bool {
	st, err := os.Stat(path)
	return err == nil && st.IsDir()
}

// under склеивает путь, если корень известен; без корня пусто.
func under(root string, parts ...string) (path string) {
	if root != "" {
		path = filepath.Join(append([]string{root}, parts...)...)
	}
	return
}

// sandboxSub — подпапка песочницы; вне песочницы пусто.
func (s *System) sandboxSub(sub string) string { return under(s.Sandbox, sub) }

// anchor — корень данных: подпапка песочницы или известная папка (ошибка
// глотается, результат может оказаться пустым).
func (s *System) anchor(sub string, id *windows.KNOWNFOLDERID, envFallback string) (dir string) {
	if dir = s.sandboxSub(sub); dir == "" {
		dir, _ = known(id, envFallback)
	}
	return
}

// shellFolder — папка ярлыков по приоритету: подмена, песочница, система. При
// отказе системы запасная переменная отдаётся целиком (корень профиля или
// Roaming, а не подпапка), как и в known.
func (s *System) shellFolder(override, sub string, id *windows.KNOWNFOLDERID, envFallback string) (dir string, err error) {
	if dir = orElse(override, s.sandboxSub(sub)); dir == "" {
		dir, err = known(id, envFallback)
	}
	return
}

func (*System) MachineGUID() (guid string, err error) { return machine.ReadGUID() }

func (*System) SelfExe() (path string, err error) { return os.Executable() }

// DeviceName — имя ПК: NetBIOS-имя, потом имя узла, потом запасное.
func (*System) DeviceName() (name string) {
	for _, ask := range [...]func() (string, error){windows.ComputerName, os.Hostname} {
		if got, err := ask(); err == nil && got != "" {
			return got
		}
	}
	return "UNKNOWN-PC"
}

// primaryLanguage — «ru» из «ru-RU» и «RU_ru».
func primaryLanguage(tag string) string {
	head, _, _ := strings.Cut(strings.ReplaceAll(tag, "_", "-"), "-")
	return strings.ToLower(head)
}

// defaultLocaleName — запасной путь OSLocale: язык по умолчанию текущего пользователя.
func defaultLocaleName() (name string) {
	var buf [localeNameMax]uint16
	if n, _, _ := procGetUserDefaultLocaleName.Call(uintptr(unsafe.Pointer(&buf[0])), localeNameMax); n != 0 {
		name = windows.UTF16ToString(buf[:])
	}
	return
}

// OSLocale — язык интерфейса системы. Из предпочитаемых человеком берётся
// первый поддерживаемый (тег отдаётся как есть, «ru-RU»), иначе самый первый.
func (*System) OSLocale() (tag string) {
	tags, err := windows.GetUserPreferredUILanguages(windows.MUI_LANGUAGE_NAME)
	if err != nil || len(tags) == 0 {
		return defaultLocaleName()
	}
	return firstSupportedTag(tags)
}

// firstSupportedTag — первый из предпочитаемых тегов, чей язык у нас есть, иначе самый первый (список не пуст).
// Порядок списка — порядок языков отображения в Windows: русский впереди английского даёт «ru-RU», а язык браузера может быть другим.
func firstSupportedTag(tags []string) string {
	at := slices.IndexFunc(tags, func(t string) bool { return slices.Contains(uiLanguages[:], primaryLanguage(t)) })
	return tags[max(at, 0)]
}

// LocalAppData — %LOCALAPPDATA% (в песочнице <Sandbox>\Local).
func (s *System) LocalAppData() (dir string) {
	return s.anchor("Local", windows.FOLDERID_LocalAppData, "LOCALAPPDATA")
}

// roamingRoot — %APPDATA% (в песочнице <Sandbox>\Roaming); пусто, если не нашли.
func (s *System) roamingRoot() (dir string) {
	return s.anchor("Roaming", windows.FOLDERID_RoamingAppData, "APPDATA")
}

// SetupHome — папка данных установщика. Если LocalAppData не нашёлся, путь
// получается относительным.
func (s *System) SetupHome() (dir string) {
	dir = orElse(s.HomeOverride, s.sandboxSub("Setup"), filepath.Join(s.LocalAppData(), "AstralBetaSetup"))
	return
}

// LogDir — журналы установщика.
func (s *System) LogDir() (dir string) {
	dir = filepath.Join(s.SetupHome(), "logs")
	return
}

// SharedDataDir — общие данные веток: <Roaming>\Astral; пусто, если Roaming неизвестен.
func (s *System) SharedDataDir() (dir string) {
	dir = under(s.roamingRoot(), "Astral")
	return
}

// UserDataDirs — папки данных пользователя: Roaming\Astral и Local\Astral,
// затем прежние «Astral Beta» там же, но только если такая папка есть на диске.
func (s *System) UserDataDirs() (dirs []string) {
	roots := [...]string{s.roamingRoot(), s.LocalAppData()}
	for _, gen := range [...]struct {
		leaf     string
		onlyReal bool
	}{{"Astral", false}, {"Astral Beta", true}} {
		for _, root := range roots {
			if dir := under(root, gen.leaf); dir != "" && (!gen.onlyReal || isDir(dir)) {
				dirs = append(dirs, dir)
			}
		}
	}
	return
}

// DesktopDir — рабочий стол.
func (s *System) DesktopDir() (dir string, err error) {
	return s.shellFolder(s.DesktopOverride, "Desktop", windows.FOLDERID_Desktop, "USERPROFILE")
}

// StartMenuDir — Пуск → Программы.
func (s *System) StartMenuDir() (dir string, err error) {
	return s.shellFolder(s.StartMenuOverride, "StartMenu", windows.FOLDERID_Programs, "APPDATA")
}

// FreeBytes — сколько места доступно вызывающему (с учётом квот) на диске path.
func (*System) FreeBytes(path string) (avail uint64, err error) {
	var total, spare uint64
	err = withUTF16(path, func(p *uint16) error {
		return windows.GetDiskFreeSpaceEx(p, &avail, &total, &spare)
	})
	if err != nil {
		avail = 0
	}
	return
}

// note дописывает строку в файл песочницы: «ЧЧ:ММ:СС.ммм текст».
func (s *System) note(name, line string) (err error) {
	const appendFlags = os.O_APPEND | os.O_CREATE | os.O_WRONLY
	var f *os.File
	err = chain(
		func() error { return os.MkdirAll(s.Sandbox, 0o755) },
		func() (e error) { f, e = os.OpenFile(filepath.Join(s.Sandbox, name), appendFlags, 0o644); return },
	)
	if err == nil {
		defer f.Close()
		_, err = io.WriteString(f, strings.Join([]string{time.Now().Format("15:04:05.000"), line}, " ")+"\n")
	}
	return
}

// shellOpen открывает цель оболочкой. Проверка адреса — на вызывающем:
// ShellExecute с путём или file: запустил бы программу.
func shellOpen(verb, target string) error {
	var wide [2]*uint16
	for i, text := range [...]string{verb, target} {
		// Ошибка перевода глагола не важна, ошибка цели — отказ.
		if p, err := windows.UTF16PtrFromString(text); err == nil {
			wide[i] = p
		} else if i == 1 {
			return err
		}
	}
	return windows.ShellExecute(0, wide[0], wide[1], nil, nil, windows.SW_SHOWNORMAL)
}

// open — общий путь OpenURL и OpenFolder: в песочнице только запись в журнал.
func (s *System) open(kind, target string) (err error) {
	if s.Sandbox == "" {
		return shellOpen("open", target)
	}
	return s.note(openedLog, kind+" "+target)
}

// OpenURL открывает адрес в браузере.
func (s *System) OpenURL(url string) (err error) { return s.open("url", url) }

// OpenFolder открывает папку в проводнике.
func (s *System) OpenFolder(path string) (err error) { return s.open("folder", path) }

// insideSandbox — лежит ли exe внутри песочницы. Сравнение лексическое, без
// учёта регистра, ссылки не разрешаются; путь наружу начинается с «..».
func (s *System) insideSandbox(exe string) (inside bool) {
	if rel, err := filepath.Rel(s.Sandbox, exe); err == nil {
		inside = strings.Split(rel, `\`)[0] != ".."
	}
	return
}

// detachedCommand готовит запуск без консоли, вне группы установщика.
func detachedCommand(exe string, args []string, dir string) (cmd *exec.Cmd) {
	attr := &syscall.SysProcAttr{CreationFlags: windows.DETACHED_PROCESS | windows.CREATE_NEW_PROCESS_GROUP}
	cmd = exec.Command(exe, args...)
	cmd.Dir, cmd.SysProcAttr = dir, attr
	return
}

// Launch запускает программу отдельным процессом без ожидания. В песочнице —
// только файлы внутри неё.
func (s *System) Launch(exe string, args []string, workDir string) (pid int, err error) {
	if s.Sandbox != "" && !s.insideSandbox(exe) {
		_ = s.note(openedLog, "launch refused "+exe)
		return 0, fmt.Errorf("sandbox: refusing to start %s outside the sandbox", exe)
	}
	child := detachedCommand(exe, args, workDir)
	if err = child.Start(); err == nil {
		pid = child.Process.Pid
		_ = child.Process.Release()
	}
	return
}

// imagePath — полный путь к exe процесса pid; false, если спросить нельзя.
func imagePath(pid uint32) (path string, ok bool) {
	p := attach(windows.PROCESS_QUERY_LIMITED_INFORMATION, pid)
	defer p.detach()
	if p.err != nil {
		return
	}
	var buf [imageBuf]uint16
	size := uint32(len(buf))
	if windows.QueryFullProcessImageName(p.h, 0, &buf[0], &size) == nil {
		path, ok = windows.UTF16ToString(buf[:size]), true
	}
	return
}

// scanProcesses обходит снимок процессов по порядку, пока visit не скажет «хватит».
// Ошибка — только в самом снимке; обрыв обхода (любой) считается концом списка.
func scanProcesses(visit func(pid uint32) (stop bool)) error {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(snap)
	row := windows.ProcessEntry32{Size: uint32(unsafe.Sizeof(windows.ProcessEntry32{}))}
	for more := windows.Process32First(snap, &row) == nil; more && !visit(row.ProcessID); {
		more = windows.Process32Next(snap, &row) == nil
	}
	return nil
}

// RunningFrom — работает ли какой-нибудь чужой процесс из папки dir (или глубже).
// Корень диска не находит ничего: к очищенному «C:\» дописывается ещё одна косая.
func (*System) RunningFrom(dir string) (found bool, err error) {
	prefix := bare(dir) + `\`
	self := uint32(os.Getpid())
	err = scanProcesses(func(pid uint32) bool {
		if pid != 0 && pid != self {
			image, ok := imagePath(pid)
			found = ok && strings.HasPrefix(strings.ToLower(image), prefix)
		}
		return found
	})
	return
}

// waitMillis — срок для WaitForSingleObject: отрицательный и слишком большой — бесконечность.
func waitMillis(d time.Duration) uint32 {
	if 0 <= d && d < windows.INFINITE*time.Millisecond {
		return uint32(d / time.Millisecond)
	}
	return windows.INFINITE
}

// WaitExit ждёт завершения процесса pid не дольше timeout (меньше нуля — сколько
// понадобится). Процесса нет — считается вышедшим. Если на дескрипторе ждать
// нельзя (чужие права), срабатывает опрос кода выхода.
func (*System) WaitExit(pid int, timeout time.Duration) (exited bool, err error) {
	p := attach(windows.SYNCHRONIZE, uint32(pid))
	defer p.detach()
	switch {
	case p.gone():
		return true, nil
	case p.denied():
		return pollExit(pid, timeout)
	case p.err != nil:
		return false, p.err
	}
	event, err := windows.WaitForSingleObject(p.h, waitMillis(timeout))
	return event == windows.WAIT_OBJECT_0, err
}

// pollExit — запасное ожидание: раз в 100 мс смотрит код выхода. Процесс,
// завершившийся именно с кодом 259, считается живым до конца срока.
func pollExit(pid int, timeout time.Duration) (exited bool, err error) {
	p := attach(windows.PROCESS_QUERY_LIMITED_INFORMATION, uint32(pid))
	defer p.detach()
	switch {
	case p.gone():
		return true, nil
	case p.err != nil:
		return false, p.err
	}
	lastCall := time.Now().Add(timeout)
	for code := uint32(stillActive); ; time.Sleep(pollPeriod) {
		if err = windows.GetExitCodeProcess(p.h, &code); err != nil {
			return false, err
		}
		if code != stillActive {
			return true, nil
		}
		if timeout >= 0 && !time.Now().Before(lastCall) {
			return false, nil
		}
	}
}
