package install

import (
	"cmp"
	"context"
	"slices"
	"time"
)

import (
	"bytes"
	"encoding/json"
	"net/url"
)

import (
	"crypto/ed25519"
	"os"
	"path/filepath"
)

import (
	"strings"
	"sync"
	"sync/atomic"
)

import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/app"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/applog"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/betaapi"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/bridge"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/layout"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/machine"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/pack"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/releasekeys"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/sysapi"

const frameCustom = "custom"

const (
	spaceReserve    = 64 << 20
	exitAfterLaunch = 300 * time.Millisecond
	cancelWait      = 10 * time.Second
)

// serverCalls — разговор раннера с сервером: активация и поправка часов.
type serverCalls interface {
	ClockOffset() time.Duration
	Start(ctx context.Context, req betaapi.StartRequest) (*betaapi.StartResponse, error)
	Poll(ctx context.Context, activationID, machine, channel string) (*betaapi.PollResponse, error)
	Complete(ctx context.Context, activationID, baseSHA256 string) error
}

// fileCalls — чтение файлов выпуска целиком и по диапазону.
type fileCalls interface {
	OpenFileRange(ctx context.Context, fileURL string, from, to int64) (*pack.Stream, error)
	OpenFile(ctx context.Context, fileURL string, from int64) (*pack.Stream, error)
}

// API — то, что раннер берёт у клиента сервера беты.
type API interface {
	fileCalls
	serverCalls
}

// Config — настройки раннера; все поля необязательны.
type Config struct {
	PollInterval, Stall             time.Duration
	Backoff, CompleteBackoff        []time.Duration
	Version, Frame                  string
	Dev, AllowUnsigned              bool
	Keys                            *releasekeys.Set
	LicensePub                      ed25519.PublicKey
	Exit                            func()
	Root, ProgramsDir               string
	Hint                            layout.Channel
	AutoCode                        string // код установки из имени файла (BETA-XXXX-…) или пусто; см. open.go
	LockBranch                      func(layout.Channel) (release func(), busy bool)
	Handoff                         bool
	HandoffFirstState, HandoffStall time.Duration
	HandoffPoll                     time.Duration
	QueueBackoff                    []time.Duration // паузы очереди без Retry-After; пусто — 5, 10, 15, 20, 30 с (queue.go)
}

// whenAbsent возвращает have, а если его нет (missing) — запасное значение.
func whenAbsent[T any](missing bool, have, spare T) T {
	if missing {
		return spare
	}
	return have
}

// withDefaults заполняет пустые настройки; копия, исходная не меняется.
func (c Config) withDefaults() Config {
	c.Frame = cmp.Or(c.Frame, frameCustom)
	c.Exit = whenAbsent(c.Exit == nil, c.Exit, func() {})
	c.CompleteBackoff = whenAbsent(c.CompleteBackoff == nil, c.CompleteBackoff,
		[]time.Duration{500 * time.Millisecond, 1500 * time.Millisecond})
	return c
}

// finishedInstall — последняя законченная установка: ветка и раскладка для launch.
type finishedInstall struct {
	lay layout.Layout
	ch  layout.Channel
}

// session — всё, что раннер помнит о сеансе; читается и меняется только под замком.
type session struct {
	last     *finishedInstall
	act      *activation
	run      *installRun
	runDone  chan struct{}
	stopPoll context.CancelFunc
	stopRun  context.CancelFunc
	running  bool
}

// forget сбрасывает активацию и ход, возвращает остановку опроса (её зовут уже без замка).
func (s *session) forget() (stop context.CancelFunc) {
	stop = s.stopPoll
	s.stopPoll = nil
	s.act = nil
	s.run = nil
	return stop
}

// Runner — сторона установщика, которая отвечает на вызовы страницы.
type Runner struct {
	mu   sync.Mutex
	sess session

	ctx      context.Context
	rootStop context.CancelFunc
	group    sync.WaitGroup
	sideOnce sync.Once
	side     atomic.Pointer[handoffState]
	picked   atomic.Value // string: папка веток, выбранная человеком
	openMode atomic.Bool  // последний init решил: установка без ввода кода (open.go)
	openCode atomic.Bool  // в открытом режиме код пришёл в имени файла
	openSure atomic.Bool  // ответ сервера о доступе получен: повторные init его не спрашивают

	log    applog.Logger
	rt     *bridge.Router
	common *app.Common
	api    API
	sys    sysapi.System
	cfg    Config
}

