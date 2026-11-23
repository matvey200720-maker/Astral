package install

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync/atomic"
	"time"

	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/applog"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/betaapi"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/bridge"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/layout"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/pack"
)

const (
	stageDownload = "download"
	stageInstall  = "install"

	// Открытий одного файла за один билет.
	opensPerTicket = 3
	// Повторных опросов (новых билетов) за один ход установки.
	maxRepolls = 2

	foreignNamesLimit = 20
	unpackTick        = 200 * time.Millisecond

	unpackFloor = 1 << 30
	unpackScale = 20

	fileBase = 0
	filePak  = 1

	baseMetaFile = "base.meta"
	baseZipFile  = "base.zip"
	pakFile      = betaPakFile
)

var errHashMismatch = errors.New("sha256 of base.zip differs from the announced one")

var errNoActivation = errors.New("the activation was reset")

// installRun — ход установки: ветка, раскладка и всё, что уже сделано. Повтор начинает с первого невыполненного.
type installRun struct {
	ch  layout.Channel
	lay layout.Layout
	act *activation // активация, на которой идёт ход

	otherPick   bool // выбрана не та ветка, что пришла в подтверждении
	branchTaken bool // релиз выбранной ветки уже взят вторым опросом

	desktop, startMenu bool

	opens   [2]int // открытий base и pak текущим билетом
	repolls int    // обновлений билета за ход

	prepared, metaChecked, baseDone, pakDone bool
	verified, unpacked, staged               bool
	placed                                   atomic.Bool
	shellDone, completed                     bool

	baseHash      string
	unpackedBytes int64
	warnings      []string
}

func (run *installRun) warn(w string) {
	if !slices.Contains(run.warnings, w) {
		run.warnings = append(run.warnings, w)
	}
}

// part — путь внутри рабочей папки .setup.
func (run *installRun) part(name string) string { return filepath.Join(run.lay.Staging(), name) }

// phaseSpanRows — диапазон общего хода установки для каждой фазы, построчно.
var phaseSpanRows = []struct {
	phase    string
	from, to int
}{
	{"verify", 0, 10},
	{"unpack", 10, 60},
	{"shortcuts", 60, 95},
	{"finalize", 95, 100},
}

// phaseSpan — диапазон общего хода установки для каждой фазы.
var phaseSpan = func() map[string][2]int {
	m := make(map[string][2]int, len(phaseSpanRows))
	for _, row := range phaseSpanRows {
		m[row.phase] = [2]int{row.from, row.to}
	}
	return m
}()

// phaseEvent — тело события install.progress.
type phaseEvent struct {
	Overall int    `json:"overall"`
	Percent int    `json:"percent"`
	Phase   string `json:"phase"`
}

func progressBody(phase string, percent int) phaseEvent {
	pct := min(max(percent, 0), 100)
	from, to := phaseSpan[phase][0], phaseSpan[phase][1]
	return phaseEvent{Overall: from + (to-from)*pct/100, Percent: pct, Phase: phase}
}

func (r *Runner) emitPhase(phase string, percent int) {
	r.rt.Emit("install.progress", progressBody(phase, percent))
}

// downloadEvent — тело события download.progress; поля по алфавиту ключей.
type downloadEvent struct {
	Attempt         int    `json:"attempt"`
	BytesPerSec     int64  `json:"bytesPerSec"`
	EtaSec          any    `json:"etaSec"`
	File            int    `json:"file"`
	Name            string `json:"name"`
	OverallReceived int64  `json:"overallReceived"`
	OverallTotal    int64  `json:"overallTotal"`
	Received        int64  `json:"received"`
	Total           int64  `json:"total"`
}

// etaSeconds — оценка в целых секундах (до ближайшей); null, если оценки нет.
func etaSeconds(eta time.Duration) any {
	if eta <= 0 {
		return nil
	}
	return int64(eta.Round(time.Second) / time.Second)
}

