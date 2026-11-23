//go:build windows

package host

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"slices"
	"strings"
	"testing/fstest"
	"time"
	"unsafe"

	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/applog"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/bridge"
)

// SelfTestReport — итог самопроверки: то, что прислала страница, то, что
// измерил хост, и список провалов. Порядок полей задаёт порядок ключей в JSON.
type SelfTestReport struct {
	Pass     bool           `json:"pass"`
	Failures []string       `json:"failures"`
	Page     map[string]any `json:"page"`
	Host     map[string]any `json:"host"`
}

// ReportSummary — одна строка для журнала.
func (r *SelfTestReport) ReportSummary() string {
	if !r.Pass {
		return "selftest: FAIL: " + strings.Join(r.Failures, "; ")
	}
	return "selftest: PASS"
}

// echoText — строка, которую страница гоняет через мост туда и обратно.
// Между «привет» и «</script>» стоит U+2028 (LINE SEPARATOR): так проверяется,
// что кодирование JSON в мосту не ломает скрипт, который хост вставляет в
// страницу. Обычные пробелы вместо него сверку обязаны провалить.
const echoText = "привет   </script> \"кавычки\""

// selfTestPage — index.html вшитого интерфейса самопроверки. Исполняется в
// WebView2: модуль (верхний await), несколько «стадий» в обход моста, затем
// проверки по очереди и итог через selftest.done. В скрипте «</script>»
// записано с обратной косой, иначе тег закрыл бы скрипт досрочно, а U+2028
// набран JS-экранированием.
const selfTestPage = `<!doctype html><meta charset="utf-8"><title>selftest</title>
<body style="background:#0a0a0b;color:#f4f4f5;font:15px system-ui">Astral Beta selftest
<script type="module">
// Стадия идёт двумя путями, оба необязательны: запросом на хост (останется в
// журнале как serve .../__stage/... -> 404) и сообщением прямо в канал
// WebView2, мимо шима моста.
const stage = (s) => {
  try { fetch('/__stage/' + encodeURIComponent(String(s))).catch(() => {}); } catch (e) {}
  try {
    window.chrome.webview.postMessage(JSON.stringify({ id: 0, m: 'selftest.stage', p: { s: String(s) } }));
  } catch (e) {}
};
window.addEventListener('error', (e) => stage('error: ' + e.message));
window.addEventListener('unhandledrejection', (e) => stage('rejection: ' + e.reason));
stage('start webview=' + typeof (window.chrome && window.chrome.webview));

const result = { errors: [] };
try {
  result.bridgeType = typeof window.astralBridge;
  stage('bridge ' + result.bridgeType);
  result.bridgeVersion = window.astralBridge && window.astralBridge.version;
  result.origin = location.origin;
  result.inner = [innerWidth, innerHeight];
  result.dpr = devicePixelRatio;
  result.userAgent = navigator.userAgent;

  result.echo = await astralBridge.call('selftest.echo', { n: 1, s: 'привет   <\/script> "кавычки"' });
  result.unknownMethod = await astralBridge.call('no.such.method', {}).then(() => 'resolved', (err) => err && err.code);

  result.event = await new Promise((resolve) => {
    const off = astralBridge.on('selftest.pong', (data) => { off(); resolve(data); });
    astralBridge.call('selftest.ping', { v: 42 }).catch(() => {});
  });
  stage('event');

  result.ownFile = (await fetch('/ping.txt').then((x) => x.text())).trim();
  result.moduleValue = (await import('/mod.js')).value;
  stage('module ' + result.moduleValue);

  result.dataUri = await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve('ok');
    img.onerror = () => resolve('failed');
    img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=';
  });

  result.foreign = await fetch('https://example.com/probe').then(() => 'answered', () => 'failed');
  stage('foreign ' + result.foreign);

  result.fontsReady = await document.fonts.ready.then(() => true);
} catch (err) {
  result.errors.push(String(err));
}
stage('done');
await astralBridge.call('selftest.done', result);
</script>`

// Допуск сверки ширины страницы с шириной клиентской области, CSS-пиксели.
const widthTolerance = 2

// selfTestTimeout — сколько ждём итог страницы.
const selfTestTimeout = 25 * time.Second

// abs — модуль числа.
func abs(f float64) float64 { return math.Abs(f) }