// New собирает раннер: пустые настройки заменяются умолчаниями.
func New(cfg Config, sys sysapi.System, api API, common *app.Common, rt *bridge.Router, log applog.Logger) *Runner {
	r := &Runner{sys: sys, api: api, common: common, rt: rt, log: log}
	r.cfg = cfg.withDefaults()
	r.ctx, r.rootStop = context.WithCancel(context.Background())
	if log == nil {
		r.log = applog.Nop{}
	}
	return r
}

// locked выполняет change над сеансом под замком.
func (r *Runner) locked(change func(s *session)) {
	r.mu.Lock()
	defer r.mu.Unlock()
	change(&r.sess)
}

// peek читает значение из сеанса под замком.
func peek[T any](r *Runner, read func(s *session) T) (got T) {
	r.locked(func(s *session) { got = read(s) })
	return got
}

// Register подключает 11 вызовов моста.
func (r *Runner) Register() {
	on := r.rt.Handle
	on("enterCode", r.hEnterCode)
	on("quit", r.hQuit)
	on("launch", r.hLaunch)
	on("cancelInstall", r.hCancelInstall)
	on("chooseInstallDir", r.hChooseDir)
	on("startInstall", r.hStartInstall)
	on("cancelActivation", r.hCancelActivation)
	on("openSite", r.hOpenSite)
	on("openVerifyUrl", r.hOpenVerifyURL)
	on("submitCode", r.hSubmitCode)
	on("init", r.hInit)
}

// Busy: идёт ли установка.
func (r *Runner) Busy() bool {
	return peek(r, func(s *session) bool { return s.running })
}

// Close останавливает всё запущенное и ждёт горутины; повторный вызов безопасен.
func (r *Runner) Close() {
	r.rootStop()
	r.group.Wait()
}

// --- общие мелочи ---

func argErr(format string, args ...any) *bridge.Error {
	return bridge.Errf("INVALID_ARGUMENT", false, format, args...)
}

func stateErr(detail string) *bridge.Error {
	return bridge.Errf("INVALID_STATE", false, "%s", detail)
}

func errAlreadyRunning() *bridge.Error { return stateErr("installation is already running") }

// readParams разбирает параметры вызова; пустые байты допустимы.
func readParams(raw json.RawMessage, into any) error {
	body := bytes.TrimSpace(raw)
	if len(body) > 0 {
		if err := json.Unmarshal(body, into); err != nil {
			return argErr("%s", err.Error())
		}
	}
	return nil
}

// argsOf разбирает параметры вызова в структуру T; без параметров остаётся нулевая.
func argsOf[T any](raw json.RawMessage) (in T, err error) {
	err = readParams(raw, &in)
	return in, err
}

// fail: строка журнала и событие error для страницы.
func (r *Runner) fail(stage string, e *bridge.Error) {
	fields := []any{stage, e.Code, e.Retryable, e.Detail}
	r.log.Printf("error stage=%s code=%s retryable=%t detail=%s", fields...)
	r.rt.Emit("error", e.Event(stage))
}

// requiredBytes — нужное место: четыре размера base, pak и 64 МиБ (беззнаково, с переносом).
func requiredBytes(rel betaapi.Release) uint64 {
	total := uint64(spaceReserve)
	total += uint64(rel.Pak.Bytes)
	total += 4 * uint64(rel.Base.Bytes)
	return total
}

// nearestExisting — первая существующая папка вверх по цепочке родителей (файл тоже «существует»).
func nearestExisting(path string) string {
	for here := path; ; {
		if _, err := os.Stat(here); err == nil {
			return here
		}
		up := filepath.Dir(here)
		if up == here {
			return here
		}
		here = up
	}
}

func (r *Runner) freePtr(path string) *uint64 {
	free, err := r.sys.FreeBytes(nearestExisting(path))
	if err != nil {
		return nil
	}
	return &free
}

func (r *Runner) chosenDir() string {
	dir, _ := r.picked.Load().(string)
	return dir
}

