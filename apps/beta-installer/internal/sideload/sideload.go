// Пакет sideload ставит ещё одну ветку Astral рядом с уже стоящей: проверяет
// файлы, которые скачал лаунчер, берёт лицензию у установки-источника, кладёт
// ветку в её собственную папку и заводит ярлыки и запись в «Приложениях».
package sideload

import (
	"cmp"
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"fmt"
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
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/chstatus"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/install"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/layout"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/machine"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/manifest"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/pack"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/releasekeys"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/sysapi"
)

// Config — параметры раннера.
type Config struct {
	Channel       layout.Channel    // что ставим
	Version       string            // версия установщика (init.version)
	Frame         string            // custom или native; пусто — custom
	Dev           bool              // init.dev
	Staging       string            // папка, которую положил лаунчер
	SourceRoot    string            // откуда берём beta\license и beta\bind
	TargetRoot    string            // корень новой ветки
	Launch        bool              // по окончании стартовать ветку
	Keys          *releasekeys.Set  // ключи проверки подписи манифеста
	AllowUnsigned bool              // dev: принять манифест без ключей
	LicensePub    ed25519.PublicKey // ключ проверки лицензии; пусто — не проверяем
	AutoStart     time.Duration     // когда начать само без init; 0 — 2 с
	Exit          func()            // закрыть установщик
	SetExitCode   func(int)         // запомнить код выхода процесса
}

// Outcome — итог работы.
type Outcome struct {
	Kind    string // done или error
	Code    int
	Version string // версия ставимой ветки; пуста, пока манифест не проверен
	Err     *bridge.Error
}

// refusal — отказ работы; несёт код, повторяемость и подробность.
type refusal struct {
	code   string
	retry  bool
	detail string
}

func (e *refusal) Error() string { return e.code + ": " + e.detail }

func refuse(code string, retry bool, format string, args ...any) error {
	return &refusal{code: code, retry: retry, detail: fmt.Sprintf(format, args...)}
}

// failedOutcome собирает итог-отказ из ошибки этапа.
func failedOutcome(err error) Outcome {
	var rf *refusal
	if errors.As(err, &rf) {
		return outcomeOf(rf)
	}
	return outcomeOf(&refusal{code: codeInternal, detail: err.Error()})
}

// outcomeOf переводит отказ в итог с кодом выхода ExitFailed.
func outcomeOf(rf *refusal) Outcome {
	detail := &bridge.Error{Code: rf.code, Retryable: rf.retry, Detail: rf.detail}
	return Outcome{Kind: "error", Code: ExitFailed, Err: detail}
}

// journal — строка журнала об итоге.
func (o Outcome) journal(ch layout.Channel) string {
	if o.Kind != "error" {
		return fmt.Sprintf("install-channel %s %s done", ch, o.Version)
	}
	return fmt.Sprintf("install-channel %s failed: %s: %s", ch, o.Err.Code, o.Err.Detail)
}

// announcement — итоговое событие по итогу работы.
func (o Outcome) announcement(ch layout.Channel) event {
	if o.Kind != "done" {
		return event{"error", o.Err.Event("side")}
	}
	return event{"side.done", map[string]any{"channel": string(ch), "version": o.Version}}
}

// event — событие страницы.
type event struct {
	name string
	data any
}

// eventMemory помнит последний ход и итог, чтобы повторить их позднему init.
type eventMemory struct {
	mu    sync.Mutex
	step  *event
	final *event
}

// update выполняет fn под замком памяти событий.
func (m *eventMemory) update(fn func()) {
	m.mu.Lock()
	defer m.mu.Unlock()
	fn()
}

func (m *eventMemory) keepStep(ev *event) { m.update(func() { m.step = ev }) }

func (m *eventMemory) keepFinal(ev *event) { m.update(func() { m.final = ev }) }

func (m *eventMemory) recall() (step, final *event) {
	m.update(func() { step, final = m.step, m.final })
	return
}

// statusFile ведёт файл состояния для лаунчера; пустой путь — файла нет.
type statusFile struct {
	path  string
	log   applog.Logger
	phase string // фаза последней записи хода
	pct   int    // процент последней записи хода
}

