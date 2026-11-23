package manifest

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"iter"
	"slices"
	"strings"

	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/releasekeys"
)

const (
	supportedSchema = 1
	baseFileName    = "base.zip"
	signatureLen    = 64
	sha256HexLen    = 64

	sigFormatText = "manifest: signature is not a base64 Ed25519 signature"
)

// ErrNoKeys возвращается Verify как значение, когда связка ключей пуста или nil.
var ErrNoKeys = errors.New("manifest: no release keys to verify the signature")

type Manifest struct {
	Schema      int               `json:"schema"`
	KID         string            `json:"kid"`
	Channel     string            `json:"channel"`
	Version     string            `json:"version"`
	Build       int64             `json:"build"`
	Sequence    int64             `json:"sequence"`
	MinVersion  string            `json:"minVersion"`
	PublishedAt string            `json:"publishedAt"`
	Notes       map[string]string `json:"notes"`
	Artifacts   Artifacts         `json:"artifacts"`
}

type Artifacts struct {
	Base BaseArtifact `json:"base"`
	Web  WebArtifact  `json:"web"`
}

type BaseArtifact struct {
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type WebArtifact struct {
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

// Release — то, что сервер назвал в ответе poll для выпуска.
type Release struct {
	Version    string
	Channel    string
	BaseSHA256 string
	BaseBytes  int64
}

// --- подпись ---

// sigDecoders — варианты base64 для подписи в порядке проб.
var sigDecoders = []func(string) ([]byte, error){
	base64.StdEncoding.DecodeString,
	base64.RawStdEncoding.DecodeString,
	base64.URLEncoding.DecodeString,
	base64.RawURLEncoding.DecodeString,
}

// decodings перечисляет успешные раскодирования текста по порядку вариантов.
func decodings(text string) iter.Seq[[]byte] {
	return func(yield func([]byte) bool) {
		for _, decode := range sigDecoders {
			if raw, err := decode(text); err == nil && !yield(raw) {
				return
			}
		}
	}
}

// decodeSignature берёт первое раскодирование ровно в 64 байта.
func decodeSignature(text string) ([]byte, bool) {
	for raw := range decodings(strings.TrimSpace(text)) {
		if len(raw) == signatureLen {
			return raw, true
		}
	}
	return nil, false
}

// verification — состояние Verify, пока оно идёт по шагам.
type verification struct {
	keys   *releasekeys.Set
	doc    []byte
	text   string
	sig    []byte
	kid    string
	result *Manifest
}

func (v *verification) needKeys() error {
	if v.keys.Len() == 0 {
		return ErrNoKeys
	}
	return nil
}

func (v *verification) readSignature() error {
	sig, ok := decodeSignature(v.text)
	if !ok {
		return errors.New(sigFormatText)
	}
	v.sig = sig
	return nil
}

// peekKID мягко читает из документа только поле kid.
func (v *verification) peekKID() error {
	var head struct {
		KID string `json:"kid"`
	}
	if err := json.Unmarshal(v.doc, &head); err != nil {
		return fmt.Errorf("manifest: %w", err)
	}
	v.kid = head.KID
	return nil
}

func (v *verification) checkSignature() error {
	if err := v.keys.Verify(v.kid, v.doc, v.sig); err != nil {
		return fmt.Errorf("manifest: %w", err)
	}
	return nil
}

func (v *verification) parse() (err error) {
	v.result, err = Parse(v.doc)
	return err
}

// Verify проверяет подпись над байтами манифеста и только потом разбирает его.
func Verify(keys *releasekeys.Set, manifestBytes []byte, sigText string) (*Manifest, error) {
	v := &verification{keys: keys, doc: manifestBytes, text: sigText}
	pipeline := [...]func(*verification) error{
		(*verification).needKeys,
		(*verification).readSignature,
		(*verification).peekKID,
		(*verification).checkSignature,
		(*verification).parse,
	}
	for _, run := range pipeline {
		if err := run(v); err != nil {
			return nil, err
		}
	}
	return v.result, nil
}

// --- разбор ---

// wireDoc — документ как он лежит в файле; artifacts пока сырой.
type wireDoc = struct {
	Schema      int               `json:"schema"`
	KID         string            `json:"kid"`
	Channel     string            `json:"channel"`
	Version     string            `json:"version"`
	Build       int64             `json:"build"`
	Sequence    int64             `json:"sequence"`
	MinVersion  string            `json:"minVersion"`
	PublishedAt string            `json:"publishedAt"`
	Notes       map[string]string `json:"notes"`
	Artifacts   json.RawMessage   `json:"artifacts"`
}

type docReader struct {
	doc  wireDoc
	arts Artifacts
}

func (r *docReader) top(b []byte) error {
	if err := json.Unmarshal(b, &r.doc); err != nil {
		return fmt.Errorf("manifest: %w", err)
	}
	if len(r.doc.Artifacts) == 0 {
		return errors.New("manifest: artifacts are missing")
	}
	return nil
}

// artifacts разбирает раздел artifacts строже остального: неизвестный ключ — отказ.
func (r *docReader) artifacts() error {
	dec := json.NewDecoder(bytes.NewReader(r.doc.Artifacts))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&r.arts); err != nil {
		return fmt.Errorf("manifest: artifacts: %w", err)
	}
	return nil
}

func (r *docReader) manifest() *Manifest {
	d := &r.doc
	return &Manifest{
		Schema: d.Schema, KID: d.KID, Channel: d.Channel, Version: d.Version,
		Build: d.Build, Sequence: d.Sequence, MinVersion: d.MinVersion,
		PublishedAt: d.PublishedAt, Notes: d.Notes, Artifacts: r.arts,
	}
}

// Parse — строгий разбор без проверки подписи.
func Parse(b []byte) (*Manifest, error) {
	var r docReader
	for _, phase := range []func() error{func() error { return r.top(b) }, r.artifacts} {
		if err := phase(); err != nil {
			return nil, err
		}
	}
	m := r.manifest()
	if err := m.validate(); err != nil {
		return nil, err
	}
	return m, nil
}

// --- правила ---

// rule — одно условие отказа и текст ошибки к нему.
type rule[T any] struct {
	broken func(T) bool
	say    func(T) string
}

// firstBroken возвращает ошибку первого нарушенного правила.
func firstBroken[T any](subject T, rules []rule[T]) error {
	for _, r := range rules {
		if r.broken(subject) {
			return errors.New(r.say(subject))
		}
	}
	return nil
}

func plain[T any](s string) func(T) string { return func(T) string { return s } }

func shown[T any](format string, pick func(T) any) func(T) string {
	return func(subject T) string { return fmt.Sprintf(format, pick(subject)) }
}

func isLowerHex(s string, n int) bool {
	return len(s) == n && strings.Trim(s, "0123456789abcdef") == ""
}

// knownChannels — ветки выпусков; сравнение точное, с регистром.
var knownChannels = []string{"alpha", "beta", "release"}

var contentRules = []rule[*Manifest]{
	{func(m *Manifest) bool { return m.Schema != supportedSchema },
		shown("manifest: unsupported schema %d", func(m *Manifest) any { return m.Schema })},
	{func(m *Manifest) bool { return m.KID == "" }, plain[*Manifest]("manifest: empty kid")},
	{func(m *Manifest) bool { return !slices.Contains(knownChannels, m.Channel) },
		shown("manifest: unknown channel %q", func(m *Manifest) any { return m.Channel })},
	{func(m *Manifest) bool { return !IsSemver(m.Version) },
		shown("manifest: version %q is not semver", func(m *Manifest) any { return m.Version })},
	{func(m *Manifest) bool { return m.MinVersion != "" && !IsSemver(m.MinVersion) },
		shown("manifest: minVersion %q is not semver", func(m *Manifest) any { return m.MinVersion })},
	{func(m *Manifest) bool { return min(m.Build, m.Sequence) < 0 }, plain[*Manifest]("manifest: negative build or sequence")},
	{func(m *Manifest) bool { return m.Artifacts.Base.Name != baseFileName },
		shown("manifest: base artifact must be base.zip, got %q", func(m *Manifest) any { return m.Artifacts.Base.Name })},
	{func(m *Manifest) bool { return min(m.Artifacts.Base.Size, m.Artifacts.Web.Size) <= 0 },
		plain[*Manifest]("manifest: artifact sizes must be positive integers")},
	{func(m *Manifest) bool {
		return !isLowerHex(m.Artifacts.Base.SHA256, sha256HexLen) || !isLowerHex(m.Artifacts.Web.SHA256, sha256HexLen)
	}, plain[*Manifest]("manifest: artifact sha256 must be 64 lowercase hex characters")},
}

func (m *Manifest) validate() error { return firstBroken(m, contentRules) }

// answer — подписанный манифест и ответ сервера, сверяемые правилами matchRules.
type answer struct {
	m *Manifest
	r Release
}

func twoSided(format string, got, signed func(answer) any) func(answer) string {
	return func(a answer) string { return fmt.Sprintf(format, got(a), signed(a)) }
}

var matchRules = []rule[answer]{
	{func(a answer) bool { return a.r.Version != a.m.Version },
		twoSided(`manifest: version %q in the response, %q in the signed manifest`,
			func(a answer) any { return a.r.Version }, func(a answer) any { return a.m.Version })},
	{func(a answer) bool { return a.r.Channel != a.m.Channel },
		twoSided(`manifest: channel %q in the response, %q in the signed manifest`,
			func(a answer) any { return a.r.Channel }, func(a answer) any { return a.m.Channel })},
	{func(a answer) bool { return !strings.EqualFold(a.r.BaseSHA256, a.m.Artifacts.Base.SHA256) },
		plain[answer]("manifest: base.zip sha256 differs from the signed manifest")},
	{func(a answer) bool { return a.r.BaseBytes != a.m.Artifacts.Base.Size },
		twoSided("manifest: base.zip is %d bytes in the response, %d in the signed manifest",
			func(a answer) any { return a.r.BaseBytes }, func(a answer) any { return a.m.Artifacts.Base.Size })},
}

// Matches сверяет ответ сервера с подписанным манифестом; первое расхождение побеждает.
func (m *Manifest) Matches(r Release) error { return firstBroken(answer{m, r}, matchRules) }

// IsSemver: строка целиком — версия по semver.org (без приставки «v», только ASCII).
func IsSemver(v string) bool {
	core, build, hasBuild := strings.Cut(v, "+")
	core, pre, hasPre := strings.Cut(core, "-")

	nums := strings.Split(core, ".")
	if len(nums) != 3 {
		return false
	}
	for _, n := range nums {
		if !isNumeric(n) {
			return false
		}
	}
	if hasPre && !allIdents(pre, func(id string) bool {
		return isIdent(id) && (!isDigits(id) || isNumeric(id))
	}) {
		return false
	}
	return !hasBuild || allIdents(build, isIdent)
}

// allIdents: список идентификаторов через «.» непуст и каждый подходит под ok.
func allIdents(list string, ok func(string) bool) bool {
	for _, id := range strings.Split(list, ".") {
		if !ok(id) {
			return false
		}
	}
	return true
}

func isDigits(s string) bool {
	return s != "" && strings.Trim(s, "0123456789") == ""
}

// isNumeric: число без ведущих нулей (сам «0» допустим).
func isNumeric(s string) bool {
	return isDigits(s) && (len(s) == 1 || s[0] != '0')
}

// isIdent: непустая строка из 0-9a-zA-Z-.
func isIdent(s string) bool {
	return s != "" && strings.Trim(s, "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-") == ""
}
