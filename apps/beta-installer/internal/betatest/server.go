// Пакет betatest — подставной сервер беты на петле для тестов установщика и
// программ разработчика. Говорит по контракту настоящего сервера: каждое
// обращение несёт доказательство DPoP, активация привязана к ключу и машине,
// файлы выдаются по билету с бюджетом и докачкой, итог принимается по sha256.
// Сервер умеет ломаться по команде теста. Всё состояние живёт в памяти.
package betatest

import (
	"archive/zip"
	"bytes"
	"cmp"
	"crypto/ed25519"
	crand "crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"iter"
	mrand "math/rand"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/dpop"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/releasekeys"
)

// ---- что нужно от теста и коды ----

type (
	helperTB interface{ Helper() }
	failerTB interface {
		Fatal(args ...any)
		Fatalf(format string, args ...any)
	}
	cleanerTB interface{ Cleanup(func()) }
)

// TB — то, что серверу нужно от теста. Подходят *testing.T и *testing.B.
type TB interface {
	helperTB
	failerTB
	cleanerTB
}

// KID — идентификатор тестового ключа релизов.
const KID = "test-2026"

// Коды запроса start: рабочий один, остальные дают заготовленные отказы.
const (
	ValidCode        = "BETA-7K3M-Q9XD-2PWF-H8RT"
	CodeInvalid      = "BETA-0000-0000-0000-0000"
	CodeUsed         = "BETA-1111-1111-1111-1111"
	CodeExpired      = "BETA-2222-2222-2222-2222"
	CodeRevoked      = "BETA-3333-3333-3333-3333"
	CodeUnregistered = "BETA-4444-4444-4444-4444"
	CodeRateLimited  = "BETA-5555-5555-5555-5555"
	CodeUnavailable  = "BETA-6666-6666-6666-6666"
)

// Статусы активации.
const (
	statusPending   = "pending"
	statusConfirmed = "confirmed"
	statusDenied    = "denied"
	statusExpired   = "expired"
	statusRevoked   = "revoked"
)

const (
	userCode        = "KQ7M-2PXD"
	serial          = "AB7F-3KQ2"
	injectedFailure = "injected failure"
)

// ---- данные сервера ----

// Release — содержимое релиза. Подписанный манифест хранится внутри, поэтому
// копия, снятая до правки, несёт старый манифест; пересчитывают его
// AddRelease и Rebuild.
type Release struct {
	Channel  string
	Version  string
	Sequence int
	Pak      []byte
	BaseZip  []byte

	// Поломки: не класть манифест в ответ, испортить подпись, подписать другую версию.
	OmitManifest   bool
	BadManifestSig bool
	TamperVersion  bool

	signed struct {
		doc []byte
		sig string
	}
}

// Manifest возвращает копию байтов подписанного манифеста.
func (r Release) Manifest() []byte { return bytes.Clone(r.signed.doc) }

// ManifestSig возвращает подпись манифеста, текст base64.
func (r Release) ManifestSig() string { return r.signed.sig }

// ActivationInfo — снимок последней начатой активации.
type ActivationInfo struct {
	ID           string
	Status       string
	Machine      string
	DeviceName   string
	Polls        int
	BindSecret   string
	License      string
	Completed    bool
	CompleteSHA  string
	CompleteHits int
	StartChannel string
	Channel      string
}

// Stats — счётчики принятых запросов.
type Stats struct {
	Starts        int
	Polls         int
	BaseRequests  int
	PakRequests   int
	Completes     int
	RangeHeaders  []string
	StartChannels []string
	StartCodes    []string // коды, пришедшие в start (пустая строка — старт без кода)
	PollChannels  []string
}

// noteRange запоминает заголовок Range, если он пришёл.
func (st *Stats) noteRange(value string) {
	if value != "" {
		st.RangeHeaders = append(st.RangeHeaders, value)
	}
}

// Server — подставной сервер. Настройки — открытые поля; их читают при каждом
// запросе, поэтому правка действует сразу. Создавать только через NewServer.
type Server struct {
	*httptest.Server

	Rel               Release       // релиз по умолчанию
	Channels          []string      // ветки по старшинству; пусто — «прежний сервер»
	ChannelsAsStrings bool          // channels строками вместо объектов
	Interval          int           // секунд в ответах start и pending-poll
	AutoConfirmAfter  int           // подтвердить само на этом по счёту опросе (<=0: только Confirm)
	TicketBudget      int           // запросов файлов на билет
	TicketTTL         time.Duration // срок билета, настоящие часы
	ActivationTTL     time.Duration // срок подтверждения, часы сервера
	SlowBase          time.Duration // пауза перед каждой записью тела base
	CorruptBase       bool          // отдавать base с одним испорченным байтом
	OpenAccess        bool          // открытый режим: public/beta отвечает closed:false
	PublicDown        bool          // public/beta отвечает 503 (сервер не сказал, открыт ли доступ)

	mu      sync.Mutex
	tb      TB
	keys    keyring
	skew    time.Duration
	last    *activation
	stats   Stats
	extra   map[string]*Release
	seenJTI map[string]bool
	acts    map[string]*activation
	tickets map[string]*ticket
	faults  struct {
		pollN, pollStatus int
		pollCode          string
		completeN         int
		base, pak         cutPlan
		filesN            int
		filesStatus       int
		filesCode         string
		filesAfter        string
	}
}

