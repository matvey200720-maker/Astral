package pack

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"math/big"
	"os"
	"path/filepath"
)

const (
	mkdirPerm = 0o755
	// tempSpace — число возможных суффиксов временного файла: шесть случайных байт.
	tempSpace = 1 << 48
)

// tempSibling даёт имя временного файла рядом с path: path.tmp-<12 знаков 0-9a-f>.
func tempSibling(path string) (string, error) {
	salt, err := rand.Int(rand.Reader, big.NewInt(tempSpace))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s.tmp-%012x", path, salt), nil
}

// sessionStep — один шаг публикации файла.
type sessionStep func() error

// writeSession ведёт публикацию одного файла: временный файл рядом с целью,
// цепочка шагов и общая уборка при выходе.
type writeSession struct {
	target  string
	tmp     string
	out     *os.File
	made    bool
	cleanup []func()
}

// run выполняет шаги по порядку до первой ошибки. При выходе закрывается всё,
// что зарегистрировано (в обратном порядке), а после неудачи стирается
// созданный временный файл.
func (w *writeSession) run(steps ...sessionStep) (err error) {
	defer func() {
		for i := len(w.cleanup) - 1; i >= 0; i-- {
			w.cleanup[i]()
		}
		if err != nil && w.made {
			_ = os.Remove(w.tmp)
		}
	}()
	for _, next := range steps {
		if err = next(); err != nil {
			return err
		}
	}
	return nil
}

// parent создаёт родительскую папку цели.
func (w *writeSession) parent() error {
	return os.MkdirAll(filepath.Dir(w.target), mkdirPerm)
}

// create открывает временный файл с заданными флагами и правами.
func (w *writeSession) create(flag int, perm os.FileMode) sessionStep {
	return func() (err error) {
		if w.tmp, err = tempSibling(w.target); err != nil {
			return err
		}
		if w.out, err = os.OpenFile(w.tmp, flag, perm); err != nil {
			return err
		}
		w.made = true
		w.cleanup = append(w.cleanup, func() { _ = w.out.Close() })
		return nil
	}
}

// fill отдаёт временный файл как приёмник для produce.
func (w *writeSession) fill(produce func(dst io.Writer) error) sessionStep {
	return func() error { return produce(w.out) }
}

// hold держит closer открытым до конца сессии, то есть и во время переименования.
func (w *writeSession) hold(c io.Closer) {
	w.cleanup = append(w.cleanup, func() { _ = c.Close() })
}

// flush сбрасывает временный файл на диск.
func (w *writeSession) flush() error { return w.out.Sync() }

// seal закрывает временный файл.
func (w *writeSession) seal() error { return w.out.Close() }

// publish ставит временный файл на место цели.
func (w *writeSession) publish() error { return renameRetrying(w.tmp, w.target) }

// WriteFileAtomic пишет файл «целиком или никак»; ошибки возвращаются как есть.
func WriteFileAtomic(path string, data []byte, perm os.FileMode) error {
	w := &writeSession{target: path}
	return w.run(
		w.parent,
		w.create(os.O_WRONLY|os.O_CREATE|os.O_TRUNC, perm),
		w.fill(func(dst io.Writer) error {
			_, err := dst.Write(data)
			return err
		}),
		w.seal,
		w.publish,
	)
}

// CopyFileAtomic копирует src в dst «целиком или никак». Источник остаётся
// открытым до возврата, поэтому копия файла на себя на Windows не пройдёт.
func CopyFileAtomic(src, dst string) error {
	w := &writeSession{target: dst}
	var source *os.File
	return w.run(
		func() (err error) {
			if source, err = os.Open(src); err == nil {
				w.hold(source)
			}
			return err
		},
		w.parent,
		w.create(os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o755),
		w.fill(func(dst io.Writer) error {
			_, err := io.Copy(dst, source)
			return err
		}),
		w.flush,
		w.seal,
		w.publish,
	)
}

// withOpen открывает файл на чтение на время use.
func withOpen(path string, use func(*os.File) error) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return use(f)
}

// SHA256File — хэш файла строчными шестнадцатеричными знаками.
func SHA256File(path string) (string, error) {
	digest := sha256.New()
	err := withOpen(path, func(f *os.File) error {
		_, err := io.Copy(io.Discard, io.TeeReader(f, digest))
		return err
	})
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", digest.Sum(nil)), nil
}

// ctxReader прерывает чтение, когда ctx отменён.
type ctxReader struct {
	ctx context.Context
	r   io.Reader
}

func (c ctxReader) Read(p []byte) (int, error) {
	if err := c.ctx.Err(); err != nil {
		return 0, err
	}
	return c.r.Read(p)
}

// SHA256FileContext — как SHA256File, но обрывается с ошибкой ctx, когда его отменили.
func SHA256FileContext(ctx context.Context, path string) (string, error) {
	digest := sha256.New()
	err := withOpen(path, func(f *os.File) error {
		_, err := io.Copy(digest, ctxReader{ctx: ctx, r: f})
		return err
	})
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", digest.Sum(nil)), nil
}

// Exists: путь есть; любая ошибка Stat читается как «нет».
func Exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// IsNotExist: ошибка — «не найдено», в том числе под обёртками.
func IsNotExist(err error) bool {
	return errors.Is(err, os.ErrNotExist)
}
