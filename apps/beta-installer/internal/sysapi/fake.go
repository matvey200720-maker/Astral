package sysapi

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"time"

	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/layout"
)

// fakeInstaller — содержимое файла «установщика», который возвращает SelfExe.
const fakeInstaller = "MZ-this-is-the-installer"

// fakeDefaultPID — номер процесса, который Launch отдаёт без хука.
const fakeDefaultPID = 4242

// ErrFake — готовая ошибка для тестов.
var ErrFake = errors.New("fake system failure")

// LaunchCall — одна запись вызова Launch.
type LaunchCall struct {
	Exe     string
	Args    []string
	WorkDir string
}

// Fake — подделка System для тестов. Пользоваться только по указателю.
// Поля, которые читают геттеры без замка, ставьте до начала работы.
type Fake struct {
	mu sync.Mutex

	GUID, Device, Locale, LocalAppDataDir, LogDirPath string
	DataDirs                                          []string
	SharedDataPath                                    string
	Free                                              uint64
	SelfPath, DesktopPath, StartMenuPath              string

	OpenURLErr, CreateShortcutErr, RegisterErr, LaunchErr error

	RunningFromResult bool
	// AgentHoldsRoot — единственный запущенный процесс из папки это фоновый
	// агент: RunningFrom отвечает «да», пока не вызван StopRockstarAgent.
	AgentHoldsRoot     bool
	RockstarAgentStops int
	RunningFromDirs    map[string]bool

	ExitedAfterWait bool
	LaunchHook      launchHook
	ExitedHook      exitedHook

	ShortcutTargets           map[string]string
	ScheduledDeletes          [][]string
	OpenedURLs, OpenedFolders []string
	Launches                  []LaunchCall
	Shortcuts                 []ShortcutSpec

	Registered      []UninstallInfo
	RegisteredFor   channels
	Unregistered    int
	UnregisteredFor channels

	WaitedPIDs, Killed []int
	UninstallRoots     rootMap

	Picked     string
	PickErr    error
	PickStarts []string
}

// Короткие имена для типов полей Fake (те же типы, не новые).
type (
	launchHook = func(exe string, args []string, workDir string) (pid int, err error)
	exitedHook = func(pid int, timeout time.Duration) (exited bool, err error)
	channels   = []layout.Channel
	rootMap    = map[layout.Channel]string
)

// fakeTree — пути подделки под одной папкой.
type fakeTree struct {
	local, roaming, downloads, self string
}

// fakeTreeUnder раскладывает пути под dir.
func fakeTreeUnder(dir string) fakeTree {
	t := fakeTree{local: filepath.Join(dir, "Local")}
	t.roaming = filepath.Join(dir, "Roaming", "Astral")
	t.downloads = filepath.Join(dir, "downloads")
	t.self = filepath.Join(t.downloads, "AstralBetaSetup.exe")
	return t
}

// NewFake собирает подделку с путями под dir и кладёт на диск файл «установщика»
// downloads/AstralBetaSetup.exe — его возвращает SelfExe.
func NewFake(dir string) *Fake {
	tree := fakeTreeUnder(dir)
	if err := os.MkdirAll(tree.downloads, 0o755); err == nil {
		_ = os.WriteFile(tree.self, []byte(fakeInstaller), 0o666)
	}
	f := &Fake{ExitedAfterWait: true, Free: 100 << 30}
	f.GUID, f.Device, f.Locale = "d5a2f0a8-1b3c-4f55-9e1e-7b1f6c0a1234", "DESKTOP-TEST", "ru-RU"
	f.LocalAppDataDir, f.LogDirPath = tree.local, filepath.Join(tree.local, "AstralBetaSetup", "logs")
	f.DataDirs, f.SharedDataPath = []string{tree.roaming, filepath.Join(tree.local, "Astral")}, tree.roaming
	f.SelfPath = tree.self
	f.DesktopPath, f.StartMenuPath = filepath.Join(dir, "Desktop"), filepath.Join(dir, "StartMenu", "Programs")
	return f
}

// lock берёт замок и отдаёт функцию, которая его снимает: defer f.lock()().
func (f *Fake) lock() func() {
	f.mu.Lock()
	return f.mu.Unlock
}

// collect дописывает v в список; зовётся под замком.
func collect[T any](into *[]T, v T) {
	*into = append(*into, v)
}

// collectIfOK дописывает v, только если fail — nil; возвращает fail как есть.
func collectIfOK[T any](fail error, into *[]T, v T) error {
	if fail == nil {
		collect(into, v)
	}
	return fail
}

// SetFree меняет свободное место.
func (f *Fake) SetFree(n uint64) {
	defer f.lock()()
	f.Free = n
}

func (f *Fake) UserDataDirs() []string {
	defer f.lock()()
	return slices.Clone(f.DataDirs)
}

func (f *Fake) FreeBytes(string) (free uint64, err error) {
	defer f.lock()()
	free = f.Free
	return
}

// Геттеры без замка и без ошибок: значения полей как есть.

