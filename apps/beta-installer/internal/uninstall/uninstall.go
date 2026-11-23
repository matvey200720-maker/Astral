// Пакет uninstall снимает одну ветку Astral: папку установки, ярлыки, запись в
// «Приложениях» и, по явной просьбе и вместе с последней веткой, общие данные.
package uninstall

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"iter"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/app"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/applog"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/bridge"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/install"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/layout"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/pack"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/sysapi"
)

// Config — параметры раннера.
type Config struct {
	Root            string         // папка установки ветки
	Channel         layout.Channel // пусто — по имени последней папки Root
	Version         string         // версия установщика (init.version)
	Frame           string         // custom или native; пусто — custom
	Dev             bool           // init.dev
	BestEffortFiles bool           // сбой стирания файлов не считается отказом
	Exit            func()         // закрыть установщик
}

// Runner — раннер удаления; создаётся только New.
type Runner struct {
	sys sysapi.System
	rt  *bridge.Router
	log applog.Logger

	channel layout.Channel
	cfg     Config

	flight  sync.WaitGroup // фоновые горутины
	working atomic.Bool    // идёт фоновое удаление, запущенное из окна
}

func branchOfRoot(root string) layout.Channel {
	ch, _ := layout.ChannelOfRoot(root)
	return ch
}

// New собирает раннер; rt может быть nil (тихий режим), log — nil (молчит).
func New(cfg Config, sys sysapi.System, rt *bridge.Router, log applog.Logger) *Runner {
	r := new(Runner)
	r.cfg, r.sys, r.rt, r.log = cfg, sys, rt, log
	r.cfg.Frame = cmp.Or(cfg.Frame, "custom")
	r.channel = cmp.Or(cfg.Channel, branchOfRoot(cfg.Root))
	if r.cfg.Exit == nil {
		r.cfg.Exit = func() {}
	}
	if r.log == nil {
		r.log = applog.Nop{}
	}
	return r
}

// Register подключает вызовы init, uninstall и quit.
func (r *Runner) Register() {
	calls := []struct {
		name string
		do   bridge.Handler
	}{
		{"init", r.hInit},
		{"uninstall", r.hUninstall},
		{"quit", r.leave},
	}
	for _, c := range calls {
		r.rt.Handle(c.name, c.do)
	}
}

// Busy сообщает, идёт ли фоновое удаление.
func (r *Runner) Busy() bool { return r.working.Load() }

// Close ждёт конца фоновой работы; сам ничего не отменяет.
func (r *Runner) Close() { r.flight.Wait() }

func (r *Runner) leave(context.Context, json.RawMessage) (any, error) {
	defer r.cfg.Exit()
	return nil, nil
}

// Коды ошибок моста.
const (
	codeInternal   = "INTERNAL"
	codeAppRunning = "APP_RUNNING"
	codeInvalidArg = "INVALID_ARGUMENT"
	codeBadState   = "INVALID_STATE"
	codeDenied     = "ACCESS_DENIED"
	codeFailed     = "INSTALL_FAILED"
)

// refusal собирает ошибку моста с подробностью по шаблону.
func refusal(code string, retryable bool, format string, args ...any) *bridge.Error {
	return &bridge.Error{Code: code, Retryable: retryable, Detail: fmt.Sprintf(format, args...)}
}

func runningRefusal() *bridge.Error { return refusal(codeAppRunning, true, "Astral is running") }

// classifyRemoval переводит ошибку стирания в ошибку моста: отказ в доступе
// — ACCESS_DENIED, всё прочее (в том числе «файл занят») — повторяемый
// INSTALL_FAILED.
func classifyRemoval(err error) *bridge.Error {
	detail := applog.Redact(fmt.Sprint(err))
	if errors.Is(err, pack.ErrBusy) || errors.Is(err, fs.ErrPermission) {
		return &bridge.Error{Code: codeDenied, Detail: detail}
	}
	return &bridge.Error{Code: codeFailed, Retryable: true, Detail: detail}
}

