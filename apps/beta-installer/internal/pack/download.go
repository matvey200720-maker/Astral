package pack

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"iter"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"sync/atomic"
	"time"
)

const (
	ParallelMinSize   = 33554432
	ParallelChunkSize = 16777216
	ParallelMaxChunks = 6

	streamBufSize    = 131072
	defaultStall     = 30 * time.Second
	progressInterval = 200 * time.Millisecond

	// Сглаживание скорости: доля прежнего значения и доля нового измерения.
	keepWeight = 0.7
	newWeight  = 1 - keepWeight
)

// Stream — открытый ответ сервера. Offset — с какого байта файла начинается
// Body (0: с начала, в том числе когда Range проигнорирован); Total — размер
// всего файла, если он известен.
type Stream struct {
	Body   io.ReadCloser
	Offset int64
	Total  int64
}

type Fetcher interface {
	Open(ctx context.Context, from int64) (*Stream, error)
}

// RangeFetcher открывает кусок [from, to], оба конца включительно.
type RangeFetcher interface {
	Fetcher
	OpenRange(ctx context.Context, from, to int64) (*Stream, error)
}

type DownloadSpec struct {
	Part         string
	Final        string
	ExpectedSize int64 // отрицательный — неизвестен; ноль — известный размер ноль
	TotalHint    int64
	Resume       bool
	MaxAttempts  int
	Stall        time.Duration
	Backoff      []time.Duration
	Parallel     RangeFetcher
}

type Progress struct {
	Received    int64
	Total       int64
	BytesPerSec float64
	ETA         time.Duration
	Attempt     int
}

// --- пометка «повторять бессмысленно» ---

type fatalMark struct{ error }

func (m fatalMark) Unwrap() error { return m.error }

// Fatal помечает err как «повторять бессмысленно»; Fatal(nil) — nil.
func Fatal(err error) error {
	if err == nil {
		return nil
	}
	return fatalMark{err}
}

func IsFatal(err error) bool {
	var mark fatalMark
	return errors.As(err, &mark)
}

// --- ход выполнения ---

// window — промежуток между событиями хода: allow говорит, что с прошлого
// события прошло достаточно времени, reopen начинает отсчёт заново.
type window struct{ opened time.Time }

func (w *window) allow(now time.Time) bool { return now.Sub(w.opened) >= progressInterval }
func (w *window) reopen(now time.Time)     { w.opened = now }

// speedo — сглаженная скорость по отсчётам, взятым в моменты выдачи.
type speedo struct {
	markAt  time.Time
	markN   int64
	value   float64
	started bool
	seeded  bool
}

// observe берёт отсчёт и возвращает скорость; пустой интервал или нулевой прирост пропускаются.
func (s *speedo) observe(now time.Time, n int64) float64 {
	if !s.started {
		s.started, s.markAt, s.markN = true, now, n
		return 0
	}
	span, gain := now.Sub(s.markAt).Seconds(), n-s.markN
	if span <= 0 || gain <= 0 {
		return s.value
	}
	fresh := float64(gain) / span
	if s.seeded {
		fresh = s.value*keepWeight + fresh*newWeight
	}
	s.value, s.seeded = fresh, true
	s.markAt, s.markN = now, n
	return s.value
}

// etaFor — оставшееся время при данной скорости; 0, если оно неизвестно.
func etaFor(left int64, rate float64) time.Duration {
	if rate <= 1 || left <= 0 {
		return 0
	}
	return time.Duration(float64(left) / rate * float64(time.Second))
}

// rateMeter превращает отсчёты в события Progress. Не потокобезопасен:
// на параллельном пути его держат под общей блокировкой.
type rateMeter struct {
	emit    func(Progress)
	total   int64
	attempt int

	pace  window
	speed speedo
}

func (m *rateMeter) report(received int64, force bool) {
	now := time.Now()
	switch {
	case m.emit == nil:
		return
	case !force && !m.pace.allow(now):
		return
	}
	m.pace.reopen(now)
	rate := m.speed.observe(now, received)
	m.emit(Progress{
		Received: received, Total: m.total, BytesPerSec: rate,
		ETA: etaFor(m.total-received, rate), Attempt: m.attempt,
	})
}

// --- сторож простоя и обёртки потока ---

// idleGuard срабатывает, если touch не вызывали дольше idle.
type idleGuard struct {
	timer   *time.Timer
	idle    time.Duration
	tripped atomic.Bool
}

