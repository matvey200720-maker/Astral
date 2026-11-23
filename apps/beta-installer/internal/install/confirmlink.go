package install

import (
	"net/url"
	"strings"
)

// shortCodeLen — длина короткого кода подтверждения без дефиса (KQ7M-2PXD → KQ7M2PXD).
const shortCodeLen = 8

// withShortCode — адрес подтверждения для браузера: короткий код установки во фрагменте («#code=KQ7M2PXD»).
// Человек сверяет код на странице с окном установщика и нажимает одну кнопку, перепечатывать его не нужно.
// Фрагмент не уходит на сервер и не попадает в его журналы; страница сайта читает его, вписывает в поле и стирает.
// Адрес, где уже есть фрагмент или параметр code, и код не из восьми букв и цифр остаются как есть.
func withShortCode(confirmURL, userCode string) string {
	code := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(userCode), "-", ""))
	if len(code) != shortCodeLen || strings.ContainsRune(confirmURL, '#') {
		return confirmURL
	}
	for i := 0; i < len(code); i++ {
		if c := code[i]; (c < '0' || c > '9') && (c < 'A' || c > 'Z') {
			return confirmURL
		}
	}
	if u, err := url.Parse(confirmURL); err != nil || u.Query().Has("code") {
		return confirmURL
	}
	return confirmURL + "#code=" + code
}