// activation — активация: снимок для теста плюс то, что знает только сервер.
type activation struct {
	ActivationInfo
	jkt      string
	deadline time.Time
	ticket   string   // действующий билет
	rel      *Release // релиз последнего подтверждённого poll
}

type ticket struct {
	act      *activation
	jkt      string
	issued   time.Time
	requests int
}

// cutPlan — сколько ближайших ответов оборвать и после скольких байт тела.
type cutPlan struct{ after, times int }

// take тратит один «раз» обрыва и возвращает порог (0 — обрыва нет).
func (c *cutPlan) take() (threshold int) {
	if c.times > 0 {
		c.times--
		threshold = c.after
	}
	return threshold
}

// hold берёт замок; отпускает то, что вернёт: defer s.hold()().
func (s *Server) hold() func() {
	s.mu.Lock()
	return s.mu.Unlock
}

// tweak выполняет правку под замком сервера.
func (s *Server) tweak(change func()) {
	defer s.hold()()
	change()
}

// assign кладёт v в поле dst под замком сервера.
func assign[T any](s *Server, dst *T, v T) {
	defer s.hold()()
	*dst = v
}

// route — один маршрут сервера.
type route struct {
	pattern string
	handler http.HandlerFunc
}

// NewServer поднимает сервер на 127.0.0.1 и останавливает его через tb.Cleanup.
func NewServer(tb TB) *Server {
	tb.Helper()
	s := &Server{tb: tb}
	s.extra, s.seenJTI = map[string]*Release{}, map[string]bool{}
	s.acts, s.tickets = map[string]*activation{}, map[string]*ticket{}
	s.Interval, s.TicketBudget = 1, 8
	s.TicketTTL, s.ActivationTTL = 30*time.Minute, 10*time.Minute

	keys, err := newKeyring()
	if err != nil {
		tb.Fatal(err)
	}
	s.keys = keys
	s.Rel = defaultRelease()
	s.sign(&s.Rel)

	s.Server = httptest.NewServer(s.stampDate(s.mux()))
	tb.Cleanup(s.Close)
	return s
}

// mux собирает маршруты сервера; порядок их регистрации не важен.
func (s *Server) mux() *http.ServeMux {
	table := []route{
		{"POST /api/v1/beta/install/start", jsonRoute(s, "start", s.runStart)},
		{"POST /api/v1/beta/install/poll", jsonRoute(s, "poll", s.runPoll)},
		{"POST /api/v1/beta/install/complete", jsonRoute(s, "complete", s.runComplete)},
		{"GET /api/v1/beta/install/files/{kind}", s.serveFile},
		{"GET /api/v1/public/beta", s.publicBeta},
	}
	mux := http.NewServeMux()
	for _, r := range table {
		mux.HandleFunc(r.pattern, r.handler)
	}
	return mux
}

// ---- ключи, релиз по умолчанию, вспомогательные данные ----

// keyring — две пары ключей сервера: подпись манифестов и подпись лицензий.
type keyring struct {
	manifest ed25519.PrivateKey
	license  ed25519.PrivateKey
	licPub   ed25519.PublicKey
	trusted  *releasekeys.Set // открытый ключ манифестов под KID
}

func newKeyring() (keyring, error) {
	var pubs [2]ed25519.PublicKey
	var privs [2]ed25519.PrivateKey
	for i := range pubs {
		pub, priv, err := ed25519.GenerateKey(crand.Reader)
		if err != nil {
			return keyring{}, err
		}
		pubs[i], privs[i] = pub, priv
	}
	kr := keyring{manifest: privs[0], license: privs[1], licPub: pubs[1]}
	kr.trusted = releasekeys.NewSet(map[string]ed25519.PublicKey{KID: pubs[0]})
	return kr, nil
}

// defaultRelease — релиз ветки beta с набором файлов по умолчанию.
func defaultRelease() Release {
	files := map[string][]byte{}
	for _, f := range []struct {
		name string
		data []byte
	}{
		{"Astral.exe", []byte("MZ-fake-astral-exe")},
		{"resources/app.asar", bytes.Repeat([]byte("asar"), 4096)},
		{"resources/locales/ru.pak", []byte("ru")},
		{"resources/big.bin", Noise(300<<10, 11)},
	} {
		files[f.name] = f.data
	}
	rel := Release{Channel: "beta", Version: "0.9.0-beta.1", Sequence: 1}
	rel.BaseZip = MakeZip(files)
	rel.Pak = slices.Concat([]byte("ASTRPAK1"), bytes.Repeat([]byte{0x5a}, 20000))
	return rel
}

// Noise возвращает n воспроизводимых несжимаемых байт.
func Noise(n int, seed int64) []byte {
	buf := make([]byte, n)
	mrand.New(mrand.NewSource(seed)).Read(buf)
	return buf
}

