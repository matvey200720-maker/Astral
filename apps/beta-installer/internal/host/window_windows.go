//go:build windows

// Package host держит окно установщика: окно Win32 с WebView2 внутри, раздачу
// вшитых файлов странице, мост между страницей и Go и цикл сообщений.
package host

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
)

import (
	"io/fs"
	"os"
	"runtime"
	"runtime/debug"
)

import (
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"
)

import (
	"github.com/jchv/go-webview2/pkg/edge"
	"github.com/jchv/go-webview2/webviewloader"
	"golang.org/x/sys/windows"
)

import (
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/applog"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/bridge"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/comutil"
)

// ErrWebViewFailed — Runtime стоит, но не поднялся.
var ErrWebViewFailed = errors.New("WebView2 is installed but did not start")

// ErrNoRuntime — на машине нет WebView2 Runtime.
var ErrNoRuntime = errors.New("WebView2 Runtime is not installed")

// WindowClass — имя класса окна; по нему второй экземпляр находит первый.
const WindowClass = "AstralBetaSetupWindow"

// className — то же имя в UTF-16 для вызовов Win32 (живёт до конца процесса).
var className = utf16p(WindowClass)

const defaultTitle, browserArgsVar = "Astral", "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"

const pageURL = bridge.Origin + "/index.html"

// Если страница так и не позвала init, окно покажет таймер.
const revealFallback = 3 * time.Second

// Options — всё, что нужно окну.
type Options struct {
	// CloseGuard — страж закрытия человеком; false оставляет окно открытым.
	CloseGuard func() bool
	// Router — мост (nil — окно без моста); Log — журнал (nil — молчит).
	Router *bridge.Router
	Log    applog.Logger
	// UI — вшитый интерфейс: index.html и его файлы.
	UI fs.FS
	// IconID — номер значка в ресурсах exe; 0 — общий значок.
	IconID uintptr
	// Размер клиентской области в CSS-пикселях.
	Height, Width int
	// Dev — меню, DevTools, акселераторы, диалоги скриптов; Silent — не
	// показывать окно; Trace — подробный журнал для разбора.
	Trace, Silent, Dev bool
	// Заголовок (пусто — «Astral»), рамка («custom» по умолчанию или «native»),
	// папка данных WebView2, параметры адреса страницы без «?», сценарий проверки
	// вида (исполняется в странице) и папка его снимков.
	ShotsDir, Drive, Query, DataDir, Frame, Title string
}

// Window — окно установщика. Создаётся и крутится на одном потоке ОС;
// из любой горутины безопасны Dispatch, Eval, Fit, Exit, Hwnd и SetExitCode.
type Window struct {
	// Очередь функций потока окна.
	mu    sync.Mutex
	queue []func()

	// Флаги и счётчики, доступные из любых горутин.
	driveOnce sync.Once
	exitCode  atomic.Int32
	blocked   atomic.Int32
	uiReady   atomic.Bool

	// То, что трогает только поток окна.
	shown    bool
	chromium *edge.Chromium
	hwnd     uintptr

	// Параметры, журнал и раздатчик вшитых файлов.
	assets *bridge.Assets
	log    applog.Logger
	opts   Options
}

// current — единственное окно процесса; без него оконная процедура ничего не делает.
var current atomic.Pointer[Window]

// wndProcPtr отдаёт обратный вызов оконной процедуры; он создаётся один раз.
var wndProcPtr = sync.OnceValue(func() uintptr { return windows.NewCallback(wndProc) })

// runSteps выполняет шаги по порядку и останавливается на первой ошибке.
func runSteps(steps ...func() error) (err error) {
	for i := 0; err == nil && i < len(steps); i++ {
		err = steps[i]()
	}
	return
}

// fallenOver — то, что осталось от паники: значение и стек вызовов.
type fallenOver struct {
	value any
	stack []byte
}

// catch выполняет f и возвращает описание паники, если она была.
func catch(f func()) (fell *fallenOver) {
	defer func() {
		if value := recover(); value != nil {
			fell = &fallenOver{value, debug.Stack()}
		}
	}()
	f()
	return nil
}

// withDefaults подставляет умолчания в копию параметров.
func withDefaults(o Options) Options {
	o.Log, o.Frame, o.Title = cmp.Or(o.Log, applog.Logger(applog.Nop{})), cmp.Or(o.Frame, "custom"), cmp.Or(o.Title, defaultTitle)
	return o
}

// runtimeVersion — версия установленного WebView2 Runtime или ошибка: нет
// Runtime — ErrNoRuntime как есть, отказ загрузчика — с обёрткой.
func runtimeVersion() (string, error) {
	version, err := webviewloader.GetInstalledVersion()
	switch {
	case err != nil:
		err = fmt.Errorf("detect WebView2: %w", err)
	case version == "":
		err = ErrNoRuntime
	}
	return version, err
}

