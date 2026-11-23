// Package layout описывает раскладку папок установки Astral: имена веток,
// пути внутри корня установки и проверки «наша ли это папка».
package layout

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"iter"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"unicode"

	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/codemark"
)

const (
	// ExeName — запускаемый файл лаунчера, лежит в папке app.
	ExeName = "Astral.exe"
	// SetupExeName — копия установщика прямо в корне установки.
	SetupExeName = "AstralBetaSetup.exe"
	// InstallMutexName — мьютекс окна установки, где вводится код.
	InstallMutexName = `Local\AstralSetup-install`
)

// Channel — ветка Astral.
type Channel string

const (
	Release Channel = "release"
	Beta    Channel = "beta"
	Alpha   Channel = "alpha"
)

var (
	// All — ветки по старшинству, alpha старшая. Менять нельзя.
	All = []Channel{Alpha, Beta, Release}
	// UserDataFolderNames — папки общих пользовательских данных.
	UserDataFolderNames = []string{"Astral", "Astral Beta"}
	// ErrForeignFolder — папка занята и это не установка Astral.
	ErrForeignFolder = errors.New("layout: the folder exists and is not an Astral install")
)

// Имена по веткам, в порядке All. Чужое имя ветки получает последнюю
// строку, то есть имя релиза.
var (
	folderNames = [3]string{"Astral Alpha", "Astral Beta", "Astral"}
	registryKey = [3]string{"AstralAlpha", "AstralBeta", "Astral"}
)

func (c Channel) pick(table [3]string) string {
	if i := c.Rank(); i < len(table) {
		return table[i]
	}
	return table[len(table)-1]
}

// Parse разбирает имя ветки; очищенное имя возвращается и при отказе.
func Parse(s string) (c Channel, ok bool) {
	c = Channel(strings.ToLower(strings.TrimFunc(s, unicode.IsSpace)))
	ok = c.Valid()
	return
}

func (c Channel) Valid() bool { return slices.Index(All, c) >= 0 }

// Rank — место в порядке All, для чужих имён len(All).
func (c Channel) Rank() int {
	i := slices.Index(All, c)
	if i < 0 {
		i = len(All)
	}
	return i
}

// mutexPrefix — общее начало имён мьютексов окон установки и обновления.
const mutexPrefix = `Local\AstralSetup-`

func (c Channel) DirName() (name string) {
	name = c.pick(folderNames)
	return
}

func (c Channel) DisplayName() (name string) {
	name = c.DirName()
	return
}

func (c Channel) UninstallKey() (key string) {
	key = c.pick(registryKey)
	return
}

func (c Channel) ShortcutFile() (file string) {
	file = fmt.Sprintf("%s.lnk", c.DirName())
	return
}

func (c Channel) MutexName() string {
	return mutexPrefix + string(c)
}

func (c Channel) UpdateMutexName() string {
	return strings.Join([]string{mutexPrefix + "update", string(c)}, "-")
}

const programsFolder = "Programs"

func ProgramsDir(localAppData string) string {
	return filepath.Join(localAppData, programsFolder)
}

func DefaultRoot(localAppData string, c Channel) string {
	return filepath.Join(ProgramsDir(localAppData), c.DirName())
}

// lastElement — имя последней папки очищенного пути.
func lastElement(path string) string {
	return filepath.Base(filepath.Clean(path))
}

func ChannelOfRoot(root string) (Channel, bool) {
	name := lastElement(root)
	at := slices.IndexFunc(All, func(c Channel) bool { return strings.EqualFold(name, c.DirName()) })
	if at < 0 {
		return "", false
	}
	return All[at], true
}

// HintFromExeName ищет в имени установщика метку «-alpha», «-beta» или
// «-release»; побеждает последняя. Имя режется по дефисам: метка — начало
// куска после дефиса.
func HintFromExeName(name string) (Channel, bool) {
	file := filepath.Base(name)
	pieces := strings.Split(strings.TrimSuffix(file, filepath.Ext(file)), "-")
	var hint Channel
	for _, piece := range pieces[1:] {
		if _, _, isCode := codemark.Token(piece); isCode {
			continue // кусок с кодом установки подсказкой ветки не считается (код может начинаться с «BETA»)
		}
		if c, ok := labelOf(piece); ok {
			hint = c
		}
	}
	return hint, hint != ""
}