func (r *Runner) choose(dir string) { r.picked.Store(dir) }

func (r *Runner) confirmedNow() *confirmation {
	return peek(r, func(s *session) *confirmation {
		if act := s.act; act != nil {
			return act.confirmed
		}
		return nil
	})
}

func (r *Runner) rememberFinished(ch layout.Channel, lay layout.Layout) {
	r.locked(func(s *session) { s.last = &finishedInstall{ch: ch, lay: lay} })
}

// --- папки и стоящие ветки ---

func parentOf(root string) string {
	if root != "" {
		return filepath.Dir(root)
	}
	return ""
}

// programsDir — папка веток: ProgramsDir, выбранная человеком, родитель Root, Programs.
func (r *Runner) programsDir() string {
	dir := cmp.Or(r.cfg.ProgramsDir, r.chosenDir(), parentOf(r.cfg.Root))
	if dir == "" {
		dir = layout.ProgramsDir(r.sys.LocalAppData())
	}
	return dir
}

// recordedRoot — корень ветки из записи об удалении, пока он в силе (по нему стоит установка).
func (r *Runner) recordedRoot(ch layout.Channel) string {
	rec := ""
	if r.cfg.ProgramsDir == "" && r.chosenDir() == "" {
		rec = r.sys.UninstallRoot(ch)
	}
	if rec != "" && layout.New(rec).Installed() {
		return rec
	}
	return ""
}

// rootFor — корень ветки; источники по очереди, пока не найдётся непустой.
func (r *Runner) rootFor(ch layout.Channel) string {
	if root := r.cfg.Root; root != "" {
		return root
	}
	if root := r.recordedRoot(ch); root != "" {
		return root
	}
	return filepath.Join(r.programsDir(), ch.DirName())
}

// sameKey — ключ сравнения путей без учёта регистра.
func sameKey(path string) string { return strings.ToLower(filepath.Clean(path)) }

// recordedBranch — ветка по записи об удалении, если её корень ещё не встречался.
func (r *Runner) recordedBranch(ch layout.Channel, known map[string]bool) []layout.Branch {
	rec := r.sys.UninstallRoot(ch)
	if rec == "" {
		return nil
	}
	key := sameKey(rec)
	if known[key] {
		return nil
	}
	known[key] = true
	beside := layout.ScanBeside(rec)
	return slices.DeleteFunc(beside, func(b layout.Branch) bool {
		return !(b.Channel == ch && sameKey(b.Root) == key)
	})
}

// rankOrder — порядок веток по старшинству.
func rankOrder(a, b layout.Branch) int { return cmp.Compare(a.Channel.Rank(), b.Channel.Rank()) }

// installedNow — стоящие ветки: папка веток, затем корни из записей об удалении; по старшинству.
func (r *Runner) installedNow() []layout.Branch {
	found := layout.Scan(r.programsDir())
	known := make(map[string]bool, len(found))
	for i := range found {
		known[sameKey(found[i].Root)] = true
	}
	for _, ch := range layout.All {
		found = append(found, r.recordedBranch(ch, known)...)
	}
	slices.SortStableFunc(found, rankOrder)
	return found
}

// --- init ---

// hintAndDir — подсказка (или nil) и папка установки для экрана.
func (r *Runner) hintAndDir() (*string, string) {
	hint := r.cfg.Hint
	if hint == "" {
		return nil, r.cfg.Root
	}
	name := string(hint)
	return &name, r.rootFor(hint)
}

// requiredNow — нужное место для подтверждённого релиза; nil, пока подтверждения нет.
func (r *Runner) requiredNow() *uint64 {
	if cf := r.confirmedNow(); cf != nil {
		need := requiredBytes(cf.rel)
		return &need
	}
	return nil
}

