// Пакет update применяет скачанное лаунчером обновление уже установленной
// ветки: ждёт выхода лаунчера, проверяет подпись и хэши, меняет app\ и файлы
// beta\, запускает новую версию и, если она не подтвердила запуск, возвращает
// прежнюю.
package update

import (
	"bytes"
	"cmp"
	"context"
	"encoding/json"
)

import (
	"errors"
	"fmt"
	"io"
	"os"
)

import (
	"path/filepath"
	"slices"
	"strings"
)

import (
	"sync"
	"sync/atomic"
	"time"
)

import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/app"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/applog"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/bridge"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/install"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/layout"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/manifest"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/pack"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/releasekeys"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/sysapi"

// Коды выхода процесса.
const (
	ExitCritical   = 12 // и замена, и откат сорвались
	ExitFailed     = 11 // отказ до замены: ничего не менялось
	ExitRolledBack = 10 // новая версия не стартовала, хелпер вернул старую
	ExitOK         = 0  // применено и подтверждено (или применено без --launch)
)

// Коды ошибок моста.
const (
	codeDenied     = "ACCESS_DENIED"
	codeHash       = "HASH_MISMATCH"
	codeSignature  = "SIGNATURE_INVALID"
	codeInstall    = "INSTALL_FAILED"
	codeAppRunning = "APP_RUNNING"
	codeInternal   = "INTERNAL"
)

// Причины отката.
const (
	reasonBootTimeout = "boot_timeout"
	reasonExitedEarly = "exited_early"
	reasonSwapFailed  = "swap_failed"

	// reasonRollbackFailed — в failed.json, когда откат не удался и диск остался новой версией.
	reasonRollbackFailed = "rollback_failed"
)

const (
	unpackFactor     = 20
	unpackFloorBytes = 1 << 30
	pakMinSize       = 48
	pakMagic         = "ASTRPAK1"
	replayAfter      = 80 * time.Millisecond  // повтор событий для позднего init
	bootNoteEvery    = 500 * time.Millisecond // не чаще сообщение об ожидании
	unpackEvery      = 200 * time.Millisecond // не чаще сообщение о распаковке
	killWait         = 5 * time.Second        // сколько ждать убитый процесс
	rollbackPause    = 300 * time.Millisecond // пауза между попытками отката
)

// Config — параметры раннера; нулевые времена заменяются умолчаниями.
type Config struct {
	DoneLinger     time.Duration    // сколько держать окно с «готово»; 0 → 1,5 с
	RollbackWindow time.Duration    // сколько повторять откат при занятых файлах; 0 → 15 с
	AutoStart      time.Duration    // когда начать само без init; 0 → 2 с
	BootPoll       time.Duration    // период опроса; 0 → 500 мс
	BootTimeout    time.Duration    // ожидание boot-ok; 0 → 120 с
	WaitPID        time.Duration    // ожидание выхода лаунчера; 0 → 60 с
	SetExitCode    func(int)        // запомнить код выхода процесса
	Exit           func()           // закрыть установщик
	AllowUnsigned  bool             // dev: принять манифест без подписи, если ключей нет
	Keys           *releasekeys.Set // ключи проверки подписи манифеста
	Dev            bool             // init.dev
	Frame          string           // custom или native; пусто — custom
	Version        string           // версия установщика (init.version)
	Launch         bool             // стартовать новую версию и ждать подтверждения
	PID            int              // pid лаунчера; 0 и меньше — не ждать
	Staging        string           // что положил лаунчер (--staging)
	Root           string           // папка установки (--install-dir)
}

// Outcome — итог применения.
type Outcome struct {
	Kind     string // done, rolledback или error
	Code     int
	Version  string // применяемая версия (из проверенного манифеста)
	Restored string // версия, вернувшаяся при откате
	Reason   string // причина отката
	Err      *bridge.Error
}

// journal — строка журнала об итоге.
func (o Outcome) journal() string {
	if o.Kind == "rolledback" {
		return fmt.Sprintf("update %s rolled back (%s), restored %s", o.Version, o.Reason, o.Restored)
	}
	if o.Kind != "error" {
		return fmt.Sprintf("update %s applied", o.Version)
	}
	if o.Code == ExitCritical {
		return fmt.Sprintf("update %s failed and could not be rolled back: %s: %s", o.Version, o.Err.Code, o.Err.Detail)
	}
	return fmt.Sprintf("update failed before any change: %s: %s", o.Err.Code, o.Err.Detail)
}

// finalEvent — итоговое событие страницы.
type finalEvent struct {
	name string
	data any
}

