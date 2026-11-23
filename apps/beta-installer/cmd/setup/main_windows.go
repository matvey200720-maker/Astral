//go:build windows

// Command setup — AstralBetaSetup.exe, единый установщик всех веток Astral (alpha, beta,
// release). Режим выбирают аргументы: установка по коду (без режимных флагов), удаление,
// применение обновления, откат, запуск, установка ветки рядом, самопроверка WebView2.
// Повышение прав делает Windows по манифесту в ресурсах exe; сама программа прав не
// спрашивает и не проверяет. Собирается с -H windowsgui: в стандартные потоки не пишет.
//
// Устройство: session хранит всё, что режимам нужно от запуска. Режим — метод session,
// который читается как прямой сценарий; невозможность идти дальше он выражает через ensure
// (общая ошибка запуска) и возвратом кода. Всё, что надо отпустить при выходе (замки,
// раннеры, отложенное стирание), кладётся в стопку after и снимается в обратном порядке.
package main

import "bytes"
import "context"
import "crypto/ed25519"
import "crypto/rand"
import "crypto/sha256"
import "encoding/base64"
import "encoding/hex"
import "errors"
import "flag"
import "fmt"
import "io"
import "io/fs"
import "log"
import "os"
import "path/filepath"
import "reflect"
import "runtime"
import "runtime/debug"
import "slices"
import "strings"
import "sync/atomic"

import installer "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/app"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/applog"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/betaapi"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/bridge"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/config"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/dpop"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/host"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/i18n"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/install"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/layout"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/pack"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/releasekeys"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/sideload"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/uninstall"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/update"
import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/winsys"

func main() {
	runtime.LockOSThread()
	code := execute()
	os.Exit(code)
}

// Коды выхода: сборка неверна, нет WebView2 Runtime, окно WebView2 не открылось,
// тихое удаление отказало из-за запущенного Astral, неверные аргументы.
// Коды 10–12 отдаёт пакет update, код 11 у «ветки рядом» — sideload.
const exitBadBuild, exitNoRuntime, exitWebViewDown, exitAppRunning, exitUsage = 2, 3, 4, 5, 64

// Страница загрузки WebView2 Runtime: открывается, если на вопрос о ней ответили «Да».
const webViewDownloadURL = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"

// Приставка записей об удалении в тестовых режимах и ключ-основа для них.
const testKeyPrefix = "AstralBetaTest-"
const testUninstallBase = `Software\AstralTest\Sandbox\Uninstall`

const setupExeName = "AstralBetaSetup.exe"

// Общие замки удаления и обновления, когда корень не похож на папку ветки.
const lockUninstallAny, lockUpdateAny = `Local\AstralSetup-uninstall`, `Local\AstralSetup-update`

const msgSideNeedsBranch = "--install-channel needs a branch (alpha, beta or release) and --staging"
const msgSideNeedsFolder = "--install-channel must be started from the folder of an installed branch"

// Справка к ошибке разбора аргументов: всегда на английском и без словаря.
const usageSummary = "AstralBetaSetup.exe [--uninstall [--quiet] [--delete-user-data]] " +
	"[--apply-update --pid N --install-dir D --staging S [--launch] [--quiet]] " +
	"[--rollback-old --pid N --install-dir D [--launch]] " +
	"[--install-channel alpha|beta|release --staging S [--install-dir D] [--launch] [--quiet]] " +
	"[--native-frame]"

// Тихое удаление различает отказы по коду ошибки моста; всё, чего здесь нет, — код 1.
var quietExitCodes = map[string]int{"APP_RUNNING": exitAppRunning}

// ---------------------------------------------------------------------------------------
// Аргументы

// options — командная строка. Имя флага и пометка лежат в теге: по нему флаги заводятся,
// а пути (пометка path) разворачиваются в абсолютные. У боевой сборки значения «только
// не боевых» флагов разбираются, но не используются.
type options struct {
	Uninstall      bool   `flag:"uninstall"`
	Quiet          bool   `flag:"quiet"`
	DeleteUserData bool   `flag:"delete-user-data"`
	ApplyUpdate    bool   `flag:"apply-update"`
	RollbackOld    bool   `flag:"rollback-old"`
	Launch         bool   `flag:"launch"`
	NativeFrame    bool   `flag:"native-frame"`
	FromTemp       bool   `flag:"from-temp"`
	Hidden         bool   `flag:"hidden"`
	Version        bool   `flag:"version"`
	Pid            int    `flag:"pid"`
	InstallChannel string `flag:"install-channel"`
	APIOrigin      string `flag:"api-origin"`
	InstallDir     string `flag:"install-dir,path"`
	Staging        string `flag:"staging,path"`
	Selftest       string `flag:"selftest,path"`
	UIDir          string `flag:"ui-dir,path"`
	Home           string `flag:"home,path"`
	Sandbox        string `flag:"sandbox,path"`
	Drive          string `flag:"drive,path"`
	Shots          string `flag:"shots,path"`
}