// downloadBody — тело события download.progress по отсчёту загрузки.
func downloadBody(name string, p pack.Progress, baseBytes, pakBytes int64) downloadEvent {
	ev := downloadEvent{
		Attempt: p.Attempt, BytesPerSec: int64(p.BytesPerSec), EtaSec: etaSeconds(p.ETA),
		File: 1, Name: name, OverallReceived: p.Received, OverallTotal: baseBytes + pakBytes,
		Received: p.Received, Total: p.Total,
	}
	if name == "pak" {
		ev.File, ev.OverallReceived = 2, baseBytes+p.Received
	}
	return ev
}

// unpackLimit — предел распакованного размера: 20 размеров архива, от гигабайта до DefaultMaxTotalBytes.
func unpackLimit(zipSize int64) int64 {
	return min(max(zipSize*unpackScale, unpackFloor), pack.DefaultMaxTotalBytes)
}

// currentRelease — активация хода и её актуальное подтверждение (его меняет обновление билета).
// Активацию ход берёт при запуске и держит сам: сброс активации раннера его не обрывает.
func (r *Runner) currentRelease(run *installRun) (*activation, *confirmation, error) {
	act := peek(r, func(*session) *activation { return run.act })
	if act == nil {
		return nil, nil, errNoActivation
	}
	cf := peek(r, func(*session) *confirmation { return act.confirmed })
	if cf == nil {
		return nil, nil, errNoActivation
	}
	return act, cf, nil
}

// installPlan — шаги установки по порядку и стадия, под которой уходит ошибка шага.
var installPlan = []struct {
	stage string
	do    func(*Runner, context.Context, *installRun) error
}{
	{stageDownload, (*Runner).takeChosenBranch},
	{stageInstall, (*Runner).checkSpace},
	{stageInstall, (*Runner).prepareRoot},
	{stageDownload, (*Runner).fetchBase},
	{stageDownload, (*Runner).fetchPak},
	{stageInstall, (*Runner).verifyDownloads},
	{stageInstall, (*Runner).unpackBase},
	{stageInstall, (*Runner).stageAndPlace},
	{stageInstall, (*Runner).shellSteps},
	{stageInstall, (*Runner).reportComplete},
	{stageInstall, (*Runner).tidyUp},
}

// doneBody — тело события done; предупреждения только если они есть.
type doneBody struct {
	Channel    string   `json:"channel"`
	InstallDir string   `json:"installDir"`
	Version    string   `json:"version"`
	Warnings   []string `json:"warnings,omitempty"`
}

// settle снимает отметку «идёт установка»; при успехе очищает активацию и ход и возвращает версию.
func (r *Runner) settle(run *installRun, succeeded bool) (version string) {
	r.locked(func(s *session) {
		s.running = false
		if s.stopRun != nil {
			s.stopRun()
			s.stopRun = nil
		}
		if !succeeded {
			return
		}
		if run.act != nil && run.act.confirmed != nil {
			version = run.act.confirmed.mf.Version
		}
		s.clearRun(run)
	})
	return version
}

// clearRun снимает ход и активацию сессии, запоминая закончившуюся установку.
func (s *session) clearRun(run *installRun) {
	s.run, s.act = nil, nil
	s.last = &finishedInstall{ch: run.ch, lay: run.lay}
}

