// Package winproxy превращает настройки прокси из «Параметров Интернета»
// Windows в функцию для поля Proxy у http.Transport. Скрипт автонастройки
// (PAC) не исполняется.
package winproxy

import (
	"net"
	"net/http"
	"net/url"
	"slices"
	"strings"
)

// globMatch сверяет имя с шаблоном: «*» — любая цепочка знаков, остальное
// буквально. Шаблон режется по «*»: первый кусок — начало имени, последний —
// конец, средние ищутся по порядку, каждый как можно левее.
func globMatch(pattern, name string) bool {
	parts := strings.Split(pattern, "*")
	if len(parts) == 1 {
		return pattern == name
	}
	if !strings.HasPrefix(name, parts[0]) {
		return false
	}
	name = name[len(parts[0]):]
	for _, mid := range parts[1 : len(parts)-1] {
		at := strings.Index(name, mid)
		if at < 0 {
			return false
		}
		name = name[at+len(mid):]
	}
	return strings.HasSuffix(name, parts[len(parts)-1])
}

// matcher — правило, по которому узел идёт мимо прокси. Узел приходит в
// нижнем регистре.
type matcher interface{ matches(host string) bool }

// loopbackRule: localhost и любой адрес петли, раньше исключений.
type loopbackRule struct{}

func (loopbackRule) matches(host string) bool {
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback()
	}
	return host == "localhost"
}

// localRule — слово <local>: имя без точки и без двоеточия.
type localRule struct{}

func (localRule) matches(host string) bool { return strings.IndexAny(host, ".:") < 0 }

// globRule — шаблон, который должен совпасть с именем целиком.
type globRule string

func (g globRule) matches(host string) bool { return globMatch(string(g), host) }

// ruleForWord — правило для одного слова ProxyOverride (уже в нижнем регистре).
func ruleForWord(word string) matcher {
	if word == "<local>" {
		return localRule{}
	}
	return globRule(word)
}

func parseOverride(spec string) (rules []matcher) {
	for _, item := range strings.Split(spec, ";") {
		if word := strings.ToLower(strings.TrimSpace(item)); word != "" {
			rules = append(rules, ruleForWord(word))
		}
	}
	return
}

// addressOf добавляет схему по умолчанию, если её нет; негодный адрес — nil.
func addressOf(value, defaultScheme string) *url.URL {
	if value = strings.TrimSpace(value); value == "" {
		return nil
	}
	if !strings.Contains(value, "://") {
		value = defaultScheme + "://" + value
	}
	u, err := url.Parse(value)
	if err == nil && u.Host != "" {
		return u
	}
	return nil
}

// entrySchemes — какие ключи понимаются и какая схема подставляется адресу
// без схемы.
var entrySchemes = map[string]string{"http": "http", "https": "http", "socks": "socks5"}

// parseEntry разбирает запись «ключ=адрес»; негодная даёт nil.
func parseEntry(item string) (string, *url.URL) {
	rawKey, value, found := strings.Cut(item, "=")
	key := strings.ToLower(strings.TrimSpace(rawKey))
	scheme, known := entrySchemes[key]
	if !found || !known {
		return "", nil
	}
	return key, addressOf(value, scheme)
}

const (
	keyAll   = "*" // запись на все схемы
	keySocks = "socks"
)

// serverTable — разобранный ProxyServer: ключ — схема запроса, keyAll — один
// адрес на всё.
type serverTable map[string]*url.URL

// pick: общий адрес, иначе запись для схемы, иначе socks на все схемы, иначе
// напрямую (nil).
func (t serverTable) pick(scheme string) *url.URL {
	if u := t[keyAll]; u != nil {
		return u
	}
	if u := t[scheme]; u != nil {
		return u
	}
	return t[keySocks]
}

func parseServers(spec string) serverTable {
	table := serverTable{}
	add := func(key string, u *url.URL) {
		if u != nil {
			table[key] = u
		}
	}
	if !strings.Contains(spec, "=") {
		first, _, _ := strings.Cut(spec, ";")
		add(keyAll, addressOf(first, "http"))
		return table
	}
	for _, item := range strings.Split(spec, ";") {
		add(parseEntry(item))
	}
	return table
}

// proxyFunc — вид функции для поля Proxy у http.Transport.
type proxyFunc = func(*http.Request) (*url.URL, error)

// directRoute — «без прокси»: ни один запрос не получает адрес прокси.
func directRoute(_ *http.Request) (u *url.URL, err error) { return }

// Func строит функцию для http.Transport по снимку настроек. fallback
// зовётся только при выключенном системном прокси; nil — «без прокси».
func (s Settings) Func(fallback proxyFunc) proxyFunc {
	switch {
	case !s.Enabled && fallback != nil:
		return fallback
	case !s.Enabled:
		return directRoute
	}
	table := parseServers(s.Server)
	if len(table) == 0 {
		return directRoute
	}
	bypass := slices.Insert(parseOverride(s.Override), 0, matcher(loopbackRule{}))
	return func(req *http.Request) (*url.URL, error) {
		host := strings.ToLower(req.URL.Hostname())
		if slices.ContainsFunc(bypass, func(rule matcher) bool { return rule.matches(host) }) {
			return nil, nil
		}
		return table.pick(strings.ToLower(req.URL.Scheme)), nil
	}
}

// Settings — четыре значения из реестра. Нулевое значение — прокси выключен.
type Settings struct {
	Enabled  bool   // ProxyEnable
	Server   string // ProxyServer: «host:port» или «http=h:p;https=h:p;socks=h:p»
	Override string // ProxyOverride: «<local>;*.corp.example;10.*»
	PACURL   string // AutoConfigURL: в разборе не участвует
}