// finding — одна проверка сверки: выполнена ли она и что сказать, если нет.
type finding struct {
	holds func() bool
	text  func() string
}

// measureHost снимает то, что хост знает о своём окне.
func (w *Window) measureHost() (client rect, dpi uint32, blocked int32) {
	dpi, blocked = w.dpi(), w.blocked.Load()
	ask(pGetClientRect, w.hwnd, uintptr(unsafe.Pointer(&client)))
	return
}

// evaluate сверяет итог страницы с ожидаемым. Страница nil (ничего не
// прислала) провалов не даёт: об этом позаботится таймер в RunSelfTest.
func (w *Window) evaluate(page map[string]any) *SelfTestReport {
	client, dpi, blocked := w.measureHost()
	rep := new(SelfTestReport)
	rep.Page = page
	rep.Host = make(map[string]any, 4)
	rep.Host["frame"] = w.opts.Frame
	rep.Host["dpi"] = dpi
	rep.Host["clientPx"] = []int32{client.Right, client.Bottom}
	rep.Host["blockedRequests"] = blocked
	if page != nil {
		rep.Failures = append(rep.Failures, failedTexts(pageChecks(page, client, dpi, blocked))...)
	}
	return rep
}

// failedTexts — сообщения провалившихся проверок, в порядке проверок.
func failedTexts(checks []finding) (texts []string) {
	for _, check := range checks {
		if !check.holds() {
			texts = append(texts, check.text())
		}
	}
	return
}

// pageChecks — проверки итога страницы по порядку; каждая провалившаяся даёт
// одно сообщение.
func pageChecks(page map[string]any, client rect, dpi uint32, blocked int32) []finding {
	var checks []finding
	add := func(holds func() bool, text func() string) { checks = append(checks, finding{holds, text}) }
	// «Поле равно ожиданию, иначе сообщение с тем, что пришло».
	sameAs := func(key string, want any, lead string) {
		add(func() bool { return page[key] == want }, func() string { return lead + fmt.Sprint(page[key]) })
	}
	// Вложенный объект страницы; не объект — как будто его нет.
	nested := func(key string) map[string]any {
		obj, _ := page[key].(map[string]any)
		return obj
	}

	add(
		func() bool { list, _ := page["errors"].([]any); return len(list) == 0 },
		func() string { return "page errors: " + fmt.Sprint(page["errors"]) },
	)
	add(
		func() bool { return page["bridgeType"] == "object" && page["bridgeVersion"] == float64(1) },
		func() string {
			return fmt.Sprintf("astralBridge missing or wrong version: %v / %v", page["bridgeType"], page["bridgeVersion"])
		},
	)
	sameAs("origin", bridge.Origin, "origin = ")
	add(
		func() bool {
			echo := nested("echo")
			return echo != nil && echo["n"] == float64(1) && echo["s"] == echoText
		},
		func() string { return "echo did not round-trip: " + fmt.Sprint(page["echo"]) },
	)
	sameAs("unknownMethod", "UNSUPPORTED", "unknown method gave ")
	add(
		func() bool { ev := nested("event"); return ev != nil && ev["v"] == float64(42) },
		func() string { return "event from the host did not arrive: " + fmt.Sprint(page["event"]) },
	)
	sameAs("ownFile", "pong-file", "own file served wrongly: ")
	sameAs("moduleValue", float64(7), "ES module import failed: ")
	sameAs("dataUri", "ok", "data: image failed: ")
	add(
		func() bool { return blocked >= 1 },
		func() string {
			return fmt.Sprintf("a foreign request was not intercepted (blocked = %d, page saw %v)", blocked, page["foreign"])
		},
	)

	// Ширина страницы должна быть шириной клиентской области в CSS-пикселях.
	// Тип inner[0] не проверяется: чужой тип — паника, её ловит роутер.
	if inner, _ := page["inner"].([]any); len(inner) == 2 {
		scale := float64(dpi) / 96
		expected := float64(client.Right) / scale
		add(
			func() bool { return abs(inner[0].(float64)-expected) <= widthTolerance },
			func() string {
				return fmt.Sprintf("page width %v css px, window client %d px at dpi %d (expected ≈ %.0f)", inner[0], client.Right, dpi, expected)
			},
		)
	}
	return checks
}