// runInstall — тело установки: идёт в своей горутине после ответа на startInstall.
func (r *Runner) runInstall(ctx context.Context, run *installRun, finished chan struct{}) {
	defer r.group.Done()
	defer close(finished)

	stage, err := r.execSteps(ctx, run)
	// Отмену узнаём до settle: он сам отменяет ход. «context canceled» в ошибке ещё не отмена,
	// так выглядит и соединение, которое оборвал сторож простоя; отмена — когда отменён сам ход.
	cancelled := errors.Is(err, context.Canceled) && ctx.Err() != nil
	version := r.settle(run, err == nil)

	verdicts := []struct {
		when bool
		say  func()
	}{
		{err == nil, func() {
			r.log.Printf("install done: %s %s, warnings %v", run.ch, version, run.warnings)
			r.rt.Emit("done", doneBody{Channel: string(run.ch), InstallDir: run.lay.Root, Version: version, Warnings: run.warnings})
		}},
		{cancelled, func() { r.log.Printf("install canceled") }},
		{true, func() { r.fail(stage, r.classify(run, err)) }},
	}
	for _, v := range verdicts {
		if v.when {
			v.say()
			return
		}
	}
}

// holdBranch берёт замок ветки, если он настроен.
func (r *Runner) holdBranch(run *installRun) (release func(), busy bool) {
	if r.cfg.LockBranch == nil {
		return func() {}, false
	}
	return r.cfg.LockBranch(run.ch)
}

// execSteps держит замок ветки и проходит шаги до первой ошибки.
func (r *Runner) execSteps(ctx context.Context, run *installRun) (string, error) {
	release, busy := r.holdBranch(run)
	if busy {
		return stageInstall, bridge.Errf("INSTALL_FAILED", true, "branch_busy: another installer is working on %s", run.ch)
	}
	defer release()
	for _, step := range installPlan {
		// Отмена до замены папок останавливает установку на границе шагов, а длинные шаги
		// (хеш, распаковка) сами смотрят на ctx. После замены отмена невозможна: UI получает «поздно».
		if !run.placed.Load() {
			if err := ctx.Err(); err != nil {
				return step.stage, err
			}
		}
		if err := step.do(r, ctx, run); err != nil {
			return step.stage, err
		}
	}
	return "", nil
}

// --- перевод ошибки шага в ошибку моста ---

func problem(code string, retryable bool, detail string) *bridge.Error {
	return &bridge.Error{Code: code, Retryable: retryable, Detail: detail}
}

// classifyRules — как превратить ошибку шага в ошибку моста; первое подошедшее правило побеждает.
var classifyRules = []struct {
	hit  func(error) bool
	cast func(r *Runner, run *installRun, err error) *bridge.Error
}{
	{
		func(err error) bool { var own *bridge.Error; return errors.As(err, &own) },
		func(_ *Runner, _ *installRun, err error) *bridge.Error {
			var own *bridge.Error
			errors.As(err, &own)
			copied := *own
			copied.Detail = applog.Redact(copied.Detail)
			return &copied
		},
	},
	{
		func(err error) bool { return errors.Is(err, pack.ErrBusy) },
		func(r *Runner, run *installRun, err error) *bridge.Error {
			running, _ := r.sys.RunningFrom(run.lay.Root)
			code := map[bool]string{true: "APP_RUNNING", false: "ACCESS_DENIED"}[running]
			return problem(code, running, applog.Redact(err.Error()))
		},
	},
	{
		pack.IsDiskFull,
		func(_ *Runner, _ *installRun, err error) *bridge.Error {
			return problem("DISK_FULL", true, applog.Redact(err.Error()))
		},
	},
	{
		func(err error) bool { return errors.Is(err, errHashMismatch) },
		func(_ *Runner, _ *installRun, err error) *bridge.Error {
			return problem("HASH_MISMATCH", true, err.Error())
		},
	},
	{
		func(err error) bool { return errors.Is(err, fs.ErrPermission) },
		func(_ *Runner, _ *installRun, err error) *bridge.Error {
			return problem("ACCESS_DENIED", false, applog.Redact(err.Error()))
		},
	},
	{
		func(err error) bool {
			var served *betaapi.APIError
			return errors.As(err, &served) || betaapi.IsNetwork(err) || errors.Is(err, context.DeadlineExceeded)
		},
		func(_ *Runner, _ *installRun, err error) *bridge.Error { return betaapi.ToBridgeError(err) },
	},
}

