package update

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"slices"
	"time"

	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/bridge"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/layout"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/pack"
)

// ReasonCrashBeforeStable — причина в failed.json: версия отрисовала окно, но
// дважды вылетела раньше срока «стабильности».
const ReasonCrashBeforeStable = "crash_before_stable"

const codeNothingToRollBack = "NOTHING_TO_ROLL_BACK"

// PendingStable — запись «прежняя версия ждёт стабильности новой».
type PendingStable struct {
	Version  string `json:"version"`
	Sequence int64  `json:"sequence"`
	From     string `json:"from"`
	At       string `json:"at"`
}

// decodeJSON разбирает документ в значение типа T.
func decodeJSON[T any](raw []byte) (*T, error) {
	value := new(T)
	if err := json.Unmarshal(raw, value); err != nil {
		return nil, err
	}
	return value, nil
}

func readPendingStableFile(l layout.Layout) ([]byte, error) {
	return os.ReadFile(l.PendingStable())
}

// readPendingStable читает update\pending-stable.json.
func readPendingStable(l layout.Layout) (*PendingStable, error) {
	raw, err := readPendingStableFile(l)
	if err != nil {
		return nil, err
	}
	return decodeJSON[PendingStable](raw)
}

// isBadDocument: ошибка разбора JSON (обрыв, не тот тип), а не ошибка чтения файла.
func isBadDocument(err error) bool {
	var syntax *json.SyntaxError
	var typed *json.UnmarshalTypeError
	return errors.As(err, &syntax) || errors.As(err, &typed)
}

// reversal — один откат прежней версии.
type reversal struct {
	r   *Runner
	ctx context.Context
	lay layout.Layout
	rec *PendingStable
}

// shrug — причина, по которой возвращать нечего.
type shrug struct {
	logLine string // строка журнала без префикса
	detail  string // подробность отказа
	erase   bool   // стереть запись
}

// RollbackOld — работа хелпера «--rollback-old»: дождаться выхода лаунчера и
// вернуть прежнюю версию, если новая не успела стать стабильной.
func (r *Runner) RollbackOld(ctx context.Context) Outcome {
	if bad := rootProblem(r.cfg.Root, true); bad != nil {
		return *bad
	}
	if pid := r.cfg.PID; pid > 0 {
		if exited, err := r.sys.WaitExit(pid, r.cfg.WaitPID); err != nil || !exited {
			return refuse(codeAppRunning, fmt.Sprintf("the launcher (pid %d) did not exit within %s", pid, r.cfg.WaitPID))
		}
	}
	lay := layout.New(r.cfg.Root)
	rec, why := r.pendingRecord(lay)
	if why != nil {
		r.log.Printf("rollback-old: %s", why.logLine)
		if why.erase {
			_ = os.Remove(lay.PendingStable())
		}
		r.startPrevious(lay)
		return refuse(codeNothingToRollBack, why.detail)
	}
	return (&reversal{r: r, ctx: ctx, lay: lay, rec: rec}).perform()
}

// previousLeft сообщает, осталось ли что возвращать.
func previousLeft(lay layout.Layout) bool {
	places := []string{lay.AppOld()}
	for _, name := range betaFiles {
		places = append(places, lay.BetaFile(name+".old"))
	}
	return slices.ContainsFunc(places, pack.Exists)
}

// installedVersionMismatch: установленная версия ветки отличается от версии в rec.
func installedVersionMismatch(lay layout.Layout, rec *PendingStable) (now string, mismatched bool) {
	now = installedVersion(lay)
	return now, now != rec.Version
}