// share — доля done из total в процентах.
func share(done, total int) int { return done * 100 / total }

// within: цель лежит в корне или совпадает с ним (без учёта регистра).
func within(root, target string) bool {
	low, base := strings.ToLower(target), strings.ToLower(root)
	if !strings.HasPrefix(low, base) {
		return false
	}
	tail := low[len(base):]
	return tail == "" || tail[0] == os.PathSeparator
}

// pass — один проход удаления: общие данные шагов.
type pass struct {
	r       *Runner
	root    string
	exists  bool
	purge   bool // стирать ли общие данные
	removed bool // общие данные стёрты
	report  func(phase string, percent int)
}

// Run выполняет удаление синхронно. Ошибка — всегда *bridge.Error. Два удаления одновременно
// не идут: пока одно не кончилось, второе получает INVALID_STATE.
func (r *Runner) Run(deleteUserData bool, progress func(phase string, percent int)) (removedData bool, err error) {
	if !r.working.CompareAndSwap(false, true) {
		return false, refusal(codeBadState, false, "uninstall is already running")
	}
	defer r.working.Store(false)
	return r.run(deleteUserData, progress)
}

// run — само удаление; занятость уже взята вызывающим.
func (r *Runner) run(deleteUserData bool, progress func(phase string, percent int)) (removedData bool, err error) {
	report := progress
	if report == nil {
		report = idleReport
	}
	p := &pass{r: r, root: r.cfg.Root, purge: deleteUserData, report: report}
	steps := []func(*pass) *bridge.Error{
		(*pass).stopRockstarAgent, (*pass).admit, (*pass).clearRoot,
		(*pass).dropShortcuts, (*pass).dropAppsEntry, (*pass).dropSharedData,
	}
	for _, step := range steps {
		if refused := step(p); refused != nil {
			return false, refused
		}
	}
	return p.removed, nil
}

// idleReport — отчёт о ходе, когда вызывающему он не нужен.
func idleReport(string, int) {}

// agentExitWait — сколько ждём, пока фоновый агент режима Rockstar выйдет после просьбы.
const agentExitWait = 8 * time.Second

// stopRockstarAgent: у агента режима Rockstar нет окна, а он держит папку app. Снимаем его запуск при
// входе в Windows и просим выйти; иначе удаление отказало бы «Astral запущен», а закрывать нечего.
func (p *pass) stopRockstarAgent() *bridge.Error {
	reached, err := p.r.sys.StopRockstarAgent()
	if err != nil {
		p.r.log.Printf("could not stop the Rockstar mode agent: %v", err)
	}
	if reached {
		p.awaitAgentExit()
	}
	return nil
}

// awaitAgentExit ждёт, пока из папки ветки не уйдёт ни один процесс, но не дольше agentExitWait.
func (p *pass) awaitAgentExit() {
	until := time.Now().Add(agentExitWait)
	for ; time.Now().Before(until); time.Sleep(150 * time.Millisecond) {
		if running, _ := p.r.sys.RunningFrom(p.root); !running {
			return
		}
	}
}

// admit решает, можно ли начинать: ветка известна, папка наша, Astral не запущен.
func (p *pass) admit() *bridge.Error {
	checks := []func() *bridge.Error{p.requireBranch, p.requireOurFolder, p.requireNotRunning}
	for _, check := range checks {
		if refused := check(); refused != nil {
			return refused
		}
	}
	return nil
}

func (p *pass) requireBranch() *bridge.Error {
	if p.r.channel != "" {
		return nil
	}
	return refusal(codeInternal, false, "%q is not the folder of an Astral branch", p.root)
}

// requireOurFolder запоминает, есть ли папка, и если есть — можно ли её стирать.
func (p *pass) requireOurFolder() *bridge.Error {
	p.exists = pack.Exists(p.root)
	if !p.exists {
		return nil
	}
	if err := layout.New(p.root).SafeToRemove(); err != nil {
		return refusal(codeInternal, false, "%s", err.Error())
	}
	return nil
}