// New создаёт скрытое окно с WebView2 и начинает грузить страницу. Вызывающая
// горутина закрепляется за потоком ОС насовсем: Run обязан идти на том же.
func New(opts Options) (*Window, error) {
	runtime.LockOSThread()
	// Нужен exe без манифеста с этим режимом; если режим уже задан, система
	// откажет, и это нормально.
	ask(pSetProcessDpiAwarenessContext, dpiPerMonitorV2)

	version, err := runtimeVersion()
	if err != nil {
		return nil, err
	}
	win := register(withDefaults(opts), version)
	if err = win.bringUp(); err != nil {
		win.abandon()
		return nil, err
	}
	return win, nil
}

// register заводит запись окна и делает её единственной в процессе.
func register(opts Options, version string) *Window {
	win := &Window{opts: opts, log: opts.Log, assets: &bridge.Assets{FS: WithFallback(opts.UI)}}
	win.log.Printf("WebView2 runtime %s", version)
	current.Store(win)
	return win
}

// bringUp создаёт окно и WebView2, привязывает мост и начинает грузить страницу.
func (w *Window) bringUp() error {
	if err := runSteps(w.createWindow, w.createWebView); err != nil {
		return err
	}
	for _, ready := range [...]func(){w.wire, w.enableDriver, w.chromium.Resize} {
		ready()
	}
	w.chromium.Navigate(w.url())
	return nil
}

// abandon снимает запись окна после неудачного старта. Порядок важен: при
// пустом current на WM_DESTROY процедура не зовёт PostQuitMessage, и в очереди
// потока не остаётся WM_QUIT, из-за которого следующий MessageBox вернулся бы сразу.
func (w *Window) abandon() {
	current.Store(nil)
	if w.hwnd != 0 {
		ask(pDestroyWindow, w.hwnd)
	}
}

// joinNonEmpty склеивает непустые части; все пустые — пустая строка.
func joinNonEmpty(sep string, parts ...string) string {
	return strings.Join(slices.DeleteFunc(parts, func(part string) bool { return part == "" }), sep)
}

// url — адрес страницы: сначала Query, потом frame=native.
func (w *Window) url() string {
	var frameParam string
	if w.opts.Frame == "native" {
		frameParam = "frame=native"
	}
	if query := joinNonEmpty("&", w.opts.Query, frameParam); query != "" {
		return pageURL + "?" + query
	}
	return pageURL
}

// styles — стили окна по режиму рамки. Окно не видимое, без WS_THICKFRAME и
// без кнопки «развернуть».
func (w *Window) styles() (style, ex uint32) {
	const shared = wsSysMenu | wsMinimizeBox | wsClipChildren | wsClipSiblings
	style, ex = wsPopup|shared, wsExAppWindow
	if w.opts.Frame == "native" {
		style, ex = wsCaption|shared, 0
	}
	return
}

// loadIcon берёт значок из ресурсов exe, а если его нет — общий значок Windows.
func (w *Window) loadIcon(inst uintptr) uintptr {
	const idiApplication = 32512
	if id := w.opts.IconID; id != 0 {
		if icon := ask(pLoadIconW, inst, id); icon != 0 {
			return icon
		}
	}
	return ask(pLoadIconW, 0, idiApplication)
}

// registerClass регистрирует класс окна. Он уже есть — это не ошибка
// (повторный запуск в одном процессе, тесты).
func registerClass(inst, icon uintptr) error {
	cls := &wndClassEx{
		Instance:   inst,
		Icon:       icon,
		IconSm:     icon,
		WndProc:    wndProcPtr(),
		Style:      csHRedraw | csVRedraw,
		ClassName:  className,
		Cursor:     ask(pLoadCursorW, 0, idcArrow),
		Background: ask(pCreateSolidBrush, rgb(10, 10, 11)), // фон #0a0a0b до первой отрисовки страницы; кисть живёт до выхода процесса
	}
	cls.Size = uint32(unsafe.Sizeof(*cls))
	switch got, last := askLast(pRegisterClassExW, uintptr(unsafe.Pointer(cls))); {
	case got != 0, errors.Is(last, windows.ERROR_CLASS_ALREADY_EXISTS):
		return nil
	default:
		return fmt.Errorf("RegisterClassEx: %w", last)
	}
}