func newIdleGuard(idle time.Duration, onTrip func()) *idleGuard {
	g := &idleGuard{idle: idle}
	g.timer = time.AfterFunc(idle, func() {
		g.tripped.Store(true)
		if onTrip != nil {
			onTrip()
		}
	})
	return g
}

func (g *idleGuard) touch()      { g.timer.Reset(g.idle) }
func (g *idleGuard) stop()       { g.timer.Stop() }
func (g *idleGuard) fired() bool { return g.tripped.Load() }

// watchedStream сообщает сторожу о каждом чтении с данными и называет сбои чтения.
type watchedStream struct {
	src     io.Reader
	guard   *idleGuard
	explain func(error) error
}

func (w *watchedStream) Read(p []byte) (int, error) {
	n, err := w.src.Read(p)
	if n > 0 {
		w.guard.touch()
	}
	if err != nil && err != io.EOF {
		err = w.explain(err)
	}
	return n, err
}

// partSink дописывает поток в частичный файл, ведёт счёт и следит за пределом размера.
type partSink struct {
	file  *os.File
	path  string
	have  int64 // байт файла уже на месте
	limit int64 // ExpectedSize; отрицательный — без предела
	meter *rateMeter
}

func (p *partSink) Write(b []byte) (int, error) {
	n, err := p.file.Write(b)
	if err != nil {
		return n, Fatal(err)
	}
	p.have += int64(n)
	if p.limit >= 0 && p.have > p.limit {
		p.file.Close()
		os.Remove(p.path)
		return n, Fatal(fmt.Errorf("server sent more than the %d bytes announced", p.limit))
	}
	p.meter.report(p.have, false)
	return n, nil
}

// --- политика попыток ---

// retryPlan — сколько раз открывать файл, какие паузы между попытками и что
// делать с частичным файлом, когда попытки кончились.
type retryPlan struct {
	tries   int
	backoff []time.Duration
	part    string
	resume  bool
}

// newRetryPlan читает политику из спецификации: меньше одной попытки — одна,
// не заданные (nil) паузы — 1 с и 3 с, пустой список — без пауз.
func newRetryPlan(spec DownloadSpec) retryPlan {
	p := retryPlan{tries: max(spec.MaxAttempts, 1), backoff: spec.Backoff, part: spec.Part, resume: spec.Resume}
	if p.backoff == nil {
		for _, secs := range [...]int{1, 3} {
			p.backoff = append(p.backoff, time.Duration(secs)*time.Second)
		}
	}
	return p
}

// pauseBefore — пауза перед попыткой n: элемент n−2, последний повторяется.
func (p retryPlan) pauseBefore(n int) time.Duration {
	if n < 2 || len(p.backoff) == 0 {
		return 0
	}
	return p.backoff[min(n-2, len(p.backoff)-1)]
}

// sweep стирает частичный файл, если докачка не нужна.
func (p retryPlan) sweep() {
	if !p.resume {
		_ = os.Remove(p.part)
	}
}

// giveUp — итог, когда попытки кончились: убирает за собой и называет последнюю причину.
func (p retryPlan) giveUp(last error) error {
	defer p.sweep()
	return fmt.Errorf("download failed after %d attempts: %w", p.tries, last)
}

// schedule перечисляет попытки вместе с паузой перед каждой.
func (p retryPlan) schedule() iter.Seq2[int, time.Duration] {
	return func(yield func(int, time.Duration) bool) {
		for n := 1; n <= p.tries; n++ {
			if !yield(n, p.pauseBefore(n)) {
				return
			}
		}
	}
}

// maxServerPause — самое долгое ожидание по просьбе сервера. Дольше ждать в установщике не стоит:
// человек видит остановку, а отмена всё равно прерывает ожидание.
const maxServerPause = 5 * time.Minute

// retryHinter — ошибка, которая знает, сколько сервер просил подождать перед повтором.
type retryHinter interface{ RetryDelay() time.Duration }

// serverPause — пауза, о которой просил сервер в этой ошибке (например, Retry-After у 429);
// 0, если не просил.
func serverPause(err error) time.Duration {
	var hint retryHinter
	if !errors.As(err, &hint) {
		return 0
	}
	return min(max(hint.RetryDelay(), 0), maxServerPause)
}

