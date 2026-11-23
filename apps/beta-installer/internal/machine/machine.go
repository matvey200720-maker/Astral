// Package machine derives the identifier by which the server, the launcher
// and the installer recognise one and the same computer.
package machine

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"strings"
)

// Hash returns the lower-case hex SHA-256 of hashPrefix followed by the
// lower-cased MachineGuid. Nothing else is normalised: braces, spaces and
// dashes stay exactly as the registry gave them.
func Hash(machineGUID string) (digest string) {
	var input bytes.Buffer
	input.WriteString(hashPrefix)
	input.WriteString(strings.ToLower(machineGUID))
	sum := sha256.Sum256(input.Bytes())
	return fmt.Sprintf("%x", sum[:])
}

// hashPrefix is mixed into every digest; its newline is part of the contract
// with the server.
const hashPrefix = "astral-beta-machine-v1\n"