func (r *Runner) classify(run *installRun, err error) *bridge.Error {
	for _, rule := range classifyRules {
		if rule.hit(err) {
			return rule.cast(r, run, err)
		}
	}
	return problem("INSTALL_FAILED", true, applog.Redact(err.Error()))
}

// --- место, корень, временное ---

func (r *Runner) checkSpace(_ context.Context, run *installRun) error {
	if run.placed.Load() {
		return nil
	}
	_, cf, err := r.currentRelease(run)
	if err != nil {
		return err
	}
	need := requiredBytes(cf.rel)
	free, ferr := r.sys.FreeBytes(nearestExisting(run.lay.Root))
	if ferr != nil || free >= need {
		return nil
	}
	return bridge.Errf("DISK_FULL", true, "need %d bytes, %d free", need, free)
}

// inspectRoot отказывает, если корень занят чужими файлами.
func (r *Runner) inspectRoot(run *installRun) error {
	err := run.lay.CheckTarget()
	if !errors.Is(err, layout.ErrForeignFolder) {
		return err
	}
	names := strings.Join(run.lay.TopNames(foreignNamesLimit), ", ")
	return bridge.Errf("FOLDER_BUSY", false, "foreign_folder: %s", applog.Redact(names))
}

func (r *Runner) prepareRoot(_ context.Context, run *installRun) error {
	if run.placed.Load() || run.prepared {
		return nil
	}
	err := inOrder([]func() error{
		func() error { return r.inspectRoot(run) },
		func() error { return os.MkdirAll(run.lay.Root, dirPerm) },
		func() error { return pack.RemoveAllRetry(run.lay.AppNew()) },
		func() error { return pack.RemoveAllRetry(run.lay.BetaNew()) },
		func() error { return os.MkdirAll(run.lay.Staging(), dirPerm) },
	})
	run.prepared = err == nil
	return err
}

// --- смена ветки и обновление билета ---

// pollConfirmed спрашивает у сервера релиз ветки и проверяет ответ.
func (r *Runner) pollConfirmed(ctx context.Context, act *activation, ch layout.Channel) (*confirmation, error) {
	resp, err := r.api.Poll(ctx, act.id, act.machine, string(ch))
	if err != nil {
		return nil, err
	}
	if resp.Status != "confirmed" {
		return nil, bridge.Errf("BETA_ACTIVATION_EXPIRED", false, "the activation is no longer confirmed")
	}
	cf, berr := r.vetPoll(resp, act.id, act.machine)
	if berr != nil {
		return nil, berr
	}
	return cf, nil
}

// renew берёт у сервера свежий релиз ветки хода. Годится ли он — решает accept;
// при успехе подтверждение заменяется, счётчики открытий обнуляются, затем commit (если он есть).
func (r *Runner) renew(ctx context.Context, run *installRun, accept func(old, fresh *confirmation) *bridge.Error, commit func(*activation)) error {
	act, old, err := r.currentRelease(run)
	if err != nil {
		return err
	}
	fresh, err := r.pollConfirmed(ctx, act, run.ch)
	if err != nil {
		return err
	}
	if berr := accept(old, fresh); berr != nil {
		return berr
	}
	r.locked(func(*session) {
		act.confirmed = fresh
		run.opens = [2]int{}
		if commit != nil {
			commit(act)
		}
	})
	return nil
}

// takeChosenBranch: если выбрана не та ветка, что пришла, берёт релиз выбранной (один раз за ход).
func (r *Runner) takeChosenBranch(ctx context.Context, run *installRun) error {
	if !run.otherPick || run.branchTaken {
		return nil
	}
	r.log.Printf("the chosen branch is %s, taking its release", run.ch)
	return r.renew(ctx, run,
		func(_, fresh *confirmation) *bridge.Error {
			if fresh.rel.Channel == string(run.ch) {
				return nil
			}
			return bridge.Errf("INSTALL_FAILED", false, "channel_unavailable: asked for %s, the server gave %s", run.ch, fresh.rel.Channel)
		},
		func(act *activation) { act.ask, run.branchTaken = run.ch, true })
}