// pageMemory помнит последний ход и итог, чтобы повторить их позднему init.
type pageMemory struct {
	mu    sync.Mutex
	step  map[string]any
	final *finalEvent
}

// with выполняет действие под замком памяти.
func (m *pageMemory) with(act func()) {
	m.mu.Lock()
	defer m.mu.Unlock()
	act()
}

func (m *pageMemory) keepStep(ev map[string]any) { m.with(func() { m.step = ev }) }

func (m *pageMemory) keepFinal(note *finalEvent) { m.with(func() { m.final = note }) }

func (m *pageMemory) recall() (step map[string]any, final *finalEvent) {
	m.with(func() { step, final = m.step, m.final })
	return step, final
}

func (o Outcome) announcement() finalEvent {
	if o.Kind == "done" {
		return finalEvent{name: "update.done", data: map[string]any{"version": o.Version}}
	}
	if o.Kind == "rolledback" {
		shown := map[string]any{"version": o.Version}
		shown["restored"], shown["reason"] = o.Restored, o.Reason
		return finalEvent{name: "update.rolledback", data: shown}
	}
	return finalEvent{name: "error", data: o.Err.Event("update")}
}

// Runner применяет обновление; создаётся только New.
type Runner struct {
	done   chan struct{}
	busy   atomic.Bool
	result Outcome
	seen   pageMemory // что уже видела страница

	launch struct { // как началась работа
		sync.Mutex
		timer *time.Timer
		begun bool
	}

	stop context.CancelFunc
	ctx  context.Context

	log applog.Logger
	rt  *bridge.Router
	sys sysapi.System
	cfg Config
}

// orSpare возвращает have, а если его нет (missing) — запасное значение.
func orSpare[T any](missing bool, have, spare T) T {
	if missing {
		return spare
	}
	return have
}

// New собирает раннер; rt может быть nil (без окна), log — nil (молчит).
func New(cfg Config, sys sysapi.System, rt *bridge.Router, log applog.Logger) *Runner {
	for _, def := range []struct {
		slot  *time.Duration
		spare time.Duration
	}{
		{&cfg.RollbackWindow, 15 * time.Second},
		{&cfg.DoneLinger, 1500 * time.Millisecond},
		{&cfg.AutoStart, 2 * time.Second},
		{&cfg.BootPoll, 500 * time.Millisecond},
		{&cfg.BootTimeout, 120 * time.Second},
		{&cfg.WaitPID, 60 * time.Second},
	} {
		*def.slot = cmp.Or(*def.slot, def.spare)
	}
	cfg.Frame = cmp.Or(cfg.Frame, "custom")
	cfg.Exit = orSpare(cfg.Exit == nil, cfg.Exit, func() {})
	cfg.SetExitCode = orSpare(cfg.SetExitCode == nil, cfg.SetExitCode, func(int) {})
	r := &Runner{done: make(chan struct{}), sys: sys, rt: rt, log: defaultLog(log)}
	r.cfg = cfg
	r.ctx, r.stop = context.WithCancel(context.Background())
	return r
}

// Register подключает вызовы init и quit.
func (r *Runner) Register() {
	r.rt.Handle("quit", r.quit)
	r.rt.Handle("init", r.handleInit)
}

func (r *Runner) quit(context.Context, json.RawMessage) (any, error) {
	r.cfg.Exit()
	return nil, nil
}

// withLaunch выполняет fn, удерживая launch только на время её работы.
func (r *Runner) withLaunch(fn func()) {
	r.launch.Lock()
	defer r.launch.Unlock()
	fn()
}

// Start заводит запасной таймер: если страница не позвала init, применение
// начнётся само. Повторный вызов ничего не делает.
func (r *Runner) Start() {
	r.withLaunch(func() {
		if r.launch.timer != nil {
			return
		}
		r.launch.timer = time.AfterFunc(r.cfg.AutoStart, func() { r.begin() })
	})
}

// awaitDone ждёт конца применения и отдаёт итог.
func (r *Runner) awaitDone() Outcome {
	<-r.done
	return r.result
}

// Wait начинает применение, если оно ещё не начато, и ждёт итога.
func (r *Runner) Wait() Outcome {
	r.begin()
	return r.awaitDone()
}

// Busy сообщает, идёт ли применение.
func (r *Runner) Busy() bool { return r.busy.Load() }

// Close останавливает запасной таймер, отменяет применение и ждёт его конца.
func (r *Runner) Close() {
	began := r.disarm()
	r.stop()
	if began {
		<-r.done
	}
}