// MakeZip собирает zip из набора файлов: записи по возрастанию имени, метод
// Deflate, фиксированное время. Имена не очищаются; имя со знаком «/» на конце
// становится каталогом, его тело теряется. Ошибки записи игнорируются.
func MakeZip(files map[string][]byte) []byte {
	var names []string
	for name := range files {
		at, _ := slices.BinarySearch(names, name)
		names = slices.Insert(names, at, name)
	}

	var out bytes.Buffer
	zw := zip.NewWriter(&out)
	modified := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	for _, name := range names {
		entry, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Deflate, Modified: modified})
		if err != nil {
			continue
		}
		_, _ = entry.Write(files[name])
	}
	_ = zw.Close()
	return out.Bytes()
}

func sha256Hex(b []byte) string {
	h := sha256.New()
	h.Write(b)
	return hex.EncodeToString(h.Sum(nil))
}

func randHex(nBytes int) string {
	var sb strings.Builder
	_, _ = io.CopyN(hex.NewEncoder(&sb), crand.Reader, int64(nBytes))
	return sb.String()
}

// testNotes — примечания к релизу на шести языках.
func testNotes() map[string]string {
	notes := map[string]string{}
	for _, lang := range []string{"ru", "uk", "en", "de", "pl", "fr"} {
		switch lang {
		case "ru", "uk":
			notes[lang] = "тест"
		case "de":
			notes[lang] = "Test"
		default:
			notes[lang] = "test"
		}
	}
	return notes
}

// ---- манифест и лицензия ----

// Поля объявлены по алфавиту ключей: так их пишет кодировщик, и порядок
// совпадает с порядком ключей карты.
type manifestDoc struct {
	Artifacts struct {
		Base artifactDoc `json:"base"`
		Web  artifactDoc `json:"web"`
	} `json:"artifacts"`
	Build       int               `json:"build"`
	Channel     string            `json:"channel"`
	Kid         string            `json:"kid"`
	MinVersion  string            `json:"minVersion"`
	Notes       map[string]string `json:"notes"`
	PublishedAt string            `json:"publishedAt"`
	Schema      int               `json:"schema"`
	Sequence    int               `json:"sequence"`
	Version     string            `json:"version"`
}

type artifactDoc struct {
	Name   string `json:"name,omitempty"`
	SHA256 string `json:"sha256"`
	Size   int    `json:"size"`
}

// describe — документ манифеста этого релиза.
func (r Release) describe() (doc manifestDoc) {
	doc.Kid, doc.MinVersion, doc.PublishedAt = KID, "0.9.0-beta.1", "2026-10-13T12:00:00.000Z"
	doc.Build, doc.Schema = 1, 1
	doc.Notes = testNotes()
	doc.Version = r.Version
	if r.TamperVersion {
		doc.Version = "9.9.9"
	}
	doc.Channel, doc.Sequence = r.Channel, r.Sequence
	doc.Artifacts.Base = artifactDoc{Name: "base.zip", SHA256: sha256Hex(r.BaseZip), Size: len(r.BaseZip)}
	doc.Artifacts.Web = artifactDoc{SHA256: sha256Hex([]byte("web")), Size: 1234}
	return doc
}

// sign пересчитывает манифест и подпись релиза.
func (s *Server) sign(r *Release) {
	text, err := json.MarshalIndent(r.describe(), "", "  ")
	if err != nil {
		s.tb.Fatal(err)
	}
	signature := ed25519.Sign(s.keys.manifest, text)
	if r.BadManifestSig {
		signature[0] ^= 0xff
	}
	r.signed.doc = text
	r.signed.sig = base64.StdEncoding.EncodeToString(signature)
}

// mintLicense выпускает лицензию «полезная часть.подпись». Подпись Ed25519
// детерминирована, поэтому лицензия зависит только от секунды выпуска.
func (s *Server) mintLicense(a *activation) string {
	var claims strings.Builder
	claims.WriteString(`{"aid":` + strconv.Quote(a.ID))
	claims.WriteString(`,"api":` + strconv.Quote(s.URL))
	claims.WriteString(`,"did":"123456789","iat":` + strconv.FormatInt(time.Now().Unix(), 10))
	claims.WriteString(`,"mh":` + strconv.Quote(a.Machine))
	claims.WriteString(`,"serial":` + strconv.Quote(serial))
	claims.WriteString(`,"sub":"user-1","v":1}`)

	enc := base64.RawURLEncoding
	body := enc.EncodeToString([]byte(claims.String()))
	return body + "." + enc.EncodeToString(ed25519.Sign(s.keys.license, []byte(body)))
}

// ---- ответы ----

// answer — чем кончается запрос; пишет себя в ответ.
type answer interface {
	send(w http.ResponseWriter, r *http.Request)
}

// refusal — ответ-ошибка application/problem+json.
type refusal struct {
	status     int
	code       string
	detail     string
	retryAfter string
}

// refuse собирает отказ без Retry-After.
func refuse(status int, code, detail string) refusal {
	return refusal{status: status, code: code, detail: detail}
}

// after добавляет к отказу заголовок Retry-After.
func (e refusal) after(seconds string) refusal {
	e.retryAfter = seconds
	return e
}