func (r *Runner) hInit(ctx context.Context, _ json.RawMessage) (any, error) {
	if side, active := r.sideInit(); active {
		return side, nil
	}
	rawLocale := r.sys.OSLocale()
	installed := r.installedNow()
	hint, dir := r.hintAndDir()
	probe := dir
	if dir == "" {
		probe = r.programsDir()
	}
	info := app.InitInfo{Mode: "install", Dev: r.cfg.Dev}
	info.Frame = r.cfg.Frame
	info.Window = app.Window{Width: app.WindowWidth, Height: app.WindowHeight}
	info.UserDataDirs = []string{}
	info.Version = r.cfg.Version
	info.OSLocaleRaw = rawLocale
	info.OSLocale = MapLocale(rawLocale)
	info.InstallDir = dir
	info.HintChannel = hint
	info.CanChooseDir = r.cfg.Root == "" && r.cfg.ProgramsDir == ""
	info.Installed = app.InstalledList(installed)
	info.Existing = app.ExistingOf(installed, r.cfg.Hint)
	opened := r.refreshOpen(ctx)
	info.Open, info.OpenCode = opened.open, opened.withCode
	if opened.unreachable {
		info.Access = "unreachable"
	}
	info.FreeBytes = r.freePtr(probe)
	info.RequiredBytes = r.requiredNow()
	return info, nil
}

// --- ввод кода и активация ---

// retire останавливает опрос и забывает активацию с ходом; false — идёт установка, ничего не тронуто.
func (r *Runner) retire() bool {
	type retired struct {
		idle bool
		stop context.CancelFunc
	}
	got := peek(r, func(s *session) (out retired) {
		out.idle = !s.running
		if out.idle {
			out.stop = s.forget()
		}
		return out
	})
	if got.stop != nil {
		got.stop()
	}
	return got.idle
}

// beginActivation получает активацию у сервера; прежняя к этому моменту уже сброшена.
func (r *Runner) beginActivation(ctx context.Context, code string) (*activation, *bridge.Error) {
	guid, err := r.sys.MachineGUID()
	if err != nil {
		return nil, bridge.Errf("INTERNAL", false, "machine id: %v", err)
	}
	hash := machine.Hash(guid)
	if !r.retire() {
		return nil, errAlreadyRunning()
	}
	var req betaapi.StartRequest
	req.Code, req.Machine = code, hash
	req.Channel = string(r.cfg.Hint)
	req.InstallerVersion = r.cfg.Version
	req.DeviceName = r.sys.DeviceName()
	reply, err := r.api.Start(ctx, req)
	if err != nil {
		return nil, betaapi.ToBridgeError(err)
	}
	if refused := app.SafeURL(reply.ConfirmURL, r.confirmHosts(), r.cfg.Dev); refused != nil {
		return nil, bridge.Errf("INTERNAL", false, "confirm_url from the server was refused: %v", refused)
	}
	act := &activation{id: reply.ActivationID}
	act.machine, act.ask = hash, r.cfg.Hint
	act.userCode, act.confirmURL = reply.UserCode, withShortCode(reply.ConfirmURL, reply.UserCode)
	act.interval = reply.Interval
	act.until = reply.ExpiresAt.Add(-r.api.ClockOffset())
	return act, nil
}

// startPolling запоминает активацию и пускает её опрос отдельной горутиной.
func (r *Runner) startPolling(act *activation) {
	ctx, stop := context.WithCancel(r.ctx)
	var replaced context.CancelFunc
	r.locked(func(s *session) { replaced, s.act, s.stopPoll = s.stopPoll, act, stop })
	if replaced != nil {
		replaced() // два submitCode успели пересечься: опрос прежней активации не должен остаться жить
	}
	r.group.Add(1)
	go r.pollLoop(ctx, act)
}

func (act *activation) reply() map[string]any {
	out := make(map[string]any, 5)
	out["userCode"] = act.userCode
	out["verifyUrl"] = act.confirmURL
	out["pollIntervalSec"] = act.interval
	out["expiresAt"] = act.until.UTC().Format(time.RFC3339)
	out["expiresInSec"] = int64(time.Until(act.until) / time.Second)
	return out
}

// submitParams — параметры вызова submitCode. Здесь и у трёх соседних типов параметров стоит «=»: это
// синоним безымянной структуры, и в тексте ошибки разбора JSON имени типа нет (этот текст уходит пользователю как есть).
type submitParams = struct {
	Code        string `json:"code"`
	OpenBrowser *bool  `json:"openBrowser"`
}

