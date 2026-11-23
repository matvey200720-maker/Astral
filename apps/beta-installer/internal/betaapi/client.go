// Package betaapi — клиент API закрытой беты от имени установщика: старт
// активации, опрос, скачивание файлов релиза и подтверждение установки. Каждый
// запрос подписан доказательством владения ключом (пакет dpop).
package betaapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/applog"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/dpop"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/pack"
)

const (
	routeStart    = "/api/v1/beta/install/start"
	routePoll     = "/api/v1/beta/install/poll"
	routeComplete = "/api/v1/beta/install/complete"
)

const defaultUserAgent = "AstralBetaSetup"

const acceptTypes = "application/json, application/octet-stream"

const codeDPoPInvalid = "DPOP_INVALID"

const defaultInterval = 3

const jsonCallTimeout = 20 * time.Second

const (
	maxJSONBody    = 4 << 20
	maxDrainBody   = 1 << 20
	maxProblemBody = 64 << 10
)

// Date сервера содержит целые секунды (дробная часть отброшена вниз),
// поэтому к нему прибавляется полсекунды.
const dateGranule = 500 * time.Millisecond

const (
	retryThreshold = 2 * time.Second
	skewThreshold  = 5 * time.Second
)

// Client безопасен для одновременных вызовов: общее изменяемое состояние —
// поправка времени в Signer и журнал.
type Client struct {
	Signer    *dpop.Signer
	Origin    string
	HTTP      *http.Client
	UserAgent string
	Now       func() time.Time
	Log       applog.Logger
}

func New(origin string, signer *dpop.Signer, httpClient *http.Client, log applog.Logger) *Client {
	c := new(Client)
	c.Signer, c.UserAgent, c.Now = signer, defaultUserAgent, time.Now
	c.Origin = strings.TrimRight(origin, "/")
	if c.HTTP = httpClient; c.HTTP == nil {
		c.HTTP = DefaultHTTPClient(nil)
	}
	if c.Log = log; c.Log == nil {
		c.Log = applog.Nop{}
	}
	return c
}

func keepLastResponse(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }

// DefaultHTTPClient ограничивает ожидание соединения и ответа, но не ставит
// общий срок (большие файлы защищает pack.Download) и не ходит по
// перенаправлениям: 3xx возвращается как есть.
func DefaultHTTPClient(proxy func(*http.Request) (*url.URL, error)) *http.Client {
	route := http.ProxyFromEnvironment
	if proxy != nil {
		route = proxy
	}
	dial := (&net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}).DialContext
	return &http.Client{
		CheckRedirect: keepLastResponse,
		Transport: &http.Transport{
			Proxy:                 route,
			DialContext:           dial,
			ForceAttemptHTTP2:     true,
			MaxIdleConns:          4,
			IdleConnTimeout:       time.Minute,
			TLSHandshakeTimeout:   15 * time.Second,
			ExpectContinueTimeout: time.Second,
			ResponseHeaderTimeout: 30 * time.Second,
		},
	}
}

// call — один запрос к серверу; тело и Range необязательны.
type call struct {
	method string
	target string // полный адрес, как он уходит (у файлов вместе с query)
	body   []byte
	rng    string
	cl     *Client
}

// dress выставляет заголовки запроса; порядок, в котором они выставлены, на проводе не виден.
func (q call) dress(req *http.Request, proof string) {
	head := req.Header
	head.Set("DPoP", proof)
	head.Set("Accept", acceptTypes)
	head.Set("User-Agent", q.cl.UserAgent)
	if q.body != nil {
		head.Set("Content-Type", "application/json")
	}
	if q.rng != "" {
		head.Set("Range", q.rng)
	}
}

// payload — тело запроса для http.NewRequest: nil, если тела нет.
func (q call) payload() (r io.Reader) {
	if q.body != nil {
		r = bytes.NewReader(q.body)
	}
	return
}