// pendingRecord читает запись и проверяет, что она про установленную версию
// и что есть что возвращать.
func (r *Runner) pendingRecord(lay layout.Layout) (*PendingStable, *shrug) {
	rec, err := readPendingStable(lay)
	unusable := err != nil
	if !unusable {
		unusable = rec.Version == ""
	}
	if unusable {
		// Нечитаемую запись стереть нельзя (может быть занята и потом прочтётся), а прочитанную, но
		// негодную, надо: она ничему не послужит, и без этого лежала бы при каждом запуске.
		return nil, &shrug{
			logLine: fmt.Sprintf("no pending-stable record (%v)", err),
			detail:  "no pending-stable record",
			erase:   err == nil || isBadDocument(err),
		}
	}
	if now, mismatched := installedVersionMismatch(lay, rec); mismatched {
		text := fmt.Sprintf("the record is for %s, but %s is installed", rec.Version, now)
		return nil, &shrug{logLine: text, detail: text, erase: true}
	}
	if !previousLeft(lay) {
		text := fmt.Sprintf("the previous version of %s is already gone", rec.Version)
		return nil, &shrug{logLine: text, detail: text, erase: true}
	}
	return rec, nil
}

// perform возвращает app, файлы beta\, пишет причину и запускает прежнюю версию.
func (v *reversal) perform() Outcome {
	r, lay, rec := v.r, v.lay, v.rec
	if pack.Exists(lay.AppOld()) {
		if err := v.returnApp(); err != nil {
			r.log.Printf("rollback-old: could not return app.old: %v", err)
			r.startPrevious(lay)
			return Outcome{
				Version: rec.Version, Code: ExitFailed, Kind: "error",
				Err: &bridge.Error{Code: codeDenied, Detail: "rollback_old_failed: " + err.Error()},
			}
		}
		logIfError(r.log, pack.RemoveAllRetry(lay.AppBad()), "rollback-old: could not remove app.bad: %v")
	}
	v.returnBeta()
	v.leaveNote()

	r.log.Printf("rollback-old: %s did not become stable, restored %s", rec.Version, rec.From)
	r.startPrevious(lay)
	return Outcome{
		Version: rec.Version, Code: ExitRolledBack, Kind: "rolledback",
		Reason: ReasonCrashBeforeStable, Restored: rec.From,
	}
}

// returnApp ставит app.old на место app (новая версия уходит в app.bad),
// повторяя попытку до срока RollbackWindow или отмены ctx.
func rollbackDeadline(cfg Config) time.Time {
	return time.Now().Add(cfg.RollbackWindow)
}

func (v *reversal) returnApp() error {
	swapBack := func() error {
		_, err := pack.SwapDirs(v.lay.AppOld(), v.lay.App(), v.lay.AppBad())
		return err
	}
	return persist(rollbackDeadline(v.r.cfg), func() bool { return v.ctx.Err() != nil }, swapBack)
}

// restoreBetaFile возвращает один файл beta\ из его .old.
// Файл стирать заранее нельзя: переименование само заменяет текущий, а если оно не
// удалось (.old занят), текущий должен остаться на месте, а не пропасть.
func (v *reversal) restoreBetaFile(name string) {
	cur := v.lay.BetaFile(name)
	if err := pack.RenameRetry(cur+".old", cur); err != nil {
		v.r.log.Printf(`rollback-old: could not return beta\%s: %v`, name, err)
	}
}

// returnBeta возвращает те файлы beta\, у которых есть .old; неудача одного не
// мешает остальным.
func (v *reversal) returnBeta() {
	shelved := slices.DeleteFunc(slices.Clone(betaFiles[:]), func(name string) bool {
		return !pack.Exists(v.lay.BetaFile(name + ".old"))
	})
	for _, name := range shelved {
		v.restoreBetaFile(name)
	}
}

// leaveNote записывает причину отката и убирает сигнальные файлы.
func (v *reversal) leaveNote() {
	note := map[string]any{
		"at": nowUTC(), "reason": ReasonCrashBeforeStable, "sequence": v.rec.Sequence, "version": v.rec.Version,
	}
	logIfError(v.r.log, writeSignal(v.lay.FailedJSON(), note), "rollback-old: could not write failed.json: %v")
	for _, signal := range []string{v.lay.PendingStable(), v.lay.BootOK()} {
		_ = os.Remove(signal)
	}
}
