package bridge

import (
	"io"
	"io/fs"
	"maps"
	"net/url"
	"path"
	"slices"
	"strings"
)

// Origin — адрес, под которым окно открывает вшитую страницу интерфейса.
const Origin = "https://astral-setup.invalid"

// Assets отвечает на запросы окна файлами вшитого интерфейса; всё чужое
// блокируется.
type Assets struct {
	FS     fs.FS  // корень ui/
	Origin string // адрес страницы; пусто — константа Origin
}

// Response — ответ на перехваченный запрос.
type Response struct {
	Status  int
	Reason  string
	Headers map[string]string
	Body    []byte
}

// HeaderString — заголовки в виде WebView2: «Имя: значение» через CRLF, без
// хвоста, по возрастанию имён как байтовых строк.
func (r Response) HeaderString() string {
	var out strings.Builder
	for n, name := range slices.Sorted(maps.Keys(r.Headers)) {
		if n > 0 {
			out.WriteString("\r\n")
		}
		out.WriteString(name + ": " + r.Headers[name])
	}
	return out.String()
}

// typeTable — тип содержимого по последнему расширению (с точкой, нижний
// регистр).
type typeTable map[string]string

// of: неизвестное расширение — безымянный двоичный тип.
func (t typeTable) of(name string) string {
	if ct, ok := t[strings.ToLower(path.Ext(name))]; ok {
		return ct
	}
	return "application/octet-stream"
}

var contentTypes = typeTable{
	".avif":  "image/avif",
	".css":   "text/css; charset=utf-8",
	".gif":   "image/gif",
	".htm":   "text/html; charset=utf-8",
	".html":  "text/html; charset=utf-8",
	".ico":   "image/x-icon",
	".jpeg":  "image/jpeg",
	".jpg":   "image/jpeg",
	".js":    "text/javascript; charset=utf-8",
	".json":  "application/json; charset=utf-8",
	".map":   "application/json; charset=utf-8",
	".mjs":   "text/javascript; charset=utf-8",
	".otf":   "font/otf",
	".png":   "image/png",
	".svg":   "image/svg+xml",
	".ttf":   "font/ttf",
	".txt":   "text/plain; charset=utf-8",
	".wasm":  "application/wasm",
	".webp":  "image/webp",
	".woff":  "font/woff",
	".woff2": "font/woff2",
}

type headerPair struct{ name, value string }

// hardHeaders идут в каждом ответе: без кэша, без угадывания типа.
var hardHeaders = []headerPair{
	{"Cache-Control", "no-store"},
	{"X-Content-Type-Options", "nosniff"},
}

// respond собирает ответ; заголовки каждый раз новая карта.
func respond(status int, reason, contentType string, body []byte) Response {
	headers := map[string]string{"Content-Type": contentType}
	for _, h := range hardHeaders {
		headers[h.name] = h.value
	}
	return Response{Status: status, Reason: reason, Headers: headers, Body: body}
}

// pathRules превращают путь запроса в имя файла в FS: очистка как у пути URL
// (выше корня не выйти), без ведущей косой, пустое имя — главная страница.
var pathRules = []func(string) string{
	func(p string) string { return "/" + p },
	path.Clean,
	func(p string) string { return strings.TrimPrefix(p, "/") },
	func(p string) string {
		if p == "" {
			return "index.html"
		}
		return p
	},
}

// source читает файлы из вшитой файловой системы.
type source struct{ files fs.FS }

func (s source) fetch(name string) ([]byte, error) {
	f, err := s.files.Open(name)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return nil, fs.ErrInvalid
	}
	data, err := io.ReadAll(f)
	return append([]byte{}, data...), err
}

func (a *Assets) origin() string {
	if a.Origin != "" {
		return a.Origin
	}
	return Origin
}

// fileFor даёт имя файла для своего запроса; false — запрос чужой.
func (a *Assets) fileFor(rawURL string) (string, bool) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return "", false
	}
	if strings.Join([]string{u.Scheme, u.Host}, "://") != a.origin() {
		return "", false
	}
	name := u.Path
	for _, rule := range pathRules {
		name = rule(name)
	}
	return name, true
}

// Serve отвечает на запрос rawURL.
func (a *Assets) Serve(rawURL string) Response {
	name, mine := a.fileFor(rawURL)
	if !mine {
		return respond(403, "Blocked", "text/plain; charset=utf-8", []byte("blocked"))
	}
	data, err := source{a.FS}.fetch(name)
	if err != nil {
		return respond(404, "Not Found", "text/plain; charset=utf-8", []byte("not found"))
	}
	return respond(200, "OK", contentTypes.of(name), data)
}
