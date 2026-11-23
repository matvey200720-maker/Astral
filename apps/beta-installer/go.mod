module github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer

go 1.23.0

require (
	github.com/jchv/go-webview2 v0.0.0-20260205173254-56598839c808
	golang.org/x/sys v0.30.0
)

require github.com/jchv/go-winloader v0.0.0-20250406163304-c1995be93bd1 // indirect

// Исправленная копия go-webview2: см. third_party/go-webview2/PATCHES.md.
replace github.com/jchv/go-webview2 => ./third_party/go-webview2