func (e refusal) send(w http.ResponseWriter, _ *http.Request) {
	headers := [][2]string{{"Content-Type", "application/problem+json"}}
	if e.retryAfter != "" {
		headers = append(headers, [2]string{"Retry-After", e.retryAfter})
	}
	for _, h := range headers {
		w.Header().Set(h[0], h[1])
	}
	w.WriteHeader(e.status)
	body := struct {
		Code   string `json:"code"`
		Detail string `json:"detail"`
		Status int    `json:"status"`
		Title  string `json:"title"`
		Type   string `json:"type"`
	}{e.code, e.detail, e.status, http.StatusText(e.status), "about:blank"}
	_ = json.NewEncoder(w).Encode(body)
}

// answerFunc — ответ, заданный функцией записи.
type answerFunc func(w http.ResponseWriter, r *http.Request)

func (f answerFunc) send(w http.ResponseWriter, r *http.Request) { f(w, r) }

// document — успешный ответ 200 с телом JSON.
func document(body any) answer {
	return answerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(body)
	})
}

// accepted — ответ 204 без тела.
var accepted answer = answerFunc(func(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusNoContent)
})

// absent — стандартный ответ платформы «404 page not found».
var absent answer = answerFunc(func(w http.ResponseWriter, r *http.Request) { http.NotFound(w, r) })

// Заготовленные отказы.
func badProof(text string) refusal { return refuse(401, "DPOP_INVALID", text) }

var (
	unknownActivity = refuse(410, "BETA_ACTIVATION_EXPIRED", "unknown activation")
	foreignKey      = badProof("key differs from the one used at start")
	foreignMachine  = refuse(403, "BETA_MACHINE_MISMATCH", "machine differs")
	notConfirmed    = refuse(403, "BETA_ACTIVATION_REVOKED", "no such confirmed activation")
	wrongChecksum   = refuse(400, "INVALID_REQUEST", "base_sha256 differs")
	ticketInvalid   = refuse(403, "BETA_TICKET_INVALID", "ticket is invalid")
	ticketSpent     = refuse(403, "BETA_TICKET_INVALID", "ticket request budget is spent")
	unknownCode     = refuse(404, "BETA_CODE_INVALID", "unknown code")
)

var closedActivation = map[string]refusal{
	statusExpired: refuse(410, "BETA_ACTIVATION_EXPIRED", "activation expired"),
	statusDenied:  refuse(410, "BETA_ACTIVATION_DENIED", "activation denied"),
	statusRevoked: refuse(410, "BETA_ACTIVATION_REVOKED", "activation revoked"),
}

var codeRefusals = map[string]refusal{
	CodeUsed:         refuse(409, "BETA_CODE_USED", "code already used"),
	CodeExpired:      refuse(410, "BETA_CODE_EXPIRED", "code expired"),
	CodeRevoked:      refuse(403, "BETA_CODE_REVOKED", "code revoked"),
	CodeUnregistered: refuse(412, "BETA_NOT_REGISTERED", "register on the site first"),
	CodeRateLimited:  refuse(429, "RATE_LIMITED", "too many attempts").after("7"),
	CodeUnavailable:  refuse(503, "BETA_UNAVAILABLE", "beta is down"),
}

// stampDate ставит в ответ Date по часам сервера (со сдвигом), если сдвиг не
// нулевой; иначе дату ставит сам http-сервер.
func (s *Server) stampDate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer next.ServeHTTP(w, r)
		skew := s.clockSkew()
		if skew == 0 {
			return
		}
		moment := time.Now().Add(skew).UTC()
		w.Header().Set("Date", moment.Format(http.TimeFormat))
	})
}

func (s *Server) clockSkew() time.Duration {
	defer s.hold()()
	return s.skew
}

// now — часы сервера; вызывать с замком.
func (s *Server) now() time.Time { return time.Now().Add(s.skew).Round(0) }

// vouch проверяет доказательство DPoP и тратит его jti; вызывать с замком.
// Возвращает отпечаток ключа клиента.
func (s *Server) vouch(r *http.Request) (jkt string, bad *refusal) {
	opts := dpop.VerifyOptions{Method: r.Method, URL: s.URL + r.URL.Path, Now: s.now()}
	jkt, claims, err := dpop.Verify(r.Header.Get("DPoP"), opts)
	switch {
	case err != nil:
		return rejectProof(err.Error())
	case s.seenJTI[claims.JTI]:
		return rejectProof("jti was already used")
	}
	s.seenJTI[claims.JTI] = true
	return jkt, nil
}

// rejectProof — результат vouch для негодного доказательства с этим текстом.
func rejectProof(text string) (string, *refusal) {
	bad := badProof(text)
	return "", &bad
}

// checked — тело запроса, умеющее проверить себя.
type checked interface{ valid() bool }

// jsonRoute строит обработчик маршрута JSON: под замком проверяет
// доказательство (раньше всего), разбирает и проверяет тело (400 с текстом
// «bad <name> request»), затем отдаёт управление serve.
func jsonRoute[T checked](s *Server, name string, serve func(jkt string, in T) answer) http.HandlerFunc {
	respond := func(r *http.Request) answer {
		jkt, bad := s.vouch(r)
		if bad != nil {
			return *bad
		}
		var in T
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil || !in.valid() {
			return refuse(400, "INVALID_REQUEST", "bad "+name+" request")
		}
		return serve(jkt, in)
	}
	return func(w http.ResponseWriter, r *http.Request) {
		defer s.hold()()
		respond(r).send(w, r)
	}
}