func (r *Runner) hSubmitCode(ctx context.Context, raw json.RawMessage) (any, error) {
	in, err := argsOf[submitParams](raw)
	if err != nil {
		return nil, err
	}
	code, err := r.startCode(in.Code)
	if err != nil {
		return nil, bridge.Errf("CODE_FORMAT", false, "%s", err.Error())
	}
	act, berr := r.beginActivation(ctx, code)
	if berr != nil {
		return nil, berr
	}
	r.startPolling(act)
	if enabled(in.OpenBrowser) {
		if openErr := r.sys.OpenURL(act.confirmURL); openErr != nil {
			r.log.Printf("could not open the browser: %v", openErr)
		}
	}
	return act.reply(), nil
}

// hostOf — хост (с портом) из адреса; пусто, если адрес не разбирается.
func hostOf(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return u.Host
}

// confirmHosts — хосты сайта и API, как в их адресах.
func (r *Runner) confirmHosts() []string {
	hosts := []string{hostOf(r.common.Site), hostOf(r.common.API)}
	return slices.DeleteFunc(hosts, func(h string) bool { return h == "" })
}

// opened превращает результат открытия адреса в ответ вызова.
func opened(err error) (any, error) {
	if err == nil {
		return flagReply("opened", true), nil
	}
	return nil, err
}

// flagReply — ответ вызова из одного булева поля.
func flagReply(key string, on bool) map[string]any { return map[string]any{key: on} }

func (r *Runner) hOpenVerifyURL(context.Context, json.RawMessage) (any, error) {
	if act := peek(r, func(s *session) *activation { return s.act }); act != nil {
		return opened(r.common.OpenAllowed(act.confirmURL))
	}
	return nil, stateErr("no activation in progress")
}

// siteParams — параметры вызова openSite.
type siteParams = struct {
	Page string `json:"page"`
	Lang string `json:"lang"`
}

// siteLangQuery — «?lang=xx» для страницы сайта, если сайт знает этот язык (ru, uk, en, de, pl: ?lang= разбирает
// languageFromParam сайта); французского на сайте нет, чужое и пустое значение — без параметра.
func siteLangQuery(lang string) string {
	if slices.Contains([]string{"ru", "uk", "en", "de", "pl"}, strings.ToLower(lang)) {
		return "?lang=" + strings.ToLower(lang)
	}
	return ""
}

func (r *Runner) hOpenSite(_ context.Context, raw json.RawMessage) (any, error) {
	in, err := argsOf[siteParams](raw)
	if err != nil {
		return nil, err
	}
	switch in.Page {
	case "", "beta":
		// Только страница /beta: адрес подтверждения кода (openVerifyUrl) язык не получает.
		return opened(r.common.OpenAllowed(r.common.Site + "/beta" + siteLangQuery(in.Lang)))
	}
	return nil, argErr("unknown page %s", in.Page)
}

// resetActivation безусловно сбрасывает опрос, активацию и ход установки.
func (r *Runner) resetActivation() {
	stop := peek(r, func(s *session) context.CancelFunc { return s.forget() })
	if stop != nil {
		stop()
	}
}

func (r *Runner) hCancelActivation(context.Context, json.RawMessage) (any, error) {
	if r.retire() {
		return nil, nil
	}
	return nil, stateErr("installation is running, use cancelInstall")
}

// --- установка ---

// removeTemp стирает временное хода (корень остаётся).
func (r *Runner) removeTemp(lay layout.Layout) {
	dirs := []string{lay.Staging(), lay.AppNew(), lay.BetaNew()}
	for _, dir := range dirs {
		err := pack.RemoveAllRetry(dir)
		if err == nil {
			continue
		}
		r.log.Printf("could not remove %s: %v", dir, err)
	}
}

// offeredIn: ветка среди предложенных — ветка релиза или любая из списка подтверждения.
func offeredIn(cf *confirmation, ch layout.Channel) bool {
	names := make([]string, 0, 1+len(cf.channels))
	names = append(names, cf.rel.Channel)
	for _, c := range cf.channels {
		names = append(names, c.Channel)
	}
	for _, name := range names {
		if got, ok := layout.Parse(name); ok && got == ch {
			return true
		}
	}
	return false
}

