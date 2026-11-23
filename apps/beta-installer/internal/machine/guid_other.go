//go:build !windows

package machine

import (
	"errors"
)

// errGUIDOnlyOnWindows is what ReadGUID answers away from Windows: the
// installer is built and run only there, and tests on other systems supply
// the GUID themselves.
var errGUIDOnlyOnWindows = errors.New("MachineGuid is only available on Windows")

// ReadGUID has nothing to read away from Windows.
func ReadGUID() (string, error) {
	var none string
	return none, errGUIDOnlyOnWindows
}