// disarm гасит запасной таймер и говорит, началось ли применение.
func (r *Runner) disarm() bool {
	var began bool
	r.withLaunch(func() {
		if timer := r.launch.timer; timer != nil {
			timer.Stop()
		}
		began = r.launch.begun
	})
	return began
}

// begin запускает применение в фоне; true, если запустил именно этот вызов.
func (r *Runner) begin() bool {
	var first bool
	r.withLaunch(func() {
		first = !r.launch.begun
		r.launch.begun = true
		if first {
			r.busy.Store(true)
		}
	})
	if first {
		go func() { r.conclude(r.Apply(r.ctx)) }()
	}
	return first
}

// conclude сообщает итог: сначала код выхода, потом событие, потом (для
// done) таймер закрытия окна.
func (r *Runner) conclude(out Outcome) {
	r.cfg.SetExitCode(out.Code)

	note := out.announcement()
	r.seen.keepFinal(&note)
	r.emit(note.name, note.data)

	if out.Kind == "done" {
		time.AfterFunc(r.cfg.DoneLinger, r.cfg.Exit)
	}
	r.result = out
	r.busy.Store(false)
	close(r.done)
}

func (r *Runner) emit(name string, data any) {
	if r.rt != nil {
		r.rt.Emit(name, data)
	}
}

// phaseSpanRows — границы общего прогресса по фазам, построчно.
var phaseSpanRows = []struct {
	phase  string
	lo, hi int
}{
	{"start", 70, 100},
	{"swap", 55, 70},
	{"unpack", 15, 55},
	{"verify", 0, 15},
}

// phaseSpans — границы общего прогресса по фазам.
var phaseSpans = func() map[string][2]int {
	m := make(map[string][2]int, len(phaseSpanRows))
	for _, row := range phaseSpanRows {
		m[row.phase] = [2]int{row.lo, row.hi}
	}
	return m
}()

// phaseBounds — границы общего прогресса для фазы; неизвестная фаза — 0..0.
func phaseBounds(phase string) (lo, hi int) {
	span := phaseSpans[phase]
	return span[0], span[1]
}

func progressEvent(phase string, percent int) map[string]any {
	percent = min(max(percent, 0), 100)
	lo, hi := phaseBounds(phase)
	ev := map[string]any{"phase": phase, "percent": percent}
	ev["overall"] = lo + (hi-lo)*percent/100
	return ev
}

func (r *Runner) progress(phase string, percent int) {
	ev := progressEvent(phase, percent)
	r.seen.keepStep(ev)
	r.emit("update.progress", ev)
}

// replay повторяет страницам последний ход и итог (для позднего init).
func (r *Runner) replay() {
	step, final := r.seen.recall()
	if step != nil {
		r.emit("update.progress", step)
	}
	if final != nil {
		r.emit(final.name, final.data)
	}
}

func (r *Runner) handleInit(context.Context, json.RawMessage) (any, error) {
	info := app.InitInfo{Mode: "update", UserDataDirs: []string{}}
	info.Window = app.Window{Width: app.WindowWidth, Height: app.WindowHeight}
	info.InstallDir, info.Version = r.cfg.Root, r.cfg.Version
	info.Frame, info.Dev = r.cfg.Frame, r.cfg.Dev
	r.fillLocale(&info)
	r.fillInstalled(&info)
	r.fillStaged(&info)
	if !r.begin() {
		time.AfterFunc(replayAfter, r.replay)
	}
	return info, nil
}

func (r *Runner) fillLocale(info *app.InitInfo) {
	info.OSLocaleRaw = r.sys.OSLocale()
	info.OSLocale = install.MapLocale(info.OSLocaleRaw)
}

func (r *Runner) fillInstalled(info *app.InitInfo) {
	lay := layout.New(r.cfg.Root)
	info.Existing = app.ReadExisting(lay)
	info.FromVersion = installedVersion(lay)
}

// fillStaged берёт целевую версию и ветку из manifest.json в staging без
// проверки подписи.
func (r *Runner) fillStaged(info *app.InitInfo) {
	doc, err := os.ReadFile(filepath.Join(r.cfg.Staging, "manifest.json"))
	if err != nil {
		return
	}
	mf, err := manifest.Parse(doc)
	if err == nil {
		info.ToVersion, info.Channel = mf.Version, mf.Channel
	}
}

// installedVersion — версия по beta\manifest.json установленной ветки.
func installedVersion(lay layout.Layout) (version string) {
	if found := app.ReadExisting(lay); found != nil {
		version = found.Version
	}
	return version
}

