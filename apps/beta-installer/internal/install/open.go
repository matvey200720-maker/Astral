package install

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/betaapi"
)

// Открытый режим (19.11.2026): человек не вводит код. Код приходит сам — в имени файла установщика
// (AstralSetup-release-k<16 знаков>.exe, Config.AutoCode). Есть код в имени — он и используется, что бы ни ответил сервер
// (после отката на закрытый режим выпущенные коды сайта ещё принимаются), и сети для решения не нужно: первый экран
// не ждёт. Кода в имени нет — спрашиваем сервер (GET /api/v1/public/beta): открыт — окно просит скачать установщик
// заново на сайте, закрыт — прежний экран кода, не ответил — «нет связи с сервером» и «Повторить» (следующий init
// спросит снова). Код не покидает хост: ни страница, ни журнал его не видят.

// openProbeWait — сколько первый экран ждёт ответа сервера о доступе, когда кода в имени нет.
const openProbeWait = 1500 * time.Millisecond

// errNoOpenCode — в открытом режиме в имени файла нет кода установки.
var errNoOpenCode = errors.New("the installer file name carries no install code")

// accessProber — необязательная возможность клиента: открытый ответ сервера о доступе.
// У поддельных клиентов тестов её нет, и тогда считается «закрыто» (прежний экран кода).
type accessProber interface {
	PublicBeta(ctx context.Context) (*betaapi.PublicStatus, error)
}

// openAnswer — итог проверки: открыт ли режим без кода, есть ли в имени код, не удалось ли связаться с сервером и
// окончательный ли ответ (его запоминают на сеанс).
type openAnswer struct{ open, withCode, unreachable, settled bool }

func (r *Runner) decideOpen(ctx context.Context) openAnswer {
	if r.cfg.AutoCode != "" {
		return openAnswer{open: true, withCode: true, settled: true}
	}
	prober, ok := r.api.(accessProber)
	if !ok {
		return openAnswer{settled: true}
	}
	bounded, release := context.WithTimeout(ctx, openProbeWait)
	got, err := prober.PublicBeta(bounded)
	release()
	if err != nil {
		r.log.Printf("public access probe failed: %v", err)
		return openAnswer{unreachable: true}
	}
	return openAnswer{open: got.Open(), settled: true}
}

// refreshOpen: решение для текущего init; окончательный ответ запоминается на сеанс, «нет связи» — нет.
func (r *Runner) refreshOpen(ctx context.Context) openAnswer {
	if r.openSure.Load() {
		return openAnswer{open: r.openMode.Load(), withCode: r.openCode.Load(), settled: true}
	}
	got := r.decideOpen(ctx)
	r.openMode.Store(got.open)
	r.openCode.Store(got.withCode)
	r.openSure.Store(got.settled)
	return got
}

// startCode: код для install/start. В открытом режиме пустой ввод означает «код из имени файла»;
// его нет — отказ (окно просит скачать установщик заново). В закрытом ввод проверяется как раньше.
func (r *Runner) startCode(input string) (string, error) {
	if r.openMode.Load() && strings.TrimSpace(input) == "" {
		if r.cfg.AutoCode == "" {
			return "", errNoOpenCode
		}
		return r.cfg.AutoCode, nil
	}
	return NormalizeCode(input)
}