// logIfError пишет err в журнал по format, если он есть.
func logIfError(log applog.Logger, err error, format string) {
	if err != nil {
		log.Printf(format, err)
	}
}

func (s *statusFile) put(st chstatus.State) {
	if s.path == "" {
		return
	}
	st.At = time.Now().In(time.UTC).Format(time.RFC3339)
	logIfError(s.log, chstatus.Write(s.path, st), "could not write the status file: %v")
}

// working записывает ход, если сменилась фаза, дошло до 100 или процент вырос
// на statusStep.
func (s *statusFile) working(phase string, percent, overall int, version string) {
	quiet := phase == s.phase && percent != 100 && percent-s.pct < statusStep
	if quiet {
		return
	}
	s.phase, s.pct = phase, percent
	st := chstatus.State{State: chstatus.Working, Phase: phase, Version: version}
	st.Percent, st.Overall = chstatus.Int(percent), chstatus.Int(overall)
	s.put(st)
}

// finish записывает итог работы.
func (s *statusFile) finish(out Outcome) {
	if out.Kind == "done" {
		s.put(chstatus.State{State: chstatus.Done, Version: out.Version})
		return
	}
	failed := chstatus.State{State: chstatus.Error, Code: out.Err.Code, Detail: out.Err.Detail}
	failed.Retryable = out.Err.Retryable
	s.put(failed)
}

// stageSpan — доля общего прогресса, которую занимает фаза.
type stageSpan struct {
	phase  string
	lo, hi int
}

// Диапазоны общего прогресса по фазам.
var spans = []stageSpan{
	{"verify", 0, 15}, {"unpack", 15, 60}, {"files", 60, 80}, {"shortcuts", 80, 92}, {"registry", 92, 100},
}

func overallOf(phase string, percent int) int {
	at := slices.IndexFunc(spans, func(sp stageSpan) bool { return sp.phase == phase })
	if at < 0 {
		return 0
	}
	sp := spans[at]
	return sp.lo + (sp.hi-sp.lo)*percent/100
}

// Runner — раннер «ставим рядом»; создаётся только New.
type Runner struct {
	cfg    Config
	sys    sysapi.System
	rt     *bridge.Router
	log    applog.Logger
	status *statusFile

	ctx    context.Context
	cancel context.CancelFunc

	gate struct { // начало работы
		sync.Mutex
		begun bool
		timer *time.Timer
	}
	recent  eventMemory  // что уже видела страница
	version atomic.Value // версия манифеста (string), когда она уже известна
	result  Outcome
	busy    atomic.Bool
	done    chan struct{}
}

// New собирает раннер; rt может быть nil (без окна), log — nil (молчит).
func New(cfg Config, sys sysapi.System, rt *bridge.Router, log applog.Logger) *Runner {
	r := &Runner{cfg: cfg, sys: sys, rt: rt, log: log}
	r.done = make(chan struct{})
	r.fillDefaults()
	r.status = &statusFile{log: r.log, pct: -100}
	if shared := sys.SharedDataDir(); shared != "" {
		r.status.path = chstatus.Path(shared, cfg.Channel)
	}
	r.ctx, r.cancel = context.WithCancel(context.Background())
	return r
}

func defaultFunc0(f func()) func() {
	if f != nil {
		return f
	}
	return func() {}
}

func defaultFunc1(f func(int)) func(int) {
	if f != nil {
		return f
	}
	return func(int) {}
}

// fillDefaults подставляет то, что не задано: срок автозапуска, рамку, пустые обработчики и молчащий журнал.
func (r *Runner) fillDefaults() {
	c := &r.cfg
	c.AutoStart = cmp.Or(c.AutoStart, 2*time.Second)
	c.Frame = cmp.Or(c.Frame, "custom")
	c.Exit = defaultFunc0(c.Exit)
	c.SetExitCode = defaultFunc1(c.SetExitCode)
	if r.log == nil {
		r.log = applog.Nop{}
	}
}