// spawn создаёт окно 100×100 рядом с углом рабочей области того монитора, где
// стоит курсор: так оно с рождения получает DPI этого монитора. Созданное в
// (0, 0) при смешанных DPI оно унаследовало бы DPI основного, и расчёт размера
// вышел бы неверным.
func (w *Window) spawn(inst uintptr) (uintptr, error) {
	style, exStyle := w.styles()
	corner := workArea()
	const side = 100
	left, top := uintptr(int32(corner.x+20)), uintptr(int32(corner.y+20))
	// Строки превращаются в адреса прямо в вызове (см. ask).
	hwnd, last := askLast(pCreateWindowExW, uintptr(exStyle),
		uintptr(unsafe.Pointer(className)), uintptr(unsafe.Pointer(utf16p(w.opts.Title))),
		uintptr(style), left, top, side, side, 0, 0, inst, 0)
	if hwnd != 0 {
		return hwnd, nil
	}
	return 0, fmt.Errorf("CreateWindowEx: %w", last)
}

func (w *Window) createWindow() error {
	inst := ask(pGetModuleHandleW, 0)
	icon := w.loadIcon(inst)
	return runSteps(
		func() error { return registerClass(inst, icon) },
		func() (err error) { w.hwnd, err = w.spawn(inst); return },
		func() error {
			for _, kind := range [...]uintptr{iconBig, iconSmall} {
				if icon != 0 {
					ask(pSendMessageW, w.hwnd, wmSetIcon, kind, icon)
				}
			}
			w.effects()
			w.layout()
			return nil
		},
	)
}

// dwmAttr — пара «атрибут DWM — значение».
type dwmAttr struct{ id, value uint32 }

// effects красит и оформляет рамку. Ошибки DWM не важны: старая система
// просто не знает атрибута.
func (w *Window) effects() {
	apply := func(list ...dwmAttr) {
		for _, a := range list {
			dwmSet(w.hwnd, a.id, a.value)
		}
	}
	if w.opts.Frame == "native" {
		apply(
			dwmAttr{dwmwaUseImmersiveDarkMode, 1},
			dwmAttr{dwmwaCaptionColor, uint32(rgb(10, 10, 11))},    // #0a0a0b
			dwmAttr{dwmwaTextColor, uint32(rgb(0xf4, 0xf4, 0xf5))}, // #f4f4f5
		)
		return
	}
	apply(dwmAttr{dwmwaNCRenderingPolicy, dwmncrpEnabled})
	// Тень безрамочному окну даёт рамка в один пиксель, втянутая в клиентскую область.
	ask(pDwmExtendFrameIntoClientArea, w.hwnd, uintptr(unsafe.Pointer(&margins{1, 1, 1, 1})))
	apply(dwmAttr{dwmwaWindowCornerPref, dwmwcpRound})
}

// dpi — DPI окна; 0 (нет окна или старая система) считается за 96.
func (w *Window) dpi() uint32 {
	return cmp.Or(uint32(ask(pGetDpiForWindow, w.hwnd)), 96)
}

// scale переводит CSS-пиксели в физические с округлением «половина вверх».
func scale(v int, dpi uint32) int {
	return (96/2 + v*int(dpi)) / 96
}

// area — прямоугольник рабочей области монитора.
type area struct{ x, y, w, h int }

// packed — POINT значением в одном 64-битном аргументе: X внизу, Y вверху.
func (p point) packed() uintptr {
	return uintptr(uint64(uint32(p.Y))<<32 | uint64(uint32(p.X)))
}

// size — размер прямоугольника без положения.
func (r rect) size() (width, height int) {
	return int(r.Right) - int(r.Left), int(r.Bottom) - int(r.Top)
}

// asArea переводит прямоугольник Win32 в area.
func (r rect) asArea() area {
	width, height := r.size()
	return area{int(r.Left), int(r.Top), width, height}
}

// cursorPos — положение курсора на экране.
func cursorPos() (at point) {
	ask(pGetCursorPos, uintptr(unsafe.Pointer(&at)))
	return
}

// workArea — рабочая область монитора под курсором; при отказе системы 1280×720.
func workArea() area {
	cursor := cursorPos()
	info := monitorInfo{Size: uint32(unsafe.Sizeof(monitorInfo{}))}
	got := ask(pGetMonitorInfoW, ask(pMonitorFromPoint, cursor.packed(), monitorDefaultToNearest), uintptr(unsafe.Pointer(&info)))
	if got == 0 {
		return area{w: 1280, h: 720}
	}
	return info.Work.asArea()
}

// outerSize — внешний размер окна для клиентской области: у родной рамки к
// нему добавляются заголовок и границы.
func (w *Window) outerSize(client area, dpi uint32) area {
	if w.opts.Frame != "native" {
		return client
	}
	style, ex := w.styles()
	frame := rect{Right: int32(client.w), Bottom: int32(client.h)}
	ask(pAdjustWindowRectExForDpi, uintptr(unsafe.Pointer(&frame)), uintptr(style), 0, uintptr(ex), uintptr(dpi))
	grown := frame.asArea()
	return area{w: grown.w, h: grown.h}
}