func hexSum(v string) bool {
	const digits = "0123456789abcdef"
	foreign := strings.IndexFunc(v, func(c rune) bool { return !strings.ContainsRune(digits, c) })
	return len(v) == 64 && foreign < 0
}

// servedBy — релиз, который отдал последний подтверждённый poll активации
// (до такого опроса — релиз по умолчанию); вызывать с замком.
func (s *Server) servedBy(a *activation) *Release { return cmp.Or(a.rel, &s.Rel) }

// releaseFor — релиз ветки: Rel, если ветка его, иначе добавленный; вызывать
// с замком. Добавленный релиз с веткой Rel не виден.
func (s *Server) releaseFor(channel string) *Release {
	switch channel {
	case s.Rel.Channel:
		return &s.Rel
	}
	return s.extra[channel]
}

// ---- start ----

type startRequest struct {
	Code             string `json:"code"`
	Machine          string `json:"machine"`
	DeviceName       string `json:"device_name"`
	InstallerVersion string `json:"installer_version"`
	Channel          string `json:"channel"`
}

func (q startRequest) valid() bool {
	return hexSum(q.Machine) && q.DeviceName != "" && q.InstallerVersion != ""
}

type startReply struct {
	ActivationID string `json:"activation_id"`
	ConfirmURL   string `json:"confirm_url"`
	ExpiresAt    string `json:"expires_at"`
	Interval     int    `json:"interval"`
	UserCode     string `json:"user_code"`
}

func (s *Server) runStart(jkt string, q startRequest) answer {
	switch no, known := codeRefusals[q.Code]; {
	case q.Code == ValidCode:
		return document(s.startReplyFor(s.begin(jkt, q)))
	case known:
		return no
	}
	return unknownCode
}

// startReplyFor — ответ start для только что начатой активации.
func (s *Server) startReplyFor(a *activation) startReply {
	return startReply{
		ActivationID: a.ID,
		ConfirmURL:   s.URL + "/beta/confirm?activation=" + a.ID,
		ExpiresAt:    a.deadline.UTC().Truncate(time.Second).Format(time.RFC3339),
		Interval:     s.Interval,
		UserCode:     userCode,
	}
}

// begin записывает принятый start: новая ожидающая активация становится
// последней начатой, а прежняя ожидающая просрочивается.
func (s *Server) begin(jkt string, q startRequest) *activation {
	s.stats.Starts++
	s.stats.StartChannels = append(s.stats.StartChannels, q.Channel)
	s.stats.StartCodes = append(s.stats.StartCodes, q.Code)
	if prev := s.last; prev != nil && prev.Status == statusPending {
		prev.Status = statusExpired
	}
	fresh := &activation{jkt: jkt, deadline: s.now().Add(s.ActivationTTL)}
	fresh.ID, fresh.Status = newActivationID(), statusPending
	fresh.Machine, fresh.DeviceName, fresh.StartChannel = q.Machine, q.DeviceName, q.Channel
	s.last = fresh
	s.acts[fresh.ID] = fresh
	return fresh
}

// newActivationID — 32 шестнадцатеричных знака группами 8-4-4-4-12.
func newActivationID() string {
	rest := randHex(16)
	var groups []string
	for _, width := range [...]int{8, 4, 4, 4, 12} {
		groups, rest = append(groups, rest[:width]), rest[width:]
	}
	return strings.Join(groups, "-")
}

// ---- poll ----

type pollRequest struct {
	ActivationID string `json:"activation_id"`
	Machine      string `json:"machine"`
	Channel      string `json:"channel"`
}

func (q pollRequest) valid() bool { return q.ActivationID != "" && hexSum(q.Machine) }

// pendingReply — ответ poll, пока человек не подтвердил.
type pendingReply struct {
	Interval int    `json:"interval"`
	Status   string `json:"status"`
}

// owned находит активацию по id и сверяет ключ и машину; отказ — вторым результатом.
func (s *Server) owned(id, jkt, machine string) (*activation, answer) {
	a := s.acts[id]
	switch {
	case a == nil:
		return nil, unknownActivity
	case a.jkt != jkt:
		return nil, foreignKey
	case a.Machine != machine:
		return nil, foreignMachine
	}
	return a, nil
}

func (s *Server) runPoll(jkt string, q pollRequest) answer {
	s.stats.Polls++
	s.stats.PollChannels = append(s.stats.PollChannels, q.Channel)

	// Приманка стоит раньше проверки активации и активацию не трогает.
	if f := &s.faults; f.pollN > 0 {
		f.pollN--
		return refuse(f.pollStatus, f.pollCode, injectedFailure)
	}

	a, bad := s.owned(q.ActivationID, jkt, q.Machine)
	if bad != nil {
		return bad
	}
	if a.Status == statusPending && s.now().After(a.deadline) {
		a.Status = statusExpired
	}
	if closed, ok := closedActivation[a.Status]; ok {
		return closed
	}

	a.Polls++
	if a.Status == statusPending && s.AutoConfirmAfter > 0 && a.Polls >= s.AutoConfirmAfter {
		a.Status = statusConfirmed
	}
	if a.Status != statusPending {
		return document(s.issue(a, q.Channel))
	}
	return document(pendingReply{s.Interval, statusPending})
}

