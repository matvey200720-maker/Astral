// Package codemark — код установки в имени файла установщика (открытый режим) и в тексте, куда попал путь к файлу.
// Одно правило конца кода для разбора имени (layout) и для маски журнала (applog): код, который разбор принимает,
// маска не пропустит.
package codemark

import "strings"

// BodyLen — длина тела кода установки: 16 знаков без «BETA-» и дефисов.
const BodyLen = 16

// Masked — чем заменяется код в тексте.
const Masked = "k****************"

// Token читает код с начала s: «k» (любой регистр) и ровно 16 букв и цифр ASCII либо ровно 16 знаков алфавита Crockford
// (без I, L, O, U) без приставки. После кода — конец строки или знак, не являющийся ASCII-буквой и цифрой: пробел,
// точка, «_», «(», «-» («…k<код>_1.exe», «… (1).exe», «… - копия.exe»). body — 16 знаков в верхнем регистре, n — сколько
// знаков занял код вместе с приставкой «k».
func Token(s string) (body string, n int, ok bool) {
	if len(s) > 0 && (s[0] == 'k' || s[0] == 'K') {
		if body, ok = tokenAt(s, 1, isAlnum); ok {
			return body, 1 + BodyLen, true
		}
	}
	if body, ok = tokenAt(s, 0, isCrockford); ok {
		return body, BodyLen, true
	}
	return "", 0, false
}

func tokenAt(s string, from int, allowed func(byte) bool) (string, bool) {
	end := from + BodyLen
	if len(s) < end {
		return "", false
	}
	for i := from; i < end; i++ {
		if !allowed(s[i]) {
			return "", false
		}
	}
	if len(s) > end && isAlnum(s[end]) {
		return "", false
	}
	return strings.ToUpper(s[from:end]), true
}

// Mask прячет целиком каждый код, стоящий после «-» или «_»: «…-k<код>.exe» → «…-k****************.exe».
func Mask(s string) string {
	var out strings.Builder
	for i := 0; i < len(s); i++ {
		out.WriteByte(s[i])
		if s[i] != '-' && s[i] != '_' {
			continue
		}
		if _, n, ok := Token(s[i+1:]); ok {
			out.WriteString(Masked)
			i += n
		}
	}
	return out.String()
}

func isAlnum(b byte) bool {
	return (b >= '0' && b <= '9') || (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z')
}

// isCrockford: цифра или буква алфавита Crockford base32 (без I, L, O, U), регистр любой.
func isCrockford(b byte) bool {
	return isAlnum(b) && !strings.ContainsRune("ILOUilou", rune(b))
}