// each обходит поля с тегом flag: имя, пометка и указатель на само поле.
func (o *options) each(visit func(name, mark string, field any)) {
	v := reflect.ValueOf(o).Elem()
	for i := range v.NumField() {
		tag, ok := v.Type().Field(i).Tag.Lookup("flag")
		if !ok {
			continue
		}
		name, mark, _ := strings.Cut(tag, ",")
		visit(name, mark, v.Field(i).Addr().Interface())
	}
}

// readOptions разбирает аргументы стандартным пакетом flag: без вывода, ошибка уходит
// вызывающему. При ошибке часть значений уже может быть выставлена, их не используют.
func readOptions(args []string) (*options, error) {
	set := flag.NewFlagSet("AstralBetaSetup", flag.ContinueOnError)
	set.SetOutput(io.Discard)
	opts := new(options)
	opts.each(func(name, _ string, field any) {
		switch ptr := field.(type) {
		case *bool:
			set.BoolVar(ptr, name, false, "")
		case *string:
			set.StringVar(ptr, name, "", "")
		case *int:
			set.IntVar(ptr, name, 0, "")
		}
	})
	return opts, set.Parse(args)
}

// anchor делает пути из аргументов абсолютными (от текущей папки на момент запуска;
// непреобразуемый путь остаётся как есть).
func (o *options) anchor() {
	o.each(func(_, mark string, field any) {
		if path, isString := field.(*string); isString && mark == "path" && *path != "" {
			*path = absOr(*path)
		}
	})
}

// absOr — абсолютный путь или, если его не получить, тот же путь.
func absOr(path string) string {
	full, err := filepath.Abs(path)
	if err != nil {
		return path
	}
	return full
}

// parkCwd уводит текущую папку процесса во временную: пока папка чья-то текущая, её нельзя
// ни переименовать, ни стереть, а лаунчер, запущенный ярлыком, живёт в <корень>\app и без
// этого передал бы её по наследству. Не вышло — в SystemRoot (результат не проверяется).
func parkCwd() {
	for _, dir := range []string{os.TempDir(), os.Getenv("SystemRoot")} {
		if os.Chdir(dir) == nil {
			return
		}
	}
}

// ---------------------------------------------------------------------------------------
// Сессия

// worker — то, что режимы с окном делят между собой: раннеры install, uninstall, update, sideload.
type worker interface {
	Register()
	Busy() bool
	Close()
}

// abort — выход с кодом из любого места режима: окна уже показаны, остаётся отпустить
// отложенное и вернуть код.
type abort struct{ code int }

// writerFunc превращает функцию в io.Writer.
type writerFunc func([]byte) (int, error)

func (f writerFunc) Write(p []byte) (n int, err error) { return f(p) }

// argList — аргументы для запуска копии установщика.
type argList []string

func (a *argList) when(on bool, flag string) {
	if on {
		*a = append(*a, flag)
	}
}

func (a *argList) pair(flag, value string) {
	if value != "" {
		*a = append(*a, flag, value)
	}
}

type session struct {
	sys    *winsys.System
	opts   *options
	log    applog.Logger
	ui     fs.FS
	window atomic.Pointer[host.Window] // заполняется после host.New, читается из горутин раннеров
	result atomic.Int32                // последний итог, о котором сообщил раннер
	undo   []func()                    // отложенное, снимается с конца

	lang, title string
	logDir      string // папка журналов: в окнах «журнал» — именно она
	frame       string // custom | native
	dataDir     string // данные WebView2
	prod        bool   // боевая сборка: Channel пакета config равен release
	silent      bool
}

// execute — рабочая функция: все отложенные действия выполняются до того, как main выйдет.
func execute() int {
	s := &session{sys: winsys.New()}
	s.lang = install.MapLocale(s.sys.OSLocale())
	s.title = i18n.T(s.lang, "title")

	var parseErr error
	s.opts, parseErr = readOptions(os.Args[1:])
	switch {
	case parseErr != nil:
		winsys.ErrorBox(s.title, parseErr.Error()+"\n\n"+usageSummary)
		return exitUsage
	case s.opts.Version:
		winsys.InfoBox(s.title, "Astral installer "+buildLabel())
		return 0
	}
	s.opts.anchor()
	parkCwd()
	s.prod = config.IsRelease()
	if !s.prod {
		if code, ok := s.devTuning(); !ok {
			return code
		}
	}

	s.logDir = s.sys.LogDir()
	defer s.openJournal()()
	log.SetOutput(writerFunc(s.pipeStdlog))
	s.note("AstralBetaSetup %s %s args=%v", buildLabel(), runtime.Version(), os.Args[1:])

	return s.guarded(s.serve)
}

