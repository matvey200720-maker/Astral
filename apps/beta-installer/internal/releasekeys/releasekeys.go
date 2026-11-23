// Пакет releasekeys хранит открытые ключи Ed25519, которыми подписаны манифесты
// выпусков, и проверяет подпись по идентификатору ключа kid.
package releasekeys

import (
	"crypto/ed25519"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"slices"
)

// ErrUnknownKID: идентификатора ключа нет в связке.
var ErrUnknownKID = errors.New("releasekeys: unknown kid")

// ErrBadSignature: подпись не сошлась.
var ErrBadSignature = errors.New("releasekeys: bad signature")

// Set — связка открытых ключей: идентификатор kid -> ключ.
type Set struct {
	keys map[string]ed25519.PublicKey
}

// rkRecord и rkDocument описывают вид документа связки. Это псевдонимы безымянных
// структур: имя типа попало бы в текст ошибок encoding/json, а он не должен меняться.
type (
	rkRecord = struct {
		KID       string `json:"kid"`
		PublicKey string `json:"publicKey"`
	}
	rkDocument = struct {
		Keys []rkRecord `json:"keys"`
	}
)

// rkFits: у ключа длина открытого ключа Ed25519.
func rkFits(key []byte) bool { return len(key) == ed25519.PublicKeySize }

// rkDecode разбирает ключ из стандартного base64; ok — получился ключ нужной длины.
func rkDecode(text string) (key ed25519.PublicKey, ok bool) {
	raw, err := base64.StdEncoding.DecodeString(text)
	return raw, err == nil && rkFits(raw)
}

// rkTable отдаёт таблицу ключей; у nil-связки таблицы нет, и читается она как пустая.
func (s *Set) rkTable() map[string]ed25519.PublicKey {
	if s == nil {
		return nil
	}
	return s.keys
}

// Verify проверяет подпись sig над message ключом kid. Ошибки возвращаются самими
// значениями ErrUnknownKID и ErrBadSignature, без обёрток.
func (s *Set) Verify(kid string, message, sig []byte) error {
	key, found := s.rkTable()[kid]
	switch {
	case !found:
		return ErrUnknownKID
	case !ed25519.Verify(key, message, sig):
		return ErrBadSignature
	}
	return nil
}

// Len — число ключей в связке; у nil-связки 0.
func (s *Set) Len() int {
	return len(s.rkTable())
}

// NewSet собирает связку из готовых ключей. Карта копируется; ключи не той длины
// в связку не попадают: проверить ими нечего, а ed25519.Verify с ними паникует.
func NewSet(keys map[string]ed25519.PublicKey) *Set {
	set := &Set{keys: maps.Clone(keys)}
	maps.DeleteFunc(set.keys, func(_ string, key ed25519.PublicKey) bool { return !rkFits(key) })
	return set
}

// rkRead разбирает JSON документа; ошибка разбора получает приставку пакета.
func rkRead(data []byte) (doc rkDocument, err error) {
	err = json.Unmarshal(data, &doc)
	if err == nil {
		return doc, nil
	}
	return doc, fmt.Errorf("releasekeys: %w", err)
}

// rkAdd кладёт запись в связку. Порядок отказов: пустой kid, повтор kid, ключ.
func (s *Set) rkAdd(rec rkRecord) error {
	key, decoded := rkDecode(rec.PublicKey)
	_, taken := s.keys[rec.KID]
	switch {
	case rec.KID == "":
		return errors.New("releasekeys: empty kid")
	case taken:
		return fmt.Errorf("releasekeys: duplicate kid %q", rec.KID)
	case !decoded:
		return fmt.Errorf("releasekeys: key %q is not a base64 Ed25519 public key", rec.KID)
	}
	s.keys[rec.KID] = key
	return nil
}

// Parse разбирает документ {"keys":[{"kid":"…","publicKey":"<base64>"}]}.
// Пустой документ даёт пустую связку; при первой же ошибке связки нет.
func Parse(data []byte) (*Set, error) {
	doc, err := rkRead(data)
	if err != nil {
		return nil, err
	}
	set := new(Set)
	set.keys = make(map[string]ed25519.PublicKey, len(doc.Keys))
	var failure error
	refused := slices.ContainsFunc(doc.Keys, func(rec rkRecord) bool {
		failure = set.rkAdd(rec)
		return failure != nil
	})
	if refused {
		return nil, failure
	}
	return set, nil
}

// embedded — боевая связка ключей, вшитая в сборку из keys.json рядом с пакетом.
//
//go:embed keys.json
var embedded []byte

// Embedded разбирает вшитый keys.json заново при каждом вызове.
func Embedded() (*Set, error) {
	set, err := Parse(embedded)
	return set, err
}
