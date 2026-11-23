// Пакет chstatus — файл состояния режима «ставим ветку рядом»:
// <общая папка данных Astral>\install-channel\<ветка>.json. Пишут лаунчер и
// хелпер, читает раннер передачи в установщике, скачанном с сайта.
package chstatus

import (
	"cmp"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"time"

	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/layout"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/pack"
)

// Значения поля State.
const Working = "working"
const Done = "done"
const Error = "error"

// validStates — значения State.State, которые читатель принимает.
var validStates = [...]string{Working, Done, Error}

// Int возвращает указатель на копию числа.
func Int(v int) *int {
	p := new(int)
	*p = v
	return p
}

// Remove стирает файл (или пустую папку); ошибки не возвращает.
func Remove(path string) {
	_ = os.Remove(path)
}

// Path возвращает путь файла ветки; для имени, которого нет среди известных веток,
// пустую строку (имя не должно выводить путь за папку install-channel).
func Path(sharedDataDir string, ch layout.Channel) (p string) {
	if ch.Valid() {
		name := string(ch) + ".json"
		p = filepath.Join(sharedDataDir, "install-channel", name)
	}
	return
}

// Write атомарно пишет состояние; пустой At заменяется текущим временем UTC.
func Write(path string, st State) (err error) {
	st.At = cmp.Or(st.At, time.Now().In(time.UTC).Format(time.RFC3339))
	var data []byte
	if data, err = json.Marshal(st); err != nil {
		return
	}
	dir := filepath.Dir(path)
	if err = os.MkdirAll(dir, 0o755); err != nil {
		return
	}
	return pack.WriteFileAtomic(path, append(data, '\n'), 0o644)
}

// Read читает состояние. Нет файла или в нём мусор — (nil, nil): читатель
// просто ждёт следующей записи. Другие ошибки чтения возвращаются.
func Read(path string) (st *State, err error) {
	data, err := os.ReadFile(path)
	if err == nil {
		st = statusFromBytes(data)
	} else if errors.Is(err, fs.ErrNotExist) {
		err = nil
	}
	return
}

// statusFromBytes разбирает содержимое файла. После объекта допустимы только пробельные
// знаки; мусор, лишний хвост и неизвестное состояние дают nil.
func statusFromBytes(data []byte) *State {
	st := new(State)
	if json.Unmarshal(data, st) != nil || !slices.Contains(validStates[:], st.State) {
		return nil
	}
	return st
}

// Time разбирает At как RFC 3339; не разобралось — нулевое время.
func (s State) Time() (t time.Time) {
	if parsed, err := time.Parse(time.RFC3339, s.At); err == nil {
		t = parsed
	}
	return
}

// State — содержимое файла. Порядок полей задаёт порядок ключей; кроме State
// и At, нулевые значения в файл не попадают.
type State struct {
	State     string `json:"state"`
	Phase     string `json:"phase,omitempty"`
	Percent   *int   `json:"percent,omitempty"`
	Overall   *int   `json:"overall,omitempty"`
	Version   string `json:"version,omitempty"`
	Code      string `json:"code,omitempty"`
	Detail    string `json:"detail,omitempty"`
	Retryable bool   `json:"retryable,omitempty"`
	At        string `json:"at"`
}
