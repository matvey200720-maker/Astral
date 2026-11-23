package install

import (
	"cmp"
	"context"
	"encoding/json"
	"slices"
	"sync/atomic"
	"time"

	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/app"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/bridge"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/chstatus"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/layout"
)

const (
	handoffStartDelay  = 100 * time.Millisecond
	handoffFirstAnswer = 30 * time.Second
	handoffIdle        = 2 * time.Minute
	handoffStep        = 500 * time.Millisecond
	handoffSleepGap    = 10 * time.Second // оборот позже шага на столько — компьютер спал

	handoffDefaultPhase = "download"
	handoffDefaultCode  = "INSTALL_FAILED"
)

// Общий срок передачи; настройками не меняется.
var handoffTotal = 2 * time.Hour

// handoffClock — часы наблюдения за лаунчером; подменяются в тестах, чтобы «усыпить» компьютер.
var handoffClock = time.Now

// handoffState — решение «поставить ветку руками установленного лаунчера».
type handoffState struct {
	from    layout.Channel // чей лаунчер зовём
	fromDir string         // корень этой ветки
	started atomic.Bool    // наблюдение уже запущено
	version atomic.Value   // string: версия ставимой ветки, как только лаунчер её назвал
}

func (s *handoffState) getVersion() string {
	v, _ := s.version.Load().(string)
	return v
}

// launcherRunning: запущен ли процесс из корня ветки (ошибка системы — «нет»).
func (r *Runner) launcherRunning(b layout.Branch) bool {
	running, _ := r.sys.RunningFrom(b.Root)
	return running
}

// decideHandoff решает, нужна ли передача: она включена, есть подсказка, подсказанной ветки нет,
// а среди стоящих есть ветка с лицензией. Берётся запущенная, иначе старшая.
func (r *Runner) decideHandoff() *handoffState {
	hint := r.cfg.Hint
	if !r.cfg.Handoff || hint == "" {
		return nil
	}
	installed := r.installedNow()
	if _, standing := layout.Find(installed, hint); standing {
		return nil
	}
	licensed := slices.DeleteFunc(slices.Clone(installed), func(b layout.Branch) bool { return !b.HasLicense })
	if len(licensed) == 0 {
		return nil
	}
	pick := licensed[0]
	if at := slices.IndexFunc(licensed, r.launcherRunning); at >= 0 {
		pick = licensed[at]
	}
	return &handoffState{from: pick.Channel, fromDir: pick.Root}
}

// sideInfo — ответ init в режиме side.
func (r *Runner) sideInfo(st *handoffState) app.InitInfo {
	hint, viaLauncher := string(r.cfg.Hint), true
	root := r.rootFor(r.cfg.Hint)
	rawLocale := r.sys.OSLocale()
	return app.InitInfo{
		Mode:         "side",
		ToVersion:    st.getVersion(),
		Channel:      hint,
		FromChannel:  string(st.from),
		ViaLauncher:  &viaLauncher,
		HintChannel:  &hint,
		Open:         r.cfg.AutoCode != "", // код пришёл в имени файла: окно говорит открытыми словами (без «беты»)
		Installed:    app.InstalledList(r.installedNow()),
		Version:      r.cfg.Version,
		OSLocale:     MapLocale(rawLocale),
		OSLocaleRaw:  rawLocale,
		InstallDir:   root,
		CanChooseDir: false,
		FreeBytes:    r.freePtr(root),
		Frame:        r.cfg.Frame,
		Window:       app.Window{Width: app.WindowWidth, Height: app.WindowHeight},
		UserDataDirs: []string{},
		Dev:          r.cfg.Dev,
	}
}

// sideInit — ответ init в режиме side, если передача активна. Решение принимается один раз,
// при первом вызове; наблюдение стартует через 100 мс после ответа, тоже один раз.
func (r *Runner) sideInit() (app.InitInfo, bool) {
	r.sideOnce.Do(func() { r.side.Store(r.decideHandoff()) })
	st := r.side.Load()
	if st == nil {
		return app.InitInfo{}, false
	}
	info := r.sideInfo(st)
	if st.started.CompareAndSwap(false, true) {
		r.group.Add(1)
		time.AfterFunc(handoffStartDelay, func() { r.watchHandoff(st) })
	}
	return info, true
}