// CodeFromExeName достаёт из имени установщика тело кода установки (правило — пакет codemark): отдельный кусок после дефиса
// вида «k» и 16 букв и цифр (AstralSetup-release-k7K3MQ9XD2PWFH8RT.exe) либо просто 16 знаков алфавита Crockford
// (AstralSetup-release-7K3MQ9XD2PWFH8RT.exe, так отдаёт сервер, если приставки «k» нет). Приставки «BETA-» и дефисов в коде
// нет: дефисом имя режется на куски. Побеждает последний подходящий кусок; хвосты браузера и проводника (« (1)», «_1»,
// « - копия») не мешают. Алфавит кода у куска с «k» здесь не проверяется — это делает install.NormalizeCode.
func CodeFromExeName(name string) (string, bool) {
	file := filepath.Base(name)
	pieces := strings.Split(strings.TrimSuffix(file, filepath.Ext(file)), "-")
	for at := len(pieces) - 1; at >= 1; at-- {
		if body, _, ok := codemark.Token(pieces[at]); ok {
			return body, true
		}
	}
	return "", false
}

func labelOf(piece string) (Channel, bool) {
	for _, c := range All {
		if startsWithWord(piece, string(c)) {
			return c, true
		}
	}
	return "", false
}

// startsWithWord: кусок начинается со слова (регистр ASCII не важен), а за
// ним конец куска или не латинская буква.
func startsWithWord(piece, word string) bool {
	if len(piece) < len(word) {
		return false
	}
	for i := range word {
		if lowerASCII(piece[i]) != word[i] {
			return false
		}
	}
	return len(piece) == len(word) || !isLatinLetter(piece[len(word)])
}

func lowerASCII(b byte) byte {
	if b >= 'A' && b <= 'Z' {
		return b + ('a' - 'A')
	}
	return b
}

func isLatinLetter(b byte) bool {
	b = lowerASCII(b)
	return b >= 'a' && b <= 'z'
}

func IsUserDataFolder(path string) bool {
	name := lastElement(path)
	return slices.ContainsFunc(UserDataFolderNames, func(known string) bool {
		return strings.EqualFold(name, known)
	})
}

// StableMarkerIn — метка внутри собранного лаунчера: сборка признаёт себя
// стабильной.
func StableMarkerIn(appDir string) string {
	return filepath.Join(appDir, filepath.FromSlash("resources/update-stable"))
}

// part — именованное место внутри корня установки.
type part int

const (
	partApp part = iota
	partAppNew
	partAppOld
	partAppBad
	partExe
	partBeta
	partBetaNew
	partBetaOld
	partLicense
	partBind
	partPak
	partManifest
	partManifestSig
	partSetupExe
	partStaging
	partUpdate
	partBootOK
	partFailed
	partPending
	partPakOld
	partManifestOld
	partSigOld
)

// partSegments — путь каждого места от корня, по сегментам.
var partSegments = [...][]string{
	partApp:         {"app"},
	partAppNew:      {"app.new"},
	partAppOld:      {"app.old"},
	partAppBad:      {"app.bad"},
	partExe:         {"app", ExeName},
	partBeta:        {"beta"},
	partBetaNew:     {"beta.new"},
	partBetaOld:     {"beta.old"},
	partLicense:     {"beta", "license"},
	partBind:        {"beta", "bind"},
	partPak:         {"beta", "astral-web.pak"},
	partManifest:    {"beta", "manifest.json"},
	partManifestSig: {"beta", "manifest.sig"},
	partSetupExe:    {SetupExeName},
	partStaging:     {".setup"},
	partUpdate:      {"update"},
	partBootOK:      {"update", "boot-ok"},
	partFailed:      {"update", "failed.json"},
	partPending:     {"update", "pending-stable.json"},
	partPakOld:      {"beta", "astral-web.pak.old"},
	partManifestOld: {"beta", "manifest.json.old"},
	partSigOld:      {"beta", "manifest.sig.old"},
}