// Register подключает вызовы init, launch и quit.
func (r *Runner) Register() {
	calls := []struct {
		name string
		do   bridge.Handler
	}{
		{"init", r.handleInit},
		{"launch", r.handleLaunch},
		{"quit", r.handleQuit},
	}
	for _, c := range calls {
		r.rt.Handle(c.name, c.do)
	}
}

func (r *Runner) handleQuit(context.Context, json.RawMessage) (any, error) {
	r.cfg.Exit()
	return nil, nil
}

// withGate выполняет fn, удерживая gate только на время её работы.
func (r *Runner) withGate(fn func()) {
	r.gate.Lock()
	defer r.gate.Unlock()
	fn()
}

// Start заводит запасной таймер; повторный вызов ничего не делает.
func (r *Runner) Start() {
	r.withGate(func() {
		if r.gate.timer == nil {
			r.gate.timer = time.AfterFunc(r.cfg.AutoStart, func() { r.begin() })
		}
	})
}

// awaitDone ждёт конца работы и отдаёт итог.
func (r *Runner) awaitDone() Outcome {
	<-r.done
	return r.result
}

// Wait начинает работу, если она ещё не начата, и ждёт итога.
func (r *Runner) Wait() Outcome {
	r.begin()
	return r.awaitDone()
}

// Busy сообщает, идёт ли работа.
func (r *Runner) Busy() bool { return r.busy.Load() }

// Close останавливает таймер, отменяет работу и ждёт её конца.
func (r *Runner) Close() {
	began := r.stopTimer()
	r.cancel()
	if began {
		<-r.done
	}
}

// stopTimer останавливает запасной таймер и говорит, начата ли уже работа.
func (r *Runner) stopTimer() bool {
	var began bool
	r.withGate(func() {
		if t := r.gate.timer; t != nil {
			t.Stop()
		}
		began = r.gate.begun
	})
	return began
}

// claim занимает начало работы; true — только для первого вызова.
func (r *Runner) claim() bool {
	claimed := false
	r.withGate(func() {
		if r.gate.begun {
			return
		}
		r.gate.begun = true
		r.busy.Store(true)
		claimed = true
	})
	return claimed
}

func (r *Runner) begin() bool {
	if !r.claim() {
		return false
	}
	go func() { r.conclude(r.Apply(r.ctx)) }()
	return true
}

// conclude сообщает итог: код выхода, файл состояния, событие.
func (r *Runner) conclude(out Outcome) {
	r.cfg.SetExitCode(out.Code)
	r.status.finish(out)

	final := out.announcement(r.cfg.Channel)
	r.recent.keepFinal(&final)
	r.emit(final)

	r.result = out
	r.busy.Store(false)
	close(r.done)
}

func (r *Runner) emit(ev event) {
	if r.rt == nil {
		return
	}
	r.rt.Emit(ev.name, ev.data)
}

func (r *Runner) knownVersion() string {
	v, _ := r.version.Load().(string)
	return v
}

// progress шлёт side.progress и, по правилам, пишет файл состояния (событие
// уходит страницам раньше записи).
// progressData собирает данные события хода; поле version — только когда версия уже известна.
func progressData(overall int, phase string, percent int, version string) map[string]any {
	data := map[string]any{"overall": overall, "phase": phase, "percent": percent}
	if version != "" {
		data["version"] = version
	}
	return data
}

func (r *Runner) progress(phase string, percent int) {
	percent = min(max(percent, 0), 100)
	overall := overallOf(phase, percent)
	version := r.knownVersion()

	step := event{"side.progress", progressData(overall, phase, percent, version)}
	r.recent.keepStep(&step)
	r.emit(step)

	r.status.working(phase, percent, overall, version)
}

// replay повторяет страницам последний ход и итог (для позднего init).
func (r *Runner) replay() {
	step, final := r.recent.recall()
	for _, ev := range []*event{step, final} {
		if ev != nil {
			r.emit(*ev)
		}
	}
}

// nearestExisting — ближайший существующий предок пути (или корень диска).
func nearestExisting(path string) string {
	if pack.Exists(path) {
		return path
	}
	parent := filepath.Dir(path)
	if parent == path {
		return path
	}
	return nearestExisting(parent)
}