// build подписывает и собирает запрос; ошибка подписи и сборки возвращается как есть.
func (q call) build(ctx context.Context) (*http.Request, error) {
	proof, err := q.cl.Signer.Proof(q.method, q.target)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, q.method, q.target, q.payload())
	if err != nil {
		return nil, err
	}
	// Логин и пароль из адреса стандартный клиент превратил бы в Authorization: Basic; серверу беты хватает подписи DPoP.
	req.URL.User = nil
	q.dress(req, proof)
	return req, nil
}

// fire отправляет запрос; сбой транспорта становится *NetError.
func (q call) fire(ctx context.Context) (*http.Response, error) {
	req, err := q.build(ctx)
	if err != nil {
		return nil, err
	}
	resp, err := q.cl.HTTP.Do(req)
	if err != nil {
		return nil, &NetError{Err: err}
	}
	return resp, nil
}

type problemDoc struct {
	Code   string `json:"code"`
	Title  string `json:"title"`
	Detail string `json:"detail"`
}

// readProblem читает тело ответа с ошибкой (не больше maxProblemBody) и закрывает его;
// документ, который не разбирается, даёт пустое описание.
func readProblem(body io.ReadCloser) (doc problemDoc) {
	defer body.Close()
	raw, _ := io.ReadAll(io.LimitReader(body, maxProblemBody))
	if json.Unmarshal(raw, &doc) != nil {
		doc = problemDoc{}
	}
	return doc
}

// problem превращает ответ с ошибкой в *APIError и пишет строку в журнал.
func (q call) problem(resp *http.Response) *APIError {
	doc := readProblem(resp.Body)
	fail := &APIError{Status: resp.StatusCode, Code: doc.Code, Title: doc.Title, Detail: doc.Detail}
	fail.RetryAfter = parseRetryAfter(resp.Header.Get("Retry-After"))
	q.cl.logf("api %s %s -> %d %s", q.method, applog.Redact(q.target), fail.Status, fail.Code)
	return fail
}

// Do выполняет запрос. Успешный (меньше 300) ответ отдаётся открытым, ответ с
// ошибкой становится *APIError. Если сервер отказал кодом DPOP_INVALID и
// поправка времени после этого ответа заметно сдвинулась, запрос уходит ещё
// раз, один, с новым доказательством.
func (q call) Do(ctx context.Context) (*http.Response, error) {
	baseline := q.cl.Signer.ClockOffset()
	for retried := false; ; retried = true {
		resp, err := q.fire(ctx)
		if err != nil {
			return nil, err
		}
		q.cl.syncClock(resp)
		if resp.StatusCode < 300 {
			return resp, nil
		}
		fail := q.problem(resp)
		if retried || fail.Code != codeDPoPInvalid || !q.cl.clockMoved(baseline) {
			return nil, fail
		}
		q.cl.logf("api: PC clock is off by %s, retrying with a correction", q.cl.Signer.ClockOffset())
	}
}

func (c *Client) logf(format string, args ...any) {
	if c.Log == nil {
		return
	}
	c.Log.Printf(format, args...)
}

func (c *Client) ClockOffset() time.Duration { return c.Signer.ClockOffset() }

// clock — «сейчас» по часам клиента (подмена Now нужна тестам).
func (c *Client) clock() time.Time {
	if c.Now == nil {
		return time.Now()
	}
	return c.Now()
}

// beyond: значение по модулю больше порога (в обе стороны, без смены знака).
func beyond(d, limit time.Duration) bool { return d > limit || d < -limit }

// syncClock сверяет часы ПК с заголовком Date: расхождение больше порога
// становится поправкой, меньшее сбрасывает её.
func (c *Client) syncClock(resp *http.Response) {
	stamp, err := http.ParseTime(resp.Header.Get("Date"))
	if err != nil {
		return
	}
	drift := stamp.Add(dateGranule).Sub(c.clock())
	if beyond(drift, skewThreshold) {
		c.Signer.SetClockOffset(drift)
		return
	}
	if c.Signer.ClockOffset() != 0 {
		c.Signer.SetClockOffset(0)
	}
}