var (
	// removalParts — по ним папку можно стирать целиком.
	removalParts = []part{partExe, partSetupExe, partLicense, partManifest}
	// claimParts — по ним папка считается нашей при установке поверх: к
	// меткам удаления добавлены хвосты прерванной и частично стёртой установки.
	claimParts = append(slices.Clone(removalParts),
		partManifestSig, partPak, partBind,
		partStaging, partAppNew, partAppOld, partAppBad,
		partBetaNew, partBetaOld, partUpdate,
		partPakOld, partManifestOld, partSigOld)
)

// Layout — одна установка; Root — папка ветки.
type Layout struct {
	Root string
}

func New(root string) Layout { return Layout{Root: root} }

func (l Layout) Channel() (Channel, bool) { return ChannelOfRoot(l.Root) }

// of строит путь места внутри корня.
func (l Layout) of(p part) string {
	return l.rooted(partSegments[p])
}

// rooted дописывает сегменты к корню установки.
func (l Layout) rooted(segments []string) string {
	return filepath.Join(slices.Insert(slices.Clone(segments), 0, l.Root)...)
}

func (l Layout) App() (path string) {
	path = l.of(partApp)
	return
}

func (l Layout) AppNew() (path string) {
	path = l.of(partAppNew)
	return
}

func (l Layout) AppOld() (path string) {
	path = l.of(partAppOld)
	return
}

func (l Layout) AppBad() (path string) {
	path = l.of(partAppBad)
	return
}

func (l Layout) Exe() (path string) {
	path = l.of(partExe)
	return
}

func (l Layout) Beta() string {
	return l.rooted(partSegments[partBeta])
}

func (l Layout) BetaNew() string {
	return l.rooted(partSegments[partBetaNew])
}

func (l Layout) BetaOld() string {
	return l.rooted(partSegments[partBetaOld])
}

func (l Layout) License() string {
	segments := partSegments[partLicense]
	return l.rooted(segments)
}

func (l Layout) Bind() string {
	segments := partSegments[partBind]
	return l.rooted(segments)
}

func (l Layout) Pak() string {
	segments := partSegments[partPak]
	return l.rooted(segments)
}

func (l Layout) Manifest() string {
	segments := partSegments[partManifest]
	return l.rooted(segments)
}

func (l Layout) ManifestSig() string {
	segments := partSegments[partManifestSig]
	return l.rooted(segments)
}

func (l Layout) SetupExe() (path string) {
	path = l.of(partSetupExe)
	return
}

func (l Layout) Staging() (path string) {
	path = l.of(partStaging)
	return
}

func (l Layout) UpdateDir() (path string) {
	path = l.of(partUpdate)
	return
}

func (l Layout) BootOK() (path string) {
	path = l.of(partBootOK)
	return
}

func (l Layout) FailedJSON() (path string) {
	path = l.of(partFailed)
	return
}

func (l Layout) PendingStable() (path string) {
	path = l.of(partPending)
	return
}

func (l Layout) BetaFile(name string) string {
	return l.rooted([]string{"beta", name})
}

func (l Layout) BetaNewFile(name string) string {
	return l.rooted([]string{"beta.new", name})
}

func present(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func isFile(path string) bool {
	if info, err := os.Stat(path); err == nil {
		return !info.IsDir()
	}
	return false
}

func (l Layout) Installed() (ok bool) {
	ok = isFile(l.Exe())
	return
}

func (l Layout) HasLicense() (ok bool) {
	ok = isFile(l.License())
	return
}

// anyPresent: существует ли хотя бы одно из мест (файл или папка).
func (l Layout) anyPresent(places []part) bool {
	return slices.ContainsFunc(places, func(p part) bool { return present(l.of(p)) })
}

// listNames — имена всех записей папки по возрастанию байтов.
func listNames(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	names := slices.AppendSeq(make([]string, 0, len(entries)), entryNames(entries))
	slices.Sort(names)
	return names, nil
}

func entryNames(entries []fs.DirEntry) iter.Seq[string] {
	return func(yield func(string) bool) {
		for _, e := range entries {
			if !yield(e.Name()) {
				return
			}
		}
	}
}

// TopNames — имена верхних записей корня по алфавиту (по байтам), не больше
// limit. Отрицательный limit при читаемой папке паникует срезом.
func (l Layout) TopNames(limit int) []string {
	names, err := listNames(l.Root)
	if err != nil {
		return nil
	}
	if len(names) > limit {
		return names[:limit]
	}
	return names
}

// CheckTarget говорит, можно ли ставить в корень: его нет, он пуст или в нём
// есть наши метки.
func (l Layout) CheckTarget() error {
	names, err := listNames(l.Root)
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return nil
	case err != nil:
		return err
	case len(names) > 0 && !l.anyPresent(claimParts):
		return fmt.Errorf("%w: %s", ErrForeignFolder, l.Root)
	}
	return nil
}

