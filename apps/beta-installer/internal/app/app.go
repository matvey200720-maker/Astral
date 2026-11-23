// Пакет app собирает то, что у режимов установщика общее: форму ответа init,
// безопасное открытие адресов и четыре обработчика моста, которым режим не
// важен.
package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"iter"
	"net/url"
	"os"
	"slices"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/applog"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/bridge"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/layout"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/sysapi"
)

// Размер рабочей части окна в CSS-пикселях.
const (
	WindowWidth  = 960
	WindowHeight = 600
)

const (
	codeInvalid = "INVALID_ARGUMENT"
	codeDenied  = "ACCESS_DENIED"
	codeFailed  = "INTERNAL"
)

type (
	// Window — размер окна для страницы.
	Window struct {
		Width  int `json:"width"`
		Height int `json:"height"`
	}

	// Existing — что уже стоит на этом месте.
	Existing struct {
		Version string `json:"version"`
		Channel string `json:"channel"`
	}

	// InstalledBranch — установленная ветка для страницы.
	InstalledBranch struct {
		Channel    string `json:"channel"`
		Version    string `json:"version"`
		InstallDir string `json:"installDir"`
	}
)

// InitInfo — ответ вызова init. Страница проверяет ключи строго, поэтому
// имена, порядок и пустые значения здесь — контракт.
type InitInfo struct {
	Mode          string            `json:"mode"`
	FromVersion   string            `json:"fromVersion,omitempty"`
	ToVersion     string            `json:"toVersion,omitempty"`
	Channel       string            `json:"channel,omitempty"`
	FromChannel   string            `json:"fromChannel,omitempty"`
	ViaLauncher   *bool             `json:"viaLauncher,omitempty"`
	HintChannel   *string           `json:"hintChannel"`
	Installed     []InstalledBranch `json:"installed"`
	Version       string            `json:"version"`
	OSLocale      string            `json:"osLocale"`
	OSLocaleRaw   string            `json:"osLocaleRaw"`
	InstallDir    string            `json:"installDir"`
	CanChooseDir  bool              `json:"canChooseDir"`
	FreeBytes     *uint64           `json:"freeBytes"`
	RequiredBytes *uint64           `json:"requiredBytes"`
	Existing      *Existing         `json:"existing"`
	Frame         string            `json:"frame"`
	Window        Window            `json:"window"`
	UserDataDirs  []string          `json:"userDataDirs"`
	AppRunning    bool              `json:"appRunning"`
	// Open — ввод кода не нужен: установка идёт по коду из имени файла или по подтверждению в браузере
	// (install/open.go). Ключа нет, пока режим закрытый: прежний ответ init не меняется.
	Open bool `json:"open,omitempty"`
	// OpenCode — в открытом режиме код установки пришёл в имени файла: «Продолжить» работает; нет — окно просит скачать установщик заново.
	OpenCode bool `json:"openCode,omitempty"`
	// Access — "unreachable": кода в имени нет, а сервер не ответил на вопрос «открыт ли доступ»; окно говорит «нет связи с
	// сервером» и даёт «Повторить» (следующий init спросит снова). Ключа нет, когда ответ получен.
	Access string `json:"access,omitempty"`
	Dev    bool   `json:"dev"`
}

// emptyIfNil заменяет nil-срез пустым: в JSON страница ждёт [].
func emptyIfNil[T any](s []T) []T {
	if s != nil {
		return s
	}
	return make([]T, 0)
}

// MarshalJSON работает на значении, поэтому годится и для *InitInfo, и для
// значения внутри map или среза.
func (info InitInfo) MarshalJSON() ([]byte, error) {
	info.Installed = emptyIfNil(info.Installed)
	info.UserDataDirs = emptyIfNil(info.UserDataDirs)
	type bare InitInfo // без методов: иначе рекурсия
	return json.Marshal(bare(info))
}

// InstalledList переводит найденные ветки в вид для страницы; результат
// никогда не nil.
func installedBranchOf(b layout.Branch) InstalledBranch {
	return InstalledBranch{Channel: string(b.Channel), Version: b.Version, InstallDir: b.Root}
}

func InstalledList(branches []layout.Branch) []InstalledBranch {
	list := make([]InstalledBranch, 0, len(branches))
	for _, b := range branches {
		list = append(list, installedBranchOf(b))
	}
	return list
}

func describe(b layout.Branch) *Existing {
	return &Existing{Version: b.Version, Channel: string(b.Channel)}
}