// centered ставит окно размера size по центру комнаты room, уменьшив его, если оно не умещается.
func centered(size, room area) area {
	fit := area{w: min(size.w, room.w), h: min(size.h, room.h)}
	fit.x, fit.y = room.x+(room.w-fit.w)/2, room.y+(room.h-fit.h)/2
	return fit
}

// layout считает размер окна по DPI и ставит его по центру рабочей области.
// Итог всегда умещается в экран.
func (w *Window) layout() {
	dpi := w.dpi()
	want := w.outerSize(area{w: scale(w.opts.Width, dpi), h: scale(w.opts.Height, dpi)}, dpi)
	room := workArea()
	fit := centered(want, room)
	if want.w > room.w || want.h > room.h {
		w.log.Printf("the screen is smaller than the window: %dx%d wanted, %dx%d available (dpi %d)",
			want.w, want.h, room.w, room.h, dpi)
	}
	placeWindow(w.hwnd, int32(fit.x), int32(fit.y), int32(fit.w), int32(fit.h))
	w.log.Printf("window: client %dx%d css px, dpi %d, outer %dx%d at %d,%d",
		w.opts.Width, w.opts.Height, dpi, fit.w, fit.h, fit.x, fit.y)
}

// placeWindow двигает окно, не трогая порядок окон и не отнимая фокус.
func placeWindow(hwnd uintptr, x, y, width, height int32) {
	ask(pSetWindowPos, hwnd, 0, uintptr(x), uintptr(y), uintptr(width), uintptr(height), swpNoZOrder|swpNoActivate)
}

// refit применяет новую высоту клиентской области, если она изменилась.
func (w *Window) refit(cssHeight int) {
	if cssHeight == w.opts.Height {
		return
	}
	w.opts.Height = cssHeight
	w.layout()
}

// Fit подгоняет высоту клиентской области под страницу (из любой горутины).
func (w *Window) Fit(cssHeight int) {
	w.Dispatch(func() { w.refit(cssHeight) })
}

// trace пишет в журнал только при Options.Trace.
func (w *Window) trace(format string, args ...any) {
	if w.opts.Trace {
		w.log.Printf(format, args...)
	}
}

// extendBrowserArgs дописывает флаги Chromium к тому, что уже лежит в
// переменной окружения. SmartScreen выключен, чтобы он не ходил в сеть за
// проверкой внутреннего адреса; CalculateNativeWinOcclusion выключен всегда:
// на части машин Chromium принимал скрытое окно за закрытое другими и не
// рисовал страницу (белое окно у тестера 13.10). При сценарии проверки
// скрытое окно тоже обязано рисовать кадры.
func extendBrowserArgs(driving bool) {
	mine := "--disable-features=msSmartScreenProtection,CalculateNativeWinOcclusion"
	if driving {
		mine += " --disable-renderer-backgrounding --disable-backgrounding-occluded-windows"
	}
	_ = os.Setenv(browserArgsVar, joinNonEmpty(" ", os.Getenv(browserArgsVar), mine))
}

// attachTo подключает обратные вызовы окна к WebView2 и разрешает странице
// читать буфер обмена; всё остальное библиотека отклоняет.
func (w *Window) attachTo(ch *edge.Chromium) {
	ch.DataPath = w.opts.DataDir
	ch.NavigationCompletedCallback = w.onNavigated
	ch.WebResourceRequestedCallback = w.onResource
	ch.MessageCallback = w.onMessage
	ch.SetPermission(edge.CoreWebView2PermissionKindClipboardRead, edge.CoreWebView2PermissionStateAllow)
}

// darken красит фон WebView2 в цвет окна, чтобы не мигала белая вспышка.
func darken(ch *edge.Chromium) {
	if c2 := ch.GetController().GetICoreWebView2Controller2(); c2 != nil {
		_ = c2.PutDefaultBackgroundColor(edge.COREWEBVIEW2_COLOR{A: 255, R: 10, G: 10, B: 11})
	}
}

// createWebView поднимает WebView2 в уже созданном окне.
func (w *Window) createWebView() error {
	ch := edge.NewChromium()
	return runSteps(
		func() error {
			err := os.MkdirAll(w.opts.DataDir, 0o755)
			if err != nil {
				err = fmt.Errorf("WebView2 data folder: %w", err)
			}
			return err
		},
		func() error {
			extendBrowserArgs(w.opts.Drive != "")
			w.attachTo(ch)
			// Дескриптор нужен до Embed: во время него уже идут обратные вызовы.
			w.chromium = ch
			return embed(ch, w.hwnd)
		},
		func() error { w.tuneSettings(ch); darken(ch); return nil },
		// Без перехвата запросов окно пустило бы страницу в интернет, поэтому
		// отказ фильтра — отказ всего запуска.
		func() error {
			err := ch.AddWebResourceRequestedFilter("*", edge.COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL)
			if err != nil {
				err = fmt.Errorf("%w: request filter: %v", ErrWebViewFailed, err)
			}
			return err
		},
		func() error { ch.Init(bridge.ShimJS); return nil },
	)
}

