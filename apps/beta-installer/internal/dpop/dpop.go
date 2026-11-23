// Package dpop подписывает запросы установщика доказательством владения
// ключом (RFC 9449) и умеет проверять такие доказательства.
package dpop

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"math/big"
	"net/url"
	"slices"
	"strings"
	"sync/atomic"
	"time"
)

const (
	proofTyp    = "dpop+jwt"
	proofAlg    = "ES256"
	curveName   = "P-256"
	keyType     = "EC"
	coordSize   = 32
	sigSize     = 2 * coordSize
	jtiSize     = 16
	defaultSkew = 60 * time.Second
)

var b64 = base64.RawURLEncoding

// Claims — тело доказательства.
type Claims struct {
	JTI string `json:"jti"`
	HTM string `json:"htm"`
	HTU string `json:"htu"`
	IAT int64  `json:"iat"`
}

// VerifyOptions — что ожидает проверяющий. Нулевой MaxSkew — 60 секунд.
type VerifyOptions struct {
	Method  string
	URL     string
	Now     time.Time
	MaxSkew time.Duration
}

// jwk — открытый ключ в заголовке доказательства.
type jwk struct {
	Crv string `json:"crv"`
	Kty string `json:"kty"`
	X   string `json:"x"`
	Y   string `json:"y"`
}

type header struct {
	Typ string `json:"typ"`
	Alg string `json:"alg"`
	JWK jwk    `json:"jwk"`
}

// thumbprintOf — отпечаток ключа по RFC 7638: SHA-256 от записи четырёх
// полей без пробелов, поля идут по возрастанию имён.
func thumbprintOf(x, y string) string {
	fields := map[string]string{"crv": curveName, "kty": keyType, "x": x, "y": y}
	var canon strings.Builder
	canon.WriteByte('{')
	for i, name := range slices.Sorted(maps.Keys(fields)) {
		if i > 0 {
			canon.WriteByte(',')
		}
		key, _ := json.Marshal(name)
		val, _ := json.Marshal(fields[name])
		canon.Write(key)
		canon.WriteByte(':')
		canon.Write(val)
	}
	canon.WriteByte('}')
	sum := sha256.Sum256([]byte(canon.String()))
	return b64.EncodeToString(sum[:])
}

// pad32 записывает число ровно в 32 байта, старшие нули сохраняются.
func pad32(n *big.Int) []byte {
	raw := n.Bytes()
	return append(make([]byte, coordSize-len(raw)), raw...)
}

// sealer подписывает ES256: SHA-256 от входа, затем пара r и s по 32 байта
// (не ASN.1).
type sealer struct{ key *ecdsa.PrivateKey }

func signDigest(key *ecdsa.PrivateKey, digest [sha256.Size]byte) (*big.Int, *big.Int, error) {
	return ecdsa.Sign(rand.Reader, key, digest[:])
}

func (z sealer) seal(input string) (string, error) {
	digest := sha256.Sum256([]byte(input))
	r, s, err := signDigest(z.key, digest)
	if err != nil {
		return "", fmt.Errorf("dpop: sign: %w", err)
	}
	return b64.EncodeToString(append(pad32(r), pad32(s)...)), nil
}

// Signer хранит ключ на время работы процесса. Создаётся только NewSigner.
type Signer struct {
	sealer sealer
	head   string // готовая первая часть доказательства, для ключа она одна
	jkt    string
	clock  func() time.Time
	drift  atomic.Pointer[time.Duration] // поправка часов; пусто — ноль
}

func generateP256Key() (*ecdsa.PrivateKey, error) {
	return ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
}

func mintKey() (*ecdsa.PrivateKey, error) {
	key, err := generateP256Key()
	if err != nil {
		return nil, fmt.Errorf("dpop: generate key: %w", err)
	}
	return key, nil
}

func NewSigner() (*Signer, error) {
	key, err := mintKey()
	if err != nil {
		return nil, err
	}
	return newSigner(key, time.Now)
}