// ExistingOf выбирает, что показать как «уже стоит»: ветку по подсказке или,
// без подсказки, первую в списке.
func ExistingOf(branches []layout.Branch, hint layout.Channel) *Existing {
	if hint == "" {
		if len(branches) == 0 {
			return nil
		}
		return describe(branches[0])
	}
	b, ok := layout.Find(branches, hint)
	if !ok {
		return nil
	}
	return describe(b)
}

// ReadExisting читает версию установки по папке; nil, если лаунчера нет.
// Подпись манифеста не проверяется. Ошибка чтения или документ, который не разбирается как
// объект, оставляют обе строки пустыми; неверный тип одного поля оставляет пустым только его.
func readManifest(l layout.Layout) ([]byte, bool) {
	raw, err := os.ReadFile(l.Manifest())
	return raw, err == nil
}

func ReadExisting(l layout.Layout) (found *Existing) {
	if !l.Installed() {
		return nil
	}
	found = &Existing{}
	if raw, ok := readManifest(l); ok {
		// Поля разбираются порознь: ошибка типа одного не отнимает другое.
		decodeInto(raw, func(v struct {
			Version string `json:"version"`
		}) {
			found.Version = v.Version
		})
		decodeInto(raw, func(v struct {
			Channel string `json:"channel"`
		}) {
			found.Channel = v.Channel
		})
	}
	return found
}

// decodeInto разбирает raw в значение вида T и, только если разбор удался, отдаёт его assign.
func decodeInto[T any](raw []byte, assign func(T)) {
	var v T
	if err := json.Unmarshal(raw, &v); err != nil {
		return
	}
	assign(v)
}

// hostMatches: запись списка без двоеточия подходит под имя хоста с любым
// портом, запись с двоеточием — только под «хост:порт» целиком.
func hostMatches(entry string, u *url.URL) bool {
	if strings.EqualFold(entry, u.Host) {
		return true
	}
	return !strings.Contains(entry, ":") && strings.EqualFold(entry, u.Hostname())
}

func checkScheme(u *url.URL, allowHTTP bool) error {
	switch scheme := strings.ToLower(u.Scheme); {
	case scheme == "https", scheme == "http" && allowHTTP:
		return nil
	case scheme == "http":
		return errors.New("plain http is not allowed")
	default:
		return fmt.Errorf("scheme %q is not allowed", scheme)
	}
}

func checkAuthority(u *url.URL) (err error) {
	if hasHost := u.Host != ""; !hasHost || u.User != nil {
		err = errors.New("url must have a host and no credentials")
	}
	return
}

func checkHost(u *url.URL, hosts []string) error {
	if slices.ContainsFunc(hosts, func(entry string) bool { return hostMatches(entry, u) }) {
		return nil
	}
	return fmt.Errorf("host %q is not allowed", u.Host)
}

// SafeURL возвращает nil, если адрес можно открывать в браузере. Правила
// идут по порядку, первый отказ побеждает.
func parseURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("bad url: %w", err)
	}
	return u, nil
}

func SafeURL(raw string, hosts []string, allowHTTP bool) error {
	rules := []func(*url.URL) error{
		func(u *url.URL) error { return checkScheme(u, allowHTTP) },
		checkAuthority,
		func(u *url.URL) error { return checkHost(u, hosts) },
	}
	u, err := parseURL(raw)
	if err != nil {
		return err
	}
	return firstFailure(u, rules...)
}

// firstFailure прогоняет правила по порядку и отдаёт первый отказ; без отказов — nil.
func firstFailure(u *url.URL, rules ...func(*url.URL) error) (err error) {
	for i := 0; i < len(rules) && err == nil; i++ {
		err = rules[i](u)
	}
	return
}

// Common — общая часть всех режимов: система, журнал, адреса и настройки
// окна.
type Common struct {
	Sys  sysapi.System
	Log  applog.Logger
	Site string
	API  string
	Dev  bool
	Fit  func(cssHeight int) // nil — размер окна не меняем

	chosen atomic.Value // последний принятый язык (string)
	guard  sync.Mutex
	extras []string // хосты, добавленные через AllowHost
}

// Языки интерфейса, которые принимает setLocale.
var uiLanguages = []string{"ru", "uk", "en", "de", "pl", "fr"}

// Lang — последний язык, принятый вызовом setLocale.
func (c *Common) Lang() string {
	if lang, ok := c.chosen.Load().(string); ok {
		return lang
	}
	return ""
}

// withGuard выполняет fn, удерживая guard только на время её работы.
func (c *Common) withGuard(fn func()) {
	c.guard.Lock()
	defer c.guard.Unlock()
	fn()
}

// AllowHost навсегда добавляет хост к тем, чьи адреса можно открывать.
func (c *Common) AllowHost(host string) {
	c.withGuard(func() { c.extras = append(c.extras, host) })
}

