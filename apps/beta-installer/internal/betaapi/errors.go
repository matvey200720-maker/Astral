package betaapi

import (
	"context"
	"errors"
	"math"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/bridge"
)

const (
	codeTicketInvalid = "BETA_TICKET_INVALID"
	codeRateLimited   = "RATE_LIMITED"
	codeServerDown    = "SERVER_UNAVAILABLE"
	codeNetworkDown   = "NETWORK_UNAVAILABLE"
	codeInternal      = "INTERNAL"
)

// APIError — ответ сервера с кодом ошибки. Ошибкой является указатель.
type APIError struct {
	Status     int
	Code       string
	Title      string
	Detail     string
	RetryAfter time.Duration
}

func (e *APIError) Error() string {
	var sb strings.Builder
	sb.WriteString("api ")
	sb.WriteString(strconv.Itoa(e.Status))
	for _, part := range [...]struct{ sep, val string }{{" ", e.Code}, {": ", e.Detail}} {
		if part.val != "" {
			sb.WriteString(part.sep + part.val)
		}
	}
	return sb.String()
}

// RetryDelay — сколько сервер просил подождать перед повтором (Retry-After); 0 — не просил.
// Так скачивание в pack узнаёт о просьбе, не зная про этот пакет.
func (e *APIError) RetryDelay() time.Duration { return e.RetryAfter }

// NetError — сбой на уровне сети. Ошибкой является указатель.
type NetError struct {
	Err error
}

func (e *NetError) Error() string { return "network: " + e.Err.Error() }

func (e *NetError) Unwrap() error { return e.Err }

func IsNetwork(err error) bool {
	return errors.As(err, new(*NetError))
}

// Code — серверный код из первого *APIError в цепочке.
func Code(err error) (code string) {
	if api := asAPI(err); api != nil {
		code = api.Code
	}
	return
}

func asAPI(err error) (api *APIError) {
	errors.As(err, &api)
	return
}

// IsTicketProblem: билет на файл погас, нужен новый poll.
func IsTicketProblem(err error) bool { return Code(err) == codeTicketInvalid }

// band — полоса статусов, которую мост считает «можно повторить».
type band struct {
	lo, hi int
	code   string // код для моста
	pause  bool   // передавать Retry-After
}

var retryBands = []band{
	{429, 429, codeRateLimited, true},
	{500, math.MaxInt, codeServerDown, false},
}

func bandOf(status int) (band, bool) {
	at := slices.IndexFunc(retryBands, func(b band) bool { return status >= b.lo && status <= b.hi })
	if at < 0 {
		return band{}, false
	}
	return retryBands[at], true
}

// IsTransient: стоит повторить позже.
func IsTransient(err error) bool {
	switch api := asAPI(err); {
	case IsNetwork(err):
		return true
	case api == nil:
		return false
	default:
		_, retry := bandOf(api.Status)
		return retry
	}
}

// passRule — как серверный код, переданный в мост как есть, ведёт себя при
// повторе.
type passRule struct {
	retryable bool
	pause     bool
}

// passCodes — коды сервера, которые мост получает без изменений. Остальные
// коды решает статус ответа.
var passCodes = map[string]passRule{
	"BETA_CODE_INVALID":       {},
	"BETA_CODE_USED":          {},
	"BETA_CODE_EXPIRED":       {},
	"BETA_CODE_REVOKED":       {},
	"BETA_NOT_REGISTERED":     {},
	"BETA_ACTIVATION_DENIED":  {},
	"BETA_ACTIVATION_REVOKED": {},
	"BETA_ACTIVATION_EXPIRED": {},
	"DPOP_INVALID":            {},
	codeTicketInvalid:         {},
	"BETA_CHANNEL_DENIED":     {},
	codeRateLimited:           {retryable: true, pause: true},
	"BETA_UNAVAILABLE":        {retryable: true},
	"DAILY_LIMIT":             {retryable: true, pause: true},
}