// tuneSettings закрывает лишнее в WebView2; в dev-режиме часть возможностей включена.
func (w *Window) tuneSettings(ch *edge.Chromium) {
	st, err := ch.GetSettings()
	if err != nil {
		w.log.Printf("WebView2 settings are unavailable: %v", err)
		return
	}
	// Что включено только в dev-режиме, а что закрыто всегда — по порядку применения.
	put := [...]func(bool) error{
		st.PutAreDefaultContextMenusEnabled, st.PutAreDevToolsEnabled, st.PutIsStatusBarEnabled,
		st.PutIsZoomControlEnabled, st.PutAreBrowserAcceleratorKeysEnabled, st.PutIsBuiltInErrorPageEnabled,
		st.PutIsSwipeNavigationEnabled, st.PutIsPinchZoomEnabled, st.PutAreDefaultScriptDialogsEnabled,
	}
	devOnly := [len(put)]bool{0: true, 1: true, 4: true, 8: true}
	for i, setting := range put {
		_ = setting(devOnly[i] && w.opts.Dev)
	}
}

// guarded выполняет запуск WebView2, превращая панику библиотеки в ошибку
// с корнем ErrWebViewFailed.
func guarded(start func() error) (err error) {
	if fell := catch(func() { err = start() }); fell != nil {
		err = fmt.Errorf("%w: %v", ErrWebViewFailed, fell.value)
	}
	return
}

// embed вставляет WebView2 в окно. Отказ Embed — ошибка с причиной из
// библиотеки (или отсылкой к журналу).
func embed(ch *edge.Chromium, hwnd uintptr) error {
	return guarded(func() error {
		if ch.Embed(hwnd) {
			return nil
		}
		cause := ch.InitErr()
		if cause == nil {
			return fmt.Errorf("%w (see the log)", ErrWebViewFailed)
		}
		return fmt.Errorf("%w: %v", ErrWebViewFailed, cause)
	})
}

// isWebAddress — адрес http:// или https:// (без учёта регистра).
func isWebAddress(uri string) bool {
	lower := strings.ToLower(uri)
	return slices.ContainsFunc([]string{"http://", "https://"}, func(scheme string) bool {
		return strings.HasPrefix(lower, scheme)
	})
}

// onResource отвечает на каждый запрос страницы файлом из памяти или отказом 403.
func (w *Window) onResource(req *edge.ICoreWebView2WebResourceRequest, args *edge.ICoreWebView2WebResourceRequestedEventArgs) {
	w.answerRequest(req.GetUri, answerer{
		build: w.chromium.Environment().CreateWebResourceResponse,
		hand:  args.PutResponse,
		// Пустая страница вместо интерфейса лучше, чем запрос в интернет: переход
		// обрывает и этот запрос.
		stop: func() { w.chromium.Navigate("about:blank") },
	})
}

// answerRequest — тело onResource: адрес запроса берётся через readURI, ответ
// вручается через to. Вынесено из обратного вызова, чтобы проверяться без окна.
func (w *Window) answerRequest(readURI func() (string, error), to answerer) {
	uri, err := readURI()
	if err != nil {
		// Чей это запрос, неизвестно, а оставленный без ответа ушёл бы в сеть: отказ.
		// В blocked он не идёт: самопроверка считает по нему перехваченный чужой запрос.
		w.log.Printf("refusing a request whose address could not be read: %v", err)
		deliver(refusal, "a request with an unreadable address", to, w.log)
		return
	}
	// Адреса не http и не https (about:, data:, blob:) страница ведёт на своих схемах.
	if !isWebAddress(uri) {
		return
	}
	given, shown := w.assets.Serve(uri), applog.Redact(uri)
	if given.Status == 403 {
		w.blocked.Add(1)
		w.log.Printf("blocked request: %s", shown)
	}
	w.trace("serve %s -> %d (%d bytes)", shown, given.Status, len(given.Body))

	deliver(given, shown, to, w.log)
}

// answerer — два действия WebView2, из которых складывается ответ странице; вынесены
// в поля, чтобы порядок действий проверялся без окна.
type answerer struct {
	build func(body []byte, status int, reason, headers string) (*edge.ICoreWebView2WebResourceResponse, error)
	hand  func(response *edge.ICoreWebView2WebResourceResponse) error
	stop  func()
}

