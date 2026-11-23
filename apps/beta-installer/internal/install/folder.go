package install

import (
	"context"
	"encoding/json"
	"iter"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/bridge"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/layout"
)

const (
	codeFolderNotAllowed  = "FOLDER_NOT_ALLOWED"
	codeFolderNotWritable = "FOLDER_NOT_WRITABLE"

	probePattern = ".astral-write-*"
)

// Переменные окружения с защищёнными папками, по порядку.
var protectedEnv = []string{"ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "SystemRoot", "windir"}

// envDirs отдаёт очищенные непустые значения переменных окружения по порядку имён.
func envDirs(names []string) iter.Seq[string] {
	return func(yield func(string) bool) {
		for _, name := range names {
			if v := strings.TrimSpace(os.Getenv(name)); v != "" && !yield(filepath.Clean(v)) {
				return
			}
		}
	}
}

// protectedDirs — защищённые папки по переменным окружения; пусто — nil.
func protectedDirs() []string { return slices.Collect(envDirs(protectedEnv)) }

// isInside: путь равен папке или лежит внутри неё (без учёта регистра).
func isInside(path, dir string) bool {
	rest, ok := strings.CutPrefix(strings.ToLower(path), strings.ToLower(dir))
	return ok && (rest == "" || strings.HasPrefix(rest, string(filepath.Separator)))
}

// stripBranchName берёт родителя, если последний элемент — имя папки какой-либо ветки.
func stripBranchName(path string) string {
	last := filepath.Base(path)
	if slices.ContainsFunc(layout.All, func(ch layout.Channel) bool { return strings.EqualFold(last, ch.DirName()) }) {
		return filepath.Dir(path)
	}
	return path
}

// probeWritable создаёт и сразу стирает пробный файл в ближайшей существующей папке над путём.
func probeWritable(under string) error {
	probe, err := os.CreateTemp(nearestExisting(under), probePattern)
	if err != nil {
		return err
	}
	defer os.Remove(probe.Name())
	probe.Close()
	return nil
}

// folderChoice — выбор человека, проходящий проверки по очереди.
type folderChoice struct {
	picked    string
	clean     string
	parent    string
	protected []string
}

func (c *folderChoice) mustBeAbsolute() *bridge.Error {
	if filepath.IsAbs(c.clean) {
		return nil
	}
	return bridge.Errf(codeFolderNotAllowed, false, "not an absolute path: %s", c.picked)
}

func (c *folderChoice) dropBranchName() *bridge.Error {
	c.parent = stripBranchName(c.clean)
	return nil
}

func (c *folderChoice) mustNotBeProtected() *bridge.Error {
	guarded := slices.ContainsFunc(c.protected, func(dir string) bool { return isInside(c.parent, filepath.Clean(dir)) })
	if !guarded {
		return nil
	}
	return bridge.Errf(codeFolderNotAllowed, false, "needs administrator rights: %s", c.parent)
}

func (c *folderChoice) mustBeWritable() *bridge.Error {
	if err := probeWritable(c.parent); err != nil {
		return bridge.Errf(codeFolderNotWritable, false, "%s", err.Error())
	}
	return nil
}

// installParent проверяет выбранную папку и возвращает «папку веток»: абсолютность,
// срез имени ветки, защищённые папки, возможность записи.
func installParent(picked string, protected []string) (string, *bridge.Error) {
	c := &folderChoice{picked: picked, clean: filepath.Clean(strings.TrimSpace(picked)), protected: protected}
	if berr := firstRefusal(c.mustBeAbsolute, c.dropBranchName, c.mustNotBeProtected, c.mustBeWritable); berr != nil {
		return "", berr
	}
	return c.parent, nil
}

// firstRefusal гонит проверки по очереди и останавливается на первой, что отказала.
func firstRefusal(checks ...func() *bridge.Error) *bridge.Error {
	for i := 0; i < len(checks); i++ {
		if berr := checks[i](); berr != nil {
			return berr
		}
	}
	return nil
}

func (r *Runner) refuseFixedFolder() *bridge.Error {
	if r.cfg.Root == "" && r.cfg.ProgramsDir == "" {
		return nil
	}
	return bridge.Errf("UNSUPPORTED", false, "the install folder is set by the caller")
}

func (r *Runner) refuseWhileInstalling() *bridge.Error {
	if r.Busy() {
		return errAlreadyRunning()
	}
	return nil
}

// chooseDirParams — параметры вызова chooseInstallDir.
type chooseDirParams struct {
	Channel string `json:"channel"`
	Title   string `json:"title"`
}

// hChooseDir — вызов chooseInstallDir: окно выбора папки установки.
func (r *Runner) hChooseDir(_ context.Context, raw json.RawMessage) (any, error) {
	var in chooseDirParams
	if err := readParams(raw, &in); err != nil {
		return nil, err
	}
	if berr := firstRefusal(r.refuseFixedFolder, r.refuseWhileInstalling); berr != nil {
		return nil, berr
	}

	cf := r.confirmedNow()
	ch := r.dialogChannel(in.Channel, cf)
	picked, err := r.sys.PickFolder(in.Title, nearestExisting(r.rootFor(ch)))
	switch {
	case err != nil:
		return nil, bridge.Errf("INTERNAL", false, "folder dialog: %v", err)
	case picked == "":
		return map[string]any{"canceled": true}, nil
	}
	// Пока человек выбирал, могла начаться установка: менять папку посреди неё нельзя.
	if berr := r.refuseWhileInstalling(); berr != nil {
		return nil, berr
	}
	return r.acceptFolder(picked, ch, cf)
}

// acceptFolder проверяет выбор, запоминает его и отвечает странице.
func (r *Runner) acceptFolder(picked string, ch layout.Channel, cf *confirmation) (any, error) {
	parent, berr := installParent(picked, protectedDirs())
	if berr == nil {
		r.choose(parent)
		return r.folderAnswer(picked, ch, cf), nil
	}
	r.log.Printf("install folder rejected: %s (%s)", picked, berr.Code)
	return nil, berr
}

// folderAnswer — ответ странице о принятой папке; список веток — только если есть подтверждённая активация.
func (r *Runner) folderAnswer(picked string, ch layout.Channel, cf *confirmation) map[string]any {
	root := r.rootFor(ch)
	r.log.Printf("install folder chosen: %s → %s", picked, root)
	answer := make(map[string]any, 4)
	answer["canceled"] = false
	answer["installDir"] = root
	answer["freeBytes"] = r.freeOver(root)
	if cf == nil {
		return answer
	}
	answer["channels"] = r.channelItems(cf.rel, cf.channels)
	return answer
}

// dialogChannel — ветка, от папки которой открывается окно: из вызова, иначе ветка релиза
// подтверждённой активации, иначе подсказка, иначе beta.
func (r *Runner) dialogChannel(asked string, cf *confirmation) layout.Channel {
	options := []func() (layout.Channel, bool){
		func() (layout.Channel, bool) { return layout.Parse(asked) },
		func() (layout.Channel, bool) {
			if cf == nil {
				return "", false
			}
			return layout.Parse(cf.rel.Channel)
		},
		func() (layout.Channel, bool) { return r.cfg.Hint, r.cfg.Hint != "" },
	}
	for _, option := range options {
		if ch, ok := option(); ok {
			return ch
		}
	}
	return layout.Beta
}
