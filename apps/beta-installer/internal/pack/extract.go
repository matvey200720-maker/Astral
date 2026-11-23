package pack

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"iter"
	"os"
	"path/filepath"
	"strings"
)

const (
	DefaultMaxTotalBytes = 8589934592
	DefaultMaxFiles      = 200000

	unpackCapFloor  = 1073741824
	unpackCapFactor = 20
	maxSegmentBytes = 255
)

type ExtractOptions struct {
	MaxTotalBytes int64
	MaxFiles      int
	// Stop, если задан, спрашивают перед каждой записью и каждым файлом; ошибка прерывает
	// распаковку, и папка назначения стирается как при любой другой ошибке.
	Stop func() error
}

type ExtractResult struct {
	Files int
	Bytes int64
}

// UnpackCap — предел распакованного размера для архива указанного размера.
// Умножение идёт без защиты от переполнения: для огромных размеров результат — нижний предел.
func UnpackCap(zipSize int64) int64 {
	return max(unpackCapFloor, min(zipSize*unpackCapFactor, DefaultMaxTotalBytes))
}

// Причины отказа имени записи.
const (
	whyEmpty     = "empty"
	whyAbsolute  = "absolute path"
	whyStream    = "drive letter, stream or NUL"
	whyDotSeg    = "empty, '.' or '..' segment"
	whyTrailing  = "segment ends with a dot or a space"
	whyTooLong   = "segment is too long"
	whyForbidden = "forbidden character"
	whyControl   = "control character"
	whyReserved  = "reserved Windows device name"
)

// reservedDevices — имена устройств Windows (список именно такой: без COM0/LPT0).
var reservedDevices = func() map[string]bool {
	set := make(map[string]bool)
	for _, name := range []string{"CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"} {
		set[name] = true
	}
	for d := '1'; d <= '9'; d++ {
		set["COM"+string(d)] = true
		set["LPT"+string(d)] = true
	}
	return set
}()

// segmentFault возвращает причину отказа для одного сегмента имени или "".
func segmentFault(seg string) string {
	switch {
	case seg == "" || seg == "." || seg == "..":
		return whyDotSeg
	case strings.HasSuffix(seg, ".") || strings.HasSuffix(seg, " "):
		return whyTrailing
	case len(seg) > maxSegmentBytes:
		return whyTooLong
	case strings.ContainsAny(seg, `<>"|?*`):
		return whyForbidden
	case strings.IndexFunc(seg, func(r rune) bool { return r < 0x20 }) >= 0:
		return whyControl
	}
	stem, _, _ := strings.Cut(seg, ".")
	if reservedDevices[strings.ToUpper(strings.TrimRight(stem, " "))] {
		return whyReserved
	}
	return ""
}