func (f *Fake) MachineGUID() (guid string, err error) {
	guid = f.GUID
	return
}

func (f *Fake) DeviceName() (name string) {
	name = f.Device
	return
}

func (f *Fake) SelfExe() (path string, err error) {
	path = f.SelfPath
	return
}

func (f *Fake) Kill(pid int) (err error) {
	defer f.lock()()
	collect(&f.Killed, pid)
	return
}

func (f *Fake) OSLocale() (locale string) {
	locale = f.Locale
	return
}

func (f *Fake) LocalAppData() (dir string) {
	dir = f.LocalAppDataDir
	return
}

func (f *Fake) ScheduleDelete(paths ...string) (err error) {
	defer f.lock()()
	collect(&f.ScheduledDeletes, append([]string(nil), paths...))
	return
}

func (f *Fake) LogDir() (dir string) {
	dir = f.LogDirPath
	return
}

func (f *Fake) SharedDataDir() (dir string) {
	dir = f.SharedDataPath
	return
}

func (f *Fake) OpenFolder(path string) (err error) {
	defer f.lock()()
	collect(&f.OpenedFolders, path)
	return
}

func (f *Fake) DesktopDir() (dir string, err error) {
	dir = f.DesktopPath
	return
}

func (f *Fake) OpenURL(url string) (err error) {
	defer f.lock()()
	err = collectIfOK(f.OpenURLErr, &f.OpenedURLs, url)
	return
}

func (f *Fake) StartMenuDir() (dir string, err error) {
	dir = f.StartMenuPath
	return
}

func (f *Fake) CreateShortcut(spec ShortcutSpec) (err error) {
	defer f.lock()()
	err = collectIfOK(f.CreateShortcutErr, &f.Shortcuts, spec)
	return
}

func (f *Fake) ShortcutTarget(lnk string) (target string, err error) {
	defer f.lock()()
	target, known := f.ShortcutTargets[lnk]
	if !known {
		err = ErrFake
	}
	return
}

func (f *Fake) PickFolder(_, start string) (picked string, err error) {
	defer f.lock()()
	collect(&f.PickStarts, start)
	picked, err = f.Picked, f.PickErr
	return
}

// noteLaunch под замком записывает запуск (если ошибка не задана) и отдаёт хук.
func (f *Fake) noteLaunch(exe string, args []string, workDir string) (hook func(string, []string, string) (int, error), failure error) {
	defer f.lock()()
	if failure = f.LaunchErr; failure != nil {
		return nil, failure
	}
	collect(&f.Launches, LaunchCall{Exe: exe, Args: append([]string(nil), args...), WorkDir: workDir})
	return f.LaunchHook, nil
}

func (f *Fake) Launch(exe string, args []string, workDir string) (pid int, err error) {
	hook, failure := f.noteLaunch(exe, args, workDir)
	switch {
	case failure != nil:
		return 0, failure
	case hook != nil:
		return hook(exe, args, workDir)
	}
	return fakeDefaultPID, nil
}

func (f *Fake) StopRockstarAgent() (reached bool, err error) {
	defer f.lock()()
	f.RockstarAgentStops++
	reached, f.AgentHoldsRoot = f.AgentHoldsRoot, false
	return
}

func (f *Fake) RunningFrom(dir string) (running bool, err error) {
	defer f.lock()()
	switch {
	case f.AgentHoldsRoot:
		running = true
	case f.RunningFromDirs != nil:
		running = f.RunningFromDirs[dir]
	default:
		running = f.RunningFromResult
	}
	return
}

// noteWait под замком записывает ожидание и отдаёт хук с заданным исходом.
func (f *Fake) noteWait(pid int) (hook func(int, time.Duration) (bool, error), exited bool) {
	defer f.lock()()
	collect(&f.WaitedPIDs, pid)
	return f.ExitedHook, f.ExitedAfterWait
}

func (f *Fake) WaitExit(pid int, timeout time.Duration) (exited bool, err error) {
	hook, exited := f.noteWait(pid)
	if hook != nil {
		return hook(pid, timeout)
	}
	return exited, nil
}

func (f *Fake) RegisterUninstall(ch layout.Channel, info UninstallInfo) (err error) {
	defer f.lock()()
	if err = f.RegisterErr; err != nil {
		return err
	}
	roots := f.UninstallRoots
	if roots == nil {
		roots = rootMap{}
		f.UninstallRoots = roots
	}
	roots[ch] = info.InstallLocation
	collect(&f.RegisteredFor, ch)
	collect(&f.Registered, info)
	return nil
}

func (f *Fake) UnregisterUninstall(ch layout.Channel) error {
	defer f.lock()()
	delete(f.UninstallRoots, ch)
	collect(&f.UnregisteredFor, ch)
	f.Unregistered++
	return nil
}

func (f *Fake) UninstallRoot(ch layout.Channel) string {
	defer f.lock()()
	return f.UninstallRoots[ch]
}

var _ System = (*Fake)(nil)