type fileView struct {
	Bytes  int    `json:"bytes"`
	SHA256 string `json:"sha256,omitempty"`
	URL    string `json:"url"`
}

type confirmedReply struct {
	Account struct {
		DisplayName string `json:"display_name"`
	} `json:"account"`
	BindSecret string `json:"bind_secret"`
	Channels   any    `json:"channels,omitempty"`
	License    string `json:"license"`
	Release    struct {
		Base        fileView `json:"base"`
		Channel     string   `json:"channel"`
		Manifest    *string  `json:"manifest,omitempty"`
		ManifestSig *string  `json:"manifest_sig,omitempty"`
		Pak         fileView `json:"pak"`
		Version     string   `json:"version"`
	} `json:"release"`
	Serial string `json:"serial"`
	Status string `json:"status"`
}

// bindSecret — новый секрет привязки: 43 знака base64 от 32 случайных байт в hex.
func bindSecret() string {
	text := base64.RawURLEncoding.EncodeToString([]byte(randHex(32)))
	return text[:43]
}

// renew выдаёт активации новые секрет привязки, лицензию и билет (прежний гаснет).
func (s *Server) renew(a *activation, rel *Release) {
	delete(s.tickets, a.ticket)
	a.ticket = randHex(16)
	s.tickets[a.ticket] = &ticket{act: a, jkt: a.jkt, issued: time.Now()}
	a.rel, a.Channel = rel, rel.Channel
	a.BindSecret = bindSecret()
	a.License = s.mintLicense(a)
}

// issue выпускает для подтверждённой активации новые билет, секрет привязки и
// лицензию и собирает ответ poll.
func (s *Server) issue(a *activation, asked string) (out confirmedReply) {
	rel := s.chosenRelease(asked)
	s.renew(a, rel)

	out.Account.DisplayName = "Тестер"
	out.BindSecret, out.License = a.BindSecret, a.License
	out.Serial, out.Status = serial, statusConfirmed
	if len(s.Channels) > 0 {
		out.Channels = s.channelList()
	}
	fileURL := func(kind string) string {
		return "/api/v1/beta/install/files/" + kind + "?ticket=" + a.ticket
	}
	rv := &out.Release
	rv.Channel, rv.Version = rel.Channel, rel.Version
	rv.Base = fileView{Bytes: len(rel.BaseZip), SHA256: sha256Hex(rel.BaseZip), URL: fileURL("base")}
	rv.Pak = fileView{Bytes: len(rel.Pak), URL: fileURL("pak")}
	if !rel.OmitManifest {
		doc := base64.StdEncoding.EncodeToString(rel.signed.doc)
		sig := rel.signed.sig
		rv.Manifest, rv.ManifestSig = &doc, &sig
	}
	return out
}

// chosenRelease выбирает релиз для опроса с веткой asked: запрошенная ветка
// из списка, иначе первая в списке, иначе Rel; ветка без релиза не годится.
func (s *Server) chosenRelease(asked string) *Release {
	if len(s.Channels) == 0 {
		return &s.Rel
	}
	askedListed := slices.Contains(s.Channels, asked)
	for _, ch := range [...]string{asked, s.Channels[0]} {
		if ch == asked && !askedListed {
			continue
		}
		if rel := s.releaseFor(ch); rel != nil {
			return rel
		}
	}
	return &s.Rel
}

// channelList — ключ channels: объекты только для веток с релизом либо, при
// ChannelsAsStrings, имена всех веток списка.
func (s *Server) channelList() any {
	if s.ChannelsAsStrings {
		return slices.Clone(s.Channels)
	}
	type entry struct {
		Channel string `json:"channel"`
		Version string `json:"version"`
	}
	list := []entry{}
	for _, ch := range s.Channels {
		if rel := s.releaseFor(ch); rel != nil {
			list = append(list, entry{ch, rel.Version})
		}
	}
	return list
}

// ---- files ----

// rangedBody — выдача base: с диапазонами, паузой перед записью и обрывом.
func rangedBody(data []byte, pause time.Duration, cut int) answer {
	return answerFunc(func(w http.ResponseWriter, r *http.Request) {
		out := &pacedWriter{ResponseWriter: w, pause: pause, cutAfter: cut}
		out.Header().Set("Content-Type", "application/octet-stream")
		http.ServeContent(out, r, "base.zip", time.Time{}, bytes.NewReader(data))
	})
}

// plainBody — выдача pak целиком, с обрывом.
func plainBody(data []byte, cut int) answer {
	return answerFunc(func(w http.ResponseWriter, r *http.Request) {
		out := &pacedWriter{ResponseWriter: w, cutAfter: cut}
		head := out.Header()
		head.Set("Content-Type", "application/octet-stream")
		head.Set("Content-Length", strconv.Itoa(len(data)))
		if r.Method != http.MethodHead {
			_, _ = out.Write(data)
		}
	})
}