// bridgeRules — конвейер перевода: первое правило, которое узнало ошибку,
// отвечает. Что не узнано, отдаётся мосту как есть.
var bridgeRules = []func(error) (*bridge.Error, bool){
	answerFromServer,
	answerFromNetwork,
	answerFromDeadline,
}

// ToBridgeError переводит ошибку клиента в ошибку для страницы. Для nil
// результат nil.
func ToBridgeError(err error) *bridge.Error {
	if err == nil {
		return nil
	}
	for _, rule := range bridgeRules {
		if out, ok := rule(err); ok {
			return out
		}
	}
	return bridge.AsError(err)
}

func answerFromServer(err error) (*bridge.Error, bool) {
	api := asAPI(err)
	if api == nil {
		return nil, false
	}
	out := &bridge.Error{Code: api.Code, Detail: api.Detail, HTTPStatus: api.Status}
	pause := func(on bool) {
		if on {
			out.RetryAfterSec = ceilSeconds(api.RetryAfter)
		}
	}
	if rule, known := passCodes[api.Code]; known {
		out.Retryable = rule.retryable
		pause(rule.pause)
	} else if b, retry := bandOf(api.Status); retry {
		out.Code, out.Retryable = b.code, true
		pause(b.pause)
	} else {
		out.Code = codeInternal
		if api.Code != "" {
			out.Detail = "server code " + api.Code + ": " + api.Detail
		}
	}
	return out, true
}

func answerFromNetwork(err error) (out *bridge.Error, ok bool) {
	if ok = IsNetwork(err); ok {
		out = &bridge.Error{Code: codeNetworkDown, Retryable: true, Detail: err.Error()}
	}
	return
}

func answerFromDeadline(err error) (out *bridge.Error, ok bool) {
	if ok = errors.Is(err, context.DeadlineExceeded); ok {
		out = &bridge.Error{Code: codeNetworkDown, Retryable: true, Detail: "timeout"}
	}
	return
}

// ceilSeconds округляет вверх до целых секунд; ноль и отрицательное — 0.
// Считает делением, поэтому у самых больших значений не переполняется.
func ceilSeconds(d time.Duration) int {
	if d <= 0 {
		return 0
	}
	secs := d / time.Second
	if d%time.Second != 0 {
		secs++
	}
	return int(secs)
}

// maxRetryAfter — предел паузы из Retry-After: просьба подождать больше суток
// ничего не значит, а огромное число переполнило бы time.Duration.
const maxRetryAfter = 24 * time.Hour

// pauseParser читает значение Retry-After в одном из форматов.
type pauseParser func(text string) (time.Duration, bool)

var pauseParsers = []pauseParser{pauseFromSeconds, pauseFromDate}

// parseRetryAfter разбирает заголовок Retry-After: целые секунды или дата
// RFC 1123. Непонятное, отрицательное и прошедшее — 0; больше суток — сутки.
func parseRetryAfter(value string) (pause time.Duration) {
	text := strings.TrimSpace(value)
	for _, parse := range pauseParsers {
		var ok bool
		if pause, ok = parse(text); ok {
			return
		}
	}
	return 0
}

// pauseFromSeconds читает целые секунды; число, не помещающееся в int64, — это
// «очень долго», его, как и любое большое, режет предел.
func pauseFromSeconds(text string) (time.Duration, bool) {
	n, err := strconv.ParseInt(text, 10, 64)
	if errors.Is(err, strconv.ErrRange) && n > 0 {
		err = nil
	}
	if err != nil || n < 0 {
		return 0, false
	}
	return time.Duration(min(n, int64(maxRetryAfter/time.Second))) * time.Second, true
}

func pauseFromDate(text string) (time.Duration, bool) {
	if when, err := time.Parse(time.RFC1123, text); err == nil {
		return min(max(time.Until(when), 0), maxRetryAfter), true
	}
	return 0, false
}