// clockMoved: поправка времени сдвинулась от since больше порога повтора.
func (c *Client) clockMoved(since time.Duration) bool {
	return beyond(c.Signer.ClockOffset()-since, retryThreshold)
}

// exchange отправляет тело POST-ом на route, отдаёт ответ sink-у и закрывает его.
func (c *Client) exchange(ctx context.Context, route string, body []byte, sink func(io.Reader) error) error {
	resp, err := call{cl: c, method: http.MethodPost, target: c.Origin + route, body: body}.Do(ctx)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return sink(resp.Body)
}

// rpc — вызов JSON с общим сроком 20 секунд на запрос, ответ и чтение тела.
// Если вызывающий сам отменил или исчерпал контекст, сетевой сбой — это его
// ошибка, а не сеть.
func (c *Client) rpc(ctx context.Context, route string, payload any, sink func(io.Reader) error) error {
	bounded, release := context.WithTimeout(ctx, jsonCallTimeout)
	defer release()
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if err = c.exchange(bounded, route, body, sink); IsNetwork(err) && ctx.Err() != nil {
		return ctx.Err()
	}
	return err
}

// jsonSink читает первое JSON-значение тела (не больше 4 МиБ) в out.
type jsonSink[T any] struct {
	route string
	out   T
}

func (s *jsonSink[T]) read(body io.Reader) error {
	raw, err := io.ReadAll(io.LimitReader(body, maxJSONBody))
	if err != nil {
		return &NetError{Err: err}
	}
	if err := json.NewDecoder(bytes.NewReader(raw)).Decode(&s.out); err != nil {
		return fmt.Errorf("betaapi: bad response from %s: %w", s.route, err)
	}
	return nil
}

// finding — одно правило проверки ответа: если bad, ответ негоден с этим текстом.
type finding struct {
	bad  bool
	text string
}

func firstFinding(rules ...finding) error {
	if at := slices.IndexFunc(rules, func(r finding) bool { return r.bad }); at >= 0 {
		return errors.New(rules[at].text)
	}
	return nil
}

// orDefault заменяет неположительный интервал опроса на значение по умолчанию.
func orDefault(interval int) int {
	if interval <= 0 {
		return defaultInterval
	}
	return interval
}

// stringMap собирает карту из пар «ключ, значение», идущих подряд.
func stringMap(pairs ...string) map[string]string {
	out := make(map[string]string, len(pairs)/2)
	for i := 0; i+1 < len(pairs); i += 2 {
		out[pairs[i]] = pairs[i+1]
	}
	return out
}

type StartRequest struct {
	Code             string `json:"code"`
	Machine          string `json:"machine"`
	DeviceName       string `json:"device_name"`
	InstallerVersion string `json:"installer_version"`
	Channel          string `json:"channel,omitempty"`
}

type StartResponse struct {
	ActivationID string    `json:"activation_id"`
	UserCode     string    `json:"user_code"`
	ConfirmURL   string    `json:"confirm_url"`
	Interval     int       `json:"interval"`
	ExpiresAt    time.Time `json:"expires_at"`
}

// ask вызывает route, разбирает ответ в значение T и отдаёт его, если check не нашёл изъяна.
func ask[T any](ctx context.Context, c *Client, route string, payload any, check func(*T) error) (*T, error) {
	sink := &jsonSink[T]{route: route}
	if err := c.rpc(ctx, route, payload, sink.read); err != nil {
		return nil, err
	}
	if err := check(&sink.out); err != nil {
		return nil, err
	}
	return &sink.out, nil
}

