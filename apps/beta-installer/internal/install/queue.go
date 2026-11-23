package install

import (
	"context"
	"errors"
	"math"
	"math/rand/v2"
	"time"

	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/betaapi"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/pack"
)

// Очередь на скачивании (первый день открытого релиза). Сервер ограничивает число одновременных скачиваний и отвечает
// отказом 429, 502, 503 или 504, чаще всего с Retry-After. Это штатный режим, а не ошибка установки: окно показывает
// «ждём своей очереди» с обратным отсчётом (событие download.queue), хост повторяет без предела, пока человек не
// отменит. Начатое докачивается: base с места (Range, кусочный список chunks), pak сервер отдаёт только целиком.
// Остальные отказы (в том числе 500 и 403 с билетом) идут прежним путём: несколько попыток и ошибка с «Повторить».

const (
	queueMinWait = time.Second
	queueMaxWait = 5 * time.Minute
)

// defaultQueueBackoff — паузы, когда сервер не сказал Retry-After; последняя повторяется.
var defaultQueueBackoff = []time.Duration{5 * time.Second, 10 * time.Second, 15 * time.Second, 20 * time.Second, 30 * time.Second}

// queueHint: ошибка — отказ из-за нагрузки сервера (429, 502, 504, 503 SERVER_BUSY или без кода); hint — что он просил подождать (0, если не просил).
func queueHint(err error) (hint time.Duration, busy bool) {
	var api *betaapi.APIError
	if !errors.As(err, &api) {
		return 0, false
	}
	switch api.Status {
	case 429:
		// Потолки сети и установки и общий бюджет сети — RATE_LIMITED (или голый 429 без документа). Суточный объём установки
		// (DAILY_LIMIT, Retry-After до часа) — не очередь: ждать пять минут бессмысленно, см. dailyLimit.
		if api.Code == "RATE_LIMITED" || api.Code == "" {
			return api.RetryAfter, true
		}
	case 502, 504:
		return api.RetryAfter, true
	case 503:
		// Перегруз — SERVER_BUSY (потолок скачиваний на сервере) или голый 503 без документа (прокси). 503 с другим кодом
		// (BETA_RELEASE_UNAVAILABLE: версию сняли, BETA_UNAVAILABLE: постоянный сбой или пауза установок) — не очередь:
		// прежний путь, несколько попыток и ошибка с «Повторить».
		if api.Code == "SERVER_BUSY" || api.Code == "" {
			return api.RetryAfter, true
		}
	}
	return 0, false
}

// dailyLimit: суточный объём скачиваний этой установки исчерпан (429 DAILY_LIMIT). Окончательный отказ без повторов:
// окно говорит словами «на сегодня предел исчерпан» и даёт «Повторить».
func dailyLimit(err error) bool {
	var api *betaapi.APIError
	return errors.As(err, &api) && api.Status == 429 && api.Code == "DAILY_LIMIT"
}

// queueDelay — сколько ждать перед следующей попыткой: Retry-After сервера (не меньше секунды и не больше пяти минут)
// или ступенька паузы по номеру попытки, плюс до пятой части сверху, чтобы очередь не пришла в один миг.
func (r *Runner) queueDelay(hint time.Duration, tries int) time.Duration {
	base := hint
	if base <= 0 {
		steps := r.cfg.QueueBackoff
		if len(steps) == 0 {
			steps = defaultQueueBackoff
		}
		base = steps[min(max(tries-1, 0), len(steps)-1)]
	} else {
		base = min(max(base, queueMinWait), queueMaxWait)
	}
	return base + time.Duration(rand.Int64N(int64(base)/5+1))
}

// queueEvent — тело события download.queue: какой файл, через сколько секунд следующая попытка, какая по счёту.
func queueEvent(name string, wait time.Duration, tries int) map[string]any {
	secs := int(math.Ceil(wait.Seconds()))
	return map[string]any{"file": name, "waitSec": max(secs, 0), "tries": tries}
}

// waitInQueue говорит окну, что мы в очереди, и ждёт; отмена прерывает ожидание.
func (r *Runner) waitInQueue(ctx context.Context, run *installRun, name string, hint time.Duration, tries int) error {
	wait := r.queueDelay(hint, tries)
	r.log.Printf("download queue: the server is busy (try %d), the next attempt in %s", tries, wait.Round(time.Second))
	r.rt.Emit("download.queue", queueEvent(name, wait, tries))
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case <-timer.C:
	case <-ctx.Done():
		return ctx.Err()
	}
	return nil
}

// busyAsFatal помечает отказ по нагрузке окончательным для pack.Download: ждать будет хост (с обратным отсчётом в окне),
// а не тихие повторы внутри скачивания.
func busyAsFatal(err error) error {
	if _, busy := queueHint(err); busy {
		return pack.Fatal(err)
	}
	return err
}
