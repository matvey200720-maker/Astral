// Package bridge соединяет страницу интерфейса установщика с Go-кодом:
// раздаёт вызовы страницы обработчикам, приводит ошибки к единому виду и
// пересылает события странице.
package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"runtime/debug"
	"sync"

	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/applog"
)

const (
	codeInternal    = "INTERNAL"
	codeUnsupported = "UNSUPPORTED"
)

// Error — отказ в том виде, в каком его видит страница.
type Error struct {
	Code          string `json:"code"`
	Retryable     bool   `json:"retryable"`
	Detail        string `json:"detail,omitempty"`
	RetryAfterSec int    `json:"retryAfterSec,omitempty"`
	HTTPStatus    int    `json:"httpStatus,omitempty"`
}

func (e *Error) Error() string {
	if e.Detail == "" {
		return e.Code
	}
	return e.Code + ": " + e.Detail
}

// eventField — вклад одного поля ошибки в тело события; ok ложно — поля нет.
type eventField struct {
	key  string
	pick func(e *Error) (value any, ok bool)
}

var eventFields = []eventField{
	{"code", func(e *Error) (any, bool) { return e.Code, true }},
	{"retryable", func(e *Error) (any, bool) { return e.Retryable, true }},
	{"detail", func(e *Error) (any, bool) { return e.Detail, e.Detail != "" }},
	{"retryAfterSec", func(e *Error) (any, bool) { return e.RetryAfterSec, e.RetryAfterSec > 0 }},
	{"httpStatus", func(e *Error) (any, bool) { return e.HTTPStatus, e.HTTPStatus > 0 }},
}

// baseEventBody — тело события с одной только стадией.
func baseEventBody(stage string) map[string]any {
	return map[string]any{"stage": stage}
}

// applyEventFields дополняет body теми полями e, у которых есть значение.
func applyEventFields(body map[string]any, e *Error) map[string]any {
	for _, f := range eventFields {
		if v, ok := f.pick(e); ok {
			body[f.key] = v
		}
	}
	return body
}

// Event — тело события error для указанной стадии.
func (e *Error) Event(stage string) map[string]any {
	return applyEventFields(baseEventBody(stage), e)
}

func Errf(code string, retryable bool, format string, args ...any) *Error {
	e := &Error{Code: code, Retryable: retryable}
	e.Detail = fmt.Sprintf(format, args...)
	return e
}

// carried ищет *Error в цепочке ошибки.
func carried(err error) (*Error, bool) {
	var found *Error
	ok := errors.As(err, &found)
	return found, ok
}

// scrubbed — копия ошибки с подробностью без секретов.
func (e *Error) scrubbed() *Error {
	dup := new(Error)
	*dup = *e
	dup.Detail = applog.Redact(e.Detail)
	return dup
}

// AsError приводит любую ошибку к виду для страницы: *Error из цепочки идёт
// копией, остальное становится INTERNAL; подробность очищается от секретов.
// Для nil результат nil.
func AsError(err error) *Error {
	if err == nil {
		return nil
	}
	if inner, ok := carried(err); ok {
		return inner.scrubbed()
	}
	fallback := &Error{Code: codeInternal, Detail: applog.Redact(err.Error())}
	return fallback
}

type (
	// Handler обслуживает один метод; params — тело поля p сообщения.
	Handler func(ctx context.Context, params json.RawMessage) (any, error)

	// ReplyFunc передаёт странице ответ на вызов id.
	ReplyFunc func(id int64, ok bool, payload any)

	// route — обработчик и способ его запуска.
	route struct {
		handle Handler
		inline bool // выполнять в потоке вызвавшего Dispatch
	}
)

// registry хранит маршруты; нулевое значение читается, но не пишется.
type registry struct {
	mu    sync.RWMutex
	table map[string]route
}

// write и read отдают fn таблицу маршрутов под замком на запись и на чтение.
func (g *registry) read(fn func(map[string]route)) {
	g.mu.RLock()
	defer g.mu.RUnlock()
	fn(g.table)
}

func (g *registry) write(fn func(map[string]route)) {
	g.mu.Lock()
	defer g.mu.Unlock()
	fn(g.table)
}

func (g *registry) lookup(method string) (rt route, ok bool) {
	g.read(func(t map[string]route) { rt, ok = t[method] })
	return
}

func (g *registry) put(method string, rt route) {
	g.write(func(t map[string]route) { t[method] = rt })
}

// hooks — наблюдатель за вызовами и доставка событий странице.
type hooks struct {
	mu       sync.RWMutex
	observer func(method string)
	emitter  func(event string, data any)
}

// update выполняет fn под замком на запись.
func (h *hooks) update(fn func()) {
	h.mu.Lock()
	defer h.mu.Unlock()
	fn()
}

func (h *hooks) setObserver(fn func(string)) { h.update(func() { h.observer = fn }) }

func (h *hooks) setEmitter(fn func(string, any)) { h.update(func() { h.emitter = fn }) }

// snapshot отдаёт текущие функции, чтобы вызывать их уже без блокировки.
func (h *hooks) snapshot() (func(string), func(string, any)) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.observer, h.emitter
}

// Router раздаёт сообщения страницы. Создаётся только NewRouter.
type Router struct {
	ctx    context.Context
	log    applog.Logger
	routes registry
	links  hooks
}

func defaultLog(log applog.Logger) applog.Logger {
	if log != nil {
		return log
	}
	return applog.Nop{}
}

func NewRouter(ctx context.Context, log applog.Logger) *Router {
	return &Router{ctx: ctx, log: defaultLog(log), routes: registry{table: make(map[string]route)}}
}