// buildLabel — «версия (ветка сборки)», как её видят окна и журнал.
func buildLabel() string { return config.Version + " (" + config.Channel + ")" }

// openJournal открывает журнал и отдаёт функцию, которая его закроет. Не открылся —
// журнал молчащий, а путь «журнала» для окон всё равно остаётся папкой журналов.
func (s *session) openJournal() func() {
	journal, closer, err := applog.Open(s.logDir, "setup", 8)
	if err != nil {
		s.log = applog.Nop{}
		return func() {}
	}
	s.log = journal
	return func() { _ = closer.Close() }
}

// note пишет строку в журнал.
func (s *session) note(format string, args ...any) { s.log.Printf(format, args...) }

// pipeStdlog принимает вывод стандартного log (им пишет go-webview2) и кладёт каждую запись
// в журнал одной строкой без завершающих переводов строки.
func (s *session) pipeStdlog(p []byte) (n int, err error) {
	s.note("%s", bytes.TrimRight(p, "\r\n"))
	return len(p), nil
}

// sandboxKey — имя записи об удалении для песочницы: приставка и первые 4 байта SHA-256
// от пути в нижнем регистре, чтобы разные песочницы не делили записи.
func sandboxKey(root string) string {
	digest := sha256.New()
	_, _ = io.WriteString(digest, strings.ToLower(root))
	return testKeyPrefix + hex.EncodeToString(digest.Sum(nil)[:4])
}

// devTuning переносит данные установщика, записи об удалении и адрес API по флагам и
// переменным окружения (только не боевая сборка). ok=false: идти дальше нельзя, код — первым.
func (s *session) devTuning() (code int, ok bool) {
	o, sys := s.opts, s.sys

	for _, home := range []string{o.Home, os.Getenv("ASTRAL_SETUP_HOME")} {
		if home != "" {
			sys.HomeOverride = home
			break
		}
	}
	if key := os.Getenv("ASTRAL_SETUP_UNINSTALL_KEY"); strings.HasPrefix(key, testKeyPrefix) {
		sys.UninstallKey, sys.UninstallBase = key, testUninstallBase
	}
	switch root, err := filepath.Abs(o.Sandbox); {
	case o.Sandbox == "":
	case err != nil:
		winsys.ErrorBox(s.title, applog.Redact("--sandbox: "+err.Error()))
		return exitUsage, false
	default:
		sys.Sandbox = root
		sys.UninstallKey, sys.UninstallBase = sandboxKey(root), testUninstallBase
	}
	if o.APIOrigin != "" {
		config.APIOrigin = o.APIOrigin
	}
	return 0, true
}

// guarded выполняет работу и превращает панику этой горутины в окно ошибки и код 1; abort
// даёт свой код. Паники до этого места и в чужих горутинах (раннеры) не перехватываются.
func (s *session) guarded(work func() int) (code int) {
	defer func() {
		switch p := recover().(type) {
		case nil:
		case abort:
			code = p.code
		default:
			s.note("panic: %v\n%s", p, debug.Stack())
			winsys.ErrorBox(s.title, applog.Redact(i18n.F(s.lang, "fatal", fmt.Sprint(p), s.logDir)))
			code = 1
		}
	}()
	return work()
}

// after откладывает действие до выхода из режима; снимается в обратном порядке.
func (s *session) after(f func()) { s.undo = append(s.undo, f) }

func (s *session) unwind() {
	for n := len(s.undo); n > 0; n = len(s.undo) {
		last := s.undo[n-1]
		s.undo = s.undo[:n-1]
		last()
	}
}

// ensure — общая ошибка запуска как выход: окно по причине, затем abort.
func (s *session) ensure(err error) {
	if err != nil {
		panic(abort{s.startFailure(err)})
	}
}

// ensured получает значение у create; ошибка — общая ошибка запуска.
func ensured[T any](s *session, create func() (T, error)) T {
	value, err := create()
	s.ensure(err)
	return value
}

// serve проверяет сборку, готовит общие настройки окна и передаёт управление режиму.
func (s *session) serve() int {
	switch err := config.Validate(); {
	case err != nil:
		s.note("bad build: %v", err)
		winsys.ErrorBox(s.title, applog.Redact(i18n.F(s.lang, "bad-build", err.Error())))
		return exitBadBuild
	}
	s.prepareView()
	defer s.unwind()

	// Первый подходящий режим побеждает; остальные режимные флаги молча игнорируются.
	switch o := s.opts; {
	case o.Selftest != "":
		return host.RunSelfTest(o.Selftest, s.dataDir+"-selftest", s.frame, s.log)
	case o.Uninstall:
		return s.runUninstall()
	case o.ApplyUpdate:
		return s.runUpdate()
	case o.RollbackOld:
		return s.runRollback()
	case o.InstallChannel != "":
		return s.runSideload()
	case o.Launch:
		return s.runLaunch()
	}
	return s.runInstall()
}