// admit проверяет, что установку можно начинать, и выбирает ветку; вызывается под замком.
func (r *Runner) admit(asked string) (*activation, layout.Channel, layout.Channel, *bridge.Error) {
	act := r.sess.act
	if act == nil || act.confirmed == nil {
		return nil, "", "", stateErr("the activation is not confirmed yet")
	}
	if r.sess.running {
		return nil, "", "", errAlreadyRunning()
	}
	relCh, _ := layout.Parse(act.confirmed.rel.Channel)
	picked, ok := relCh, true
	if asked != "" {
		picked, ok = layout.Parse(asked)
		ok = ok && offeredIn(act.confirmed, picked)
	}
	if !ok {
		return nil, "", "", argErr("channel %s is not among the offered ones", asked)
	}
	return act, picked, relCh, nil
}

// takeRun отдаёт ход для запуска: прежний, если он подходит, иначе новый. Вызывается под замком и
// на время стирания чужого временного отпускает его, не перепроверяя состояние после (Дс1).
func (r *Runner) takeRun(act *activation, ch, relCh layout.Channel, desktop, startMenu bool) *installRun {
	root := r.rootFor(ch)
	old := r.sess.run
	if old != nil && (old.ch != ch || !strings.EqualFold(old.lay.Root, root)) {
		r.sess.run = nil
		r.mu.Unlock()
		r.removeTemp(old.lay)
		r.mu.Lock()
	}
	run := r.sess.run
	if run == nil {
		run = &installRun{ch: ch, lay: layout.New(root), otherPick: ch != relCh}
		r.sess.run = run
	}
	run.act, run.desktop, run.startMenu = act, desktop, startMenu
	return run
}

// dispatch запускает тело установки; вызывается под замком.
func (r *Runner) dispatch(run *installRun) {
	finished := make(chan struct{})
	ctx, stop := context.WithCancel(r.ctx)
	r.sess.stopRun, r.sess.runDone = stop, finished
	r.sess.running = true
	r.group.Add(1)
	go r.runInstall(ctx, run, finished)
}

// startParams — параметры вызова startInstall.
type startParams = struct {
	Channel         string `json:"channel"`
	DesktopShortcut *bool  `json:"desktopShortcut"`
	StartMenu       *bool  `json:"startMenu"`
}

func (r *Runner) hStartInstall(_ context.Context, raw json.RawMessage) (any, error) {
	in, err := argsOf[startParams](raw)
	if err != nil {
		return nil, err
	}
	refusal := r.beginInstall(in.Channel, enabled(in.DesktopShortcut), enabled(in.StartMenu))
	if refusal != nil {
		return nil, refusal
	}
	return flagReply("started", true), nil
}

// enabled: необязательный флажок вызова включён, если его не прислали или он true.
func enabled(flag *bool) bool { return flag == nil || *flag }

// beginInstall допускает установку и пускает её ход; всё под замком раннера.
func (r *Runner) beginInstall(asked string, desktop, startMenu bool) *bridge.Error {
	r.mu.Lock()
	defer r.mu.Unlock()
	act, ch, relCh, refusal := r.admit(asked)
	if refusal == nil {
		// Установку занимаем до уборки чужого временного: takeRun на её время отпускает замок, и
		// второй startInstall не должен успеть пройти допуск и запустить ещё одну установку.
		r.sess.running = true
		r.dispatch(r.takeRun(act, ch, relCh, desktop, startMenu))
	}
	return refusal
}

// stopPlan — что нужно знать об установке, чтобы её отменить.
type stopPlan struct {
	run              *installRun
	tooLate, running bool
	stop             context.CancelFunc
	finished         chan struct{}
}

func (r *Runner) hCancelInstall(context.Context, json.RawMessage) (any, error) {
	plan := peek(r, func(s *session) (p stopPlan) {
		p.run, p.running = s.run, s.running
		p.stop, p.finished = s.stopRun, s.runDone
		p.tooLate = s.run != nil && s.run.placed.Load()
		return p
	})
	if plan.tooLate {
		return flagReply("canceled", false), nil
	}
	if plan.running && plan.stop != nil { // stop ещё нет, пока занятый ход убирает временное
		plan.stop()
		r.awaitStopped(plan.finished)
	}
	if plan.run != nil {
		r.removeTemp(plan.run.lay)
	}
	r.resetActivation()
	return flagReply("canceled", true), nil
}