// betaFiles — файлы beta\, которые меняются при обновлении, в порядке замены.
var betaFiles = [...]string{"astral-web.pak", "manifest.json", "manifest.sig"}

// launchFailed запускает ветку и отдаёт ошибку запуска, если она была.
func launchFailed(sys sysapi.System, lay layout.Layout) error {
	_, err := sys.Launch(lay.Exe(), nil, lay.App())
	return err
}

// startPrevious запускает установленную версию (только если Launch).
func (r *Runner) startPrevious(lay layout.Layout) {
	if !r.cfg.Launch {
		return
	}
	if err := launchFailed(r.sys, lay); err != nil {
		r.log.Printf("could not start the previous version: %v", err)
	}
}

func refuse(code, detail string) Outcome {
	out := Outcome{Kind: "error", Code: ExitFailed}
	out.Err = &bridge.Error{Code: code, Detail: detail}
	return out
}

// isBranchFolder: у папки имя ветки Astral и она существует.
func isBranchFolder(root string) bool {
	if _, named := layout.ChannelOfRoot(root); named {
		st, err := os.Stat(root)
		return err == nil && st.IsDir()
	}
	return false
}

// rootProblem возвращает отказ, если корень не существующая папка ветки;
// short выбирает короткий текст (его использует RollbackOld).
func rootProblem(root string, short bool) *Outcome {
	if isBranchFolder(root) {
		return nil
	}
	tail := ""
	if !short {
		tail = fmt.Sprintf(" (%s, %s or %s)", layout.Release.DirName(), layout.Beta.DirName(), layout.Alpha.DirName())
	}
	out := refuse(codeInternal, fmt.Sprintf("refusing to work in %q: it is not an installed Astral branch folder", root)+tail)
	return &out
}

// persist повторяет op с паузой, пока он не удастся, не пройдёт срок или не
// сработает stop (оба условия проверяются только после неудачи).
func persist(deadline time.Time, stop func() bool, op func() error) error {
	for {
		err := op()
		if err == nil {
			return nil
		}
		if !time.Now().Before(deadline) || stop() {
			return err
		}
		time.Sleep(rollbackPause)
	}
}

// Apply применяет обновление синхронно. SetExitCode и Exit не вызывает и
// итоговых событий не шлёт: это делают Wait и окно.
func (r *Runner) Apply(ctx context.Context) Outcome {
	j := &job{r: r, ctx: ctx, staging: r.cfg.Staging}
	j.lay = layout.New(r.cfg.Root)
	outcome := j.guardRoot()
	r.log.Printf("%s", outcome.journal())
	return outcome
}

// job — ход одного применения. Этапы идут цепочкой: каждый либо возвращает
// итог-отказ, либо передаёт управление следующему.
type job struct {
	pid      int            // pid запущенной новой версии
	undo     []func() error // как отменить замену файлов beta; выполняются с конца
	undoApp  func() error   // как вернуть прежнюю app; откат начинается с неё
	havePak  bool
	haveBase bool
	baseSize int64
	sigBytes []byte
	mfBytes  []byte
	mf       *manifest.Manifest
	before   string // прежняя установленная версия

	staging string
	lay     layout.Layout
	ctx     context.Context
	r       *Runner
}

// fail — общий путь отказа до замены: убрать app.new, запустить прежнюю
// версию, вернуть итог с кодом 11.
func (j *job) fail(code, format string, args ...any) Outcome {
	_ = pack.RemoveAllRetry(j.lay.AppNew())
	j.r.startPrevious(j.lay)
	return refuse(code, fmt.Sprintf(format, args...))
}

func (j *job) guardRoot() Outcome {
	bad := rootProblem(j.r.cfg.Root, false)
	if bad != nil {
		return *bad
	}
	j.r.progress("verify", 0)
	return j.awaitLauncher()
}

func (j *job) awaitLauncher() Outcome {
	pid, wait := j.r.cfg.PID, j.r.cfg.WaitPID
	if pid > 0 {
		exited, err := j.r.sys.WaitExit(pid, wait)
		if err != nil || !exited {
			return refuse(codeAppRunning, fmt.Sprintf("the launcher (pid %d) did not exit within %s", pid, wait))
		}
	}
	return j.recoverLayout()
}

func (j *job) recoverLayout() Outcome {
	err := RecoverLayout(j.lay, j.r.log)
	if err != nil {
		return j.fail(codeInstall, "recovery after an interrupted update failed: %v", err)
	}
	j.before = installedVersion(j.lay)
	return j.loadStaging()
}

func (j *job) staged(name string) string { return filepath.Join(j.staging, name) }