func (r *Runner) handleInit(context.Context, json.RawMessage) (any, error) {
	notViaLauncher := false
	info := app.InitInfo{Mode: "side", Version: r.cfg.Version, Channel: string(r.cfg.Channel)}
	info.ViaLauncher, info.UserDataDirs = &notViaLauncher, []string{}
	info.InstallDir, info.Frame, info.Dev = r.cfg.TargetRoot, r.cfg.Frame, r.cfg.Dev
	info.Window = app.Window{Width: app.WindowWidth, Height: app.WindowHeight}
	fillers := []func(*app.InitInfo){r.fillLocale, r.fillNeighbours, r.fillOrigin, r.fillTarget, r.fillFreeSpace}
	for _, fill := range fillers {
		fill(&info)
	}
	if !r.begin() {
		time.AfterFunc(replayAfter, r.replay)
	}
	return info, nil
}

func (r *Runner) fillLocale(info *app.InitInfo) {
	info.OSLocaleRaw = r.sys.OSLocale()
	info.OSLocale = install.MapLocale(info.OSLocaleRaw)
}

func (r *Runner) fillNeighbours(info *app.InitInfo) {
	beside := layout.ScanBeside(r.cfg.TargetRoot)
	info.Installed = app.InstalledList(beside)
	info.Existing = app.ExistingOf(beside, "")
}

func (r *Runner) fillOrigin(info *app.InitInfo) {
	from, ok := layout.ChannelOfRoot(r.cfg.SourceRoot)
	if ok {
		info.FromChannel = string(from)
	}
}

// readStaged читает файл name из папки staging.
func readStaged(cfg Config, name string) ([]byte, error) {
	return os.ReadFile(filepath.Join(cfg.Staging, name))
}

// stagedVersion — версия из manifest.json в staging без проверки подписи; пусто, если не читается.
func (r *Runner) stagedVersion() string {
	doc, err := readStaged(r.cfg, "manifest.json")
	if err != nil {
		return ""
	}
	mf, err := manifest.Parse(doc)
	if err != nil {
		return ""
	}
	return mf.Version
}

// fillTarget берёт целевую версию из проверенного манифеста, а пока его нет —
// из manifest.json staging без проверки подписи.
func (r *Runner) fillTarget(info *app.InitInfo) {
	if info.ToVersion = r.knownVersion(); info.ToVersion == "" {
		info.ToVersion = r.stagedVersion()
	}
}

func (r *Runner) fillFreeSpace(info *app.InitInfo) {
	if free, err := r.sys.FreeBytes(nearestExisting(r.cfg.TargetRoot)); err == nil {
		info.FreeBytes = &free
	}
}

// siblingRoot — корень соседней ветки ch рядом с root.
func siblingRoot(root string, ch layout.Channel) string {
	return filepath.Join(filepath.Dir(root), ch.DirName())
}

// launchRoot находит корень ветки, которую просит запустить страница.
func (r *Runner) launchRoot(asked string) (string, *bridge.Error) {
	if asked == "" {
		return r.cfg.TargetRoot, nil
	}
	ch, known := layout.Parse(asked)
	if !known {
		return "", &bridge.Error{Code: codeInvalidArg, Detail: "unknown channel " + asked}
	}
	if ch == r.cfg.Channel {
		return r.cfg.TargetRoot, nil
	}
	return siblingRoot(r.cfg.TargetRoot, ch), nil
}

func (r *Runner) handleLaunch(_ context.Context, raw json.RawMessage) (any, error) {
	var args struct {
		Channel string `json:"channel"`
	}
	if err := json.Unmarshal(raw, &args); err != nil {
		return nil, &bridge.Error{Code: codeInvalidArg, Detail: err.Error()}
	}
	root, refused := r.launchRoot(args.Channel)
	if refused == nil {
		refused = r.launchBranch(layout.New(root))
	}
	if refused != nil {
		return nil, refused
	}
	time.AfterFunc(exitAfter, r.cfg.Exit)
	return map[string]bool{"launched": true}, nil
}

// launchFailed запускает ветку и отдаёт ошибку запуска, если она была.
func launchFailed(sys sysapi.System, lay layout.Layout) error {
	_, err := sys.Launch(lay.Exe(), nil, lay.App())
	return err
}

