//go:build windows

package host

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
)

import (
	"os"
	"path/filepath"
	"regexp"
	"time"
)

import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/bridge"

// Режим проверки вида интерфейса без видимых окон (только dev). После первой
// удачной загрузки страницы хост исполняет в ней сценарий Options.Drive; тот
// управляет интерфейсом как человек и просит хост снять картинку окна —
// снимает сам WebView2, поэтому видимое окно не нужно.

// shotName — допустимое имя снимка: 1–80 знаков из A-Z a-z 0-9 . _ -.
// Косых черт, пробелов и кириллицы нет, так что выйти из папки снимков нельзя.
var shotName = regexp.MustCompile(`^[A-Za-z0-9._-]{1,80}$`)

// Сколько ждём поток окна: в dev.state — его ответ, в dev.shot — готовый снимок.
const (
	stateReplyWait = 5 * time.Second
	shotWait       = 30 * time.Second
)

// loose разбирает параметры вызова в T; что не разобралось, остаётся нулевым,
// а ошибку разбора вызывающий вправе не смотреть.
func loose[T any](raw json.RawMessage) (T, error) {
	var parsed T
	err := json.Unmarshal(raw, &parsed)
	return parsed, err
}

// adapt делает обработчик моста из функции над разобранными параметрами
// (ошибка разбора отдаётся вторым аргументом, можно не смотреть).
func adapt[T any](fn func(params T, parseErr error) (any, error)) bridge.Handler {
	return func(_ context.Context, raw json.RawMessage) (any, error) {
		return fn(loose[T](raw))
	}
}

// route — один метод моста: имя, где исполняется (в потоке вызова или в своей
// горутине) и обработчик.
type route struct {
	method string
	inline bool
	run    bridge.Handler
}

// install регистрирует методы на роутере в заданном порядке.
func install(router *bridge.Router, routes ...route) {
	for _, r := range routes {
		register := router.Handle
		if r.inline {
			register = router.HandleSync
		}
		register(r.method, r.run)
	}
}

// onWindowThread отдаёт start поток окна и ждёт до wait значение, которое тот
// передаст в deliver (можно позже, из обратного вызова на том же потоке).
// false — не дождались.
func onWindowThread[T any](w *Window, wait time.Duration, start func(deliver func(T))) (T, bool) {
	slot := make(chan T, 1) // буфер: опоздавший ответ после таймаута не застрянет
	w.Dispatch(func() { start(func(v T) { slot <- v }) })
	select {
	case v := <-slot:
		return v, true
	case <-time.After(wait):
		var none T
		return none, false
	}
}

// enableDriver регистрирует методы моста сценария. Без сценария или без моста
// их нет, и dev.* получает UNSUPPORTED.
func (w *Window) enableDriver() {
	if router := w.opts.Router; router != nil && w.opts.Drive != "" {
		install(router,
			route{"dev.log", true, adapt(w.devLog)},
			route{"dev.exit", true, adapt(w.devExit)},
			route{"dev.state", false, w.hState},
			route{"dev.shot", false, w.hShot},
		)
	}
}

// devLog пишет строку сценария в журнал; ошибка разбора даёт пустой текст.
func (w *Window) devLog(line struct {
	Text string `json:"text"`
}, _ error) (any, error) {
	w.log.Printf("drive: %s", line.Text)
	return nil, nil
}

// devExit закрывает окно с кодом из параметров; не число или нет поля — код 0.
func (w *Window) devExit(req struct {
	Code int `json:"code"`
}, _ error) (any, error) {
	w.Exit(req.Code)
	return nil, nil
}

// hState отвечает, видно ли окно и на каком оно рабочем столе. Данные читает
// поток окна.
func (w *Window) hState(context.Context, json.RawMessage) (any, error) {
	state, answered := onWindowThread(w, stateReplyWait, func(deliver func(map[string]any)) {
		deliver(map[string]any{
			"uiReady":       w.uiReady.Load(),
			"shown":         w.shown,
			"windowVisible": ask(pIsWindowVisible, w.hwnd) != 0,
			"desktop":       desktopName(),
		})
	})
	if answered {
		return state, nil
	}
	return nil, errors.New("the window thread did not answer")
}

// shotPath готовит папку снимков и отдаёт путь файла <ShotsDir>\<имя>.png.
func (w *Window) shotPath(name string) (string, error) {
	dir := w.opts.ShotsDir
	if dir == "" {
		return "", bridge.Errf("INVALID_STATE", false, "no folder for the screenshots")
	}
	err := os.MkdirAll(dir, 0o755)
	return filepath.Join(dir, name+".png"), err
}

// describeShot отвечает странице путём и размером готового снимка.
func (w *Window) describeShot(name, file string) (any, error) {
	st, err := os.Stat(file)
	if err != nil {
		return nil, err
	}
	w.log.Printf("drive: screenshot %s (%d bytes)", name, st.Size())
	return map[string]any{"path": file, "bytes": st.Size()}, nil
}

// hShot снимает картинку окна в <ShotsDir>\<имя>.png и отвечает путём и размером.
// Если снимок не удался или окно не готово, пустой .png может остаться на диске:
// файл создаёт библиотека до постановки снимка.
func (w *Window) hShot(_ context.Context, p json.RawMessage) (any, error) {
	want, parseErr := loose[struct {
		Name string `json:"name"`
	}](p)
	if parseErr != nil || !shotName.MatchString(want.Name) {
		return nil, bridge.Errf("INVALID_ARGUMENT", false, "dev.shot needs a plain file name")
	}
	file, err := w.shotPath(want.Name)
	if err != nil {
		return nil, err
	}

	failure, finished := onWindowThread(w, shotWait, func(deliver func(error)) {
		// Не поставился — обратного вызова не будет, об этом скажем сами.
		if err := w.chromium.CapturePreviewFile(file, deliver); err != nil {
			deliver(err)
		}
	})
	if !finished {
		return nil, fmt.Errorf("the screenshot %s was not finished in time", want.Name)
	}
	if failure != nil {
		return nil, failure
	}
	return w.describeShot(want.Name, file)
}

// runScenario исполняет сценарий в странице; срабатывает один раз за процесс.
func (w *Window) runScenario(script string) {
	w.driveOnce.Do(func() {
		w.log.Printf("drive: the scenario starts (%d bytes)", len(script))
		w.chromium.Eval(script)
	})
}

// startDriver запускает сценарий в странице; зовётся на потоке окна после
// первой удачной загрузки.
func (w *Window) startDriver() {
	if script := w.opts.Drive; script != "" {
		w.runScenario(script)
	}
}
