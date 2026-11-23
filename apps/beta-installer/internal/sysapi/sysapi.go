// Пакет sysapi описывает всё, что установщик делает с операционной системой.
// Режимы установщика зависят только от интерфейса System: в бою его
// реализует winsys, в тестах подставляется Fake.
package sysapi

import (
	"time"

	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/layout"
)

// ShortcutSpec описывает ярлык .lnk.
type ShortcutSpec struct {
	Path        string // полный путь к самому .lnk
	Target      string // что запускает ярлык
	WorkDir     string
	Args        string
	IconPath    string
	Description string
}

// UninstallInfo — запись об удалении в «Приложениях».
type UninstallInfo struct {
	DisplayName          string
	DisplayVersion       string
	Publisher            string
	InstallLocation      string
	DisplayIcon          string
	UninstallString      string
	QuietUninstallString string
	EstimatedSizeKB      uint32
	InstallDate          string // ГГГГММДД
}

// System — окружение, процессы, оболочка и реестр. Методы могут вызываться из
// разных горутин.
type System interface {
	// Окружение.
	MachineGUID() (string, error)
	DeviceName() string
	OSLocale() string
	LocalAppData() string
	LogDir() string
	UserDataDirs() []string
	SharedDataDir() string
	FreeBytes(path string) (uint64, error)
	SelfExe() (string, error)

	// Открыть снаружи.
	OpenURL(url string) error
	OpenFolder(path string) error

	// Процессы.
	Launch(exe string, args []string, workDir string) (pid int, err error)
	RunningFrom(dir string) (bool, error)
	Kill(pid int) error
	WaitExit(pid int, timeout time.Duration) (exited bool, err error)
	// StopRockstarAgent снимает запуск при входе в Windows фонового агента режима Rockstar
	// (Astral.exe --rockstar-agent: у него нет окна, и он держит папку app) и просит его выйти.
	// reached — агент ответил по каналу управления.
	StopRockstarAgent() (reached bool, err error)

	// Ярлыки.
	DesktopDir() (string, error)
	StartMenuDir() (string, error)
	CreateShortcut(ShortcutSpec) error
	ShortcutTarget(lnk string) (string, error)

	// Запись «Приложений».
	RegisterUninstall(ch layout.Channel, info UninstallInfo) error
	UnregisterUninstall(ch layout.Channel) error
	UninstallRoot(ch layout.Channel) string

	// Диалог выбора папки и отложенное удаление.
	PickFolder(title, start string) (string, error)
	ScheduleDelete(paths ...string) error
}