// Start начинает активацию: человек ввёл код.
func (c *Client) Start(ctx context.Context, req StartRequest) (*StartResponse, error) {
	return ask(ctx, c, routeStart, req, func(got *StartResponse) error {
		err := firstFinding(finding{
			bad:  got.ActivationID == "" || got.UserCode == "" || got.ConfirmURL == "",
			text: "betaapi: start response lacks activation_id, user_code or confirm_url",
		})
		if err == nil {
			got.Interval = orDefault(got.Interval)
		}
		return err
	})
}

type (
	FileRef struct {
		URL    string `json:"url"`
		SHA256 string `json:"sha256"`
		Bytes  int64  `json:"bytes"`
	}

	Release struct {
		Version     string  `json:"version"`
		Channel     string  `json:"channel"`
		Base        FileRef `json:"base"`
		Pak         FileRef `json:"pak"`
		Manifest    string  `json:"manifest"`
		ManifestSig string  `json:"manifest_sig"`
	}

	ChannelInfo struct {
		Channel string `json:"channel"`
		Version string `json:"version"`
	}
)

// ChannelList — список веток: массив объектов {channel, version} или (прежний
// вид) массив строк; элементы можно мешать.
type ChannelList []ChannelInfo

// notAnArray: значение, которое не массив. Стандартный разбор массива даёт свою ошибку
// платформы; если он, как ни странно, проходит, ошибка своя.
func notAnArray(data []byte) error {
	if err := json.Unmarshal(data, new([]json.RawMessage)); err != nil {
		return err
	}
	return errors.New("betaapi: channels is not an array")
}

// UnmarshalJSON идёт по массиву токенами. Пустой вход даёт ошибку чтения
// первого токена (EOF), null — пустой список. Дальше вход, прежде чем
// разбирать его как массив, проверяется целиком, иначе обрыв после открывающей
// скобки молча сошёл бы за пустой массив; любое значение, кроме массива,
// получает стандартную ошибку платформы.
func (l *ChannelList) UnmarshalJSON(data []byte) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	opening, err := dec.Token()
	if err != nil {
		return err
	}
	if opening == nil {
		*l = ChannelList{}
		return nil
	}
	if err := json.Unmarshal(data, new(any)); err != nil {
		return err
	}
	if opening != json.Delim('[') {
		return notAnArray(data)
	}
	list := ChannelList{}
	for dec.More() {
		info, err := nextChannel(dec)
		if err != nil {
			return err
		}
		list = append(list, info)
	}
	*l = list
	return nil
}

// nextChannel читает следующий элемент массива веток.
func nextChannel(dec *json.Decoder) (ChannelInfo, error) {
	var item json.RawMessage
	if err := dec.Decode(&item); err != nil {
		return ChannelInfo{}, err
	}
	info, err := channelFromJSON(item)
	if err != nil {
		return ChannelInfo{}, fmt.Errorf("betaapi: bad channels entry: %w", err)
	}
	return info, nil
}

// channelFromJSON: строка — имя ветки, всё остальное разбирается как объект.
func channelFromJSON(item json.RawMessage) (info ChannelInfo, err error) {
	if len(item) > 0 && item[0] == '"' {
		err = json.Unmarshal(item, &info.Channel)
	} else {
		err = json.Unmarshal(item, &info)
	}
	return
}

type PollResponse struct {
	Status   string `json:"status"`
	Interval int    `json:"interval"`
	Serial   string `json:"serial"`
	Account  struct {
		DisplayName string `json:"display_name"`
	} `json:"account"`
	Release    *Release    `json:"release"`
	Channels   ChannelList `json:"channels"`
	License    string      `json:"license"`
	BindSecret string      `json:"bind_secret"`
}

// Poll спрашивает, подтвердил ли человек активацию; channel пуст — ветку
// выбирает сервер.
func (c *Client) Poll(ctx context.Context, activationID, machine, channel string) (*PollResponse, error) {
	pairs := []string{"activation_id", activationID, "machine", machine}
	if channel != "" {
		pairs = append(pairs, "channel", channel)
	}
	return ask(ctx, c, routePoll, stringMap(pairs...), func(got *PollResponse) error {
		err := firstFinding(finding{
			bad:  got.Status != "pending" && got.Status != "confirmed",
			text: fmt.Sprintf("betaapi: unknown poll status %q", got.Status),
		})
		if err == nil {
			got.Interval = orDefault(got.Interval)
		}
		return err
	})
}