// awaitStopped ждёт конца хода не дольше cancelWait; опоздание только пишется в журнал.
func (r *Runner) awaitStopped(finished <-chan struct{}) {
	limit := time.NewTimer(cancelWait)
	defer limit.Stop()
	select {
	case <-finished:
	case <-limit.C:
		r.log.Printf("cancelInstall: the install goroutine did not stop in 10s")
	}
}

// --- запуск и выход ---

// launchParams — параметры вызова launch.
type launchParams = struct {
	Channel string `json:"channel"`
	Lang    string `json:"lang"`
}

// launchArgs — аргументы запуска лаунчера: язык, показанный установщиком, едет флагом
// --astral-lang=xx (приём — apps/desktop/src/launch-language.js). Значение сворачивается тем же путём, что язык системы
// («ua» → «uk», «de-DE» → «de»), передаётся один из шести кодов, а не сам тег; чужое молча не передаётся.
func launchArgs(lang string) []string {
	known, ok := KnownLanguage(lang)
	if !ok {
		return nil
	}
	return []string{"--astral-lang=" + known}
}

func (r *Runner) hLaunch(_ context.Context, raw json.RawMessage) (any, error) {
	in, err := argsOf[launchParams](raw)
	if err != nil {
		return nil, err
	}
	lay, found := r.launchTarget(in.Channel)
	switch {
	case !found, !lay.Installed():
		return nil, bridge.Errf("INSTALL_FAILED", false, "Astral.exe is not installed")
	}
	_, err = r.sys.Launch(lay.Exe(), launchArgs(in.Lang), lay.App())
	if err != nil {
		return nil, bridge.Errf("INTERNAL", false, "launch: %v", err)
	}
	time.AfterFunc(exitAfterLaunch, r.cfg.Exit)
	return flagReply("launched", true), nil
}

// launchTarget выбирает ветку для запуска: из вызова, последняя законченная, подсказка, старшая из стоящих.
// Первый источник, у которого есть ответ, решает: даже «ветки нет» — окончательный ответ.
func (r *Runner) launchTarget(asked string) (layout.Layout, bool) {
	for _, source := range []func() launchAnswer{
		func() launchAnswer { return r.askedTarget(asked) },
		r.finishedTarget,
		r.hintTarget,
		r.standingTarget,
	} {
		if got := source(); got.answered {
			return got.lay, got.found
		}
	}
	return layout.Layout{}, false
}

// launchAnswer — ответ одного источника: раскладка, дан ли ответ вообще и найдена ли ветка.
type launchAnswer struct {
	lay      layout.Layout
	answered bool
	found    bool
}

// branchLayout — раскладка ветки по её корню.
func (r *Runner) branchLayout(ch layout.Channel) layout.Layout { return layout.New(r.rootFor(ch)) }

// askedTarget — ветка, названная в вызове; непустое, но непонятное имя — тоже окончательный ответ.
func (r *Runner) askedTarget(asked string) launchAnswer {
	ch, ok := layout.Parse(asked)
	if !ok {
		return launchAnswer{answered: asked != ""}
	}
	return launchAnswer{lay: r.branchLayout(ch), answered: true, found: true}
}

// finishedTarget — последняя законченная установка.
func (r *Runner) finishedTarget() launchAnswer {
	last := peek(r, func(s *session) *finishedInstall { return s.last })
	if last == nil {
		return launchAnswer{}
	}
	return launchAnswer{lay: last.lay, answered: true, found: true}
}

// hintTarget — подсказанная ветка.
func (r *Runner) hintTarget() launchAnswer {
	if r.cfg.Hint == "" {
		return launchAnswer{}
	}
	return launchAnswer{lay: r.branchLayout(r.cfg.Hint), answered: true, found: true}
}

// standingTarget — старшая из стоящих веток.
func (r *Runner) standingTarget() launchAnswer {
	installed := r.installedNow()
	if len(installed) == 0 {
		return launchAnswer{}
	}
	return launchAnswer{lay: r.branchLayout(installed[0].Channel), answered: true, found: true}
}

func (r *Runner) hQuit(ctx context.Context, raw json.RawMessage) (any, error) {
	r.hCancelInstall(ctx, raw)
	r.cfg.Exit()
	return nil, nil
}