// prepareView выбирает источник интерфейса, рамку, папку данных WebView2 и скрытость окна.
func (s *session) prepareView() {
	s.ui = installer.UI()
	diskUI := s.opts.UIDir
	if diskUI == "" {
		diskUI = os.Getenv("ASTRAL_SETUP_UI_DIR")
	}
	if diskUI != "" && !s.prod {
		s.note("UI is served from the folder %s", diskUI)
		s.ui = os.DirFS(diskUI)
	}

	s.frame = "custom"
	switch {
	case !s.prod && os.Getenv("ASTRAL_SETUP_FRAME") == "native", s.opts.NativeFrame:
		s.frame = "native"
	}
	s.dataDir = filepath.Join(s.sys.SetupHome(), "webview2")
	s.silent = s.opts.Hidden && !s.prod
}

// ---------------------------------------------------------------------------------------
// Общее для режимов с окном

// scenario читает сценарий проверки вида для окна. Боевая сборка и пустой --drive дают
// пару пустых строк; файл читается целиком как есть (BOM и CRLF сохраняются).
func (s *session) scenario() (script, shotsDir string) {
	if s.prod || s.opts.Drive == "" {
		return
	}
	raw, err := os.ReadFile(s.opts.Drive)
	if err == nil {
		return string(raw), s.opts.Shots
	}
	s.note("--drive: %v", err)
	return
}

// bridgeWith собирает мост и общую часть страницы; fit — как окно меняет высоту
// (nil — размер не меняется, страница получает успешный ответ и ничего больше).
func (s *session) bridgeWith(fit func(int)) (*bridge.Router, *app.Common) {
	rt := bridge.NewRouter(context.Background(), s.log)
	common := new(app.Common)
	common.Sys, common.Log, common.Fit = s.sys, s.log, fit
	common.Site, common.API, common.Dev = config.Site(), config.API(), !s.prod
	common.Register(rt)
	return rt, common
}

// onWindow выполняет действие над окном, если оно уже создано: замыкания раннеров зовутся
// из их горутин, и пока окна нет, ничего не делают.
func (s *session) onWindow(act func(*host.Window)) {
	if w := s.window.Load(); w != nil {
		act(w)
	}
}

func (s *session) closeWindow() { s.onWindow(func(w *host.Window) { w.Exit(0) }) }

// closeWithResult закрывает окно с кодом, о котором раннер сообщил последним.
func (s *session) closeWithResult() {
	s.onWindow(func(w *host.Window) { w.Exit(int(s.result.Load())) })
}

// rememberResult запоминает итог раннера и передаёт его окну: любое закрытие окна,
// даже крестиком, тогда выходит с этим кодом.
func (s *session) rememberResult(code int) {
	s.result.Store(int32(code))
	s.onWindow(func(w *host.Window) { w.SetExitCode(code) })
}

// openWindow создаёт окно режима. busy сообщает, идёт ли работа раннера: пока идёт, окно
// не закрывается, а страница получает событие window.closeRequested.
func (s *session) openWindow(query string, rt *bridge.Router, busy func() bool) (*host.Window, error) {
	var o host.Options
	o.Router, o.Log, o.Query, o.Dev = rt, s.log, query, !s.prod
	o.UI, o.DataDir, o.Silent = s.ui, s.dataDir, s.silent
	o.Width, o.Height = app.WindowWidth, app.WindowHeight
	o.Frame, o.IconID = s.frame, 1
	o.Drive, o.ShotsDir = s.scenario()
	o.CloseGuard = closeGuard(rt, busy)

	win, err := host.New(o)
	if err == nil {
		s.window.Store(win)
	}
	return win, err
}

// closeGuard — решение окна при попытке его закрыть: пока идёт работа, не закрывать
// и сообщить странице; иначе закрывать молча.
func closeGuard(rt *bridge.Router, busy func() bool) func() bool {
	return func() bool {
		if idle := !busy(); idle {
			return true
		}
		rt.Emit("window.closeRequested", map[string]bool{"busy": true})
		return false
	}
}

// present регистрирует раннер, открывает окно режима и крутит его цикл сообщений.
// Окно не открылось — решает failed. warm, если задан, вызывается, когда окно уже создано
// (запасной отсчёт раннера: первый запуск WebView2 бывает дольше двух секунд, и работа
// не должна начаться раньше окна).
func (s *session) present(query string, rt *bridge.Router, wk worker, warm func(), failed func(error) int) int {
	wk.Register()
	s.after(wk.Close)
	win, err := s.openWindow(query, rt, wk.Busy)
	if err != nil {
		return failed(err)
	}
	if warm != nil {
		warm()
	}
	return win.Run()
}

