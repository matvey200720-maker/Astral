// Пакет applog — журнал установщика. Журнал читают люди, которые присылают
// его в поддержку, поэтому код беты и значения ticket= скрываются при записи.
package applog

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/codemark"
)

// Logger — всё, что остальным пакетам нужно от журнала.
type Logger interface {
	Printf(format string, args ...any)
}

// Nop — журнал, который ничего не пишет.
type Nop struct{}

// Printf ничего не делает: ни разбора формата, ни паники.
func (Nop) Printf(string, ...any) {}

// printer превращает функцию в Logger.
type printer func(format string, args ...any)

func (p printer) Printf(format string, args ...any) { p(format, args...) }

// New возвращает журнал, пишущий в w строки «метка текст». Каждая строка
// уходит одним вызовом Write; ошибки записи игнорируются.
func New(w io.Writer) Logger {
	var mu sync.Mutex
	return printer(func(format string, args ...any) {
		line := fmt.Appendf(nil, "%s %s\n",
			time.Now().Format("2006-01-02 15:04:05.000"),
			Redact(fmt.Sprintf(format, args...)))
		mu.Lock()
		defer mu.Unlock()
		_, _ = w.Write(line)
	})
}

// logFolder — папка журналов установщика и общий префикс их имён.
type logFolder struct{ dir, prefix string }

// owns: имя точно вида <prefix>-ГГГГММДД-ЧЧММСС.log, как его создаёт create. Файлы
// с тем же префиксом, но другой формы (журналы соседнего семейства вроде
// <prefix>-update-….log, чужие заметки), не наши и не чистятся.
func (f logFolder) owns(name string) bool {
	const stamped = "20060102-150405.log"
	rest, ok := strings.CutPrefix(name, f.prefix+"-")
	if !ok || len(rest) != len(stamped) {
		return false
	}
	for i := range stamped {
		switch stamped[i] {
		case '-', '.', 'l', 'o', 'g':
			if rest[i] != stamped[i] {
				return false
			}
		default:
			if rest[i] < '0' || rest[i] > '9' {
				return false
			}
		}
	}
	return true
}

// create открывает на дозапись новый журнал с меткой текущей секунды; два
// вызова в одну секунду открывают один и тот же файл.
func (f logFolder) create() (*os.File, error) {
	if err := os.MkdirAll(f.dir, 0o755); err != nil {
		return nil, err
	}
	stamp := time.Now().Format("20060102-150405")
	return os.OpenFile(filepath.Join(f.dir, f.prefix+"-"+stamp+".log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
}

// trim оставляет не больше keep журналов вместе со свежим fresh: идёт от
// самых поздних по имени (побайтно, так отдаёт и os.ReadDir) и удаляет всё,
// что не поместилось. Ошибки игнорируются.
func (f logFolder) trim(fresh string, keep int) {
	entries, err := os.ReadDir(f.dir)
	if err != nil {
		return
	}
	room := keep - 1
	for i := len(entries) - 1; i >= 0; i-- {
		name := entries[i].Name()
		if entries[i].IsDir() || name == fresh || !f.owns(name) {
			continue
		}
		if room > 0 {
			room--
			continue
		}
		_ = os.Remove(filepath.Join(f.dir, name))
	}
}

// Open открывает файл журнала <prefix>-<ГГГГММДД-ЧЧММСС>.log в dir на
// дозапись и оставляет не больше keep файлов с этим префиксом (с новым).
// Возвращаемый io.Closer — сам файл.
func Open(dir, prefix string, keep int) (Logger, io.Closer, error) {
	folder := logFolder{dir, prefix}
	file, err := folder.create()
	if err != nil {
		return nil, nil, err
	}
	folder.trim(filepath.Base(file.Name()), keep)
	return New(file), file, nil
}

// Код беты: слово BETA и четыре группы «-XXXX» (ASCII-буквы и цифры),
// с границами слова (ASCII) с обеих сторон. Кириллица словом не считается.
var codePattern = regexp.MustCompile(`\b[Bb][Ee][Tt][Aa]-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}\b`)

// Короткий код подтверждения во фрагменте адреса («#code=KQ7M2PXD»): в журнал и в тексты ошибок он не идёт.
var fragmentCodePattern = regexp.MustCompile(`#code=[0-9A-Za-z-]+`)

// Значение билета в адресе: всё до &, пробельного знака, кавычки или апострофа.
var ticketPattern = regexp.MustCompile(`[Tt][Ii][Cc][Kk][Ee][Tt]=[^&\s"']+`)

// MaskCode прячет код беты, оставляя последнюю группу как написана.
func MaskCode(s string) string {
	return codePattern.ReplaceAllStringFunc(s, func(code string) string {
		return "BETA-****-****-****-" + code[len(code)-4:]
	})
}

// MaskNameCode прячет код установки из имени файла целиком (правило конца кода общее с разбором имени — пакет codemark).
func MaskNameCode(s string) string {
	return codemark.Mask(s)
}

// Redact маскирует коды беты и коды из имени файла, затем скрывает значения ticket=.
func Redact(s string) string {
	masked := fragmentCodePattern.ReplaceAllString(MaskNameCode(MaskCode(s)), "#code=****")
	return ticketPattern.ReplaceAllStringFunc(masked, func(param string) string {
		const name = len("ticket=")
		return param[:name] + "***"
	})
}