func (p *pass) requireNotRunning() *bridge.Error {
	running, _ := p.r.probeRunning(p.root)
	if running {
		return runningRefusal()
	}
	return nil
}

// probeRunning спрашивает систему, запущен ли Astral из root; ошибка проверки
// пишется в журнал и возвращается вместе с ответом.
func (r *Runner) probeRunning(root string) (running bool, err error) {
	running, err = r.sys.RunningFrom(root)
	r.noteProbeFailure(err)
	return running, err
}

// noteProbeFailure пишет в журнал сбой проверки запущенных процессов.
func (r *Runner) noteProbeFailure(err error) {
	if err != nil {
		r.log.Printf("could not check running processes: %v", err)
	}
}

// clearRoot стирает папку установки; при отказе без BestEffortFiles остальные
// шаги не идут.
func (p *pass) clearRoot() *bridge.Error {
	p.report("files", 0)
	var failures []error
	if p.exists {
		failures = p.emptyRoot()
	}
	if worst, found := firstError(failures); found && !p.r.cfg.BestEffortFiles {
		return classifyRemoval(worst)
	}
	p.report("files", 100)
	return nil
}

// firstError — первая из ошибок списка; found ложно, если список пуст.
func firstError(list []error) (first error, found bool) {
	if len(list) == 0 {
		return nil, false
	}
	return list[0], true
}

// emptyRoot стирает записи корня по порядку, затем сам корень; ошибки идут в
// порядке появления.
func (p *pass) emptyRoot() []error {
	strict := !p.r.cfg.BestEffortFiles
	dir := p.root
	if strict {
		aside, err := p.setAside()
		if err != nil {
			return []error{err}
		}
		dir = aside
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return []error{err}
	}
	failures := p.eraseEntries(dir, entries)
	if strict && len(failures) > 0 {
		// Папку уже унесли с её места: ветки нет, а остатки лежат рядом мусором и ничего не держат.
		return nil
	}
	return failures
}

// eraseEntries стирает записи папки dir по одной, а если все ушли — и саму папку.
func (p *pass) eraseEntries(dir string, entries []os.DirEntry) (failures []error) {
	for i := range entries {
		name := entries[i].Name()
		if err := pack.RemoveAllRetry(filepath.Join(dir, name)); err != nil {
			p.r.log.Printf("could not remove %s: %v", name, err)
			failures = append(failures, err)
		}
		p.report("files", share(i+1, len(entries)))
	}
	if len(failures) == 0 {
		failures = appendIf(failures, pack.RemoveAllRetry(dir))
	}
	return failures
}

// appendIf добавляет err в список, если он есть.
func appendIf(list []error, err error) []error {
	if err == nil {
		return list
	}
	return append(list, err)
}

// setAside переносит папку установки на соседнее имя одним переименованием: пока в ней что-то
// занято, оно не удаётся, и тогда не тронуто ничего, а не половина ветки. Возвращает новое имя.
func (p *pass) setAside() (string, error) {
	aside := p.root + ".removing"
	_ = pack.RemoveAllRetry(aside) // остаток прошлой попытки
	err := pack.RenameRetry(p.root, aside)
	if err == nil {
		return aside, nil
	}
	// Занятое освободится: текст ошибки не называет это отказом в доступе.
	return "", fmt.Errorf("could not set the folder aside: %v", err)
}

// links отдаёт по очереди существующие ярлыки ветки: сначала в меню «Пуск»,
// потом на рабочем столе. Папки спрашиваются лениво.
func (p *pass) links() iter.Seq[string] {
	file := p.r.channel.ShortcutFile()
	find := func(folder func() (string, error)) (string, bool) {
		dir, err := folder()
		if err != nil {
			return "", false
		}
		lnk := filepath.Join(dir, file)
		return lnk, pack.Exists(lnk)
	}
	folders := []func() (string, error){p.r.sys.StartMenuDir, p.r.sys.DesktopDir}
	return func(yield func(string) bool) {
		for _, folder := range folders {
			if lnk, ok := find(folder); ok && !yield(lnk) {
				return
			}
		}
	}
}