// headless — запасной путь режима без окна: причина в журнал и работа без интерфейса.
func (s *session) headless(what string, fallback func() int) func(error) int {
	return func(err error) int {
		s.note("no window (%v): %s", err, what)
		return fallback()
	}
}

// startFailure — общая ошибка запуска режима: журнал и окно по причине. Нет WebView2
// Runtime и сбой WebView2 дают вопрос про страницу загрузки, остальное — окно ошибки.
func (s *session) startFailure(err error) int {
	s.note("fatal: %v", err)
	var question string
	var exit int
	switch {
	case errors.Is(err, host.ErrNoRuntime):
		question, exit = i18n.T(s.lang, "no-webview2"), exitNoRuntime
	case errors.Is(err, host.ErrWebViewFailed):
		question, exit = i18n.F(s.lang, "webview2-failed", s.logDir), exitWebViewDown
	default:
		winsys.ErrorBox(s.title, applog.Redact(i18n.F(s.lang, "fatal", err.Error(), s.logDir)))
		return 1
	}
	// Адрес открывает свежая winsys.System: песочницу этот вопрос обходит.
	if winsys.AskYesNo(s.title, question) {
		_ = winsys.New().OpenURL(webViewDownloadURL)
	}
	return exit
}

// ---------------------------------------------------------------------------------------
// Замки и ключи

// tryLock берёт именованный замок; он отпустится при выходе из режима. taken=false при
// занятом замке и при ошибке (тогда err не nil).
func (s *session) tryLock(name string) (taken bool, err error) {
	release, busy, err := winsys.SingleInstance(name)
	if err != nil || busy {
		return false, err
	}
	s.after(release)
	return true, nil
}

// claim — замок, у которого сбой создания считается общей ошибкой запуска.
func (s *session) claim(name string) bool {
	taken, err := s.tryLock(name)
	s.ensure(err)
	return taken
}

// lockNameFor — замок ветки по корню или общий замок, если корень не похож на ветку.
func lockNameFor(root, common string, branchName func(layout.Channel) string) string {
	if ch, known := layout.ChannelOfRoot(root); known {
		return branchName(ch)
	}
	return common
}

// claimUpdate берёт замок помощника обновления для корня; занят — запись в журнал и false.
func (s *session) claimUpdate(root string) bool {
	if s.claim(lockNameFor(root, lockUpdateAny, layout.Channel.UpdateMutexName)) {
		return true
	}
	s.note("another update helper is running")
	return false
}

// lockBranch — замок ветки для установщика. Сбой самого замка установке не мешает.
func (s *session) lockBranch(ch layout.Channel) (release func(), busy bool) {
	var err error
	if release, busy, err = winsys.SingleInstance(ch.MutexName()); err != nil {
		s.note("could not take the lock of %s: %v", ch, err)
		release, busy = func() {}, false
	}
	return
}

// keysMissing: боевая сборка без ключей релизов не может проверить ни один манифест.
func (s *session) keysMissing(keys *releasekeys.Set) bool { return s.prod && keys.Len() == 0 }

// unsignedOK: только не боевая сборка и только без ключей принимает манифест без подписи.
func (s *session) unsignedOK(keys *releasekeys.Set) bool { return !s.prod && keys.Len() == 0 }

// badBuildNoKeys показывает окно «сборка собрана неправильно: нет ключей релизов».
func (s *session) badBuildNoKeys() int {
	winsys.ErrorBox(s.title, applog.Redact(i18n.F(s.lang, "bad-build", "no release keys")))
	return exitBadBuild
}

// licenseKey раскодирует открытый ключ лицензий (стандартный base64 с дополнением).
// Не раскодировался или не 32 байта — ключа нет, и установка лицензию не проверяет.
func licenseKey(encoded string) ed25519.PublicKey {
	buf := make([]byte, base64.StdEncoding.DecodedLen(len(encoded)))
	n, err := base64.StdEncoding.Decode(buf, []byte(encoded))
	if err != nil || n != ed25519.PublicKeySize {
		return nil
	}
	return buf[:n]
}

// ---------------------------------------------------------------------------------------
// Установка по коду