// signedManifest проверяет подпись (или, в dev, только разбирает манифест).
func (j *job) signedManifest() (*manifest.Manifest, error) {
	cfg := j.r.cfg
	if cfg.Keys.Len() > 0 {
		return manifest.Verify(cfg.Keys, j.mfBytes, string(j.sigBytes))
	}
	if !cfg.AllowUnsigned {
		return nil, manifest.ErrNoKeys
	}
	j.r.log.Printf("WARNING: the manifest signature is NOT verified (dev build without release keys)")
	return manifest.Parse(j.mfBytes)
}

func (j *job) loadStaging() Outcome {
	mfBytes, err := os.ReadFile(j.staged("manifest.json"))
	if err != nil {
		return j.fail(codeInstall, "staging has no manifest.json: %v", err)
	}
	j.mfBytes = mfBytes
	sigBytes, err := os.ReadFile(j.staged("manifest.sig"))
	if err != nil {
		return j.fail(codeInstall, "staging has no manifest.sig: %v", err)
	}
	j.sigBytes = sigBytes
	mf, err := j.signedManifest()
	if err != nil {
		return j.fail(codeSignature, "%s", err.Error())
	}
	j.mf = mf
	return j.verifyStaging()
}

// problem — найденная при проверке staging неполадка.
type problem struct{ code, detail string }

func (j *job) probeBase() *problem {
	base := j.staged("base.zip")
	if !pack.Exists(base) {
		return nil
	}
	j.haveBase = true
	st, err := os.Stat(base)
	if err != nil {
		return baseFault(err)
	}
	j.baseSize = st.Size()
	sum, err := pack.SHA256File(base)
	if err != nil {
		return baseFault(err)
	}
	signed := j.mf.Artifacts.Base
	if j.baseSize != signed.Size || !strings.EqualFold(sum, signed.SHA256) {
		return &problem{code: codeHash, detail: "base.zip does not match the signed manifest"}
	}
	return nil
}

// baseFault — неполадка чтения base.zip.
func baseFault(err error) *problem {
	return &problem{code: codeInstall, detail: "base.zip: " + err.Error()}
}

func (j *job) probePak() *problem {
	pak := j.staged("astral-web.pak")
	if !pack.Exists(pak) {
		return nil
	}
	j.havePak = true
	err := checkPak(pak)
	if err != nil {
		return &problem{code: codeInstall, detail: err.Error()}
	}
	return nil
}

// firstProblem проверяет base.zip, затем (если с ним всё хорошо) pak.
func (j *job) firstProblem() *problem {
	if found := j.probeBase(); found != nil {
		return found
	}
	return j.probePak()
}

func (j *job) verifyStaging() Outcome {
	if found := j.firstProblem(); found != nil {
		return j.fail(found.code, "%s", found.detail)
	}
	j.r.progress("verify", 100)
	return j.unpack()
}

// openHead читает до n первых байт path, не считая ошибку чтения смертельной.
func openHead(path string, n int) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	head, _ := io.ReadAll(io.LimitReader(f, int64(n)))
	return head, nil
}

// checkPak проверяет заголовок astral-web.pak: ASTRPAK1 и не меньше 48 байт.
func checkPak(path string) error {
	head, err := openHead(path, pakMinSize)
	if err != nil {
		return err
	}
	if !bytes.HasPrefix(head, []byte(pakMagic)) {
		return errors.New("astral-web.pak does not start with " + pakMagic)
	}
	if len(head) < pakMinSize {
		return errors.New("astral-web.pak is too short")
	}
	return nil
}

// unpackLimit — предел распакованного размера: размер архива × 20, но не
// меньше 1 ГиБ и не больше DefaultMaxTotalBytes.
func unpackLimit(zipSize int64) int64 {
	return min(max(zipSize*unpackFactor, unpackFloorBytes), pack.DefaultMaxTotalBytes)
}

// unpackProgress превращает вызовы распаковки в события не чаще раза в 200 мс
// (последний вызов идёт всегда).
func (j *job) unpackProgress() func(done, total int64) {
	var last time.Time
	return func(done, total int64) {
		finished := total > 0 && done >= total
		throttled := !finished && !last.IsZero() && time.Since(last) < unpackEvery
		if throttled {
			return
		}
		last = time.Now()
		percent := 100
		if total > 0 {
			percent = int(done * 100 / total)
		}
		j.r.progress("unpack", percent)
	}
}