// dropShortcuts убирает свои ярлыки; ярлыки, ведущие не в этот корень, остаются.
func (p *pass) dropShortcuts() *bridge.Error {
	p.report("shortcuts", 0)
	for lnk := range p.links() {
		p.retire(lnk)
	}
	p.report("shortcuts", 100)
	return nil
}

func (p *pass) retire(lnk string) {
	target, err := p.r.sys.ShortcutTarget(lnk)
	switch {
	case err == nil && !within(p.root, target):
		p.r.log.Printf("keeping %s: it points to %s", lnk, target)
	default:
		if err = os.Remove(lnk); err != nil {
			p.r.log.Printf("could not remove %s: %v", lnk, err)
		}
	}
}

func (p *pass) dropAppsEntry() *bridge.Error {
	p.report("registry", 0)
	if err := p.r.sys.UnregisterUninstall(p.r.channel); err != nil {
		p.r.log.Printf("could not remove the Apps entry: %v", err)
	}
	p.report("registry", 100)
	return nil
}

// otherBranches — стоящие ветки, кроме снимаемой.
func (r *Runner) otherBranches() []layout.Branch {
	standing := layout.ScanBeside(r.cfg.Root)
	return slices.DeleteFunc(standing, func(b layout.Branch) bool { return b.Channel == r.channel })
}

// dropSharedData стирает общие данные, но только вместе с последней веткой.
func (p *pass) dropSharedData() *bridge.Error {
	if !p.purge {
		return nil
	}
	rivals := p.r.otherBranches()
	if len(rivals) == 0 {
		return p.purgeData()
	}
	names := strings.Join(branchChannelNames(rivals), ", ")
	p.r.log.Printf("keeping the shared data: other branches are installed (%s)", names)
	return nil
}

// purgeData стирает папки данных и отмечает, что общие данные ушли.
func (p *pass) purgeData() *bridge.Error {
	p.report("data", 0)
	if refused := p.eraseDataDirs(); refused != nil {
		return refused
	}
	p.report("data", 100)
	p.removed = true
	return nil
}

// branchChannelNames — имена веток списком, в порядке списка.
func branchChannelNames(branches []layout.Branch) []string {
	names := make([]string, len(branches))
	for i, b := range branches {
		names[i] = string(b.Channel)
	}
	return names
}

// eraseDataDirs стирает папки данных Astral по порядку; чужие по имени пропускаются.
func (p *pass) eraseDataDirs() *bridge.Error {
	dirs := p.r.sys.UserDataDirs()
	for i, dir := range dirs {
		skipped, refused := p.removeUserDir(dir)
		if refused != nil {
			return refused
		}
		if !skipped {
			p.report("data", share(i+1, len(dirs)))
		}
	}
	return nil
}

// removeUserDir стирает одну папку данных; чужая по имени пропускается (skipped).
func (p *pass) removeUserDir(dir string) (skipped bool, refused *bridge.Error) {
	if !layout.IsUserDataFolder(dir) {
		p.r.log.Printf("refusing to remove %q: not an Astral data folder", dir)
		return true, nil
	}
	if err := pack.RemoveAllRetry(dir); err != nil {
		return false, classifyRemoval(err)
	}
	return false, nil
}

// nearestExisting — ближайший существующий предок пути (или корень диска).
func nearestExisting(path string) string {
	if pack.Exists(path) {
		return path
	}
	if up := filepath.Dir(path); up != path {
		return nearestExisting(up)
	}
	return path
}

