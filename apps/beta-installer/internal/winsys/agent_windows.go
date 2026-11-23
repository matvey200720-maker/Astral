//go:build windows

package winsys

import (
	"bufio"
	"os"
	"os/exec"
	"os/user"
	"syscall"
	"time"

	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/agentpipe"
)

// Имена те же, что у лаунчера: apps/desktop/src/rockstar-mode/scheduler.js и agent-control.js.
const (
	agentTaskName = "AstralRockstarAgent"
	agentRunKey   = `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
)

// currentUser — имя пользователя как отдаёт система (с доменом); срез и регистр — дело agentpipe.Name.
func currentUser() string {
	if u, err := user.Current(); err == nil {
		return u.Username
	}
	return ""
}

func quiet(name string, args ...string) {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	_ = cmd.Run()
}

// stopAgentAt просит агента, занявшего канал pipe, выйти. true — канал открылся и просьба ушла
// (агент есть); false — открыть канал не удалось, агента нет.
func stopAgentAt(pipe string) bool {
	file, err := os.OpenFile(pipe, os.O_RDWR, 0)
	if err != nil {
		return false
	}
	defer file.Close()
	if _, err := file.WriteString(`{"cmd":"stop"}` + "\n"); err != nil {
		return false
	}
	answered := make(chan struct{})
	go func() {
		_, _ = bufio.NewReader(file).ReadString('\n')
		close(answered)
	}()
	select {
	case <-answered:
	case <-time.After(3 * time.Second):
	}
	return true
}

// StopRockstarAgent снимает запуск агента при входе (задача планировщика и запись Run) и
// просит работающего агента выйти. Файлов игры агент при выходе не трогает.
func (s *System) StopRockstarAgent() (bool, error) {
	quiet("schtasks.exe", "/Delete", "/TN", agentTaskName, "/F")
	quiet("reg.exe", "delete", agentRunKey, "/v", agentTaskName, "/f")
	return stopAgentAt(agentpipe.Name(currentUser())), nil
}