// refreshTicket берёт новый билет, пока не исчерпан запас обновлений.
func (r *Runner) refreshTicket(ctx context.Context, run *installRun) error {
	var count int
	r.locked(func(*session) {
		if run.repolls < maxRepolls {
			run.repolls++
			count = run.repolls
		}
	})
	if count == 0 {
		return bridge.Errf("BETA_TICKET_INVALID", false, "the download link is spent and no more refreshes are allowed")
	}
	r.log.Printf("refreshing the download ticket (%d of %d)", count, maxRepolls)
	return r.renew(ctx, run,
		func(old, fresh *confirmation) *bridge.Error {
			if strings.EqualFold(old.rel.Base.SHA256, fresh.rel.Base.SHA256) {
				return nil
			}
			return bridge.Errf("INSTALL_FAILED", false, "the release changed during the installation")
		}, nil)
}

// --- скачивание ---

// ticketSource — источник файла по актуальному билету; открытия считаются, куски Range — нет.
type ticketSource struct {
	r    *Runner
	run  *installRun
	file int
}

// via подставляет актуальный адрес файла и зовёт call.
func (s *ticketSource) via(counted bool, call func(addr string) (*pack.Stream, error)) (*pack.Stream, error) {
	_, cf, err := s.r.currentRelease(s.run)
	if err != nil {
		return nil, err
	}
	if counted {
		s.r.locked(func(*session) { s.run.opens[s.file]++ })
	}
	stream, err := call([2]string{cf.rel.Base.URL, cf.rel.Pak.URL}[s.file])
	if err != nil {
		if _, busy := queueHint(err); busy {
			// Отказ из-за нагрузки не тратит открытие билета: ждёт и повторяет хост (queue.go).
			if counted {
				s.r.locked(func(*session) { s.run.opens[s.file] = max(s.run.opens[s.file]-1, 0) })
			}
			err = busyAsFatal(err)
		} else if dailyLimit(err) {
			err = pack.Fatal(err) // без тихих повторов: сразу ошибка DAILY_LIMIT с «Повторить»
		}
	}
	return stream, err
}

func (s *ticketSource) Open(ctx context.Context, from int64) (*pack.Stream, error) {
	return s.via(true, func(addr string) (*pack.Stream, error) { return s.r.api.OpenFile(ctx, addr, from) })
}

func (s *ticketSource) OpenRange(ctx context.Context, from, to int64) (*pack.Stream, error) {
	return s.via(false, func(addr string) (*pack.Stream, error) { return s.r.api.OpenFileRange(ctx, addr, from, to) })
}

// baseMarkValue — ожидаемое содержимое base.meta для подтверждённого релиза.
func baseMarkValue(cf *confirmation) string {
	return fmt.Sprintf("%s:%d", strings.ToLower(cf.rel.Base.SHA256), cf.rel.Base.Bytes)
}

// sizeMatches: файл по path существует и весит ровно want байт.
func sizeMatches(path string, want int64) bool {
	st, err := os.Stat(path)
	return err == nil && st.Size() == want
}

// checkBaseMark сверяет метку скачанного base: чужая метка стирает остатки, своя может засчитать готовый файл.
func (r *Runner) checkBaseMark(run *installRun, cf *confirmation) {
	run.metaChecked = true
	want := baseMarkValue(cf)
	markPath := run.part(baseMetaFile)
	if have, err := os.ReadFile(markPath); err == nil && string(have) == want {
		if sizeMatches(run.part(baseZipFile), cf.rel.Base.Bytes) {
			run.baseDone = true
		}
		return
	}
	for _, stale := range []string{baseZipFile + ".part", baseZipFile} {
		os.Remove(run.part(stale))
	}
	if err := pack.WriteFileAtomic(markPath, []byte(want), plainPerm); err != nil {
		r.log.Printf("could not write base.meta: %v", err)
	}
}

