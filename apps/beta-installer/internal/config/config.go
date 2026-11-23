// Package config keeps the settings that are baked into the installer when it
// is built. The release pipeline overwrites the variables with the linker flag
//
//	-ldflags "-X <module>/internal/config.Name=value"
//
// and a build made without the flags is a dev build that talks to the servers
// running on the developer's machine.
package config

import (
	"errors"
	"strings"
)

// Build-time settings. They must stay plain string variables: the linker can
// only replace those, and cmd/setup and the tests assign to them while running.

// APIOrigin is the address of the beta API.
var APIOrigin = "http://127.0.0.1:8080"

// SiteOrigin is the address of the beta website.
var SiteOrigin = "http://127.0.0.1:5173"

// Version is the installer version reported to the server.
var Version = "0.0.0-dev"

// Channel is "release" for a production build; anything else is dev.
var Channel = "dev"

// LicensePublicKey is the base64 Ed25519 key that signs the licence in the
// poll answer. Empty means the launcher does the check.
var LicensePublicKey = ""

// cutTrailingSlashes drops every slash at the end of an address and nothing else.
func cutTrailingSlashes(address string) string {
	end := len(address)
	for end > 0 && address[end-1] == '/' {
		end--
	}
	return address[:end]
}

// isSecureOrigin: the address starts with https:// (the case matters).
func isSecureOrigin(address string) bool {
	return strings.HasPrefix(address, "https://")
}

// IsRelease reports whether this is a production build. Only the exact word
// counts.
func IsRelease() bool {
	switch Channel {
	case "release":
		return true
	}
	return false
}

// API returns the API address with every trailing slash cut off.
func API() string { return cutTrailingSlashes(APIOrigin) }

// Site returns the website address cut the same way.
func Site() string { return cutTrailingSlashes(SiteOrigin) }

// Validate catches a broken build before the first screen: a production
// build may only talk https. Other builds are not checked at all.
func Validate() error {
	if !IsRelease() {
		return nil
	}
	if isSecureOrigin(API()) && isSecureOrigin(Site()) {
		return nil
	}
	return errors.New("release build must use https origins")
}