// hInit отвечает на init: сначала статика, затем вопросы системе в порядке
// OSLocale, UserDataDirs, RunningFrom, FreeBytes.
func (r *Runner) hInit(context.Context, json.RawMessage) (any, error) {
	var info app.InitInfo
	info.Mode, info.Channel, info.Version = "uninstall", string(r.channel), r.cfg.Version
	info.InstallDir, info.Frame, info.Dev = r.cfg.Root, r.cfg.Frame, r.cfg.Dev
	info.Window = app.Window{Width: app.WindowWidth, Height: app.WindowHeight}
	info.Existing = app.ReadExisting(layout.New(r.cfg.Root))
	info.Installed = app.InstalledList(r.otherBranches())
	for _, ask := range []func(*app.InitInfo){r.askLocale, r.askDataDirs, r.askRunning, r.askFreeSpace} {
		ask(&info)
	}
	return info, nil
}

func (r *Runner) askLocale(info *app.InitInfo) {
	info.OSLocaleRaw = r.sys.OSLocale()
	info.OSLocale = install.MapLocale(info.OSLocaleRaw)
}

func (r *Runner) askDataDirs(info *app.InitInfo) { info.UserDataDirs = r.sys.UserDataDirs() }

func (r *Runner) askRunning(info *app.InitInfo) {
	running, err := r.probeRunning(r.cfg.Root)
	info.AppRunning = err == nil && running
}

func (r *Runner) askFreeSpace(info *app.InitInfo) {
	free, err := r.sys.FreeBytes(nearestExisting(r.cfg.Root))
	switch err {
	case nil:
		info.FreeBytes = &free
	}
}

func (r *Runner) hUninstall(_ context.Context, raw json.RawMessage) (any, error) {
	// Тип безымянный: encoding/json вставляет его описание в текст ошибки разбора, и тест ждёт именно его.
	args := struct {
		DeleteUserData bool `json:"deleteUserData"`
	}{}
	if err := json.Unmarshal(raw, &args); err != nil {
		return nil, refusal(codeInvalidArg, false, "%s", err.Error())
	}
	refused := r.startRemoval(args.DeleteUserData)
	if refused == nil {
		return map[string]bool{"started": true}, nil
	}
	return nil, refused
}

// startRemoval занимает раннер и пускает удаление в фоне; отказ — если Astral запущен или
// удаление уже идёт.
func (r *Runner) startRemoval(purge bool) *bridge.Error {
	if running, err := r.sys.RunningFrom(r.cfg.Root); err == nil && running {
		return runningRefusal()
	}
	if !r.working.CompareAndSwap(false, true) {
		return refusal(codeBadState, false, "uninstall is already running")
	}
	r.flight.Add(1)
	go r.background(purge)
	return nil
}

// background — фоновая работа вызова uninstall: удаление и итоговое событие.
func (r *Runner) background(purge bool) {
	defer r.flight.Done()
	removed, err := r.run(purge, r.forward)
	r.working.Store(false)
	r.announce(removed, err)
}

func (r *Runner) forward(phase string, percent int) {
	step := make(map[string]any, 2)
	step["phase"], step["percent"] = phase, percent
	r.rt.Emit("uninstall.progress", step)
}

// reportDone пишет в журнал и шлёт страницам, что удаление закончено.
func (r *Runner) reportDone(removed bool) {
	r.log.Printf("uninstall done, user data removed: %t", removed)
	done := map[string]any{}
	done["removedUserData"] = removed
	r.rt.Emit("uninstall.done", done)
}

// reportFailure пишет в журнал и шлёт страницам, чем кончился отказ.
func (r *Runner) reportFailure(err error) {
	bad := bridge.AsError(err)
	defer r.rt.Emit("error", bad.Event("uninstall"))
	r.log.Printf("uninstall failed: %s %s", bad.Code, bad.Detail)
}

func (r *Runner) announce(removed bool, err error) {
	if err == nil {
		r.reportDone(removed)
		return
	}
	r.reportFailure(err)
}