// SafeToRemove — последняя защита перед стиранием корня целиком. Правила
// проверяются по порядку, первое сработавшее даёт отказ.
func (l Layout) SafeToRemove() error {
	clean := filepath.Clean(l.Root)
	refusals := []struct {
		applies func() bool
		text    string
	}{
		{func() bool { return clean == "." || filepath.Dir(clean) == clean },
			"layout: refusing to remove an empty or root path"},
		{func() bool { _, ours := ChannelOfRoot(clean); return !ours },
			fmt.Sprintf("layout: %q is not an Astral branch folder (Astral, Astral Beta or Astral Alpha)", clean)},
		{func() bool { return !l.anyPresent(removalParts) },
			fmt.Sprintf("layout: %q has none of our files", clean)},
	}
	for _, r := range refusals {
		if r.applies() {
			return errors.New(r.text)
		}
	}
	return nil
}

// Branch — найденная установка.
type Branch struct {
	Channel    Channel
	Root       string
	Version    string
	HasLicense bool
}

func (b Branch) Layout() Layout { return Layout{Root: b.Root} }

// versionDoc достаёт из манифеста только поле version (имя без учёта
// регистра, при повторе последнее, null ничего не меняет). Не объект или
// версия не строкой — ошибка.
type versionDoc struct{ text string }

func (v *versionDoc) UnmarshalJSON(data []byte) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	if open, err := dec.Token(); err != nil || open != json.Delim('{') {
		return errors.New("layout: manifest is not an object")
	}
	for dec.More() {
		key, err := dec.Token()
		if err != nil {
			return err
		}
		var value any
		if err := dec.Decode(&value); err != nil {
			return err
		}
		if name, _ := key.(string); !strings.EqualFold(name, "version") {
			continue
		}
		switch typed := value.(type) {
		case nil:
		case string:
			v.text = typed
		default:
			return errors.New("layout: manifest version is not a string")
		}
	}
	return nil
}

// manifestVersion читает версию для показа; подпись не проверяется.
func manifestVersion(path string) (version string) {
	if raw, err := os.ReadFile(path); err == nil {
		var doc versionDoc
		if json.Unmarshal(raw, &doc) == nil {
			version = doc.text
		}
	}
	return
}

// installedBranches перебирает ветки по порядку All и отдаёт стоящие.
func installedBranches(programsDir string) iter.Seq[Branch] {
	return func(yield func(Branch) bool) {
		for _, c := range All {
			l := New(filepath.Join(programsDir, c.DirName()))
			if !l.Installed() {
				continue
			}
			found := Branch{Channel: c, Root: l.Root, Version: manifestVersion(l.Manifest()), HasLicense: l.HasLicense()}
			if !yield(found) {
				return
			}
		}
	}
}

// Scan находит стоящие ветки в папке Programs: порядок alpha, beta, release.
func Scan(programsDir string) []Branch {
	return slices.Collect(installedBranches(programsDir))
}

// ScanBeside ищет в папке, где лежит root.
func ScanBeside(root string) []Branch {
	return Scan(filepath.Dir(filepath.Clean(root)))
}

func Find(branches []Branch, c Channel) (Branch, bool) {
	at := slices.IndexFunc(branches, func(b Branch) bool { return b.Channel == c })
	if at < 0 {
		return Branch{}, false
	}
	return branches[at], true
}
