// Package i18n holds the texts of the installer's native windows: the ones
// shown before the web interface exists or when it cannot start at all. The
// interface itself ships its own dictionaries.
package i18n

import (
	"fmt"
	"maps"
	"slices"
	"strings"
)

// nativeLangs lists the supported languages; the order is part of the contract.
var nativeLangs = strings.Fields("ru uk en de pl fr")

// nativeFallback answers when the asked language has no such text.
const nativeFallback = "ru"

// nativeSet is every message of one language: one field per key.
type nativeSet struct {
	badBuild        string
	fatal           string
	noWebView2      string
	title           string
	uninstallFailed string
	webView2Failed  string
}

// dictionary maps the keys the callers know to the texts of one language.
type dictionary = map[string]string

// table lays the set out under the keys the callers know.
func (s nativeSet) table() dictionary {
	return dictionary{
		"bad-build":        s.badBuild,
		"fatal":            s.fatal,
		"no-webview2":      s.noWebView2,
		"title":            s.title,
		"uninstall-failed": s.uninstallFailed,
		"webview2-failed":  s.webView2Failed,
	}
}

var nativeRU = nativeSet{
	badBuild:        "Эта сборка установщика собрана неправильно: %s.\n\nСкачайте установщик заново с сайта.",
	fatal:           "Не удалось запустить установщик.\n\n%s\n\nЖурнал: %s",
	noWebView2:      "Для установщика нужен Microsoft Edge WebView2 Runtime, но на этом компьютере его нет.\n\nОткрыть страницу загрузки?",
	title:           "Astral",
	uninstallFailed: "Не удалось удалить Astral Beta.\n\n%s\n\nЖурнал: %s",
	webView2Failed:  "Microsoft Edge WebView2 не смог открыть окно установщика.\n\nПерезагрузите компьютер и запустите установщик снова. Если не помогло, переустановите WebView2 Runtime.\n\nЖурнал: %s\n\nОткрыть страницу загрузки WebView2?",
}

var nativeUK = nativeSet{
	badBuild:        "Цю збірку встановлювача зібрано неправильно: %s.\n\nЗавантажте встановлювач заново з сайту.",
	fatal:           "Не вдалося запустити встановлювач.\n\n%s\n\nЖурнал: %s",
	noWebView2:      "Для встановлювача потрібен Microsoft Edge WebView2 Runtime, але на цьому комп'ютері його немає.\n\nВідкрити сторінку завантаження?",
	title:           "Astral",
	uninstallFailed: "Не вдалося видалити Astral Beta.\n\n%s\n\nЖурнал: %s",
	webView2Failed:  "Microsoft Edge WebView2 не зміг відкрити вікно встановлювача.\n\nПерезавантажте комп'ютер і запустіть встановлювач знову. Якщо не допомогло, перевстановіть WebView2 Runtime.\n\nЖурнал: %s\n\nВідкрити сторінку завантаження WebView2?",
}

var nativeEN = nativeSet{
	badBuild:        "This installer build is broken: %s.\n\nDownload the installer again from the website.",
	fatal:           "The installer could not start.\n\n%s\n\nLog: %s",
	noWebView2:      "The installer needs Microsoft Edge WebView2 Runtime, which is not installed on this computer.\n\nOpen the download page?",
	title:           "Astral",
	uninstallFailed: "Astral Beta could not be removed.\n\n%s\n\nLog: %s",
	webView2Failed:  "Microsoft Edge WebView2 could not open the installer window.\n\nRestart the computer and run the installer again. If that does not help, reinstall WebView2 Runtime.\n\nLog: %s\n\nOpen the WebView2 download page?",
}