// offer собирает ответ и вручает его WebView2.
func (to answerer) offer(given bridge.Response, shown string) error {
	var built *edge.ICoreWebView2WebResourceResponse
	return runSteps(
		func() (err error) {
			built, err = to.build(given.Body, given.Status, given.Reason, given.HeaderString())
			if err != nil {
				err = fmt.Errorf("could not build a response for %s: %v", shown, err)
			}
			return
		},
		func() error {
			if err := to.hand(built); err != nil {
				return fmt.Errorf("could not hand the response for %s to WebView2: %v", shown, err)
			}
			return nil
		},
	)
}

// refusal — самый простой ответ, который ещё можно собрать: пустой 403 без заголовков.
var refusal = bridge.Response{Status: 403, Reason: "Forbidden"}

// deliver отвечает на запрос страницы. Запрос, оставшийся без ответа, WebView2 отправил
// бы в сеть, а окно установщика в сеть не ходит, поэтому при отказе сборки или вручения
// отдаётся пустой 403, а если не выходит и он, страницу останавливают.
func deliver(given bridge.Response, shown string, to answerer, log applog.Logger) {
	failure := to.offer(given, shown)
	if failure == nil {
		return
	}
	log.Printf("%v", failure)
	if failure = to.offer(refusal, shown); failure == nil {
		log.Printf("answered %s with an empty 403 instead", shown)
		return
	}
	log.Printf("%v; the request cannot be left to the network, stopping the page", failure)
	to.stop()
}

// navFact читает один 32-битный факт о завершённом переходе: слот 3 —
// IsSuccess, слот 4 — WebErrorStatus. Первым идёт HRESULT вызова.
func navFact(args *edge.ICoreWebView2NavigationCompletedEventArgs, slot int) (hr, value int32) {
	hr = comutil.Call(unsafe.Pointer(args), slot, uintptr(unsafe.Pointer(&value)))
	return
}

// onNavigated разбирает итог перехода.
func (w *Window) onNavigated(_ *edge.ICoreWebView2, args *edge.ICoreWebView2NavigationCompletedEventArgs) {
	hr, success := navFact(args, 3)
	w.trace("navigation completed: hr=%#x success=%d", uint32(hr), success)
	if hr < 0 {
		return
	}
	if success != 0 {
		w.startDriver()
		return
	}
	w.navigationFailed(args)
}

// navigationFailed пишет код отказа страницы и показывает окно: хотя бы
// пустое, чтобы человек что-то увидел.
func (w *Window) navigationFailed(args *edge.ICoreWebView2NavigationCompletedEventArgs) {
	_, status := navFact(args, 4)
	w.log.Printf("navigation failed: web error status %d", status)
	w.reveal()
}

// onMessage передаёт сообщение страницы мосту.
func (w *Window) onMessage(raw string) {
	w.trace("page message: %d bytes", len(raw))
	if router := w.opts.Router; router != nil {
		router.Dispatch(raw, w.reply)
	}
}

// encodeReply строит скрипт ответа странице. Если ответ не кодируется, в
// скрипте INTERNAL с причиной (пусто — не закодировалось и это).
func encodeReply(id int64, ok bool, payload any) string {
	script, err := bridge.ReplyScript(id, ok, payload)
	if err == nil {
		return script
	}
	script, _ = bridge.ReplyScript(id, false,
		&bridge.Error{Code: "INTERNAL", Detail: "response could not be encoded: " + err.Error()})
	return script
}

// reply доставляет странице ответ на её вызов.
func (w *Window) reply(id int64, ok bool, payload any) {
	if script := encodeReply(id, ok, payload); script != "" {
		w.Eval(script)
	}
}

// emit доставляет странице событие моста.
func (w *Window) emit(event string, data any) {
	switch script, err := bridge.EventScript(event, data); err {
	case nil:
		w.Eval(script)
	default:
		w.log.Printf("event %s was not delivered: %v", event, err)
	}
}

// observe следит за вызовами страницы: init значит «интерфейс готов».
// Наблюдатель видит только известные методы, поэтому init должен быть
// зарегистрирован кодом вне этого файла.
func (w *Window) observe(method string) {
	if method != "init" {
		return
	}
	w.uiReady.Store(true)
	w.Dispatch(w.reveal)
}

// wire привязывает мост к окну (если мост есть).
func (w *Window) wire() {
	router := w.opts.Router
	if router == nil {
		return
	}
	router.SetEmitter(w.emit)
	router.SetObserver(w.observe)

	actions := [...]func(){
		func() { w.beginDrag() },
		func() { ask(pShowWindow, w.hwnd, swMinimize) },
		func() { postMessage(w.hwnd, wmClose, 0, 0) },
	}
	for i, method := range [...]string{"windowDrag", "windowMinimize", "windowClose"} {
		router.HandleSync(method, func(context.Context, json.RawMessage) (any, error) {
			actions[i]()
			return nil, nil
		})
	}
}