// normalizeSlashes заменяет «\» на «/» и убирает хвостовой «/».
func normalizeSlashes(raw string) string {
	return strings.TrimSuffix(strings.ReplaceAll(raw, `\`, "/"), "/")
}

// cleanEntryName приводит имя записи к чистому пути с «/» либо называет причину отказа.
func cleanEntryName(raw string) (clean, reason string) {
	name := normalizeSlashes(raw)
	switch {
	case name == "":
		return "", whyEmpty
	case name[0] == '/':
		return "", whyAbsolute
	case strings.ContainsAny(name, ":\x00"):
		return "", whyStream
	}
	for _, seg := range strings.Split(name, "/") {
		if why := segmentFault(seg); why != "" {
			return "", why
		}
	}
	return name, ""
}

// parentKeys перечисляет пути-родители ключа: для «a/b/c» это «a» и «a/b».
func parentKeys(key string) iter.Seq[string] {
	return func(yield func(string) bool) {
		for i := 0; i < len(key); i++ {
			if key[i] == '/' && !yield(key[:i]) {
				return
			}
		}
	}
}

var unsafeModeKinds = []os.FileMode{
	os.ModeSymlink,
	os.ModeDevice,
	os.ModeNamedPipe,
	os.ModeSocket,
	os.ModeCharDevice,
	os.ModeIrregular,
}

// isUnsafeMode — true, если режим записи — ссылка или особый файл.
func isUnsafeMode(mode os.FileMode) bool {
	for _, kind := range unsafeModeKinds {
		if mode&kind != 0 {
			return true
		}
	}
	return false
}

// isDirEntry — true, если запись архива — папка (по режиму или хвостовому разделителю имени).
func isDirEntry(mode os.FileMode, name string) bool {
	return mode.IsDir() || strings.HasSuffix(name, "/") || strings.HasSuffix(name, `\`)
}

type planEntry struct {
	file *zip.File
	name string // чистый путь с «/»
	dir  bool
}

type zipPlan struct {
	entries []planEntry
	files   int
	total   int64 // сумма объявленных размеров файлов
}

// planState — накопитель planZip: план и ключи имён, занятые папками/файлами.
type planState struct {
	plan     *zipPlan
	fileKeys map[string]bool
	dirKeys  map[string]bool
	limit    uint64
	declared uint64
}

func (s *planState) addDir(m *zip.File, clean, key string) error {
	if s.fileKeys[key] {
		return fmt.Errorf("entry %q is a directory and a file at once", m.Name)
	}
	s.dirKeys[key] = true
	s.plan.entries = append(s.plan.entries, planEntry{file: m, name: clean, dir: true})
	return nil
}

func (s *planState) addFile(m *zip.File, clean, key string, maxFiles int, maxBytes int64) error {
	if s.fileKeys[key] || s.dirKeys[key] {
		return fmt.Errorf("entry %q repeats an earlier one (names collide on Windows)", m.Name)
	}
	s.plan.files++
	if s.plan.files > maxFiles {
		return fmt.Errorf("archive has more than %d files", maxFiles)
	}
	size := m.UncompressedSize64
	if size > s.limit || s.declared+size > s.limit {
		return fmt.Errorf("archive unpacks to more than %d bytes", maxBytes)
	}
	s.declared += size
	s.fileKeys[key] = true
	s.plan.entries = append(s.plan.entries, planEntry{file: m, name: clean})
	return nil
}

// planZip проверяет весь архив, ничего не создавая на диске.
func planZip(members []*zip.File, maxFiles int, maxBytes int64) (*zipPlan, error) {
	state := &planState{
		plan:     &zipPlan{entries: make([]planEntry, 0, len(members))},
		fileKeys: make(map[string]bool, len(members)),
		dirKeys:  make(map[string]bool),
		limit:    uint64(maxBytes),
	}

	for _, m := range members {
		mode := m.Mode()
		if isUnsafeMode(mode) {
			return nil, fmt.Errorf("entry %q is a link or a special file", m.Name)
		}
		clean, why := cleanEntryName(m.Name)
		if why != "" {
			return nil, fmt.Errorf("unsafe entry name %q: %s", m.Name, why)
		}
		key := strings.ToLower(clean)

		var err error
		if isDirEntry(mode, m.Name) {
			err = state.addDir(m, clean, key)
		} else {
			err = state.addFile(m, clean, key, maxFiles, maxBytes)
		}
		if err != nil {
			return nil, err
		}
	}
	state.plan.total = int64(state.declared)

	for _, e := range state.plan.entries {
		if e.dir {
			continue
		}
		key := strings.ToLower(e.name)
		for parent := range parentKeys(key) {
			if state.fileKeys[parent] {
				return nil, fmt.Errorf("entry %q lies under the file %q", key, parent)
			}
		}
	}
	return state.plan, nil
}

// prepareDest: папка назначения должна не существовать (её создают) или быть пустой.
func prepareDest(dest string) error {
	d, err := os.Open(dest)
	if err == nil {
		defer d.Close()
		_, err = d.Readdirnames(1)
		switch {
		case err == nil:
			return fmt.Errorf("destination %q is not empty", dest)
		case errors.Is(err, io.EOF):
			return nil
		}
	}
	if errors.Is(err, os.ErrNotExist) {
		return os.MkdirAll(dest, mkdirPerm)
	}
	return err
}

// countingSink пишет в w и сообщает ход после каждой записи с данными.
type countingSink struct {
	w      io.Writer
	done   *int64
	total  int64
	notify func(done, total int64)
	stop   func() error
}

func (t *countingSink) Write(p []byte) (int, error) {
	if t.stop != nil {
		if err := t.stop(); err != nil {
			return 0, err
		}
	}
	n, err := t.w.Write(p)
	if n > 0 {
		*t.done += int64(n)
		if t.notify != nil {
			t.notify(*t.done, t.total)
		}
	}
	return n, err
}

type zipUnpacker struct {
	dest   string
	plan   *zipPlan
	notify func(done, total int64)
	stop   func() error
	done   int64
}

// escapesDest — true, если относительный путь выходит за пределы папки назначения.
func escapesDest(rel string, err error) bool {
	return err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// target — путь внутри dest для чистого имени; ложь, если он вышел бы за dest.
func (u *zipUnpacker) target(name string) (string, bool) {
	path := filepath.Join(u.dest, filepath.FromSlash(name))
	rel, err := filepath.Rel(u.dest, path)
	if escapesDest(rel, err) {
		return "", false
	}
	return path, true
}

func openEntryFile(e planEntry) (io.ReadCloser, error) {
	return e.file.Open()
}

func createDestFile(path string) (*os.File, error) {
	return os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
}

// closeKeepFirstErr закрывает c и возвращает err, если он уже был; иначе — ошибку закрытия.
func closeKeepFirstErr(c io.Closer, err error) error {
	if cerr := c.Close(); err == nil {
		err = cerr
	}
	return err
}

func (u *zipUnpacker) writeFile(e planEntry, path string) error {
	if err := os.MkdirAll(filepath.Dir(path), mkdirPerm); err != nil {
		return err
	}
	src, err := openEntryFile(e)
	if err != nil {
		return err
	}
	defer src.Close()
	out, err := createDestFile(path)
	if err != nil {
		return err
	}

	declared := e.file.UncompressedSize64
	budget := int64(min(declared, uint64(1<<63-2))) + 1
	n, err := io.Copy(&countingSink{w: out, done: &u.done, total: u.plan.total, notify: u.notify, stop: u.stop}, io.LimitReader(src, budget))
	if err = closeKeepFirstErr(out, err); err != nil {
		return err
	}
	if uint64(n) != declared {
		return fmt.Errorf("entry is %d bytes, its header says %d", n, declared)
	}
	if mod := e.file.Modified; !mod.IsZero() {
		_ = os.Chtimes(path, mod, mod)
	}
	return nil
}

// processEntry воплощает одну запись плана: папку — создаёт, файл — пишет через writeFile.
func (u *zipUnpacker) processEntry(e planEntry) error {
	path, ok := u.target(e.name)
	if !ok {
		return fmt.Errorf("entry %q escapes the destination", e.file.Name)
	}
	if e.dir {
		return os.MkdirAll(path, mkdirPerm)
	}
	if err := u.writeFile(e, path); err != nil {
		return fmt.Errorf("extract %q: %w", e.name, err)
	}
	return nil
}

func (u *zipUnpacker) run() (*ExtractResult, error) {
	for _, e := range u.plan.entries {
		if u.stop != nil {
			if err := u.stop(); err != nil {
				return nil, err
			}
		}
		if err := u.processEntry(e); err != nil {
			return nil, err
		}
	}
	if u.notify != nil {
		u.notify(u.done, u.plan.total)
	}
	return &ExtractResult{Files: u.plan.files, Bytes: u.done}, nil
}

// defaultedOptions заполняет нулевые пределы опций значениями по умолчанию.
func defaultedOptions(opt ExtractOptions) ExtractOptions {
	if opt.MaxTotalBytes <= 0 {
		opt.MaxTotalBytes = DefaultMaxTotalBytes
	}
	if opt.MaxFiles <= 0 {
		opt.MaxFiles = DefaultMaxFiles
	}
	return opt
}

func openZipReader(zipPath string) (*zip.ReadCloser, error) {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, fmt.Errorf("open zip: %w", err)
	}
	return zr, nil
}

// ExtractZip распаковывает архив в dest, не доверяя ему. При любой ошибке после
// подготовки папки назначения она стирается целиком.
func ExtractZip(zipPath, dest string, opt ExtractOptions, onProgress func(done, total int64)) (*ExtractResult, error) {
	opt = defaultedOptions(opt)

	zr, err := openZipReader(zipPath)
	if err != nil {
		return nil, err
	}
	defer zr.Close()

	plan, err := planZip(zr.File, opt.MaxFiles, opt.MaxTotalBytes)
	if err != nil {
		return nil, err
	}
	if err := prepareDest(dest); err != nil {
		return nil, err
	}

	res, err := (&zipUnpacker{dest: dest, plan: plan, notify: onProgress, stop: opt.Stop}).run()
	if err != nil {
		_ = os.RemoveAll(dest)
		return nil, err
	}
	return res, nil
}