// launchBranch запускает установленную ветку; отказ — ошибка моста.
func (r *Runner) launchBranch(lay layout.Layout) *bridge.Error {
	if lay.Installed() {
		if err := launchFailed(r.sys, lay); err != nil {
			return &bridge.Error{Code: codeInternal, Detail: "launch: " + err.Error()}
		}
		return nil
	}
	return &bridge.Error{Code: codeInstall, Detail: "Astral.exe is not installed"}
}

// Apply выполняет работу синхронно. SetExitCode не вызывает, итоговый файл
// состояния и итоговые события оставляет Wait.
func (r *Runner) Apply(ctx context.Context) Outcome {
	j := &job{r: r, ctx: ctx, src: layout.New(r.cfg.SourceRoot), dst: layout.New(r.cfg.TargetRoot)}
	var out Outcome
	if err := j.runStages(); err != nil {
		out = failedOutcome(err)
	} else {
		out = Outcome{Kind: "done", Code: ExitOK, Version: j.mf.Version}
	}
	r.log.Printf("%s", out.journal(r.cfg.Channel))
	return out
}

// job — ход одной работы.
type job struct {
	r   *Runner
	ctx context.Context
	src layout.Layout // источник
	dst layout.Layout // цель

	license, bind []byte
	mf            *manifest.Manifest
	mfBytes       []byte
	sigBytes      []byte
	baseSize      int64
	pakSize       int64
}

// stages — этапы работы по порядку; первая ошибка прекращает работу.
var stages = []func(*job) error{
	(*job).checkBranch, (*job).takeLicense, (*job).checkTarget, (*job).checkStaging,
	(*job).prepareRoot, (*job).unpack, (*job).place, (*job).register, (*job).finish,
}

// runStages прогоняет этапы по порядку и отдаёт первую ошибку.
func (j *job) runStages() error {
	for _, stage := range stages {
		if err := stage(j); err != nil {
			return err
		}
	}
	return nil
}

func (j *job) staged(name string) string { return filepath.Join(j.r.cfg.Staging, name) }

// channelFault: ветка из настроек должна быть известной.
func channelFault(cfg Config) error {
	if cfg.Channel.Valid() {
		return nil
	}
	return refuse(codeInvalidArg, false, "unknown channel %q", string(cfg.Channel))
}

// folderFault: папка цели должна называться как ветка.
func folderFault(cfg Config) error {
	have := filepath.Base(filepath.Clean(cfg.TargetRoot))
	if strings.EqualFold(have, cfg.Channel.DirName()) {
		return nil
	}
	return refuse(codeInternal, false, "the target %q is not the %s folder", cfg.TargetRoot, cfg.Channel.DirName())
}

func (j *job) checkBranch() error {
	for _, probe := range []func(Config) error{channelFault, folderFault} {
		if err := probe(j.r.cfg); err != nil {
			return err
		}
	}
	j.r.progress("verify", 0)
	return nil
}

// takeLicense читает лицензию и bind у источника и, если задан ключ, сверяет
// лицензию с этой машиной.
func (j *job) takeLicense() error {
	lic, err := os.ReadFile(j.src.License())
	if err != nil || strings.TrimSpace(string(lic)) == "" {
		return refuse(codeInstall, false, "no_license: nothing to copy from %s", j.r.cfg.SourceRoot)
	}
	if err := j.verifyLicense(lic); err != nil {
		return err
	}
	j.license = lic
	if bind, err := os.ReadFile(j.src.Bind()); err == nil && len(bind) > 0 {
		j.bind = bind
	}
	return nil
}

// verifyLicense сверяет лицензию с этой машиной, если задан ключ проверки.
func (j *job) verifyLicense(lic []byte) error {
	pub := j.r.cfg.LicensePub
	if len(pub) == 0 {
		return nil
	}
	guid, err := j.r.sys.MachineGUID()
	if err != nil {
		return refuse(codeInternal, false, "machine id: %v", err)
	}
	if err = install.VerifyLicenseMachine(string(lic), pub, machine.Hash(guid)); err != nil {
		return refuse(codeSignature, false, "license: %v", err)
	}
	return nil
}