// beginDrag запускает перетаскивание окна без рамки: система думает, что
// человек нажал на заголовок.
func (w *Window) beginDrag() {
	ask(pReleaseCapture)
	at := cursorPos()
	where := makeLParam(at.X, at.Y)
	postMessage(w.hwnd, wmNCLButtonDown, htCaption, where)
}

// put ставит функцию в очередь потока окна.
func (w *Window) put(f func()) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.queue = append(w.queue, f)
}

// takeAll забирает всю очередь и очищает её.
func (w *Window) takeAll() (batch []func()) {
	w.mu.Lock()
	defer w.mu.Unlock()
	batch, w.queue = w.queue, nil
	return
}

// Dispatch ставит функцию в очередь потока окна. Каждой функции — своё
// сообщение, без слияния. Если окна уже нет, функция не выполнится.
func (w *Window) Dispatch(f func()) {
	defer postMessage(w.hwnd, wmDispatch, 0, 0)
	w.put(f)
}

// drain выполняет всё, что накопилось. Паника одной функции пишется в журнал и
// остальным не мешает.
func (w *Window) drain() {
	for _, f := range w.takeAll() {
		if fell := catch(f); fell != nil {
			w.log.Printf("panic in a dispatched function: %v\n%s", fell.value, fell.stack)
		}
	}
}

// Hwnd — дескриптор окна.
func (w *Window) Hwnd() (handle uintptr) {
	handle = w.hwnd
	return
}

// evalIn готовит выполнение скрипта в странице; chromium берётся в момент вызова.
func (w *Window) evalIn(script string) func() {
	return func() { w.chromium.Eval(script) }
}

// Eval выполняет скрипт в странице (на потоке окна).
func (w *Window) Eval(script string) { w.Dispatch(w.evalIn(script)) }

// SetExitCode запоминает код, который вернёт Run, как бы окно ни закрылось.
func (w *Window) SetExitCode(code int) { _ = w.exitCode.Swap(int32(code)) }

// Exit запоминает код и закрывает окно мимо стража закрытия.
func (w *Window) Exit(code int) {
	defer postMessage(w.hwnd, wmExit, 0, 0)
	w.SetExitCode(code)
}

// browser зовёт f, если WebView2 уже создан (окно рождается раньше него).
func (w *Window) browser(f func(*edge.Chromium)) {
	if c := w.chromium; c != nil {
		f(c)
	}
}

// mayReveal — можно ли показывать окно сейчас: оно ещё не показано, не молчит
// и не окно проверки вида на рабочем столе человека.
func (w *Window) mayReveal() bool {
	switch {
	case w.shown || w.opts.Silent:
		return false
	case w.opts.Drive != "" && strings.EqualFold(desktopName(), "Default"):
		w.log.Printf("drive: the window stays hidden on the default desktop")
		return false
	}
	return true
}

// reveal показывает окно. Зовётся на потоке окна: по init от страницы, по
// запасному таймеру и после неудачного перехода.
func (w *Window) reveal() {
	if !w.mayReveal() {
		return
	}
	w.shown = true
	// Именно SW_SHOW, а не SW_SHOWNORMAL: первый ShowWindow за процесс
	// получает режим из STARTUPINFO, а лаунчер на Node запускает установщик
	// «скрытым». С режимом 5 окно всё равно появляется (Windows 11). Не менять
	// без прогона TestRevealIgnoresTheLaunchersHideRequest.
	ask(pShowWindow, w.hwnd, swShow)
	ask(pSetForegroundWindow, w.hwnd)
	w.browser(func(c *edge.Chromium) {
		c.Focus()
		// Переключение видимости заставляет Chromium заново узнать, что окно
		// показано; без него оставалось белое окно (тестер 13.10).
		_ = c.Hide()
		_ = c.Show()
		c.Resize()
		_ = c.NotifyParentWindowPositionChanged()
	})
}

// pump крутит цикл сообщений потока, пока приходят обычные сообщения;
// WM_QUIT или сломанная очередь — конец.
func pump() {
	m := new(msg)
	for int32(ask(pGetMessageW, uintptr(unsafe.Pointer(m)), 0, 0, 0)) > 0 {
		for _, step := range [...]*windows.LazyProc{pTranslateMessage, pDispatchMessageW} {
			ask(step, uintptr(unsafe.Pointer(m)))
		}
	}
}