func newSigner(key *ecdsa.PrivateKey, clock func() time.Time) (*Signer, error) {
	x := b64.EncodeToString(pad32(key.PublicKey.X))
	y := b64.EncodeToString(pad32(key.PublicKey.Y))
	raw, err := json.Marshal(header{Typ: proofTyp, Alg: proofAlg, JWK: jwk{Crv: curveName, Kty: keyType, X: x, Y: y}})
	if err != nil {
		return nil, err
	}
	return &Signer{
		sealer: sealer{key},
		head:   b64.EncodeToString(raw),
		jkt:    thumbprintOf(x, y),
		clock:  clock,
	}, nil
}

func (s *Signer) SetClockOffset(d time.Duration) { s.drift.Store(&d) }

func (s *Signer) ClockOffset() time.Duration {
	if d := s.drift.Load(); d != nil {
		return *d
	}
	return 0
}

// Thumbprint — отпечаток ключа по RFC 7638 (на сервере он зовётся jkt).
func (s *Signer) Thumbprint() string { return s.jkt }

// forge собирает доказательство по шагам.
type forge struct {
	signer         *Signer
	method, rawURL string
	htu, jti       string
	signing        string // части 1 и 2 через точку
	proof          string
}

func (f *forge) stepURL() (err error) {
	f.htu, err = NormalizeHTU(f.rawURL)
	return err
}

func (f *forge) stepID() error {
	raw := make([]byte, jtiSize)
	if _, err := rand.Read(raw); err != nil {
		return fmt.Errorf("dpop: jti: %w", err)
	}
	f.jti = b64.EncodeToString(raw)
	return nil
}

func (f *forge) stepBody() error {
	now := f.signer.clock().Add(f.signer.ClockOffset())
	body, err := json.Marshal(Claims{JTI: f.jti, HTM: strings.ToUpper(f.method), HTU: f.htu, IAT: now.Unix()})
	if err != nil {
		return err
	}
	f.signing = f.signer.head + "." + b64.EncodeToString(body)
	return nil
}

func (f *forge) stepSeal() error {
	sig, err := f.signer.sealer.seal(f.signing)
	if err != nil {
		return err
	}
	f.proof = f.signing + "." + sig
	return nil
}

// Proof подписывает запрос. Адрес проверяется раньше всего остального.
func (s *Signer) Proof(method, rawURL string) (string, error) {
	f := &forge{signer: s, method: method, rawURL: rawURL}
	for _, step := range []func(*forge) error{(*forge).stepURL, (*forge).stepID, (*forge).stepBody, (*forge).stepSeal} {
		if err := step(f); err != nil {
			return "", err
		}
	}
	return f.proof, nil
}

// urlRules — что должен выполнять адрес запроса.
var urlRules = []func(*url.URL) bool{
	func(u *url.URL) bool { return u.Scheme == "http" || u.Scheme == "https" },
	func(u *url.URL) bool { return u.Host != "" },
}

// NormalizeHTU приводит адрес к виду htu: схема и узел в нижнем регистре, путь
// в экранированной записи, без учётных данных, query и фрагмента.
func parseDpopURL(rawURL string) (*url.URL, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("dpop: bad url: %w", err)
	}
	return u, nil
}

func NormalizeHTU(rawURL string) (string, error) {
	u, err := parseDpopURL(rawURL)
	if err != nil {
		return "", err
	}
	for _, holds := range urlRules {
		if !holds(u) {
			return "", fmt.Errorf("dpop: url must be absolute http(s): %q", rawURL)
		}
	}
	return strings.Join([]string{u.Scheme, "://", strings.ToLower(u.Host), u.EscapedPath()}, ""), nil
}

// proofCheck несёт состояние проверки от шага к шагу.
type proofCheck struct {
	raw    string
	opt    VerifyOptions
	parts  []string
	head   header
	pub    ecdsa.PublicKey
	jkt    string
	claims Claims
}

// Verify проверяет доказательство так же, как сервер. Шаги идут по порядку,
// побеждает первая ошибка; тело возвращается тем, что успело разобраться.
func Verify(proof string, opt VerifyOptions) (string, Claims, error) {
	pc := &proofCheck{raw: proof, opt: opt}
	steps := [...]func(*proofCheck) error{
		(*proofCheck).split,
		(*proofCheck).readHeader,
		(*proofCheck).checkKind,
		(*proofCheck).readKey,
		(*proofCheck).checkSignature,
		(*proofCheck).readClaims,
		(*proofCheck).checkJTI,
		(*proofCheck).checkMethod,
		(*proofCheck).checkURL,
		(*proofCheck).checkFresh,
	}
	for _, step := range steps {
		if err := step(pc); err != nil {
			return "", pc.claims, err
		}
	}
	return pc.jkt, pc.claims, nil
}