func (s *Server) serveFile(w http.ResponseWriter, r *http.Request) {
	s.admitLocked(r).send(w, r)
}

// admitLocked решает судьбу запроса файла под замком сервера.
func (s *Server) admitLocked(r *http.Request) answer {
	defer s.hold()()
	return s.admit(r)
}

// admit проверяет билет и считает запрос; замок держит вызывающий.
func (s *Server) admit(r *http.Request) answer {
	jkt, bad := s.vouch(r)
	if bad != nil {
		return *bad
	}
	// Сервер занят: отказ раньше билета, бюджет билета не тратится.
	if s.faults.filesN > 0 {
		s.faults.filesN--
		return refuse(s.faults.filesStatus, s.faults.filesCode, "busy").after(s.faults.filesAfter)
	}
	tk := s.tickets[r.URL.Query().Get("ticket")]
	if usable := tk != nil && tk.jkt == jkt && time.Now().Before(tk.issued.Add(s.TicketTTL)); !usable {
		return ticketInvalid
	}
	// Бюджет тратится раньше проверки вида файла.
	tk.requests++
	if tk.requests > s.TicketBudget {
		return ticketSpent
	}

	rel := s.servedBy(tk.act)
	switch r.PathValue("kind") {
	case "base":
		return s.baseDelivery(r, rel)
	case "pak":
		return s.pakDelivery(rel)
	}
	return absent
}

// baseDelivery считает запрос base и готовит выдачу: с диапазонами, паузой и обрывом.
func (s *Server) baseDelivery(r *http.Request, rel *Release) answer {
	s.stats.BaseRequests++
	s.stats.noteRange(r.Header.Get("Range"))
	data := rel.BaseZip
	if s.CorruptBase && len(data) > 0 {
		data = bytes.Clone(data)
		data[len(data)/2] ^= 0xff
	}
	return rangedBody(data, s.SlowBase, s.faults.base.take())
}

// pakDelivery считает запрос pak и готовит выдачу целиком.
func (s *Server) pakDelivery(rel *Release) answer {
	s.stats.PakRequests++
	return plainBody(rel.Pak, s.faults.pak.take())
}

// pacedWriter тормозит и обрывает тело ответа: пауза перед каждой записью,
// а запись, выходящая за cutAfter, пишется до порога и рвёт соединение.
type pacedWriter struct {
	http.ResponseWriter
	pause    time.Duration
	cutAfter int
	sent     int
}

// abortAfter дописывает последнюю часть тела, сбрасывает буфер и рвёт соединение.
func (p *pacedWriter) abortAfter(part []byte) {
	n, _ := p.ResponseWriter.Write(part)
	p.sent += n
	_ = http.NewResponseController(p.ResponseWriter).Flush()
	panic(http.ErrAbortHandler)
}

func (p *pacedWriter) Write(b []byte) (int, error) {
	if p.pause > 0 {
		time.Sleep(p.pause)
	}
	room := p.cutAfter - p.sent
	if cutting := p.cutAfter > 0 && len(b) > room; cutting {
		p.abortAfter(b[:room])
	}
	written, err := p.ResponseWriter.Write(b)
	p.sent += written
	return written, err
}

// ---- complete ----

type completeRequest struct {
	ActivationID string `json:"activation_id"`
	BaseSHA256   string `json:"base_sha256"`
}

func (completeRequest) valid() bool { return true }

func (s *Server) runComplete(jkt string, q completeRequest) answer {
	s.stats.Completes++
	if s.faults.completeN > 0 {
		s.faults.completeN--
		return refuse(503, "BETA_UNAVAILABLE", injectedFailure)
	}
	a := s.acts[q.ActivationID]
	if a == nil || a.jkt != jkt || a.Status != statusConfirmed {
		return notConfirmed
	}
	if q.BaseSHA256 != sha256Hex(s.servedBy(a).BaseZip) {
		return wrongChecksum
	}
	a.Completed, a.CompleteSHA = true, q.BaseSHA256
	a.CompleteHits++
	return accepted
}

// ---- настройки и снимки для теста ----

// Keys — связка с одним ключом (KID), которым подписаны манифесты сервера.
func (s *Server) Keys() *releasekeys.Set { return s.keys.trusted }

// LicensePublicKey — открытый ключ подписи лицензий.
func (s *Server) LicensePublicKey() ed25519.PublicKey { return s.keys.licPub }

// BaseSHA256 — sha256 текущего Rel.BaseZip.
func (s *Server) BaseSHA256() string { return sha256Hex(s.Rel.BaseZip) }

// ManifestJSON — копия манифеста релиза по умолчанию.
func (s *Server) ManifestJSON() []byte { return s.Rel.Manifest() }

// ManifestSig — подпись манифеста релиза по умолчанию.
func (s *Server) ManifestSig() string { return s.Rel.ManifestSig() }

// AddRelease сохраняет копию r как релиз ветки r.Channel, подписывает её и
// возвращает указатель на сохранённую копию.
func (s *Server) AddRelease(r Release) *Release {
	kept := &r
	s.tweak(func() {
		s.sign(kept)
		s.extra[kept.Channel] = kept
	})
	return kept
}