// downloadSpec — спецификация загрузки файла: base докачивается и может идти кусками, pak каждый раз с нуля.
func (r *Runner) downloadSpec(run *installRun, file int, cf *confirmation, src *ticketSource) (spec pack.DownloadSpec) {
	spec = pack.DownloadSpec{
		MaxAttempts: opensPerTicket - run.opens[file],
		Stall:       r.cfg.Stall,
		Backoff:     r.cfg.Backoff,
	}
	if file == fileBase {
		spec.Part, spec.Final = run.part(baseZipFile+".part"), run.part(baseZipFile)
		spec.ExpectedSize, spec.Resume, spec.Parallel = cf.rel.Base.Bytes, true, src
		return
	}
	spec.Part, spec.Final = run.part(pakFile+".part"), run.part(pakFile)
	spec.ExpectedSize, spec.TotalHint = -1, cf.rel.Pak.Bytes
	return
}

// isUnretryableDownloadErr — true, если ошибку загрузки не стоит оборачивать в NetError.
func isUnretryableDownloadErr(err error) bool {
	var served *betaapi.APIError
	return errors.As(err, &served) || betaapi.IsNetwork(err) || pack.IsFatal(err)
}

// afterFailedDownload решает, что делать с ошибкой загрузки: nil — пробовать дальше (новый билет взят).
func (r *Runner) afterFailedDownload(ctx context.Context, run *installRun, err error) error {
	if cerr := ctx.Err(); cerr != nil {
		return cerr
	}
	if betaapi.IsTicketProblem(err) {
		return r.refreshTicket(ctx, run)
	}
	if isUnretryableDownloadErr(err) {
		return err
	}
	return &betaapi.NetError{Err: err}
}

// fetchOnce делает один заход за файлом: новый билет, если открытия кончились, иначе загрузка.
func (r *Runner) fetchOnce(ctx context.Context, run *installRun, file int, done *bool) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if run.opens[file] >= opensPerTicket {
		return r.refreshTicket(ctx, run)
	}
	_, cf, err := r.currentRelease(run)
	if err != nil {
		return err
	}
	name := [2]string{"base", "pak"}[file]
	src := &ticketSource{r: r, run: run, file: file}
	err = pack.Download(ctx, src, r.downloadSpec(run, file, cf, src),
		func(p pack.Progress) {
			r.rt.Emit("download.progress", downloadBody(name, p, cf.rel.Base.Bytes, cf.rel.Pak.Bytes))
		})
	if err != nil {
		return r.afterFailedDownload(ctx, run, err)
	}
	*done = true
	return nil
}

// fetch скачивает один файл (base или pak), пока не скачан или не отказал.
func (r *Runner) fetch(ctx context.Context, run *installRun, file int) error {
	done := [2]*bool{&run.baseDone, &run.pakDone}[file]
	if file == fileBase && !run.metaChecked {
		_, cf, err := r.currentRelease(run)
		if err != nil {
			return err
		}
		r.checkBaseMark(run, cf)
	}
	name := [2]string{"base", "pak"}[file]
	tries := 0
	for !*done {
		err := r.fetchOnce(ctx, run, file, done)
		if err == nil {
			continue
		}
		// Сервер занят (429, 502, 503, 504): это очередь, а не ошибка; ждём и повторяем, пока человек не отменит.
		hint, busy := queueHint(err)
		if !busy {
			return err
		}
		tries++
		if werr := r.waitInQueue(ctx, run, name, hint, tries); werr != nil {
			return werr
		}
	}
	return nil
}

func (r *Runner) fetchBase(ctx context.Context, run *installRun) error {
	return r.fetch(ctx, run, fileBase)
}