func (s *session) runInstall() int {
	if !s.claim(layout.InstallMutexName) {
		s.note("another installer is running: raising its window")
		host.FocusExisting()
		return 0
	}
	hint := s.branchHint()

	signer := ensured(s, dpop.NewSigner)
	s.noteProxy()

	keys := ensured(s, releasekeys.Embedded)
	if s.keysMissing(keys) {
		s.note("bad build: no release keys to verify manifests")
		return s.badBuildNoKeys()
	}

	rt, common := s.bridgeWith(func(cssHeight int) {
		s.onWindow(func(w *host.Window) { w.Fit(cssHeight) })
	})
	var cfg install.Config
	cfg.Version, cfg.Frame, cfg.Dev = config.Version, s.frame, !s.prod
	cfg.Keys, cfg.AllowUnsigned = keys, s.unsignedOK(keys)
	cfg.LicensePub = licenseKey(config.LicensePublicKey)
	cfg.Hint, cfg.Handoff = hint, true
	cfg.AutoCode = s.codeFromName()
	cfg.LockBranch, cfg.Exit = s.lockBranch, s.closeWindow
	transport := betaapi.DefaultHTTPClient(winsys.ProxyFunc())
	api := betaapi.New(config.API(), signer, transport, s.log)

	runner := install.New(cfg, s.sys, api, common, rt, s.log)
	return s.present("", rt, runner, nil, s.startFailure)
}

// branchHint — подсказка ветки из имени установщика; пусто, если её нет.
func (s *session) branchHint() layout.Channel {
	self, err := s.sys.SelfExe()
	if err != nil {
		return ""
	}
	hint, _ := layout.HintFromExeName(self)
	if hint != "" {
		s.note("the branch hint from the file name: %s", hint)
	}
	return hint
}

// codeFromName — код установки из имени установщика (AstralSetup-release-k<16 знаков>.exe); пусто, если его нет
// или он не по алфавиту. В журнал идут только последние четыре знака.
func (s *session) codeFromName() string {
	self, err := s.sys.SelfExe()
	if err != nil {
		return ""
	}
	body, ok := layout.CodeFromExeName(self)
	if !ok {
		return ""
	}
	code, err := install.NormalizeCode("BETA-" + body)
	if err != nil {
		s.note("the install code mark in the file name was ignored: not a code")
		return ""
	}
	s.note("an install code came with the file name")
	return code
}

// noteProxy записывает системный прокси, если он включён или задан PAC.
func (s *session) noteProxy() {
	px := winsys.ProxySettings()
	if !px.Enabled && px.PACURL == "" {
		return
	}
	fields := []any{px.Enabled, px.Server, px.Override, px.PACURL}
	s.note("system proxy: enabled=%t server=%q override=%q pac=%q (PAC is not supported)", fields...)
}

// ---------------------------------------------------------------------------------------
// Корень ветки (удаление и запуск)

// branchRoot — корень ветки, с которой работаем: первый из --install-dir, папки запущенного
// exe и папок по умолчанию alpha, beta, release, который layout признаёт нашей установкой.
// Ничего не нашлось — папка beta по умолчанию, даже если её нет. Пустой путь layout
// отвергает сам, поэтому незаданный --install-dir и неопределившийся exe просто выпадают.
func (s *session) branchRoot() string {
	self, _ := s.sys.SelfExe()
	appData := s.sys.LocalAppData()
	candidates := []string{s.opts.InstallDir, filepath.Dir(self)}
	for _, ch := range layout.All {
		candidates = append(candidates, layout.DefaultRoot(appData, ch))
	}
	ours := func(dir string) bool { return layout.New(dir).SafeToRemove() == nil }
	if at := slices.IndexFunc(candidates, ours); at >= 0 {
		return candidates[at]
	}
	return layout.DefaultRoot(appData, layout.Beta)
}