// writeSelfTest кладёт отчёт в файл. Ошибки глотаются: папка не создаётся, а
// отчёт, который некуда писать, ничего не ломает.
func writeSelfTest(path string, rep *SelfTestReport) {
	if rep.Failures == nil {
		rep.Failures = []string{}
	}
	data, err := json.MarshalIndent(rep, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(path, append(data, '\n'), 0o644)
}

// selfTestFiles — вшитый интерфейс самопроверки: страница и два файла для неё.
func selfTestFiles() fstest.MapFS {
	files := make(fstest.MapFS, 3)
	for name, body := range map[string]string{
		"index.html": selfTestPage,
		"ping.txt":   "pong-file\n",
		"mod.js":     "export const value = 7;\n",
	} {
		files[name] = &fstest.MapFile{Data: []byte(body)}
	}
	return files
}

// selfRun — один прогон самопроверки: окно, мост и куда писать отчёт.
type selfRun struct {
	w      *Window
	router *bridge.Router
	log    applog.Logger
	out    string
}

// finish — общий конец для ответа страницы и таймера: сверка, отчёт, закрытие
// окна (код 0 при успехе, 1 при провале).
func (r *selfRun) finish(page map[string]any, extra ...string) {
	rep := r.w.evaluate(page)
	rep.Failures = slices.Concat(rep.Failures, extra)
	rep.Pass = len(rep.Failures) == 0
	writeSelfTest(r.out, rep)
	r.w.Exit(selfExitCode(rep.Pass))
}

// selfExitCode — код выхода процесса самопроверки: 0 при успехе, 1 при провале.
func selfExitCode(pass bool) int {
	if pass {
		return 0
	}
	return 1
}

// stage пишет в журнал, до какой стадии дошла страница (ошибка разбора — пустая стадия).
func (r *selfRun) stage(msg struct {
	S string `json:"s"`
}, _ error) (any, error) {
	r.log.Printf("selftest page: %s", msg.S)
	return nil, nil
}

// echo возвращает присланное как есть.
func (r *selfRun) echo(v any, _ error) (any, error) { return v, nil }

// ping отвечает событием selftest.pong с теми же данными.
func (r *selfRun) ping(data map[string]any, _ error) (any, error) {
	r.router.Emit("selftest.pong", data)
	return nil, nil
}

// done принимает итог страницы.
func (r *selfRun) done(page map[string]any, _ error) (any, error) {
	r.finish(page)
	return nil, nil
}

// RunSelfTest поднимает скрытое окно с тестовой страницей, ждёт её итог,
// пишет отчёт в outPath и закрывает окно. Результат — код выхода процесса:
// 0 при успехе, 1 при провале.
func RunSelfTest(outPath, dataDir, frame string, log applog.Logger) int {
	router := bridge.NewRouter(context.Background(), log)
	w, err := New(selfTestOptions(frame, dataDir, router, log))
	if err == nil {
		return (&selfRun{w: w, router: router, log: log, out: outPath}).drive()
	}
	writeSelfTest(outPath, &SelfTestReport{Failures: []string{"window: " + err.Error()}})
	return 1
}

// selfTestOptions — параметры скрытого окна самопроверки: тихое, с трассой и вшитым интерфейсом.
func selfTestOptions(frame, dataDir string, router *bridge.Router, log applog.Logger) Options {
	opts := Options{Frame: frame, DataDir: dataDir, Width: 960, Height: 600}
	opts.UI, opts.Router, opts.Log, opts.Silent, opts.Trace = selfTestFiles(), router, log, true, true
	return opts
}

// drive ставит обработчики страницы самопроверки, заводит таймер и ведёт окно до конца.
func (r *selfRun) drive() int {
	// Обработчики ставятся после New: страница уже грузится, а цикл сообщений
	// ещё не идёт, так что гонки нет.
	install(r.router,
		route{"selftest.stage", true, adapt(r.stage)},
		route{"selftest.echo", false, adapt(r.echo)},
		route{"selftest.ping", false, adapt(r.ping)},
		route{"selftest.done", false, adapt(r.done)},
	)
	time.AfterFunc(selfTestTimeout, func() {
		r.finish(nil, "timeout: the test page never finished")
	})
	return r.w.Run()
}