func (r *Runner) fetchPak(ctx context.Context, run *installRun) error {
	return r.fetch(ctx, run, filePak)
}

// --- проверка, распаковка, сборка, замена ---

// checkDownloads сверяет хеш base и шапку pak; при отказе стирает испорченное и сбрасывает флаги.
func (r *Runner) checkDownloads(ctx context.Context, run *installRun) error {
	_, cf, err := r.currentRelease(run)
	if err != nil {
		return err
	}
	sum, err := pack.SHA256FileContext(ctx, run.part(baseZipFile))
	if err != nil {
		return err
	}
	if !strings.EqualFold(sum, cf.rel.Base.SHA256) {
		os.Remove(run.part(baseZipFile))
		run.baseDone, run.metaChecked = false, false
		return errHashMismatch
	}
	if err = CheckPakHeader(run.part(pakFile)); err != nil {
		os.Remove(run.part(pakFile))
		run.pakDone = false
		return bridge.Errf("INSTALL_FAILED", true, "%s", err.Error())
	}
	run.baseHash, run.verified = strings.ToLower(sum), true
	return nil
}

func (r *Runner) verifyDownloads(ctx context.Context, run *installRun) error {
	if run.placed.Load() {
		return nil
	}
	r.emitPhase("verify", 0)
	if !run.verified {
		if err := r.checkDownloads(ctx, run); err != nil {
			return err
		}
	}
	r.emitPhase("verify", 100)
	return nil
}

// pacer решает, пора ли слать очередное событие распаковки: первое, не чаще раза в 200 мс и последнее.
type pacer struct {
	started bool
	at      time.Time
}

func (p *pacer) due(final bool) bool {
	now := time.Now()
	if p.started && !final && now.Sub(p.at) < unpackTick {
		return false
	}
	p.started, p.at = true, now
	return true
}

// extractOptionsFor — предел распаковки base.zip и отмена по ctx.
func extractOptionsFor(cf *confirmation, ctx context.Context) pack.ExtractOptions {
	return pack.ExtractOptions{MaxTotalBytes: unpackLimit(cf.mf.Artifacts.Base.Size), Stop: ctx.Err}
}

func (r *Runner) unpackBase(ctx context.Context, run *installRun) error {
	if run.placed.Load() || run.unpacked {
		return nil
	}
	_, cf, err := r.currentRelease(run)
	if err != nil {
		return err
	}
	r.emitPhase("unpack", 0)
	if err = pack.RemoveAllRetry(run.lay.AppNew()); err != nil {
		return err
	}
	var pace pacer
	res, err := pack.ExtractZip(run.part(baseZipFile), run.lay.AppNew(),
		extractOptionsFor(cf, ctx),
		func(done, total int64) {
			if total > 0 && pace.due(done == total) {
				r.emitPhase("unpack", int(done*100/total))
			}
		})
	if err != nil {
		return err
	}
	if !isFile(filepath.Join(run.lay.AppNew(), layout.ExeName)) {
		return bridge.Errf("INSTALL_FAILED", false, "%s is missing in base.zip", layout.ExeName)
	}
	run.unpackedBytes = res.Bytes
	os.Remove(run.part(baseZipFile))
	run.unpacked = true
	r.emitPhase("unpack", 100)
	return nil
}

func isFile(path string) bool {
	st, err := os.Stat(path)
	return err == nil && !st.IsDir()
}

// betaFilesOf — содержимое beta\ новой установки по подтверждению.
func (run *installRun) betaFilesOf(cf *confirmation) BetaFiles {
	files := BetaFiles{PakFrom: run.part(pakFile), MovePak: true}
	files.License, files.Bind = []byte(cf.license), []byte(cf.bind)
	files.Manifest, files.ManifestSig = cf.mfBytes, []byte(cf.rel.ManifestSig)
	return files
}