func (j *job) unpack() Outcome {
	if !j.haveBase {
		return j.swapIn()
	}
	j.r.progress("unpack", 0)
	if err := j.extractBase(); err != nil {
		return j.fail(codeInstall, "%s", err.Error())
	}
	j.r.progress("unpack", 100)
	return j.swapIn()
}

// extractBase стирает прежний app.new, распаковывает base.zip в него и проверяет Astral.exe.
func (j *job) extractBase() error {
	if err := pack.RemoveAllRetry(j.lay.AppNew()); err != nil {
		return err
	}
	opts := pack.ExtractOptions{MaxTotalBytes: unpackLimit(j.baseSize)}
	_, err := pack.ExtractZip(j.staged("base.zip"), j.lay.AppNew(), opts, j.unpackProgress())
	if err != nil {
		return fmt.Errorf("unpack: %v", err)
	}
	if !pack.Exists(filepath.Join(j.lay.AppNew(), layout.ExeName)) {
		return errors.New("Astral.exe is missing in base.zip")
	}
	return nil
}

// betaSlot — один заменяемый файл beta\: прежний уходит в .old, новый
// пишется атомарно.
type betaSlot struct {
	cur, old string
	shelved  bool // прежний файл переехал в .old
}

// shelve освобождает место: чужой старый .old стирается, прежний файл уходит в .old.
func (s *betaSlot) shelve() error {
	if pack.Exists(s.old) {
		err := pack.RemoveAllRetry(s.old)
		if err != nil {
			return err
		}
	}
	if pack.Exists(s.cur) {
		err := pack.RenameRetry(s.cur, s.old)
		if err == nil {
			s.shelved = true
		}
		return err
	}
	return nil
}

func (s *betaSlot) take(write func(dst string) error) error {
	if err := s.shelve(); err != nil {
		return err
	}
	err := write(s.cur)
	if err != nil && s.shelved {
		_ = pack.RenameRetry(s.old, s.cur)
	}
	return err
}

// revert отменяет удавшуюся замену.
func (s *betaSlot) revert() error {
	err := pack.RemoveAllRetry(s.cur)
	if err == nil && s.shelved {
		err = pack.RenameRetry(s.old, s.cur)
	}
	return err
}

// writerFor выбирает, чем заполнить новый файл beta\.
func (j *job) writerFor(name string) func(dst string) error {
	writing := func(data []byte) func(dst string) error {
		return func(dst string) error { return pack.WriteFileAtomic(dst, data, 0o644) }
	}
	switch name {
	case "manifest.json":
		return writing(j.mfBytes)
	case "astral-web.pak":
		return func(dst string) error { return pack.CopyFileAtomic(j.staged(name), dst) }
	}
	return writing(j.sigBytes)
}

// replacementCode — код отказа при невозможности заменить app.
func (j *job) replacementCode(err error) string {
	if !errors.Is(err, pack.ErrBusy) {
		return codeDenied
	}
	if running, _ := j.r.sys.RunningFrom(j.r.cfg.Root); running {
		return codeAppRunning
	}
	return codeDenied
}

func (j *job) swapIn() Outcome {
	j.r.progress("swap", 0)
	if j.haveBase {
		swap, err := pack.SwapDirs(j.lay.AppNew(), j.lay.App(), j.lay.AppOld())
		if err != nil {
			return j.fail(j.replacementCode(err), "could not replace app: %v", err)
		}
		j.undoApp = swap.Rollback
	}
	for _, name := range j.betaToReplace() {
		cur := j.lay.BetaFile(name)
		slot := &betaSlot{cur: cur, old: cur + ".old"}
		err := slot.take(j.writerFor(name))
		if err != nil {
			j.r.log.Printf(`replacing beta\%s failed: %v`, name, err)
			return j.rollBack(reasonSwapFailed)
		}
		j.undo = append(j.undo, slot.revert)
	}
	j.r.progress("swap", 100)
	return j.settle()
}

// betaToReplace — файлы beta\ в порядке замены; pak пропускается, если лаунчер его не положил.
func (j *job) betaToReplace() []string {
	names := make([]string, 0, len(betaFiles))
	for _, name := range betaFiles {
		if name == "astral-web.pak" && !j.havePak {
			continue
		}
		names = append(names, name)
	}
	return names
}