func (j *job) checkTarget() error {
	target := j.r.cfg.TargetRoot
	// Цель — файл, а не папка: layout.CheckTarget на Windows принимает «путь не найден» за «папки нет»,
	// и отказ пришёл бы позже и невнятно. Файл на месте цели — чужое.
	if st, err := os.Stat(target); err == nil && !st.IsDir() {
		return refuse(codeFolderBusy, false, "%s", applog.Redact("foreign_folder: "+filepath.Base(target)))
	}
	if j.dst.Installed() {
		return refuse(codeInstall, false, "already_installed: %s (use --apply-update)", target)
	}
	err := j.dst.CheckTarget()
	if err == nil {
		return nil
	}
	if !errors.Is(err, layout.ErrForeignFolder) {
		return refuse(codeDenied, false, "%s", applog.Redact(err.Error()))
	}
	names := strings.Join(j.dst.TopNames(foreignNames), ", ")
	return refuse(codeFolderBusy, false, "%s", applog.Redact("foreign_folder: "+names))
}

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

// readManifestPair читает manifest.json и manifest.sig из staging.
func (j *job) readManifestPair() error {
	reads := []struct {
		name string
		into *[]byte
	}{{"manifest.json", &j.mfBytes}, {"manifest.sig", &j.sigBytes}}
	for _, rd := range reads {
		data, err := os.ReadFile(j.staged(rd.name))
		if err != nil {
			return refuse(codeInstall, false, "staging has no %s: %v", rd.name, err)
		}
		*rd.into = data
	}
	return nil
}

// acceptManifest проверяет манифест и запоминает его; ветка в нём должна быть той, что просили.
func (j *job) acceptManifest() error {
	mf, err := j.signedManifest()
	if err != nil {
		return refuse(codeSignature, false, "%s", err.Error())
	}
	j.mf = mf
	want := string(j.r.cfg.Channel)
	if mf.Channel != want {
		return refuse(codeInstall, false, "channel_mismatch: the signed manifest is %s, asked for %s", mf.Channel, want)
	}
	j.r.version.Store(mf.Version)
	return nil
}

func (j *job) checkStaging() error {
	checks := []func() error{
		j.readManifestPair, j.acceptManifest, j.checkPresence, j.checkBase, j.checkPak, j.checkSpace,
	}
	for _, check := range checks {
		if err := check(); err != nil {
			return err
		}
	}
	j.r.progress("verify", 100)
	return nil
}

func (j *job) checkPresence() error {
	names := []string{"base.zip", "astral-web.pak"}
	if at := slices.IndexFunc(names, func(name string) bool { return !pack.Exists(j.staged(name)) }); at >= 0 {
		return refuse(codeInstall, false, "staging has no %s", names[at])
	}
	return nil
}

// weigh отдаёт размер файла и его sha256.
func weigh(path string) (size int64, sum string, err error) {
	st, err := os.Stat(path)
	if err != nil {
		return 0, "", err
	}
	sum, err = pack.SHA256File(path)
	return st.Size(), sum, err
}

func (j *job) checkBase() error {
	size, sum, err := weigh(j.staged("base.zip"))
	if err != nil {
		return refuse(codeInstall, false, "base.zip: %v", err)
	}
	j.baseSize = size
	signed := j.mf.Artifacts.Base
	if size != signed.Size || !strings.EqualFold(sum, signed.SHA256) {
		return refuse(codeHash, true, "base.zip does not match the signed manifest")
	}
	return nil
}

func (j *job) checkPak() error {
	pak := j.staged("astral-web.pak")
	if err := install.CheckPakHeader(pak); err != nil {
		return refuse(codeInstall, false, "%s", err.Error())
	}
	st, err := os.Stat(pak)
	if err == nil {
		j.pakSize = st.Size()
		return nil
	}
	return refuse(codeInstall, false, "astral-web.pak: %v", err)
}