// Complete сообщает, что установка легла на диск. Тело ответа не разбирается.
func (c *Client) Complete(ctx context.Context, activationID, baseSHA256 string) error {
	drain := func(body io.Reader) error {
		_, _ = io.Copy(io.Discard, io.LimitReader(body, maxDrainBody))
		return nil
	}
	return c.rpc(ctx, routeComplete, stringMap("activation_id", activationID, "base_sha256", baseSHA256), drain)
}

// span — что просим у сервера: с позиции до конца или закрытый кусок.
type span struct {
	from, to int64
	bounded  bool
}

// closedSpan — закрытый кусок [from, to]; from больше to — ошибка.
func closedSpan(from, to int64) (span, error) {
	if from > to {
		return span{}, fmt.Errorf("betaapi: bad range [%d, %d]", from, to)
	}
	return span{from: from, to: to, bounded: true}, nil
}

// header — значение Range; пусто, если нужен весь файл.
func (s span) header() string {
	switch {
	case s.bounded:
		return fmt.Sprintf("bytes=%d-%d", s.from, s.to)
	case s.from > 0:
		return fmt.Sprintf("bytes=%d-", s.from)
	}
	return ""
}

// resumes: открытая докачка, которой можно начать файл заново после 416.
func (s span) resumes() bool { return s.from > 0 && !s.bounded }

// apiRoot — корень сервера, от которого разрешаются адреса файлов.
type apiRoot struct{ root *url.URL }

func parseRoot(origin string) (apiRoot, error) {
	root, err := url.Parse(origin)
	return apiRoot{root}, err
}

// within разрешает ссылку от корня и не пускает на чужой узел (схема и узел с
// портом должны совпасть без учёта регистра).
func (b apiRoot) within(ref string) (string, error) {
	rel, err := url.Parse(ref)
	if err != nil {
		return "", fmt.Errorf("betaapi: bad file url: %w", err)
	}
	abs := b.root.ResolveReference(rel)
	sameScheme := strings.EqualFold(abs.Scheme, b.root.Scheme)
	if sameHost := strings.EqualFold(abs.Host, b.root.Host); sameScheme && sameHost {
		return abs.String(), nil
	}
	return "", foreign(abs.Host)
}

// foreign — отказ в адресе файла на чужом узле.
func foreign(host string) error {
	return fmt.Errorf("betaapi: refusing a file url on a foreign host %q", host)
}

// OpenFile открывает файл с позиции from (0 — с начала).
func (c *Client) OpenFile(ctx context.Context, fileURL string, from int64) (*pack.Stream, error) {
	return c.openFile(ctx, fileURL, span{from: from})
}

// OpenFileRange открывает кусок [from, to], оба конца включительно.
func (c *Client) OpenFileRange(ctx context.Context, fileURL string, from, to int64) (*pack.Stream, error) {
	want, err := closedSpan(from, to)
	if err != nil {
		return nil, err
	}
	return c.openFile(ctx, fileURL, want)
}

func (c *Client) openFile(ctx context.Context, fileURL string, want span) (*pack.Stream, error) {
	root, err := parseRoot(c.Origin)
	if err == nil {
		var target string
		if target, err = root.within(fileURL); err == nil {
			return c.pull(ctx, target, want)
		}
	}
	return nil, pack.Fatal(err)
}