// hEnterCode — вызов enterCode: человек отказался от передачи и вводит код сам.
func (r *Runner) hEnterCode(context.Context, json.RawMessage) (any, error) {
	if r.side.Swap(nil) == nil {
		return nil, stateErr("there is no hand-over to the launcher to leave")
	}
	r.log.Printf("handoff: the person chose to enter a code")
	return map[string]any{}, nil
}

// sideFail: журнал и событие error со стадией side (подробность в событии не очищается).
func (r *Runner) sideFail(code, detail string, retryable bool) {
	e := &bridge.Error{Code: code, Retryable: retryable, Detail: detail}
	r.log.Printf("handoff failed: %s %s", e.Code, e.Detail)
	r.rt.Emit("error", e.Event("side"))
}

// stepMark — то, по чему узнают, что лаунчер сдвинулся с места.
type stepMark struct {
	phase              string
	percent, overall   int
	hasPercent, hasAll bool
	version            string
}

func deref(p *int) (int, bool) {
	if p == nil {
		return 0, false
	}
	return *p, true
}

func markOf(s *chstatus.State) stepMark {
	m := stepMark{phase: s.Phase, version: s.Version}
	m.percent, m.hasPercent = deref(s.Percent)
	m.overall, m.hasAll = deref(s.Overall)
	return m
}

// sideProgress — тело события side.progress; ключи по алфавиту, пустые необязательные пропускаются.
type sideProgress struct {
	Overall *int   `json:"overall,omitempty"`
	Percent *int   `json:"percent,omitempty"`
	Phase   string `json:"phase"`
	Version string `json:"version,omitempty"`
}

func sideProgressBody(rec *chstatus.State) sideProgress {
	return sideProgress{
		Overall: rec.Overall,
		Percent: rec.Percent,
		Phase:   cmp.Or(rec.Phase, handoffDefaultPhase),
		Version: rec.Version,
	}
}

func pickDur(set, fallback time.Duration) time.Duration {
	if set > 0 {
		return set
	}
	return fallback
}

// watcher пересказывает файл состояния лаунчера событиями странице.
type watcher struct {
	r           *Runner
	st          *handoffState
	file        string
	began       time.Time
	since       time.Time // записи старше этой секунды — чужие
	firstAnswer time.Duration
	idle        time.Duration
	step        time.Duration // как часто заглядываем в файл

	answered   bool
	last       stepMark
	lastChange time.Time
	tickedAt   time.Time // начало прошлого оборота
}

// stateHandlers — что делать с записью каждого состояния; true — наблюдение кончено.
var stateHandlers = map[string]func(*watcher, *chstatus.State) bool{
	chstatus.Working: (*watcher).onWorking,
	chstatus.Done:    (*watcher).onDone,
	chstatus.Error:   (*watcher).onError,
}

func (w *watcher) onWorking(rec *chstatus.State) bool {
	mark := markOf(rec)
	if w.answered && mark == w.last {
		return false
	}
	w.last, w.answered, w.lastChange = mark, true, handoffClock()
	if rec.Version != "" {
		w.st.version.Store(rec.Version)
	}
	w.r.rt.Emit("side.progress", sideProgressBody(rec))
	return false
}

func (w *watcher) onDone(rec *chstatus.State) bool {
	w.r.handoffDone(w.st, rec)
	return true
}

func (w *watcher) onError(rec *chstatus.State) bool {
	w.r.sideFail(cmp.Or(rec.Code, handoffDefaultCode), rec.Detail, rec.Retryable)
	return true
}

