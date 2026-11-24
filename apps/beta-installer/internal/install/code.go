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
// Язык первого запуска — одно правило для окна, установщика и сайта:
// 1) явный выбор человека (сохранённый язык) — всегда главный; язык, показанный установщиком, идёт сразу за ним;
// 2) язык системы или браузера — первый из списка, который у нас есть;
// 3) иначе часовой пояс; 4) иначе английский.
// Здесь, у родных окон, п. 1 и 3 нет (выбор и пояс знает окно интерфейса): язык системы — `OSLocale`, неизвестный даёт английский.
func MapLocale(tag string) string {
	if lang, ok := KnownLanguage(tag); ok {
		return lang
	}
	return "en"
}

// KnownLanguage — язык окна по тегу («de-DE», «pl_PL», «ua» → «uk»); false, если такого языка у нас нет.
// Возвращается всегда один из шести кодов, а не сам тег: лишнее из тега дальше не уходит.
func KnownLanguage(tag string) (string, bool) {
	lang := strings.TrimSpace(strings.ToLower(tag))
	if cut := strings.IndexAny(lang, "-_"); cut >= 0 {
		lang = lang[:cut]
	}
	if lang == "ua" {
		lang = "uk"
	}
	for _, known := range uiLanguages {
		if lang == known {
			return lang, true
		}
	}
	return "", false
}