// checkSpace сверяет запас места; ошибка запроса места проверку пропускает.
func (j *job) checkSpace() error {
	need := uint64(4*j.baseSize+j.pakSize) + spareBytes
	free, err := j.r.sys.FreeBytes(nearestExisting(j.r.cfg.TargetRoot))
	enough := err != nil || free >= need
	if enough {
		return nil
	}
	return refuse(codeDiskFull, true, "need %d bytes, %d free", need, free)
}

func (j *job) prepareRoot() error {
	if err := os.MkdirAll(j.r.cfg.TargetRoot, 0o755); err != nil {
		return refuse(codeDenied, false, "%s", applog.Redact(err.Error()))
	}
	// Остатки прерванной установки в нашей папке стираются заранее, иначе распаковка откажет
	// «destination is not empty» и только очистка после отказа их уберёт.
	j.removeLeftovers()
	return nil
}

// removeLeftovers стирает app.new и beta.new цели.
func (j *job) removeLeftovers() {
	for _, leftover := range []string{j.dst.AppNew(), j.dst.BetaNew()} {
		_ = pack.RemoveAllRetry(leftover)
	}
}

// cleanup убирает недоделанное до замены: app.new, beta.new и, если корень
// после этого пуст, сам корень.
func (j *job) cleanup() {
	j.removeLeftovers()
	left, err := os.ReadDir(j.dst.Root)
	if err == nil && len(left) == 0 {
		_ = os.Remove(j.dst.Root)
	}
}

// abort — отказ после начала распаковки: сначала очистка.
func (j *job) abort(code string, retry bool, format string, args ...any) error {
	j.cleanup()
	return refuse(code, retry, format, args...)
}