// within: путь лежит строго внутри корня. Оба приводятся Clean и к нижнему регистру;
// сам корень не считается. Корень вида «C:\» как префикс не работает.
func within(path, root string) bool {
	norm := func(p string) string { return strings.ToLower(filepath.Clean(p)) }
	return strings.HasPrefix(norm(path), norm(root)+`\`)
}

// ---------------------------------------------------------------------------------------
// Удаление

// uninstallPlan — где идёт удаление и что стереть при выходе.
type uninstallPlan struct {
	inPlace    bool     // удаление идёт прямо из установленного exe
	handedOver bool     // работу забрала копия во временной папке
	leftovers  []string // что стереть при выходе из режима
}

func (s *session) runUninstall() int {
	root := s.branchRoot()
	self, _ := s.sys.SelfExe() // не определился — пустая строка
	plan := s.planUninstall(self, root)
	if plan.handedOver {
		return 0
	}
	// Остатки стираются при любом выходе отсюда, даже когда удаление отказало или работу
	// не начали из-за занятого замка: так задумано.
	s.after(func() { s.scheduleCleanup(plan.leftovers) })

	if !s.claim(lockNameFor(root, lockUninstallAny, layout.Channel.MutexName)) {
		host.FocusExisting()
		return 0
	}

	var cfg uninstall.Config
	cfg.Root, cfg.Version, cfg.Frame = root, config.Version, s.frame
	cfg.Dev, cfg.BestEffortFiles = !s.prod, plan.inPlace
	if s.opts.Quiet {
		return s.quietUninstall(cfg)
	}

	cfg.Exit = s.closeWindow
	rt, _ := s.bridgeWith(nil)
	runner := uninstall.New(cfg, s.sys, rt, s.log)
	return s.present("mode=uninstall", rt, runner, nil, s.headless("uninstalling without UI", func() int {
		_, err := runner.Run(s.opts.DeleteUserData, nil)
		if err == nil {
			return 0
		}
		winsys.ErrorBox(s.title, applog.Redact(i18n.F(s.lang, "uninstall-failed", err.Error(), s.logDir)))
		return 1
	}))
}

// quietUninstall — удаление без окна и без WebView2.
func (s *session) quietUninstall(cfg uninstall.Config) int {
	_, err := uninstall.New(cfg, s.sys, nil, s.log).Run(s.opts.DeleteUserData, nil)
	if err == nil {
		return 0
	}
	failure := bridge.AsError(err)
	s.note("quiet uninstall failed: %s %s", failure.Code, failure.Detail)
	if code, known := quietExitCodes[failure.Code]; known {
		return code
	}
	return 1
}

// scheduleCleanup заводит отложенное стирание остатков; сбой на код выхода не влияет.
func (s *session) scheduleCleanup(paths []string) {
	err := s.sys.ScheduleDelete(paths...)
	if err == nil {
		return
	}
	s.note("could not schedule the final cleanup: %v", err)
}

// planUninstall решает, где идёт удаление и что стереть при выходе.
//
//   - --from-temp: мы уже временная копия — стираем её папку и данные WebView2;
//   - exe лежит вне корня: стираем только данные WebView2;
//   - exe внутри корня и --quiet: удаление на месте, остатки — корень и данные WebView2;
//   - exe внутри корня, без --quiet: делаем копию во временной папке и уходим (handedOver),
//     остальное доделает она; не вышло — как в «на месте».
func (s *session) planUninstall(self, root string) (plan uninstallPlan) {
	withData := func(first ...string) []string { return append(first, s.dataDir) }
	switch {
	case s.opts.FromTemp:
		plan.leftovers = withData(filepath.Dir(self))
	case !within(self, root):
		plan.leftovers = withData()
	case s.opts.Quiet:
		plan.inPlace, plan.leftovers = true, withData(root)
	default:
		err := s.continueFromTempCopy(self, root)
		if err == nil {
			plan.handedOver = true
			return
		}
		s.note("could not run from a temp copy (%v): uninstalling in place", err)
		plan.inPlace, plan.leftovers = true, withData(root)
	}
	return
}

// continueFromTempCopy копирует установщик во временную папку и запускает копию с
// продолжением удаления: установщик, лежащий внутри корня, сам себя стереть не может.
// Не скопировалось — папка остаётся; не запустилось — папка стирается целиком.
func (s *session) continueFromTempCopy(self, root string) error {
	salt := make([]byte, 4)
	_, _ = rand.Read(salt)
	dir := filepath.Join(os.TempDir(), fmt.Sprintf("AstralBetaSetup-u-%x", salt))
	copied := filepath.Join(dir, setupExeName)

	err := pack.CopyFileAtomic(self, copied)
	if err == nil {
		if _, err = s.sys.Launch(copied, s.argsForCopy(root), ""); err != nil {
			_ = os.RemoveAll(dir)
		}
	}
	if err == nil {
		s.note("uninstall continues from %s", copied)
	}
	return err
}

// argsForCopy — аргументы копии. --quiet, --hidden и --selftest не передаются.
func (s *session) argsForCopy(root string) []string {
	o := s.opts
	args := argList{"--uninstall", "--from-temp", "--install-dir", root}
	args.when(o.DeleteUserData, "--delete-user-data")
	args.when(o.NativeFrame, "--native-frame")
	args.pair("--home", o.Home)
	args.pair("--sandbox", o.Sandbox)
	args.pair("--ui-dir", o.UIDir)
	args.pair("--api-origin", o.APIOrigin)
	args.pair("--drive", o.Drive)
	args.pair("--shots", o.Shots)
	return args
}

// ---------------------------------------------------------------------------------------
// Обновление и откат

func (s *session) runUpdate() int {
	o := s.opts
	if o.InstallDir == "" || o.Staging == "" {
		winsys.ErrorBox(s.title, "--apply-update needs --install-dir and --staging")
		return exitUsage
	}
	if !s.claimUpdate(o.InstallDir) {
		return 0
	}
	keys := ensured(s, releasekeys.Embedded)
	if s.keysMissing(keys) {
		return s.badBuildNoKeys()
	}

	var cfg update.Config
	cfg.Root, cfg.Staging, cfg.PID = o.InstallDir, o.Staging, o.Pid
	cfg.Launch, cfg.Version, cfg.Frame = o.Launch, config.Version, s.frame
	cfg.Dev, cfg.Keys, cfg.AllowUnsigned = !s.prod, keys, s.unsignedOK(keys)
	cfg.Exit, cfg.SetExitCode = s.closeWithResult, s.rememberResult

	if o.Quiet {
		runner := update.New(cfg, s.sys, nil, s.log)
		s.after(runner.Close)
		return runner.Wait().Code
	}
	rt, _ := s.bridgeWith(nil)
	runner := update.New(cfg, s.sys, rt, s.log)
	// Без окна применяет тот же раннер: второй начал бы работу заново, и замена прошла бы дважды.
	return s.present("mode=update", rt, runner, runner.Start,
		s.headless("applying the update without UI", func() int { return runner.Wait().Code }))
}

func (s *session) runRollback() int {
	o := s.opts
	if o.InstallDir == "" {
		winsys.ErrorBox(s.title, "--rollback-old needs --install-dir")
		return exitUsage
	}
	if !s.claimUpdate(o.InstallDir) {
		return 0
	}

	var cfg update.Config
	cfg.Root, cfg.PID, cfg.Launch = o.InstallDir, o.Pid, o.Launch
	cfg.Version, cfg.Dev = config.Version, !s.prod
	runner := update.New(cfg, s.sys, nil, s.log)
	s.after(runner.Close)

	outcome := runner.RollbackOld(context.Background())
	if failure := outcome.Err; failure != nil {
		s.note("rollback-old: %s: %s", failure.Code, failure.Detail)
	}
	return outcome.Code
}

// ---------------------------------------------------------------------------------------
// Запуск

// runLaunch чинит папки после прерванной замены и запускает app\Astral.exe. Ошибка починки
// только пишется в журнал: если лаунчер на месте, его всё равно пробуем запустить.
func (s *session) runLaunch() int {
	lay := layout.New(s.branchRoot())
	if err := update.RecoverLayout(lay, s.log); err != nil {
		s.note("recovery failed: %v", err)
	}
	if !lay.Installed() {
		return 1
	}
	_, err := s.sys.Launch(lay.Exe(), nil, lay.App())
	if err == nil {
		return 0
	}
	s.note("launch failed: %v", err)
	return 1
}

// ---------------------------------------------------------------------------------------
// Установка ветки рядом

// sideSource — корень установленной ветки, откуда берутся лицензия и привязка: --install-dir
// (без проверки) или папка этого exe, если она похожа на установленную ветку.
func (s *session) sideSource() string {
	if dir := s.opts.InstallDir; dir != "" {
		return dir
	}
	if self, err := s.sys.SelfExe(); err == nil {
		if dir := filepath.Dir(self); layout.New(dir).SafeToRemove() == nil {
			return dir
		}
	}
	return ""
}

func (s *session) runSideload() int {
	o := s.opts

	// Окон общей ошибки у этого режима нет; окно с причиной — только без --quiet.
	var problem, source string
	ch, known := layout.Parse(o.InstallChannel)
	switch {
	case !known, o.Staging == "":
		problem = msgSideNeedsBranch
	default:
		if source = s.sideSource(); source == "" {
			problem = msgSideNeedsFolder
		}
	}
	if problem != "" {
		s.note("%s", problem)
		if !o.Quiet {
			winsys.ErrorBox(s.title, applog.Redact(problem))
		}
		return exitUsage
	}
	target := layout.DefaultRoot(s.sys.LocalAppData(), ch)

	taken, err := s.tryLock(ch.MutexName())
	switch {
	case err != nil:
		s.note("fatal: %v", err)
		return 1
	case !taken:
		s.note("another installer is working on %s", ch)
		return 1
	}

	keys, err := releasekeys.Embedded()
	switch {
	case err != nil:
		s.note("fatal: %v", err)
		return 1
	case s.keysMissing(keys):
		s.note("bad build: no release keys to verify manifests")
		if !o.Quiet {
			s.badBuildNoKeys()
		}
		return exitBadBuild
	}

	var cfg sideload.Config
	cfg.Channel, cfg.Staging, cfg.Launch = ch, o.Staging, o.Launch
	cfg.SourceRoot, cfg.TargetRoot = source, target
	cfg.Version, cfg.Frame, cfg.Dev = config.Version, s.frame, !s.prod
	cfg.Keys, cfg.AllowUnsigned = keys, s.unsignedOK(keys)
	cfg.LicensePub = licenseKey(config.LicensePublicKey)
	cfg.Exit, cfg.SetExitCode = s.closeWithResult, s.rememberResult

	if o.Quiet {
		runner := sideload.New(cfg, s.sys, nil, s.log)
		s.after(runner.Close)
		return runner.Wait().Code
	}
	rt, _ := s.bridgeWith(nil)
	runner := sideload.New(cfg, s.sys, rt, s.log)
	return s.present("mode=side", rt, runner, runner.Start,
		s.headless("installing the branch without UI", func() int { return runner.Wait().Code }))
}