// Run крутит цикл сообщений до закрытия окна и возвращает сохранённый код
// выхода (а не параметр WM_QUIT).
func (w *Window) Run() int {
	if !w.opts.Silent {
		// Запасной путь показа, если страница так и не позвала init. Таймер не
		// останавливается: после выхода его вызов уйдёт в никуда.
		time.AfterFunc(revealFallback, func() { w.Dispatch(w.reveal) })
	}
	pump()
	return int(w.exitCode.Load())
}

// FocusExisting поднимает уже открытое окно установщика. Находит и скрытое.
func FocusExisting() bool {
	other := ask(pFindWindowW, uintptr(unsafe.Pointer(className)), 0)
	switch {
	case other == 0:
		return false
	case ask(pIsIconic, other) != 0:
		ask(pShowWindow, other, swRestore)
		fallthrough
	default:
		ask(pSetForegroundWindow, other)
		return true
	}
}

// defaultProc отдаёт сообщение системной обработке по умолчанию.
func defaultProc(hwnd, m, wp, lp uintptr) uintptr {
	return ask(pDefWindowProcW, hwnd, m, wp, lp)
}

// closeAllowed — можно ли закрыть окно, когда его закрывает человек. Пока
// интерфейс не позвал init, решение за самим хостом: закрываем без вопросов.
func (w *Window) closeAllowed() bool {
	if w.opts.CloseGuard == nil || !w.uiReady.Load() {
		return true
	}
	return w.opts.CloseGuard()
}

// messageHandler — реакция окна на одно сообщение; результат уходит системе.
type messageHandler func(w *Window, hwnd, wp, lp uintptr) uintptr

// handled оборачивает действие, после которого процедура возвращает 0.
func handled(action func(w *Window, hwnd, wp, lp uintptr)) messageHandler {
	return func(w *Window, hwnd, wp, lp uintptr) uintptr {
		action(w, hwnd, wp, lp)
		return 0
	}
}

// follow сообщает WebView2, что окно сдвинулось (всплывающим окнам браузера
// нужны свежие координаты).
var follow = handled(func(w *Window, _, _, _ uintptr) {
	w.browser(func(c *edge.Chromium) { _ = c.NotifyParentWindowPositionChanged() })
})

// messageTable — реакции окна по номеру сообщения; всё, чего здесь нет, идёт в
// DefWindowProcW. Обработчики терпят chromium == nil (окно создаётся раньше
// WebView2).
var messageTable = map[uint32]messageHandler{
	// Фон рисует Chromium.
	wmEraseBkgnd: func(*Window, uintptr, uintptr, uintptr) uintptr { return 1 },

	wmSize: handled(func(w *Window, _, _, _ uintptr) { w.browser((*edge.Chromium).Resize) }),

	wmMove:   follow,
	wmMoving: follow,

	wmActivate: handled(func(w *Window, _, wp, _ uintptr) {
		if uint16(wp) != waInactive {
			w.browser((*edge.Chromium).Focus)
		}
	}),

	// lParam — прямоугольник, выделенный системой. Размер в CSS-пикселях заново
	// не считается: окно просто встаёт туда, куда сказано. Нулевой lParam даёт
	// панику, её ловит общий щит.
	wmDpiChanged: handled(func(_ *Window, hwnd, _, lp uintptr) {
		suggested := (*(*rect)(unsafe.Add(nil, lp))).asArea()
		placeWindow(hwnd, int32(suggested.x), int32(suggested.y), int32(suggested.w), int32(suggested.h))
	}),

	wmDispatch: handled(func(w *Window, _, _, _ uintptr) { w.drain() }),

	wmClose: handled(func(w *Window, hwnd, _, _ uintptr) {
		if w.closeAllowed() {
			ask(pDestroyWindow, hwnd)
		}
	}),

	wmExit: handled(func(_ *Window, hwnd, _, _ uintptr) { ask(pDestroyWindow, hwnd) }),

	wmDestroy: handled(func(w *Window, _, _, _ uintptr) {
		ask(pPostQuitMessage, uintptr(w.exitCode.Load()))
	}),
}

// route отдаёт сообщение его обработчику из таблицы или системе.
func (w *Window) route(hwnd, m, wp, lp uintptr) uintptr {
	if handle, known := messageTable[uint32(m)]; known {
		return handle(w, hwnd, wp, lp)
	}
	return defaultProc(hwnd, m, wp, lp)
}

// wndProc — оконная процедура. Паника внутри не должна падать в систему:
// она пишется в журнал, результат 0.
func wndProc(hwnd, m, wp, lp uintptr) (ret uintptr) {
	w := current.Load()
	if w == nil {
		return defaultProc(hwnd, m, wp, lp)
	}
	if fell := catch(func() { ret = w.route(hwnd, m, wp, lp) }); fell != nil {
		w.log.Printf("panic in the window procedure (message %#x): %v\n%s", uint32(m), fell.value, fell.stack)
		ret = 0
	}
	return
}