// start готовит наблюдение и просит лаунчер поставить ветку; false — не вышло.
func (w *watcher) start() bool {
	r, hint := w.r, w.r.cfg.Hint
	shared := r.sys.SharedDataDir()
	if shared == "" {
		r.sideFail(handoffDefaultCode, "no_shared_data_dir", false)
		return false
	}
	w.file = chstatus.Path(shared, hint)
	chstatus.Remove(w.file)
	w.began = handoffClock()
	w.tickedAt = w.began
	w.since = w.began.Truncate(time.Second)

	r.log.Printf("handoff: asking the %s launcher to install %s", w.st.from, hint)
	launcher := layout.New(w.st.fromDir)
	if _, err := r.sys.Launch(launcher.Exe(), []string{"--install-channel", string(hint)}, launcher.App()); err != nil {
		r.sideFail(handoffDefaultCode, "launcher_start_failed: "+err.Error(), true)
		return false
	}
	return true
}

// deadline — срок наблюдения и его причина, если он вышел.
type deadline struct {
	late   bool
	detail string
}

// absorbSleep: оборот пришёл намного позже шага — компьютер спал или впал в гибернацию.
// Лаунчер всё это время тоже стоял, поэтому спавшее время не идёт в зачёт ни ожидания первого
// ответа, ни простоя, ни общего срока.
func (w *watcher) absorbSleep(now time.Time) {
	gap := now.Sub(w.tickedAt) - w.step
	w.tickedAt = now
	if gap <= handoffSleepGap {
		return
	}
	w.began, w.lastChange = w.began.Add(gap), w.lastChange.Add(gap)
	w.r.log.Printf("handoff: the computer was asleep for about %s, not counting it", gap.Round(time.Second))
}

// tick — один оборот: разбор записи и проверка сроков; false — наблюдение кончено.
func (w *watcher) tick() bool {
	w.absorbSleep(handoffClock())
	if rec, _ := chstatus.Read(w.file); rec != nil && !rec.Time().Before(w.since) {
		if handle, known := stateHandlers[rec.State]; known && handle(w, rec) {
			return false
		}
	}
	now := handoffClock()
	overdue := []deadline{
		{!w.answered && now.Sub(w.began) > w.firstAnswer, "launcher_no_answer"},
		{w.answered && now.Sub(w.lastChange) > w.idle, "launcher_stalled"},
		{now.Sub(w.began) > handoffTotal, "launcher_took_too_long"},
	}
	if at := slices.IndexFunc(overdue, func(d deadline) bool { return d.late }); at >= 0 {
		w.r.sideFail(handoffDefaultCode, overdue[at].detail, true)
		return false
	}
	return true
}

// watchHandoff просит лаунчер поставить ветку и пересказывает файл состояния событиями странице.
func (r *Runner) watchHandoff(st *handoffState) {
	defer r.group.Done()
	w := &watcher{
		r: r, st: st,
		firstAnswer: pickDur(r.cfg.HandoffFirstState, handoffFirstAnswer),
		idle:        pickDur(r.cfg.HandoffStall, handoffIdle),
		step:        pickDur(r.cfg.HandoffPoll, handoffStep),
	}
	// Окно успели закрыть или человек выбрал ввод кода, пока шла задержка перед стартом: лаунчер
	// звать незачем.
	if r.ctx.Err() != nil || r.side.Load() != st {
		return
	}
	if !w.start() {
		return
	}
	// Передачу отменил enterCode: наблюдение тихо кончается, страница уже на вводе кода.
	for sleepOrDone(r.ctx, w.step) && r.side.Load() == st && w.tick() {
	}
}

// handoffDone: лаунчер сообщил, что ветка стоит. Проверяем диск и запоминаем законченную установку.
func (r *Runner) handoffDone(st *handoffState, rec *chstatus.State) {
	hint := r.cfg.Hint
	lay := layout.New(r.rootFor(hint))
	if !lay.Installed() {
		r.sideFail(handoffDefaultCode, "launcher_reported_done_but_the_branch_is_missing", false)
		return
	}
	version := cmp.Or(rec.Version, st.getVersion())
	r.rememberFinished(hint, lay)
	r.log.Printf("handoff: %s is installed (%s)", hint, version)
	r.rt.Emit("side.done", map[string]any{"channel": string(hint), "version": version})
}