func (r *Runner) stageAndPlace(ctx context.Context, run *installRun) error {
	if run.placed.Load() {
		return nil
	}
	if !run.staged {
		_, cf, err := r.currentRelease(run)
		if err != nil {
			return err
		}
		if err = StageBeta(run.lay, run.betaFilesOf(cf)); err != nil {
			return err
		}
		run.staged = true
	}
	r.emitPhase("shortcuts", 0)
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := PlaceBranch(run.lay, r.log); err != nil {
		return err
	}
	run.placed.Store(true)
	return nil
}

// --- ярлыки, запись в «Приложения», отчёт серверу, уборка ---

// shellSteps: копия установщика, ярлыки, запись об удалении; любая неудача — только предупреждение.
func (r *Runner) shellSteps(_ context.Context, run *installRun) error {
	if run.shellDone {
		return nil
	}
	_, cf, err := r.currentRelease(run)
	if err != nil {
		return err
	}
	desktop, startMenu := peek(r, func(*session) bool { return run.desktop }), peek(r, func(*session) bool { return run.startMenu })
	installedSize := run.unpackedBytes + cf.rel.Pak.Bytes

	stages := []struct {
		percent int
		warning string
		failed  func() bool
	}{
		{20, "uninstaller", func() bool { return CopyInstaller(r.sys, run.lay, r.log) != nil }},
		{50, "shortcuts", func() bool { return MakeShortcuts(r.sys, run.lay, run.ch, desktop, startMenu, r.log) }},
		{80, "registry", func() bool {
			return RegisterBranch(r.sys, run.lay, run.ch, cf.mf.Version, installedSize, r.log) != nil
		}},
	}
	for _, st := range stages {
		r.emitPhase("shortcuts", st.percent)
		if st.failed() {
			run.warn(st.warning)
		}
	}
	r.emitPhase("shortcuts", 100)
	run.shellDone = true
	return nil
}

// reportComplete сообщает серверу об установке: попыток на одну больше, чем пауз.
func (r *Runner) reportComplete(ctx context.Context, run *installRun) error {
	r.emitPhase("finalize", 0)
	if run.completed {
		return nil
	}
	act, _, err := r.currentRelease(run)
	if err != nil {
		return err
	}
	pauses := r.cfg.CompleteBackoff
	for try := range len(pauses) + 1 {
		err = r.api.Complete(ctx, act.id, run.baseHash)
		switch {
		case err == nil:
			run.completed = true
			return nil
		case ctx.Err() != nil:
			return ctx.Err()
		case !betaapi.IsTransient(err):
			// Сервер ответил отказом: ветка уже стоит и работает, повтор ничего не изменит. Установка
			// кончается успехом, а предупреждение говорит, что сервер не принял отчёт и почему.
			r.log.Printf("the server refused the install report, the branch stays installed: %v", err)
			run.warn(refusalWarning(err))
			run.completed = true
			return nil
		case try == len(pauses):
			return err
		case !sleepOrDone(ctx, pauses[try]):
			return ctx.Err()
		}
	}
	return err
}

// refusalWarning — предупреждение страницы по отказу сервера принять отчёт об установке:
// доступ отозван, активация истекла или прочее (страница показывает текст по коду).
func refusalWarning(err error) string {
	code := betaapi.Code(err)
	switch {
	case strings.Contains(code, "REVOKED"), strings.Contains(code, "DENIED"):
		return "access_revoked"
	case strings.Contains(code, "EXPIRED"):
		return "access_expired"
	}
	return "report"
}

// removeStaging стирает рабочую папку .setup; неудача только пишется в журнал.
func removeStaging(lay layout.Layout, log applog.Logger) {
	dir := lay.Staging()
	if err := pack.RemoveAllRetry(dir); err != nil {
		log.Printf("could not remove %s: %v", dir, err)
	}
}

func (r *Runner) tidyUp(_ context.Context, run *installRun) error {
	r.emitPhase("finalize", 100)
	removeStaging(run.lay, r.log)
	return nil
}