func (j *job) settle() Outcome {
	applied := Outcome{Kind: "done", Code: ExitOK, Version: j.mf.Version}
	if !j.r.cfg.Launch {
		j.cleanup()
		return applied
	}
	j.r.progress("start", 0)
	_ = os.Remove(j.lay.BootOK())
	pid, err := j.r.sys.Launch(j.lay.Exe(), nil, j.lay.App())
	if err != nil {
		j.r.log.Printf("the new version did not start: %v", err)
		return j.rollBack(reasonExitedEarly)
	}
	j.pid = pid
	if reason := j.awaitBoot(); reason != "" {
		return j.rollBack(reason)
	}
	finish := j.cleanup
	if pack.Exists(layout.StableMarkerIn(j.lay.App())) {
		finish = j.keepPrevious
	}
	finish()
	return applied
}

// bootVersion — версия из update\boot-ok ("" если файла нет или он битый).
func (j *job) bootVersion() string {
	raw, err := os.ReadFile(j.lay.BootOK())
	if err != nil {
		return ""
	}
	var rec struct {
		Version string `json:"version"`
	}
	if json.Unmarshal(raw, &rec) == nil {
		return rec.Version
	}
	return ""
}

// bootConfirmed: запуск подтверждён, если в boot-ok записана применяемая версия.
func (j *job) bootConfirmed() bool {
	if j.bootVersion() != j.mf.Version {
		return false
	}
	j.r.progress("start", 100)
	return true
}

// awaitBoot ждёт подтверждения запуска; пустая строка — подтверждено, иначе
// причина отката.
func (j *job) awaitBoot() string {
	cfg := j.r.cfg
	began := time.Now()
	var lastNote time.Time
	for {
		if j.bootConfirmed() {
			return ""
		}
		if exited, _ := j.r.sys.WaitExit(j.pid, 0); exited {
			if j.bootConfirmed() {
				return ""
			}
			return reasonExitedEarly
		}
		now := time.Now()
		if now.After(began.Add(cfg.BootTimeout)) {
			return reasonBootTimeout
		}
		if lastNote.IsZero() || now.Sub(lastNote) >= bootNoteEvery {
			lastNote = now
			elapsed := int64(now.Sub(began)) * 100 / int64(cfg.BootTimeout)
			j.r.progress("start", int(min(elapsed, 99)))
		}
		select {
		case <-j.ctx.Done():
			return reasonBootTimeout
		case <-time.After(cfg.BootPoll):
		}
	}
}

// keepPrevious оставляет прежнюю версию до «стабильности» и пишет запись о
// том; если записать нельзя — убирает прежнюю сразу.
func (j *job) keepPrevious() {
	if err := writeSignal(j.lay.PendingStable(), j.stamp(map[string]any{"from": j.before})); err != nil {
		j.r.log.Printf("could not write pending-stable.json (%v): removing the previous version now", err)
		j.cleanup()
		return
	}
	j.r.log.Printf("update %s confirmed its start; the previous version stays until it is stable", j.mf.Version)
	j.dropStaging()
}

// logIfError пишет err в журнал по format, если он есть.
func logIfError(log applog.Logger, err error, format string) {
	if err != nil {
		log.Printf(format, err)
	}
}

// finishCleanup убирает запись о стабильности и staging.
func (j *job) finishCleanup() {
	_ = os.Remove(j.lay.PendingStable())
	j.dropStaging()
}

// cleanup — очистка успеха: прежняя версия, .old файлы, запись о
// стабильности и staging.
func (j *job) cleanup() {
	logIfError(j.r.log, pack.RemoveAllRetry(j.lay.AppOld()), "could not remove app.old: %v")
	for _, name := range betaFiles {
		_ = os.Remove(j.lay.BetaFile(name + ".old"))
	}
	j.finishCleanup()
}

// dropStaging стирает staging, только если он лежит строго внутри корня.
func (j *job) dropStaging() {
	if insideRoot(j.r.cfg.Root, j.staging) {
		err := pack.RemoveAllRetry(j.staging)
		if err != nil {
			j.r.log.Printf("could not remove staging: %v", err)
		}
	}
}

// insideRoot: path лежит строго внутри root (без учёта регистра).
func insideRoot(root, path string) bool {
	if root == "" || path == "" {
		return false
	}
	prefix := strings.ToLower(filepath.Clean(root)) + string(filepath.Separator)
	rest, under := strings.CutPrefix(strings.ToLower(filepath.Clean(path)), prefix)
	return under && rest != ""
}

// stopNewVersion убивает запущенную хелпером новую версию и ждёт её выхода.
func (j *job) stopNewVersion() {
	if j.pid > 0 {
		err := j.r.sys.Kill(j.pid)
		if err != nil {
			j.r.log.Printf("could not stop the new version (pid %d): %v", j.pid, err)
		}
		_, _ = j.r.sys.WaitExit(j.pid, killWait)
	}
}