// SetChannels заменяет список веток целиком (без аргументов — на nil).
func (s *Server) SetChannels(channels ...string) { assign(s, &s.Channels, channels) }

// ReleaseOf возвращает &Rel для ветки Rel, иначе добавленный релиз ветки или nil.
func (s *Server) ReleaseOf(channel string) (found *Release) {
	s.tweak(func() { found = s.releaseFor(channel) })
	return found
}

// stagingSet отдаёт по порядку имя и содержимое четырёх файлов набора; манифест последним:
// он считается готовностью набора.
func stagingSet(rel *Release) iter.Seq2[string, []byte] {
	return func(yield func(string, []byte) bool) {
		_ = yield("astral-web.pak", rel.Pak) &&
			yield("base.zip", rel.BaseZip) &&
			yield("manifest.sig", []byte(rel.signed.sig)) &&
			yield("manifest.json", rel.signed.doc)
	}
}

// stageFiles создаёт папку и кладёт в неё набор; первая ошибка прекращает работу.
func stageFiles(rel *Release, dir string) error {
	err := os.MkdirAll(dir, 0o755)
	for name, blob := range stagingSet(rel) {
		if err != nil {
			break
		}
		err = os.WriteFile(filepath.Join(dir, name), blob, 0o644)
	}
	return err
}

// Staging кладёт в dir четыре файла релиза ветки так, как кладёт лаунчер.
func (s *Server) Staging(channel, dir string) error {
	if rel := s.ReleaseOf(channel); rel != nil {
		return stageFiles(rel, dir)
	}
	return fmt.Errorf("betatest: no release for channel %q", channel)
}

// Rebuild заново подписывает манифесты Rel и всех добавленных релизов.
// Без замка, как и правка открытых полей тестом.
func (s *Server) Rebuild() {
	releases := []*Release{&s.Rel}
	for _, rel := range s.extra {
		releases = append(releases, rel)
	}
	for _, rel := range releases {
		s.sign(rel)
	}
}

// Confirm, Deny, ExpireActivation и RevokeActivation ставят статус последней
// начатой активации без оглядки на прежний.
func (s *Server) Confirm()          { s.setLastStatus(statusConfirmed) }
func (s *Server) Deny()             { s.setLastStatus(statusDenied) }
func (s *Server) ExpireActivation() { s.setLastStatus(statusExpired) }
func (s *Server) RevokeActivation() { s.setLastStatus(statusRevoked) }

func (s *Server) setLastStatus(status string) {
	s.tb.Helper()
	defer s.hold()()
	last := s.last
	if last != nil {
		last.Status = status
		return
	}
	s.tb.Fatalf("betatest: %s before any start", status)
	// Если Fatalf вернул управление, здесь будет обращение к пустому указателю.
	last.Status = status
}

// SetClockSkew сдвигает часы сервера относительно часов теста.
func (s *Server) SetClockSkew(d time.Duration) { assign(s, &s.skew, d) }

// CutBase обрывает times ближайших ответов base после afterBytes байт тела.
func (s *Server) CutBase(afterBytes, times int) {
	assign(s, &s.faults.base, cutPlan{afterBytes, times})
}

// CutPak то же для pak.
func (s *Server) CutPak(afterBytes, times int) {
	assign(s, &s.faults.pak, cutPlan{afterBytes, times})
}

// FailComplete: n ближайших complete получают 503.
func (s *Server) FailComplete(n int) { assign(s, &s.faults.completeN, n) }

// FailPoll: n ближайших poll получают ответ-ошибку с этим статусом и кодом.
func (s *Server) FailPoll(n, status int, code string) {
	s.tweak(func() { s.faults.pollN, s.faults.pollStatus, s.faults.pollCode = n, status, code })
}

// Activation — снимок последней начатой активации; до start нулевое значение.
func (s *Server) Activation() (info ActivationInfo) {
	s.tweak(func() {
		if s.last != nil {
			info = s.last.ActivationInfo
		}
	})
	return info
}

// Stats — снимок счётчиков; списки в нём копии.
func (s *Server) Stats() (snap Stats) {
	s.tweak(func() { snap = s.stats })
	for _, list := range []*[]string{&snap.RangeHeaders, &snap.StartChannels, &snap.PollChannels} {
		*list = slices.Clone(*list)
	}
	return snap
}

// ---- открытый ответ о доступе ----

// publicBeta — GET /api/v1/public/beta: закрыта ли бета (открытый маршрут, без DPoP).
func (s *Server) publicBeta(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	open, down := s.OpenAccess, s.PublicDown
	s.mu.Unlock()
	if down {
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"closed": !open, "installer": nil})
}

// FailFiles отвечает отказом (status, код code, Retry-After retryAfter — пустой значит без заголовка) на n ближайших
// запросов файлов: так сервер говорит «много желающих». Бюджет билета отказ не тратит.
func (s *Server) FailFiles(n, status int, code, retryAfter string) {
	s.tweak(func() {
		s.faults.filesN, s.faults.filesStatus, s.faults.filesCode, s.faults.filesAfter = n, status, code, retryAfter
	})
}
