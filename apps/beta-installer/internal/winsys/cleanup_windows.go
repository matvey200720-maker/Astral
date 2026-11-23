//go:build windows

package winsys

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
)

import "golang.org/x/sys/windows"

// ShortcutTarget — куда ведёт ярлык; пусто, если цель не задана.
func (*System) ShortcutTarget(lnk string) (target string, err error) {
	if info, readErr := ReadShortcut(lnk); readErr != nil {
		err = readErr
	} else {
		target = info.Target
	}
	return
}

const (
	// minDeletablePath — короче этого (после очистки, в байтах) путь не стираем:
	// «C:\abcde» проходит, «C:\abcd» нет.
	minDeletablePath = 8
	// cmdSpecial — знаки, которые cmd.exe трактует даже внутри кавычек (%) или
	// которые ломают саму командную строку. Остальные (& | < > ( ) ^ !) в кавычках
	// безопасны, а в пользовательских папках встречаются часто.
	cmdSpecial = "\"%\n\r"
)

// tooRisky — пустой, относительный или слишком короткий путь стирать нельзя.
func tooRisky(p string) bool {
	switch {
	case p == "", !filepath.IsAbs(p):
		return true
	}
	return len(filepath.Clean(p)) < minDeletablePath
}

// protectedDirs — папки, которые нельзя стереть ни целиком, ни вместе с содержащей
// их папкой: каталог Windows и System32, обе Program Files, ProgramData, профиль
// пользователя и «Users» над ним.
func protectedDirs() []string {
	var dirs []string
	for _, name := range []string{"SystemRoot", "windir", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "ProgramData", "USERPROFILE"} {
		if v := os.Getenv(name); v != "" {
			dirs = append(dirs, v)
		}
	}
	if v := os.Getenv("SystemRoot"); v != "" {
		dirs = append(dirs, filepath.Join(v, "System32"))
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		dirs = append(dirs, home, filepath.Dir(home))
	}
	return dirs
}

// bare — путь без лишних слэшей в конце, в нижнем регистре: для сравнения папок.
func bare(p string) string {
	return strings.ToLower(strings.TrimRight(filepath.Clean(p), `\`))
}

// coversProtected — путь совпадает с защищённой папкой или лежит над ней (стирание
// захватило бы её); регистр и лишние слэши не важны.
func coversProtected(p string) bool {
	clean := bare(p)
	for _, dir := range protectedDirs() {
		if d := bare(dir); d == clean || strings.HasPrefix(d, clean+`\`) {
			return true
		}
	}
	return false
}

// pathRules — по порядку, что не пускаем в удаление; сработавшее правило
// даёт ошибку с самим путём.
var pathRules = [...]struct {
	rejects func(path string) bool
	message string
}{
	{tooRisky, "refusing to schedule the deletion of %q"},
	{coversProtected, "refusing to schedule the deletion of %q"},
	{func(p string) bool { return strings.ContainsAny(p, cmdSpecial) }, "path %q contains characters that cmd.exe would interpret"},
}

// usableDir — системная папка годится для сборки командной строки: путь
// абсолютный и без знаков, ломающих строку.
func usableDir(dir string) bool {
	return filepath.IsAbs(dir) && !strings.ContainsAny(dir, cmdSpecial)
}

// quote берёт строку в двойные кавычки как есть (без экранирования).
func quote(s string) string { return `"` + s + `"` }

// deleteCommandLine собирает командную строку отложенного удаления и возвращает
// путь к cmd.exe, саму строку и ошибку. Обе программы вызываются по полному
// пути от sys32: cmd.exe ищет сначала в текущей папке, а у установщика она
// временная, и чужой ping.bat выполнился бы с его правами.
func deleteCommandLine(sys32 string, paths []string) (cmdExe, line string, err error) {
	if !usableDir(sys32) {
		return "", "", fmt.Errorf("unusable system directory %q", sys32)
	}
	var steps []string
	for _, p := range paths {
		for _, rule := range pathRules {
			if rule.rejects(p) {
				return "", "", fmt.Errorf(rule.message, p)
			}
		}
		// Вставляется тот же очищенный путь, что проверялся правилами; стираем и как
		// папку, и как файл.
		clean := filepath.Clean(p)
		steps = append(steps, "rmdir /s /q "+quote(clean)+" 2>nul & del /f /q "+quote(clean)+" 2>nul")
	}

	cmdExe = filepath.Join(sys32, "cmd.exe")
	// Пауза: ping -n 4 делает четыре запроса с паузами в секунду, то есть ждёт
	// около трёх секунд, пока установщик выйдет и отпустит файлы.
	script := quote(filepath.Join(sys32, "ping.exe")) + " -n 4 127.0.0.1 >nul & " + strings.Join(steps, " & ")
	// /S: cmd.exe отбрасывает ровно одну открывающую и одну закрывающую кавычку
	// всей команды.
	return cmdExe, quote(cmdExe) + " /S /C " + quote(script), nil
}

// startHidden запускает программу скрытой, без консоли и в своей группе;
// процесс остаётся жить после вызова и после выхода установщика. Командную
// строку отдаём системе готовой: собери её Go из аргументов, кавычки были бы
// экранированы по правилам, которых cmd.exe не знает.
func startHidden(exe, cmdLine string) error {
	cmd := exec.Command(exe)
	cmd.SysProcAttr = hiddenAttr(cmdLine)
	err := cmd.Start()
	switch {
	case err != nil:
		return err
	case cmd.Process == nil:
		return errors.New("cmd.exe did not start")
	}
	return cmd.Process.Release()
}

// hiddenAttr — скрытый запуск без консоли в своей группе процессов с готовой
// командной строкой.
func hiddenAttr(cmdLine string) *syscall.SysProcAttr {
	return &syscall.SysProcAttr{
		HideWindow:    true,
		CmdLine:       cmdLine,
		CreationFlags: windows.CREATE_NEW_PROCESS_GROUP | windows.CREATE_NO_WINDOW,
	}
}

// ScheduleDelete запускает скрытый cmd.exe, который через несколько секунд,
// когда установщика уже нет, стирает пути.
func (*System) ScheduleDelete(paths ...string) (err error) {
	var sys32, exe, line string
	if len(paths) > 0 {
		err = chain(
			func() (e error) { sys32, e = windows.GetSystemDirectory(); return },
			func() (e error) { exe, line, e = deleteCommandLine(sys32, paths); return },
			func() error { return startHidden(exe, line) },
		)
	}
	return
}

// Kill завершает процесс pid (код выхода 1). Процесса нет — не ошибка.
func (*System) Kill(pid int) error {
	p := attach(windows.PROCESS_TERMINATE, uint32(pid))
	defer p.detach()
	switch {
	case p.gone():
		return nil
	case p.err != nil:
		return p.err
	}
	return windows.TerminateProcess(p.h, 1)
}
