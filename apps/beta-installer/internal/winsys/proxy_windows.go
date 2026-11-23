//go:build windows

package winsys

import (
	"net/http"
	"net/url"
)

import "github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/winproxy"

// internetSettings — «Параметры Интернета» текущего пользователя: прокси
// люди настраивают там, а не в переменных окружения.
const internetSettings = `Software\Microsoft\Windows\CurrentVersion\Internet Settings`

// ProxySettings читает системный прокси из реестра (только чтение). Нет
// ключа — пустые настройки, то есть «прокси выключен».
func ProxySettings() (found winproxy.Settings) {
	_ = peek(internetSettings, func(h hive) {
		flag, _ := h.number("ProxyEnable")
		// Отсутствующее значение и значение не того типа дают пустую строку.
		server, _ := h.text("ProxyServer")
		skip, _ := h.text("ProxyOverride")
		pac, _ := h.text("AutoConfigURL")
		// Включённым считается только ровно 1.
		found = winproxy.Settings{Server: server, Override: skip, PACURL: pac, Enabled: flag == 1}
	})
	return
}

// ProxyFunc — функция для http.Transport.Proxy: системный прокси, а когда он
// выключен — прокси из переменных окружения. Настройки снимаются в момент
// вызова и позже не обновляются.
func ProxyFunc() func(*http.Request) (*url.URL, error) {
	snapshot := ProxySettings()
	return snapshot.Func(http.ProxyFromEnvironment)
}
