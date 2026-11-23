package install

import (
	"errors"
	"strings"
	"unicode"
)

const (
	codeTag      = "BETA"
	codeBodyLen  = 16
	codeGroupLen = 4

	// Знаки, которые срезаются по краям вместе с пробелами, но не внутри кода.
	codeEdgeMarks = ".,;:"

	// Алфавит Crockford base32: без I, L, O, U.
	codeAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

	// Похожие знаки тела: что вместо чего подставляется.
	codeLookalikes = "O0I1L1"
)

var errCodeShape = errors.New("code must be BETA plus four groups of four Crockford base32 characters")

// bodyTable[c] — знак тела после замены похожих или 0, если знак в алфавит не входит.
var bodyTable = func() (t [128]byte) {
	for i := 0; i < len(codeAlphabet); i++ {
		t[codeAlphabet[i]] = codeAlphabet[i]
	}
	for i := 0; i < len(codeLookalikes); i += 2 {
		t[codeLookalikes[i]] = codeLookalikes[i+1]
	}
	return t
}()

func isCodeEdge(r rune) bool {
	return unicode.IsSpace(r) || strings.ContainsRune(codeEdgeMarks, r)
}

// isCodeDash: дефис-минус, U+2010…U+2015 и знак минус U+2212.
func isCodeDash(r rune) bool {
	return r == '-' || (r >= 0x2010 && r <= 0x2015) || r == 0x2212
}

// squeezeCode оставляет в строке только цифры и латинские буквы в верхнем регистре;
// пробелы и тире пропускает, любой другой знак — отказ.
func squeezeCode(s string) ([]byte, bool) {
	out := make([]byte, 0, len(codeTag)+codeBodyLen)
	for _, r := range s {
		switch {
		case unicode.IsSpace(r), isCodeDash(r):
		case r >= '0' && r <= '9', r >= 'A' && r <= 'Z':
			out = append(out, byte(r))
		case r >= 'a' && r <= 'z':
			out = append(out, byte(r-'a'+'A'))
		default:
			return nil, false
		}
		if len(out) > len(codeTag)+codeBodyLen {
			// Дальше длина уже не исправится: результат тот же отказ.
			return nil, false
		}
	}
	return out, true
}

// NormalizeCode приводит введённый код беты к виду BETA-XXXX-XXXX-XXXX-XXXX.
func NormalizeCode(in string) (string, error) {
	flat, ok := squeezeCode(strings.TrimFunc(in, isCodeEdge))
	if !ok || len(flat) != len(codeTag)+codeBodyLen || string(flat[:len(codeTag)]) != codeTag {
		return "", errCodeShape
	}
	var b strings.Builder
	b.Grow(len(codeTag) + codeBodyLen + codeBodyLen/codeGroupLen)
	b.WriteString(codeTag)
	for i, c := range flat[len(codeTag):] {
		fixed := bodyTable[c]
		if fixed == 0 {
			return "", errCodeShape
		}
		if i%codeGroupLen == 0 {
			b.WriteByte('-')
		}
		b.WriteByte(fixed)
	}
	return b.String(), nil
}

var uiLanguages = [...]string{"ru", "uk", "en", "de", "pl", "fr"}

// MapLocale сворачивает язык системы («ru-RU», «pl_PL») в один из шести языков окна.
func MapLocale(tag string) string {
	lang := strings.TrimSpace(strings.ToLower(tag))
	if cut := strings.IndexAny(lang, "-_"); cut >= 0 {
		lang = lang[:cut]
	}
	for _, known := range uiLanguages {
		if lang == known {
			return lang
		}
	}
	return uiLanguages[0]
}