func (pc *proofCheck) split() error {
	pc.parts = strings.Split(pc.raw, ".")
	if len(pc.parts) != 3 {
		return errors.New("dpop: want three dot-separated parts")
	}
	return nil
}

// decodeAndParse декодирует base64-часть part и разбирает её JSON в into.
func decodeAndParse(part, label string, into any) error {
	raw, err := b64.DecodeString(part)
	if err != nil {
		return fmt.Errorf("dpop: %s: %w", label, err)
	}
	if err := json.Unmarshal(raw, into); err != nil {
		return fmt.Errorf("dpop: %s json: %w", label, err)
	}
	return nil
}

func (pc *proofCheck) readHeader() error {
	return decodeAndParse(pc.parts[0], "header", &pc.head)
}

func (pc *proofCheck) checkKind() error {
	h := pc.head
	if h.Typ != proofTyp || h.Alg != proofAlg || h.JWK.Kty != keyType || h.JWK.Crv != curveName {
		return errors.New("dpop: unsupported header")
	}
	return nil
}

// decodeCoord декодирует одну координату jwk; ok ложно, если длина не coordSize.
func decodeCoord(s string) (b []byte, ok bool) {
	b, err := b64.DecodeString(s)
	return b, err == nil && len(b) == coordSize
}

func (pc *proofCheck) readKey() error {
	xb, okX := decodeCoord(pc.head.JWK.X)
	yb, okY := decodeCoord(pc.head.JWK.Y)
	if !okX || !okY {
		return errors.New("dpop: bad jwk coordinates")
	}
	curve := elliptic.P256()
	x, y := new(big.Int).SetBytes(xb), new(big.Int).SetBytes(yb)
	if !curve.IsOnCurve(x, y) {
		return errors.New("dpop: jwk point is not on the curve")
	}
	pc.pub = ecdsa.PublicKey{Curve: curve, X: x, Y: y}
	pc.jkt = thumbprintOf(b64.EncodeToString(xb), b64.EncodeToString(yb))
	return nil
}

// signingInput — часть доказательства, которую покрывает подпись.
func signingInput(parts []string) string {
	return parts[0] + "." + parts[1]
}

func (pc *proofCheck) checkSignature() error {
	sig, err := b64.DecodeString(pc.parts[2])
	if err != nil || len(sig) != sigSize {
		return errors.New("dpop: signature must be 64 raw bytes")
	}
	digest := sha256.Sum256([]byte(signingInput(pc.parts)))
	r, s := new(big.Int).SetBytes(sig[:coordSize]), new(big.Int).SetBytes(sig[coordSize:])
	if !ecdsa.Verify(&pc.pub, digest[:], r, s) {
		return errors.New("dpop: bad signature")
	}
	return nil
}

func (pc *proofCheck) readClaims() error {
	return decodeAndParse(pc.parts[1], "claims", &pc.claims)
}

func (pc *proofCheck) checkJTI() error {
	if pc.claims.JTI == "" {
		return errors.New("dpop: empty jti")
	}
	return nil
}

func (pc *proofCheck) checkMethod() error {
	if !strings.EqualFold(pc.claims.HTM, pc.opt.Method) {
		return fmt.Errorf("dpop: htm %q != %q", pc.claims.HTM, pc.opt.Method)
	}
	return nil
}

// checkURL нормализует только ожидаемый адрес: htu из тела сравнивается как есть.
func (pc *proofCheck) checkURL() error {
	want, err := NormalizeHTU(pc.opt.URL)
	if err != nil {
		return err
	}
	if pc.claims.HTU != want {
		return fmt.Errorf("dpop: htu %q != %q", pc.claims.HTU, want)
	}
	return nil
}

func (pc *proofCheck) checkFresh() error {
	skew := pc.opt.MaxSkew
	if skew == 0 {
		skew = defaultSkew
	}
	away := pc.opt.Now.Sub(time.Unix(pc.claims.IAT, 0))
	if away > skew || away < -skew {
		return fmt.Errorf("dpop: iat is %s away from now", away)
	}
	return nil
}