// register заводит маршрут method на rt.
func (r *Router) register(method string, rt route) {
	r.routes.put(method, rt)
}

// Handle регистрирует обработчик, который работает в своей горутине.
func (r *Router) Handle(method string, h Handler) {
	r.register(method, route{handle: h})
}

// HandleSync регистрирует обработчик, который работает в потоке Dispatch.
func (r *Router) HandleSync(method string, h Handler) {
	r.register(method, route{handle: h, inline: true})
}

// SetObserver: fn зовётся с именем метода перед каждым известным вызовом.
func (r *Router) SetObserver(fn func(method string)) {
	r.links.setObserver(fn)
}

func (r *Router) SetEmitter(fn func(event string, data any)) {
	r.links.setEmitter(fn)
}

func (r *Router) Emit(event string, data any) {
	if _, emit := r.links.snapshot(); emit != nil {
		r.shielded("emitter", func() { emit(event, data) })
	}
}

// shielded вызывает fn так, чтобы паника чужой функции (наблюдателя, эмиттера,
// доставки ответа) не ушла вызывающему: у обработчика в своей горутине она
// роняла бы весь установщик. Паника пишется в журнал очищенной от секретов.
func (r *Router) shielded(what string, fn func()) {
	defer func() {
		v := recover()
		if v == nil {
			return
		}
		r.log.Printf("%s", panicLine(what, v, debug.Stack()))
	}()
	fn()
}

// panicLine — строка журнала о панике в месте where, очищенная от секретов.
func panicLine(where string, v any, stack []byte) string {
	return applog.Redact(fmt.Sprintf("bridge: panic in %s: %v\n%s", where, v, stack))
}

// shieldReply оборачивает доставку ответа так, чтобы её паника оставалась внутри.
func (r *Router) shieldReply(reply ReplyFunc) ReplyFunc {
	return func(id int64, ok bool, payload any) {
		r.shielded("reply", func() { reply(id, ok, payload) })
	}
}

// envelope — сообщение страницы {"id":1,"m":"метод","p":{…}}.
type envelope struct {
	ID     int64           `json:"id"`
	Method string          `json:"m"`
	Params json.RawMessage `json:"p"`
}

// parseEnvelope читает сообщение стандартным разбором в структуру (имена
// полей без учёта регистра, при повторе последнее); всё, что не похоже на
// вызов, отбрасывается. Пустые параметры превращаются в {}.
func parseEnvelope(raw string) (env envelope, ok bool) {
	if json.Unmarshal([]byte(raw), &env) != nil || env.Method == "" {
		return envelope{}, false
	}
	if p := string(env.Params); p == "" || p == "null" {
		env.Params = json.RawMessage("{}")
	}
	return env, true
}

// salvageID достаёт id из сообщения, которое не разобралось как вызов: страница
// ждёт ответ именно по нему. Нет читаемого целого id — ответить некому.
func salvageID(raw string) (id int64, ok bool) {
	var probe struct {
		ID *int64 `json:"id"`
	}
	if json.Unmarshal([]byte(raw), &probe) == nil && probe.ID != nil {
		id, ok = *probe.ID, true
	}
	return
}

// Dispatch разбирает сообщение страницы и вызывает обработчик. Битое сообщение
// пишет одну строку в журнал; если из него понятен id, страница получает отказ
// INVALID_ARGUMENT, иначе оно отбрасывается молча. Неизвестный метод получает
// UNSUPPORTED сразу.
func (r *Router) Dispatch(raw string, reply ReplyFunc) {
	reply = r.shieldReply(reply)
	env, ok := parseEnvelope(raw)
	if !ok {
		r.log.Printf("bridge: dropped malformed message (%d bytes)", len(raw))
		if id, known := salvageID(raw); known {
			reply(id, false, &Error{Code: "INVALID_ARGUMENT", Detail: "malformed message"})
		}
		return
	}
	rt, known := r.routes.lookup(env.Method)
	if !known {
		reply(env.ID, false, &Error{Code: codeUnsupported, Detail: "unknown method " + env.Method})
		return
	}
	if observe, _ := r.links.snapshot(); observe != nil {
		r.shielded("observer", func() { observe(env.Method) })
	}
	runJob(rt.inline, func() { r.invoke(env, rt.handle, reply) })
}

// runJob выполняет job в потоке вызвавшего (inline) или в своей горутине.
func runJob(inline bool, job func()) {
	if inline {
		job()
		return
	}
	go job()
}

// guard страхует процесс от паники: паника пишется в журнал, а странице
// уходит отказ INTERNAL.
type guard struct {
	log    applog.Logger
	method string
	id     int64
	reply  ReplyFunc
}

func (g guard) Guard(fn func()) {
	defer func() {
		v := recover()
		if v == nil {
			return
		}
		// Текст паники — произвольная строка обработчика: в нём бывают адрес с
		// билетом или код беты, поэтому очищается и журнал, и ответ странице.
		g.log.Printf("%s", panicLine(g.method, v, debug.Stack()))
		g.reply(g.id, false, &Error{Code: codeInternal, Detail: applog.Redact(fmt.Sprintf("panic: %v", v))})
	}()
	fn()
}

// outcome превращает результат обработчика в пару «успех, что отдать».
func outcome(result any, err error) (bool, any) {
	if err != nil {
		return false, AsError(err)
	}
	return true, result
}

func (r *Router) invoke(env envelope, h Handler, reply ReplyFunc) {
	guard{log: r.log, method: env.Method, id: env.ID, reply: reply}.Guard(func() {
		ok, payload := outcome(h(r.ctx, env.Params))
		reply(env.ID, ok, payload)
	})
}