var nativeDE = nativeSet{
	badBuild:        "Diese Version des Installationsprogramms ist fehlerhaft: %s.\n\nLaden Sie das Installationsprogramm erneut von der Website herunter.",
	fatal:           "Das Installationsprogramm konnte nicht gestartet werden.\n\n%s\n\nProtokoll: %s",
	noWebView2:      "Das Installationsprogramm benötigt Microsoft Edge WebView2 Runtime, das auf diesem Computer nicht installiert ist.\n\nDownload-Seite öffnen?",
	title:           "Astral",
	uninstallFailed: "Astral Beta konnte nicht entfernt werden.\n\n%s\n\nProtokoll: %s",
	webView2Failed:  "Microsoft Edge WebView2 konnte das Fenster des Installationsprogramms nicht öffnen.\n\nStarten Sie den Computer neu und führen Sie das Installationsprogramm erneut aus. Hilft das nicht, installieren Sie WebView2 Runtime neu.\n\nProtokoll: %s\n\nDownload-Seite von WebView2 öffnen?",
}

var nativePL = nativeSet{
	badBuild:        "Ta wersja instalatora jest uszkodzona: %s.\n\nPobierz instalator ponownie ze strony.",
	fatal:           "Nie udało się uruchomić instalatora.\n\n%s\n\nDziennik: %s",
	noWebView2:      "Instalator wymaga Microsoft Edge WebView2 Runtime, którego nie ma na tym komputerze.\n\nOtworzyć stronę pobierania?",
	title:           "Astral",
	uninstallFailed: "Nie udało się usunąć Astral Beta.\n\n%s\n\nDziennik: %s",
	webView2Failed:  "Microsoft Edge WebView2 nie mógł otworzyć okna instalatora.\n\nUruchom ponownie komputer i włącz instalator jeszcze raz. Jeśli to nie pomoże, zainstaluj WebView2 Runtime ponownie.\n\nDziennik: %s\n\nOtworzyć stronę pobierania WebView2?",
}

var nativeFR = nativeSet{
	badBuild:        "Cette version de l’installateur est défectueuse\u00a0: %s.\n\nTéléchargez de nouveau l’installateur depuis le site.",
	fatal:           "Impossible de lancer l’installateur.\n\n%s\n\nJournal\u00a0: %s",
	noWebView2:      "L’installateur a besoin de Microsoft Edge WebView2 Runtime, qui n’est pas installé sur cet ordinateur.\n\nOuvrir la page de téléchargement\u00a0?",
	title:           "Astral",
	uninstallFailed: "Impossible de désinstaller Astral Beta.\n\n%s\n\nJournal\u00a0: %s",
	webView2Failed:  "Microsoft Edge WebView2 n’a pas pu ouvrir la fenêtre de l’installateur.\n\nRedémarrez l’ordinateur et relancez l’installateur. Si cela ne suffit pas, réinstallez WebView2 Runtime.\n\nJournal\u00a0: %s\n\nOuvrir la page de téléchargement de WebView2\u00a0?",
}

// texts is the dictionary of every language: one entry per language, each
// holding all the keys.
var texts = map[string]dictionary{
	"ru": nativeRU.table(),
	"uk": nativeUK.table(),
	"en": nativeEN.table(),
	"de": nativeDE.table(),
	"pl": nativePL.table(),
	"fr": nativeFR.table(),
}

// lookup finds the exact pair; neither the language nor the key is
// normalised.
func lookup(lang, key string) (text string, found bool) {
	// An absent language yields a nil dictionary, and indexing a nil map is
	// safe: it gives the zero value and false.
	text, found = texts[lang][key]
	return
}

// T returns the text of key in lang, the Russian one when lang lacks it, and
// the key itself when Russian lacks it too.
func T(lang, key string) string {
	for _, candidate := range [...]string{lang, nativeFallback} {
		if text, found := lookup(candidate, key); found {
			return text
		}
	}
	return key
}

// F is T passed through fmt.Sprintf.
func F(lang, key string, args ...any) string {
	pattern := T(lang, key)
	return fmt.Sprintf(pattern, args...)
}

// Langs returns the languages in order; the caller owns the slice.
func Langs() []string {
	return append(make([]string, 0, len(nativeLangs)), nativeLangs...)
}

// Keys returns every key, sorted; the caller owns the slice.
func Keys() []string {
	return slices.Sorted(maps.Keys(texts[nativeFallback]))
}