// unpackProgress превращает вызовы распаковки в события не чаще раза в 200 мс
// (последний вызов идёт всегда).
func (j *job) unpackProgress() func(done, total int64) {
	var last time.Time
	return func(done, total int64) {
		finished := total > 0 && done >= total
		tooSoon := !last.IsZero() && time.Since(last) < unpackEvery
		if tooSoon && !finished {
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

// extract распаковывает base.zip в app.new и убеждается, что Astral.exe на месте.
func (j *job) extract() error {
	opts := pack.ExtractOptions{MaxTotalBytes: pack.UnpackCap(j.baseSize), Stop: j.ctx.Err}
	_, err := pack.ExtractZip(j.staged("base.zip"), j.dst.AppNew(), opts, j.unpackProgress())
	if err != nil {
		if j.ctx.Err() == nil {
			return j.abort(codeInstall, true, "unpack: %v", err)
		}
		return j.abort(codeInternal, false, "canceled")
	}
	if exe := filepath.Join(j.dst.AppNew(), layout.ExeName); !pack.Exists(exe) {
		return j.abort(codeInstall, false, "Astral.exe is missing in base.zip")
	}
	if j.ctx.Err() != nil {
		return j.abort(codeInternal, false, "canceled")
	}
	return nil
}

func (j *job) unpack() error {
	j.r.progress("unpack", 0)
	if err := j.extract(); err != nil {
		return err
	}
	j.r.progress("unpack", 100)
	return nil
}

// stageBetaFiles кладёт лицензию, bind, манифест и pak рядом с распакованной веткой.
func (j *job) stageBetaFiles() error {
	files := install.BetaFiles{
		License: j.license, Bind: j.bind, Manifest: j.mfBytes, ManifestSig: j.sigBytes,
		PakFrom: j.staged("astral-web.pak"),
	}
	if err := install.StageBeta(j.dst, files); err != nil {
		return j.abort(codeInstall, true, "beta files: %v", err)
	}
	return nil
}

// swapBranch заменяет рабочую папку ветки подготовленной; занятая папка — отказ в доступе.
func (j *job) swapBranch() error {
	err := install.PlaceBranch(j.dst, j.r.log)
	if err == nil {
		return nil
	}
	code := placeCode(errors.Is(err, pack.ErrBusy))
	return j.abort(code, true, "could not place the branch: %v", err)
}

// placeCode: код отказа замены — «доступ закрыт», если папка занята, иначе «установка не удалась».
func placeCode(busy bool) string {
	if busy {
		return codeDenied
	}
	return codeInstall
}

func (j *job) place() error {
	j.r.progress("files", 0)
	for _, step := range []func() error{j.stageBetaFiles, j.swapBranch} {
		if err := step(); err != nil {
			return err
		}
	}
	j.r.progress("files", 100)
	return nil
}

// copyInstaller кладёт копию установщика в папку ветки; отказ — только в журнал.
func (j *job) copyInstaller() {
	if install.CopyInstaller(j.r.sys, j.dst, j.r.log) != nil {
		j.r.log.Printf("the installer copy is missing in %s", j.r.cfg.TargetRoot)
	}
}

// makeShortcuts заводит ярлыки; отказ — только в журнал.
func (j *job) makeShortcuts() {
	if install.MakeShortcuts(j.r.sys, j.dst, j.r.cfg.Channel, true, true, j.r.log) {
		j.r.log.Printf("some shortcuts were not created")
	}
}

// registerApp заводит запись в «Приложениях»; отказ — только в журнал.
func (j *job) registerApp() {
	size := 3*j.baseSize + j.pakSize
	if install.RegisterBranch(j.r.sys, j.dst, j.r.cfg.Channel, j.mf.Version, size, j.r.log) != nil {
		j.r.log.Printf("the Apps entry was not created")
	}
}

// register заводит копию установщика, ярлыки и запись в «Приложениях»; отказы
// только в журнал. Шаги и сообщения о ходе идут одной лентой.
func (j *job) register() error {
	ribbon := []struct {
		phase   string
		percent int
		work    func()
	}{
		{"shortcuts", 0, nil},
		{"", 0, j.copyInstaller},
		{"shortcuts", 50, nil},
		{"", 0, j.makeShortcuts},
		{"shortcuts", 100, nil},
		{"registry", 0, nil},
		{"", 0, j.registerApp},
		{"registry", 100, nil},
	}
	for _, beat := range ribbon {
		if beat.work != nil {
			beat.work()
			continue
		}
		j.r.progress(beat.phase, beat.percent)
	}
	return nil
}

// dropStaging стирает staging, если он лежит внутри источника или цели.
func (j *job) dropStaging() {
	cfg := j.r.cfg
	roots := []string{cfg.SourceRoot, cfg.TargetRoot}
	if !slices.ContainsFunc(roots, func(root string) bool { return inside(root, cfg.Staging) }) {
		return
	}
	if err := pack.RemoveAllRetry(cfg.Staging); err != nil {
		j.r.log.Printf("could not remove staging: %v", err)
	}
}

func (j *job) finish() error {
	j.dropStaging()
	if cfg := j.r.cfg; cfg.Launch {
		if err := launchFailed(j.r.sys, j.dst); err != nil {
			j.r.log.Printf("could not start %s: %v", cfg.Channel, err)
		}
	}
	return nil
}

// inside: path лежит строго внутри root (без учёта регистра).
func inside(root, path string) bool {
	if root == "" || path == "" {
		return false
	}
	prefix := strings.ToLower(filepath.Clean(root)) + string(filepath.Separator)
	rest, under := strings.CutPrefix(strings.ToLower(filepath.Clean(path)), prefix)
	return under && rest != ""
}

// Код выхода процесса.
const (
	ExitOK     = 0  // ветка поставлена
	ExitFailed = 11 // отказ; следов работы на диске нет
)

// Коды ошибок моста.
const (
	codeInvalidArg = "INVALID_ARGUMENT"
	codeInternal   = "INTERNAL"
	codeInstall    = "INSTALL_FAILED"
	codeFolderBusy = "FOLDER_BUSY"
	codeDenied     = "ACCESS_DENIED"
	codeSignature  = "SIGNATURE_INVALID"
	codeHash       = "HASH_MISMATCH"
	codeDiskFull   = "DISK_FULL"
)

const (
	spareBytes   = 64 << 20 // запас места сверх 4×base.zip + pak
	foreignNames = 20       // сколько имён показать в foreign_folder
	unpackEvery  = 200 * time.Millisecond
	replayAfter  = 80 * time.Millisecond
	exitAfter    = 300 * time.Millisecond // пауза между запуском ветки и закрытием окна
	statusStep   = 10                     // шаг процента, с которого пишем файл состояния
)