// pull запрашивает файл; после 416 на открытой докачке начинает с нуля.
func (c *Client) pull(ctx context.Context, target string, want span) (*pack.Stream, error) {
	resp, err := call{cl: c, method: http.MethodGet, target: target, rng: want.header()}.Do(ctx)
	if err == nil {
		return admitFile(resp, want)
	}
	var api *APIError
	errors.As(err, &api)
	switch {
	case api != nil && api.Status == http.StatusRequestedRangeNotSatisfiable && want.resumes():
		return c.pull(ctx, target, span{})
	case api != nil && api.Status < 500 && !retryableFileStatus(api.Status):
		return nil, pack.Fatal(err)
	case api == nil && IsNetwork(err) && errors.Is(ctx.Err(), context.Canceled):
		return nil, context.Canceled
	}
	return nil, err
}

// retryableFileStatus — отказы файла с кодом меньше 500, которые временные:
// слишком частые запросы (429) и перенаправление (3xx; клиент его не выполняет,
// но оно бывает минутным). Остальные коды меньше 500 — окончательный отказ.
func retryableFileStatus(status int) bool {
	if status == http.StatusTooManyRequests {
		return true
	}
	return status >= http.StatusMultipleChoices && status < http.StatusBadRequest
}

// wholeFile: сервер ответил 200 — отдал файл целиком, что годится только для запроса без куска.
func wholeFile(resp *http.Response, want span) (*pack.Stream, error) {
	if want.bounded {
		return nil, pack.Fatal(errors.New("betaapi: a ranged request got the whole file back (no Range support)"))
	}
	return &pack.Stream{Body: resp.Body, Offset: 0, Total: resp.ContentLength}, nil
}

// partOfFile: сервер ответил 206 — кусок; начало и размер берутся из Content-Range.
func partOfFile(resp *http.Response, want span) (*pack.Stream, error) {
	start, total, err := parseContentRange(resp.Header.Get("Content-Range"))
	if err != nil {
		return nil, err
	}
	if want.bounded && start != want.from {
		return nil, pack.Fatal(fmt.Errorf(
			"betaapi: asked for range from %d, server started at %d (no partial range support)", want.from, start))
	}
	return &pack.Stream{Body: resp.Body, Offset: start, Total: total}, nil
}

// admitFile превращает успешный ответ в поток или отказывает.
func admitFile(resp *http.Response, want span) (stream *pack.Stream, refusal error) {
	switch resp.StatusCode {
	case http.StatusOK:
		stream, refusal = wholeFile(resp, want)
	case http.StatusPartialContent:
		stream, refusal = partOfFile(resp, want)
	default:
		refusal = pack.Fatal(fmt.Errorf("betaapi: unexpected file status %d", resp.StatusCode))
	}
	if refusal != nil {
		resp.Body.Close()
	}
	return stream, refusal
}

// rangeParts режет «bytes <начало>-<конец>/<размер>» и отдаёт начало и размер
// строками; ok ложно, если форма не та.
func rangeParts(header string) (first, size string, ok bool) {
	unit, rest, ok := strings.Cut(strings.TrimSpace(header), " ")
	if !ok || unit != "bytes" {
		return "", "", false
	}
	window, size, ok := strings.Cut(rest, "/")
	if !ok {
		return "", "", false
	}
	first, _, ok = strings.Cut(window, "-")
	return first, size, ok
}

// parseContentRange читает «bytes <начало>-<конец>/<размер>»: берутся начало и
// размер («*» — неизвестен, -1); конец не проверяется. Числа читает
// strconv.ParseInt, поэтому знак «+» принимается; отрицательное начало нет.
// В тексте ошибки значение заголовка как пришло.
func parseContentRange(header string) (start, total int64, err error) {
	bad := fmt.Errorf("betaapi: bad Content-Range %q", header)
	first, size, ok := rangeParts(header)
	if !ok {
		return 0, 0, bad
	}
	if start, err = strconv.ParseInt(first, 10, 64); err != nil || start < 0 {
		return 0, 0, bad
	}
	if size == "*" {
		return start, -1, nil
	}
	if total, err = strconv.ParseInt(size, 10, 64); err != nil {
		return 0, 0, bad
	}
	return start, total, nil
}