// rollBack возвращает прежнее состояние после неудачи замены или запуска.
func (j *job) rollBack(reason string) Outcome {
	r := j.r
	j.stopNewVersion()

	deadline := time.Now().Add(r.cfg.RollbackWindow)
	never := func() bool { return false }
	for _, undo := range j.undoSteps() {
		err := persist(deadline, never, undo)
		if err == nil {
			continue
		}
		r.log.Printf("ROLLBACK FAILED: %v", err)
		// Запись нужна лаунчеру: по ней он вносит версию в список негодных, иначе предложит её снова.
		j.noteFailure(reasonRollbackFailed)
		critical := Outcome{Kind: "error", Code: ExitCritical, Version: j.mf.Version}
		critical.Err = &bridge.Error{Code: codeInstall, Detail: "rollback_failed: " + err.Error()}
		return critical
	}
	_ = pack.RemoveAllRetry(j.lay.AppNew())
	j.noteFailure(reason)
	r.startPrevious(j.lay)
	rolled := Outcome{Kind: "rolledback", Code: ExitRolledBack, Version: j.mf.Version}
	rolled.Restored, rolled.Reason = j.before, reason
	return rolled
}

// undoSteps — что отменять и в каком порядке. Сначала app: её чаще всего держит ещё живой процесс,
// и откат упирается именно в неё. Тогда файлы beta остаются новыми, и диск целиком новая версия,
// а не новая app со старыми beta.
func (j *job) undoSteps() []func() error {
	beta := slices.Clone(j.undo)
	slices.Reverse(beta)
	if j.undoApp == nil {
		return beta
	}
	return append([]func() error{j.undoApp}, beta...)
}

// stamp добавляет к записи в update\ общие поля: время, sequence и версию применяемого обновления.
func (j *job) stamp(fields map[string]any) map[string]any {
	fields["at"] = nowUTC()
	fields["sequence"] = j.mf.Sequence
	fields["version"] = j.mf.Version
	return fields
}

// noteFailure пишет update\failed.json: версия не прижилась, причина такая-то.
func (j *job) noteFailure(reason string) {
	err := writeSignal(j.lay.FailedJSON(), j.stamp(map[string]any{"reason": reason}))
	if err != nil {
		j.r.log.Printf("could not write failed.json: %v", err)
	}
}

func nowUTC() string { return time.Now().UTC().Format(time.RFC3339) }

// writeSignal пишет JSON-файл с ключами по алфавиту и переводом строки.
func writeSignal(path string, fields map[string]any) error {
	data, err := json.Marshal(fields)
	if err == nil {
		err = pack.WriteFileAtomic(path, append(data, '\n'), 0o644)
	}
	return err
}

// repair — один шаг починки следов прерванной замены.
type repair struct {
	apply  func() error
	note   string
	needed func() bool
}

// betaRepair — починка одного файла beta\ из его .old.
func betaRepair(lay layout.Layout, name string) repair {
	cur := lay.BetaFile(name)
	return repair{
		needed: func() bool { return !pack.Exists(cur) && pack.Exists(cur+".old") },
		note:   `recovery: restoring beta\` + name,
		apply:  func() error { return pack.RenameRetry(cur+".old", cur) },
	}
}

// defaultLog отдаёт log, а если он nil — молчащую заглушку.
func defaultLog(log applog.Logger) applog.Logger {
	if log != nil {
		return log
	}
	return applog.Nop{}
}

// RecoverLayout чинит следы прерванной замены; останавливается на первой
// ошибке и отдаёт её как есть.
func RecoverLayout(lay layout.Layout, log applog.Logger) error {
	log = defaultLog(log)
	repairs := make([]repair, 0, 2+len(betaFiles))
	repairs = append(repairs, repair{
		needed: func() bool { return !pack.Exists(lay.App()) && pack.Exists(lay.AppOld()) },
		note:   "recovery: app is missing, restoring app.old",
		apply:  func() error { return pack.RenameRetry(lay.AppOld(), lay.App()) },
	})
	repairs = append(repairs, repair{
		needed: func() bool { return pack.Exists(lay.App()) && pack.Exists(lay.AppNew()) },
		note:   "recovery: removing the leftover app.new",
		apply:  func() error { return pack.RemoveAllRetry(lay.AppNew()) },
	})
	for _, name := range betaFiles {
		repairs = append(repairs, betaRepair(lay, name))
	}
	for _, fix := range repairs {
		if fix.needed() {
			log.Printf("%s", fix.note)
			if err := fix.apply(); err != nil {
				return err
			}
		}
	}
	return nil
}
