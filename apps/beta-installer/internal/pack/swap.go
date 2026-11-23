package pack

import (
	"errors"
	"fmt"
	"os"
	"time"
)

// Единственные точки, через которые модуль переименовывает и ждёт.
var (
	renameFn func(from, to string) error = os.Rename
	sleepFn  func(d time.Duration)       = time.Sleep
)

const (
	renameAttempts = 6
	renamePause    = 150 * time.Millisecond
	removeAttempts = 5
	removePause    = 200 * time.Millisecond
)

// retryPolicy описывает, сколько раз и с какой паузой повторять операцию.
// Пауза выдерживается после каждой неудачной попытки, повторной или нет.
type retryPolicy struct {
	attempts int
	pause    time.Duration
	retryOn  func(error) bool
}

var (
	renamePolicy = retryPolicy{renameAttempts, renamePause, isBusy}
	removePolicy = retryPolicy{removeAttempts, removePause, func(error) bool { return true }}
)

// do запускает op по политике и возвращает последнюю ошибку.
func (p retryPolicy) do(op func() error) error {
	err := op()
	if err == nil || !p.retryOn(err) {
		return err
	}
	sleepFn(p.pause)
	if p.attempts <= 1 {
		return err
	}
	p.attempts--
	return p.do(op)
}

// ErrBusy узнаётся через errors.Is у любой ошибки «папка занята».
var ErrBusy = errors.New("directory is busy or access is denied")

// BusyError — «занято» с путём, который вызывающий показывает человеку.
type BusyError struct {
	Path string
	Err  error
}

func (e *BusyError) Error() string        { return fmt.Sprint(e.Path, ": ", e.Err) }
func (e *BusyError) Unwrap() error        { return e.Err }
func (e *BusyError) Is(target error) bool { return errors.Is(ErrBusy, target) }

// renameRetrying — переименование по политике, ошибка как есть.
func renameRetrying(from, to string) error {
	return renamePolicy.do(func() error { return renameFn(from, to) })
}

// relocate переименовывает и называет виновника: «занято» превращается
// в *BusyError с путём blame, прочие ошибки идут как есть.
func relocate(blame, from, to string) error {
	err := renameRetrying(from, to)
	if isBusy(err) {
		return &BusyError{Path: blame, Err: err}
	}
	return err
}

// RenameRetry переименовывает файл или папку; в BusyError попадает путь источника.
func RenameRetry(from, to string) error { return relocate(from, from, to) }

// RemoveAllRetry стирает path целиком, повторяя на любую ошибку.
func RemoveAllRetry(path string) error {
	return removePolicy.do(func() error { return os.RemoveAll(path) })
}

// Фазы замены. Нулевая — «ничего не сделано или всё откатано».
type swapPhase uint8

const (
	phaseIdle     swapPhase = iota
	phaseSwapped            // новая папка стоит на месте target
	phaseDetached           // target уже унесён в newDir, прежняя папка ещё в oldDir
)

// Swap — выполненная замена папки. Нулевое значение безвредно.
type Swap struct {
	newDir, target, oldDir string
	hadOld                 bool
	phase                  swapPhase
}

// phaseStep — шаг перехода: действие и фаза, в которой замена оказывается после него.
type phaseStep struct {
	act  func(*Swap) error
	next swapPhase
}

var (
	// rollbackPlan[фаза] — что делать Rollback, начиная с этой фазы.
	rollbackPlan = [...][]phaseStep{
		phaseIdle:     nil,
		phaseSwapped:  {{(*Swap).detach, phaseDetached}, {(*Swap).restore, phaseIdle}},
		phaseDetached: {{(*Swap).restore, phaseIdle}},
	}
	// commitPlan[фаза] — что делает Commit; в фазе phaseIdle ничего.
	commitPlan = [...]func(*Swap) error{
		phaseIdle:     nil,
		phaseSwapped:  (*Swap).purge,
		phaseDetached: (*Swap).purge,
	}
)

// detach уносит target обратно в newDir.
func (s *Swap) detach() error { return relocate(s.target, s.target, s.newDir) }

// restore возвращает прежнюю папку, если она была.
func (s *Swap) restore() error {
	if !s.hadOld {
		return nil
	}
	return relocate(s.target, s.oldDir, s.target)
}

// purge стирает прежнюю папку, если она была.
func (s *Swap) purge() error {
	if !s.hadOld {
		return nil
	}
	return RemoveAllRetry(s.oldDir)
}

// Rollback возвращает прежнюю папку; после отказа его можно вызвать снова:
// сделанная половина не повторяется.
func (s *Swap) Rollback() error {
	for _, st := range rollbackPlan[s.phase] {
		if err := st.act(s); err != nil {
			return err
		}
		s.phase = st.next
	}
	return nil
}

// Commit принимает замену: стирает прежнюю папку и закрывает замену, так что
// Rollback после него ничего не делает (откатывать нечего, а унести принятую
// папку он мог бы). Отказ стирания замену не закрывает: Commit можно повторить.
func (s *Swap) Commit() error {
	if act := commitPlan[s.phase]; act != nil {
		if err := act(s); err != nil {
			return err
		}
	}
	s.phase = phaseIdle
	return nil
}

// SwapDirs ставит newDir на место target; прежний target уезжает в oldDir.
func SwapDirs(newDir, target, oldDir string) (*Swap, error) {
	preflight := []func() error{
		func() error {
			if fi, err := os.Stat(newDir); err != nil || !fi.IsDir() {
				return fmt.Errorf("new directory %q is missing", newDir)
			}
			return nil
		},
		func() error {
			if err := RemoveAllRetry(oldDir); err != nil {
				return fmt.Errorf("remove stale %q: %w", oldDir, err)
			}
			return nil
		},
	}
	for _, check := range preflight {
		if err := check(); err != nil {
			return nil, err
		}
	}

	_, probe := os.Stat(target)
	moves := []struct{ from, to string }{{target, oldDir}, {newDir, target}}
	hadOld := probe == nil
	if !hadOld {
		moves = moves[1:]
	}
	for done, mv := range moves {
		if err := relocate(target, mv.from, mv.to); err != nil {
			for back := done - 1; back >= 0; back-- {
				_ = renameRetrying(moves[back].to, moves[back].from)
			}
			return nil, err
		}
	}
	return &Swap{newDir: newDir, target: target, oldDir: oldDir, hadOld: hadOld, phase: phaseSwapped}, nil
}