// waitBackoff ждёт d; отмена ctx прерывает ожидание.
func waitBackoff(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return nil
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// settle решает судьбу попытки: done — повторять не нужно, verdict — что вернуть.
func settle(ctx context.Context, err error) (done bool, verdict error) {
	switch {
	case err == nil:
		return true, nil
	case ctx.Err() != nil:
		return true, ctx.Err()
	case IsFatal(err):
		return true, err
	}
	return false, nil
}

// Download скачивает файл с повторами и докачкой; onProgress может быть nil.
func Download(ctx context.Context, f Fetcher, spec DownloadSpec, onProgress func(Progress)) error {
	plan := newRetryPlan(spec)
	if spec.Stall <= 0 {
		spec.Stall = defaultStall
	}

	var last error
	var asked time.Duration // что просил сервер после прошлой попытки
	for n, pause := range plan.schedule() {
		if err := waitBackoff(ctx, max(pause, asked)); err != nil {
			return err
		}
		err := (&dlAttempt{f: f, spec: spec, attempt: n, report: onProgress}).run(ctx)
		if done, verdict := settle(ctx, err); done {
			return verdict
		}
		last, asked = err, serverPause(err)
	}
	return plan.giveUp(last)
}

// --- одна попытка ---

type dlAttempt struct {
	f       Fetcher
	spec    DownloadSpec
	attempt int
	report  func(Progress)
}

func (t *dlAttempt) meter(total int64) *rateMeter {
	return &rateMeter{emit: t.report, total: total, attempt: t.attempt}
}

func (t *dlAttempt) run(ctx context.Context) error {
	s := &t.spec
	if s.Resume && s.Parallel != nil && s.ExpectedSize >= ParallelMinSize {
		return t.runChunked(ctx)
	}
	return t.runSingle(ctx)
}

// publish ставит готовый Part на место Final.
func (t *dlAttempt) publish() error {
	return Fatal(renameRetrying(t.spec.Part, t.spec.Final))
}

// firstFailure выполняет действия по порядку до первой ошибки.
func firstFailure(actions ...func() error) error {
	for _, act := range actions {
		if err := act(); err != nil {
			return err
		}
	}
	return nil
}

// sizeOnDisk — длина файла или 0, если его нет.
func sizeOnDisk(path string) int64 {
	if fi, err := os.Stat(path); err == nil {
		return fi.Size()
	}
	return 0
}

// resumePoint решает, с какого байта продолжать; complete — Part уже полный.
func (t *dlAttempt) resumePoint() (from int64, complete bool) {
	s := &t.spec
	if !s.Resume {
		_ = os.Remove(s.Part)
		return 0, false
	}
	from = sizeOnDisk(s.Part)
	if s.ExpectedSize < 0 {
		return from, false
	}
	if from > s.ExpectedSize {
		_ = os.Remove(s.Part)
		return 0, false
	}
	return from, from == s.ExpectedSize
}

// shownTotal — общий размер для показа хода.
func (t *dlAttempt) shownTotal(st *Stream) int64 {
	s := &t.spec
	if s.ExpectedSize >= 0 {
		return s.ExpectedSize
	}
	for _, guess := range [...]int64{st.Total, s.TotalHint} {
		if guess > 0 {
			return guess
		}
	}
	return s.ExpectedSize
}

// alignStart сверяет начало потока с запрошенной позицией: 0 означает, что
// Range проигнорирован и файл переписывается с нуля.
func alignStart(offset, asked int64) (int64, error) {
	if offset == asked || offset == 0 {
		return offset, nil
	}
	return 0, fmt.Errorf("server started at byte %d, asked for %d", offset, asked)
}

// lease — открытый ответ сервера вместе с отменой контекста, в котором он открыт.
type lease struct {
	*Stream
	cancel context.CancelFunc
}

// lease открывает файл с позиции from в контексте попытки, который отменяет
// сторож простоя и конец попытки.
func (t *dlAttempt) lease(ctx context.Context, from int64) (*lease, error) {
	actx, cancel := context.WithCancel(ctx)
	st, err := t.f.Open(actx, from)
	if err != nil {
		cancel()
		return nil, err
	}
	return &lease{Stream: st, cancel: cancel}, nil
}

func (l *lease) Close() error {
	defer l.cancel()
	return l.Body.Close()
}

// openPart открывает частичный файл на запись; extra — флаги поверх «писать и создать».
func openPart(path string, extra int) (*os.File, error) {
	return os.OpenFile(path, os.O_WRONLY|os.O_CREATE|extra, 0o644)
}

// openPartFor открывает частичный файл: дописывать при from > 0, иначе с нуля.
func openPartFor(path string, from int64) (*os.File, error) {
	if from > 0 {
		return openPart(path, os.O_APPEND)
	}
	return openPart(path, os.O_TRUNC)
}

func (t *dlAttempt) runSingle(ctx context.Context) error {
	s := &t.spec
	if err := os.MkdirAll(filepath.Dir(s.Part), mkdirPerm); err != nil {
		return Fatal(err)
	}
	from, complete := t.resumePoint()
	if complete {
		return t.publish()
	}

	ls, err := t.lease(ctx, from)
	if err != nil {
		return err
	}
	defer ls.Close()

	if from, err = alignStart(ls.Offset, from); err != nil {
		return err
	}
	out, err := openPartFor(s.Part, from)
	if err != nil {
		return Fatal(err)
	}
	defer out.Close()

	meter := t.meter(t.shownTotal(ls.Stream))
	meter.report(from, true)
	guard := newIdleGuard(s.Stall, ls.cancel)
	defer guard.stop()

	sink := &partSink{file: out, path: s.Part, have: from, limit: s.ExpectedSize, meter: meter}
	feed := &watchedStream{src: ls.Body, guard: guard, explain: func(cause error) error {
		switch {
		case ctx.Err() != nil:
			return ctx.Err()
		case guard.fired():
			return fmt.Errorf("no data for %v: %w", s.Stall, cause)
		}
		return cause
	}}
	if _, err := io.CopyBuffer(sink, feed, make([]byte, streamBufSize)); err != nil {
		return err
	}

	guard.stop()
	if err := firstFailure(out.Sync, out.Close); err != nil {
		return Fatal(err)
	}
	if s.ExpectedSize >= 0 && sink.have != s.ExpectedSize {
		return fmt.Errorf("stream ended at %d of %d bytes", sink.have, s.ExpectedSize)
	}
	meter.report(sink.have, true)
	return t.publish()
}

// --- параллельный путь ---

// chunkSpan — кусок файла [From, To], оба конца включительно.
type chunkSpan struct {
	From, To int64
}

func (c chunkSpan) size() int64 { return c.To - c.From + 1 }

// planChunks размечает файл на куски не меньше ParallelChunkSize, но не больше
// ParallelMaxChunks; последний забирает остаток.
func planChunks(size int64) []chunkSpan {
	size = max(size, 0) // размер не больше нуля даёт один пустой кусок {0, -1}
	count := min(max(size/ParallelChunkSize, 1), ParallelMaxChunks)
	cuts := make([]int64, 0, count+1)
	for i := range count {
		cuts = append(cuts, i*(size/count))
	}
	cuts = append(cuts, size)

	spans := make([]chunkSpan, count)
	for i := range spans {
		spans[i] = chunkSpan{cuts[i], cuts[i+1] - 1}
	}
	return spans
}

// chunkState — содержимое сопутствующего файла <Part>.chunks.
type chunkState struct {
	Size  int64       `json:"size"`
	Spans []chunkSpan `json:"spans"`
	Done  []bool      `json:"done"`
}

func chunkStatePath(part string) string { return part + ".chunks" }

// persist записывает состояние в path одним JSON-документом без перевода строки в конце.
func (c chunkState) persist(path string) error {
	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(c); err != nil {
		return err
	}
	return WriteFileAtomic(path, bytes.TrimSuffix(buf.Bytes(), []byte{'\n'}), 0o644)
}

// describes: состояние снято для файла этого размера и с этой разметкой.
func (c *chunkState) describes(size int64, spans []chunkSpan) bool {
	return c.Size == size && slices.Equal(c.Spans, spans)
}

func saveChunkState(path string, size int64, spans []chunkSpan, done []bool) error {
	return chunkState{Size: size, Spans: spans, Done: done}.persist(path)
}

// loadChunkState возвращает ровно len(spans) флагов; любая неполадка — все false.
func loadChunkState(path string, size int64, spans []chunkSpan) []bool {
	flags := make([]bool, len(spans))
	var st chunkState
	if raw, err := os.ReadFile(path); err == nil && json.Unmarshal(raw, &st) == nil && st.describes(size, spans) {
		copy(flags, st.Done)
	}
	return flags
}

// vouch оставляет отметку «готов» только у кусков, чьи байты есть в Part длиной
// partLen: пропавший или укороченный файл не хранит конец куска, а файл длиннее
// size — не наш, и ни одному его байту верить нельзя. Возвращает, менялись ли отметки.
func vouch(done []bool, spans []chunkSpan, partLen, size int64) (changed bool) {
	for i, sp := range spans {
		if done[i] && (partLen > size || sp.To >= partLen) {
			done[i], changed = false, true
		}
	}
	return changed
}

// splitDone делит куски на готовые и неготовые: сколько байт уже на месте и номера недостающих.
func splitDone(spans []chunkSpan, done []bool) (have int64, todo []int) {
	for i, sp := range spans {
		if done[i] {
			have += sp.size()
		} else {
			todo = append(todo, i)
		}
	}
	return have, todo
}

// stretchPart создаёт Part при отсутствии и приводит его длину к size, не трогая содержимое.
func stretchPart(path string, size int64) (*os.File, error) {
	f, err := openPart(path, 0)
	if err == nil {
		if err = f.Truncate(size); err != nil {
			f.Close()
			f = nil
		}
	}
	return f, err
}

// chunkRun — общее состояние горутин, качающих куски.
type chunkRun struct {
	ctx       context.Context
	src       RangeFetcher
	stall     time.Duration
	out       *os.File
	statePath string
	size      int64
	spans     []chunkSpan

	todo []int        // номера неготовых кусков в порядке выдачи
	next atomic.Int64 // сколько кусков из todo уже взято

	mu       sync.Mutex
	idle     sync.Cond // сигнал о том, что очередной воркер закончил
	live     int       // сколько воркеров ещё работает
	done     []bool
	received int64
	meter    *rateMeter
	firstErr error
}

// noteErr запоминает только первую по времени ошибку; mu уже занят.
func (r *chunkRun) noteErr(err error) {
	if r.firstErr == nil {
		r.firstErr = err
	}
}

func (r *chunkRun) fail(err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.noteErr(err)
}

// store кладёт байты куска на место и сообщает ход.
func (r *chunkRun) store(off int64, p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	n, err := r.out.WriteAt(p, off)
	r.received += int64(n)
	r.meter.report(r.received, false)
	return n, err
}

// syncPart сбрасывает Part на диск; подменяется в тестах.
var syncPart = func(f *os.File) error { return f.Sync() }

// markDone отмечает кусок готовым и переписывает сопутствующий файл целиком. Сначала байты
// куска уходят на диск, потом отметка о нём: иначе после сбоя питания отметка «готов» уцелеет,
// а сам кусок нет, и докачка поверит нулям вместо данных. Сброс идёт вне замка, чтобы
// остальные куски не ждали диск.
func (r *chunkRun) markDone(i int) {
	flushed := syncPart(r.out)
	r.mu.Lock()
	defer r.mu.Unlock()
	if flushed != nil {
		r.noteErr(Fatal(flushed))
		return
	}
	r.done[i] = true
	if err := (chunkState{Size: r.size, Spans: r.spans, Done: r.done}).persist(r.statePath); err != nil {
		r.noteErr(Fatal(err))
	}
}

// chunkSink пишет куски в Part по смещению и сдвигается вперёд.
type chunkSink struct {
	run *chunkRun
	at  int64
}

func (c *chunkSink) Write(b []byte) (int, error) {
	n, err := c.run.store(c.at, b)
	c.at += int64(n)
	return n, Fatal(err)
}

// fetch качает кусок i; ошибки уходят в fail.
func (r *chunkRun) fetch(i int) {
	sp := r.spans[i]
	// Свой контекст на кусок: сторож простоя отменяет только его, и молчащее
	// соединение обрывается, не трогая соседние куски.
	cctx, cancel := context.WithCancel(r.ctx)
	defer cancel()
	st, err := r.src.OpenRange(cctx, sp.From, sp.To)
	if err != nil {
		r.fail(err)
		return
	}
	defer st.Body.Close()
	if st.Offset != sp.From {
		r.fail(Fatal(fmt.Errorf("range [%d,%d]: server started at %d", sp.From, sp.To, st.Offset)))
		return
	}

	guard := newIdleGuard(r.stall, cancel)
	defer guard.stop()
	feed := &watchedStream{src: io.LimitReader(st.Body, sp.size()), guard: guard, explain: func(cause error) error {
		switch {
		case r.ctx.Err() != nil:
			return r.ctx.Err()
		case guard.fired():
			return fmt.Errorf("no data for %v: %w", r.stall, cause)
		}
		return cause
	}}
	got, err := io.CopyBuffer(&chunkSink{run: r, at: sp.From}, feed, make([]byte, streamBufSize))
	switch {
	case err != nil:
		r.fail(err)
	case got < sp.size():
		r.fail(fmt.Errorf("chunk [%d,%d]: got %d of %d bytes", sp.From, sp.To, got, sp.size()))
	default:
		r.markDone(i)
	}
}

// ticket выдаёт номер следующего неготового куска; ложь, когда куски кончились.
func (r *chunkRun) ticket() (int, bool) {
	k := int(r.next.Add(1)) - 1
	if k >= len(r.todo) {
		return 0, false
	}
	return r.todo[k], true
}

// worker берёт куски, пока они есть, и по выходу отмечается в счётчике живых.
func (r *chunkRun) worker() {
	defer func() {
		r.mu.Lock()
		r.live--
		r.idle.Broadcast()
		r.mu.Unlock()
	}()
	for {
		if err := r.ctx.Err(); err != nil {
			r.fail(err)
			return
		}
		i, ok := r.ticket()
		if !ok {
			return
		}
		r.fetch(i)
	}
}

// drain запускает воркеров (не больше ParallelMaxChunks, по числу неготовых
// кусков) и ждёт, пока все выйдут; возвращает первую ошибку, а при отмене — ctx.Err().
func (r *chunkRun) drain() error {
	r.idle.L = &r.mu
	crew := min(len(r.todo), ParallelMaxChunks)
	r.mu.Lock()
	r.live = crew
	r.mu.Unlock()
	for range crew {
		go r.worker()
	}
	r.mu.Lock()
	for r.live > 0 {
		r.idle.Wait()
	}
	r.mu.Unlock()

	switch {
	case r.firstErr == nil:
		return nil
	case r.ctx.Err() != nil:
		return r.ctx.Err()
	}
	return r.firstErr
}

func (t *dlAttempt) runChunked(ctx context.Context) error {
	s := &t.spec
	spans := planChunks(s.ExpectedSize)
	sidecar := chunkStatePath(s.Part)
	done := loadChunkState(sidecar, s.ExpectedSize, spans)
	// Отметки сверяются с Part до того, как он растянется: растянутый файл
	// выглядит полным. Исправленные отметки сразу на диск, иначе после сбоя
	// прежние ложные «готов» встретили бы уже растянутый Part.
	if vouch(done, spans, sizeOnDisk(s.Part), s.ExpectedSize) {
		if err := saveChunkState(sidecar, s.ExpectedSize, spans, done); err != nil {
			return Fatal(err)
		}
	}

	out, err := stretchPart(s.Part, s.ExpectedSize)
	if err != nil {
		return Fatal(err)
	}
	defer out.Close()

	have, todo := splitDone(spans, done)
	meter := t.meter(s.ExpectedSize)
	meter.report(have, true)

	flush := func() error { return nil }
	if len(todo) > 0 {
		run := &chunkRun{
			ctx: ctx, src: s.Parallel, stall: s.Stall, out: out, statePath: sidecar,
			size: s.ExpectedSize, spans: spans, todo: todo, done: done, received: have, meter: meter,
		}
		if err := run.drain(); err != nil {
			return err
		}
		if run.received != s.ExpectedSize {
			return fmt.Errorf("parallel download: got %d of %d bytes", run.received, s.ExpectedSize)
		}
		flush = out.Sync
	}
	if err := firstFailure(flush, out.Close); err != nil {
		return Fatal(err)
	}
	return t.landChunked(sidecar, meter, len(todo) > 0)
}

// landChunked: все куски на месте — сопутствующий файл больше не нужен;
// после докачки сообщается итог, затем Part ставится на место Final.
func (t *dlAttempt) landChunked(sidecar string, meter *rateMeter, fetched bool) error {
	_ = os.Remove(sidecar)
	if fetched {
		meter.report(t.spec.ExpectedSize, true)
	}
	return t.publish()
}