// originHosts отдаёт хосты сайта и API (с портом, как в адресе), если эти
// адреса разбираются и имя хоста непусто.
func (c *Common) originHosts() iter.Seq[string] {
	return func(yield func(string) bool) {
		bases := [...]string{c.Site, c.API}
		for i := range bases {
			u, err := url.Parse(bases[i])
			if err != nil || u.Hostname() == "" {
				continue
			}
			if !yield(u.Host) {
				return
			}
		}
	}
}

func (c *Common) allowedHosts() []string {
	var manual []string
	c.withGuard(func() { manual = slices.Clone(c.extras) })
	return slices.AppendSeq(manual, c.originHosts())
}

// OpenAllowed открывает адрес в системе, только если SafeURL его допустил.
func (c *Common) OpenAllowed(raw string) error {
	err := SafeURL(raw, c.allowedHosts(), c.Dev)
	if err == nil {
		return c.Sys.OpenURL(raw)
	}
	return &bridge.Error{Code: codeDenied, Detail: "url not allowed: " + err.Error()}
}

// Register подключает четыре общих метода моста.
func (c *Common) Register(rt *bridge.Router) {
	calls := []struct {
		name string
		do   bridge.Handler
	}{
		{"setLocale", c.setLocale},
		{"openLogs", c.openLogs},
		{"openExternal", c.openExternal},
		{"fitWindow", c.fitWindow},
	}
	for _, call := range calls {
		rt.Handle(call.name, call.do)
	}
}

// refusal собирает отказ моста без повторной попытки.
func refusal(code, detail string) *bridge.Error {
	return &bridge.Error{Code: code, Detail: detail}
}

// readParams разбирает параметры вызова в структуру T; ошибка разбора —
// INVALID_ARGUMENT с текстом стандартной библиотеки.
func readParams[T any](raw json.RawMessage) (v T, err error) {
	if err = json.Unmarshal(raw, &v); err != nil {
		err = refusal(codeInvalid, err.Error())
	}
	return v, err
}

// failure превращает ошибку системы в отказ моста; nil остаётся nil.
func failure(code string, err error) (out *bridge.Error) {
	if err != nil {
		out = refusal(code, err.Error())
	}
	return out
}

// verdict выбирает, что вернуть обработчику: ответ или отказ.
func verdict(reply any, refused *bridge.Error) (any, error) {
	if refused == nil {
		return reply, nil
	}
	return nil, refused
}

// opened — ответ «открыто»; каждый раз новое значение.
func opened() map[string]bool { return map[string]bool{"opened": true} }

func (c *Common) setLocale(_ context.Context, raw json.RawMessage) (any, error) {
	p, err := readParams[struct {
		Lang string `json:"lang"`
	}](raw)
	switch {
	case err != nil:
		return nil, err
	case !slices.Contains(uiLanguages, p.Lang):
		return nil, refusal(codeInvalid, "unsupported language "+p.Lang)
	}
	c.chosen.Store(p.Lang)
	return nil, nil
}

// ensureLogDir создаёт папку журнала (если её нет) и отдаёт её путь.
func ensureLogDir(sys sysapi.System) string {
	dir := sys.LogDir()
	_ = os.MkdirAll(dir, 0o755) // ошибка не важна: OpenFolder скажет сам, если папки нет
	return dir
}

// openLogDir создаёт папку журнала и открывает её.
func (c *Common) openLogDir() error {
	return c.Sys.OpenFolder(ensureLogDir(c.Sys))
}

func (c *Common) openLogs(context.Context, json.RawMessage) (any, error) {
	return verdict(opened(), failure(codeFailed, c.openLogDir()))
}

func (c *Common) openExternal(_ context.Context, raw json.RawMessage) (any, error) {
	p, err := readParams[struct {
		URL string `json:"url"`
	}](raw)
	if err != nil {
		return nil, err
	}
	opening := c.OpenAllowed(p.URL)
	if opening == nil {
		return opened(), nil
	}
	var denied *bridge.Error
	if errors.As(opening, &denied) {
		return nil, denied
	}
	return nil, failure(codeFailed, opening)
}

func (c *Common) fitWindow(_ context.Context, raw json.RawMessage) (any, error) {
	p, err := readParams[struct {
		Height int `json:"height"`
	}](raw)
	if err != nil {
		return nil, err
	}
	if p.Height <= 0 {
		return nil, refusal(codeInvalid, "height must be positive")
	}
	if c.Fit != nil {
		c.Fit(FitWindowHeight(p.Height))
	}
	return nil, nil
}
