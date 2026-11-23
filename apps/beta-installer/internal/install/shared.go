package install

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/applog"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/config"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/layout"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/pack"
	"github.com/matvey200720-maker/GTA-PROJECT/launcher_app/apps/beta-installer/internal/sysapi"
)

// SetupRecordName — файл в update\ с версией и sha256 копии установщика.
const SetupRecordName = "setup.json"

const (
	betaLicenseFile  = "license"
	betaBindFile     = "bind"
	betaManifestFile = "manifest.json"
	betaSigFile      = "manifest.sig"
	betaPakFile      = "astral-web.pak"

	secretPerm = 0o600
	plainPerm  = 0o644
	dirPerm    = 0o755

	uninstallPublisher = "Astral"
)

// BetaFiles — содержимое beta\ новой установки.
type BetaFiles struct {
	License     []byte
	Bind        []byte
	Manifest    []byte
	ManifestSig []byte
	PakFrom     string
	MovePak     bool
}

// inOrder выполняет действия по очереди и останавливается на первой ошибке.
func inOrder(actions []func() error) error {
	for _, act := range actions {
		if err := act(); err != nil {
			return err
		}
	}
	return nil
}

// writing — действие «записать файл атомарно».
func writing(path string, data []byte, perm os.FileMode) func() error {
	return func() error { return pack.WriteFileAtomic(path, data, perm) }
}

// StageBeta собирает папку beta.new целиком: прежняя стирается, файлы пишутся
// атомарно, pak переезжает или копируется.
func StageBeta(lay layout.Layout, f BetaFiles) error {
	inNew := lay.BetaNewFile
	pakTo := inNew(betaPakFile)

	carryPak := func() error { return pack.CopyFileAtomic(f.PakFrom, pakTo) }
	if f.MovePak {
		carryPak = func() error { return os.Rename(f.PakFrom, pakTo) }
	}

	// Файлы по порядку записи; bind пишется, только если он есть.
	records := []struct {
		name string
		data []byte
		perm os.FileMode
		skip bool
	}{
		{betaLicenseFile, f.License, secretPerm, false},
		{betaBindFile, f.Bind, secretPerm, f.Bind == nil},
		{betaManifestFile, f.Manifest, plainPerm, false},
		{betaSigFile, f.ManifestSig, plainPerm, false},
	}

	actions := make([]func() error, 0, len(records)+3)
	actions = append(actions,
		func() error { return pack.RemoveAllRetry(lay.BetaNew()) },
		func() error { return os.MkdirAll(lay.BetaNew(), dirPerm) },
	)
	for _, rec := range records {
		if !rec.skip {
			actions = append(actions, writing(inNew(rec.name), rec.data, rec.perm))
		}
	}
	return inOrder(append(actions, carryPak))
}

// placements — какие папки меняются местами и в каком порядке: новая, живая, прежняя.
var placements = []struct {
	label              string
	fresh, live, spare func(layout.Layout) string
}{
	{"app", layout.Layout.AppNew, layout.Layout.App, layout.Layout.AppOld},
	{"beta", layout.Layout.BetaNew, layout.Layout.Beta, layout.Layout.BetaOld},
}

// PlaceBranch ставит app.new и beta.new на место app и beta. Если очередная замена
// не прошла, прежние откатываются; прежние папки стираются только после всех.
func PlaceBranch(lay layout.Layout, log applog.Logger) error {
	swapped := make([]*pack.Swap, 0, len(placements))
	for _, p := range placements {
		swap, err := pack.SwapDirs(p.fresh(lay), p.live(lay), p.spare(lay))
		if err != nil {
			undoSwaps(swapped, log)
			return err
		}
		swapped = append(swapped, swap)
	}
	commitAll(swapped, log)
	return nil
}

// commitAll подтверждает каждую замену; неудачное подтверждение только пишется в журнал.
func commitAll(swapped []*pack.Swap, log applog.Logger) {
	for _, swap := range swapped {
		if err := swap.Commit(); err != nil {
			log.Printf("could not remove the previous version: %v", err)
		}
	}
}

// undoSwaps откатывает уже сделанные замены с последней к первой; неудачный откат только пишется в журнал.
func undoSwaps(swapped []*pack.Swap, log applog.Logger) {
	for i := len(swapped) - 1; i >= 0; i-- {
		if undo := swapped[i].Rollback(); undo != nil {
			log.Printf("rollback of %s failed: %v", placements[i].label, undo)
		}
	}
}

// samePath: два пути указывают на одно место (без учёта регистра, после очистки).
func samePath(a, b string) bool {
	return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
}

// logOnError пишет err в журнал по format, если он есть, и всегда отдаёт его обратно.
func logOnError(log applog.Logger, err error, format string) error {
	if err != nil {
		log.Printf(format, err)
	}
	return err
}

// CopyInstaller кладёт копию запущенного установщика в корень ветки.
func CopyInstaller(sys sysapi.System, lay layout.Layout, log applog.Logger) error {
	self, err := sys.SelfExe()
	if err = logOnError(log, err, "could not locate the installer: %v"); err != nil {
		return err
	}
	target := lay.SetupExe()
	if samePath(self, target) {
		return nil
	}
	if err = pack.CopyFileAtomic(self, target); err == nil {
		RecordInstaller(lay, log)
		return nil
	}
	return logOnError(log, err, "could not copy the installer: %v")
}

// setupRecord — запись о версии копии установщика.
type setupRecord struct {
	Version string `json:"version"`
	SHA256  string `json:"sha256"`
}

// writeSetupRecord пишет update\setup.json по текущей копии установщика.
func writeSetupRecord(lay layout.Layout) error {
	var (
		sum string
		doc []byte
	)
	return inOrder([]func() error{
		func() (err error) { sum, err = pack.SHA256File(lay.SetupExe()); return },
		func() error { return os.MkdirAll(lay.UpdateDir(), dirPerm) },
		func() (err error) { doc, err = json.Marshal(setupRecord{Version: config.Version, SHA256: sum}); return },
		func() error { return pack.WriteFileAtomic(recordPath(lay), withTrailingNewline(doc), plainPerm) },
	})
}

// recordPath — путь update\setup.json для этой ветки.
func recordPath(lay layout.Layout) string {
	return filepath.Join(lay.UpdateDir(), SetupRecordName)
}

// withTrailingNewline отдаёт doc с добавленным переводом строки на конце.
func withTrailingNewline(doc []byte) []byte {
	return append(doc, '\n')
}

// RecordInstaller пишет update\setup.json: версию пакета config и sha256 копии установщика.
func RecordInstaller(lay layout.Layout, log applog.Logger) {
	if err := writeSetupRecord(lay); err != nil {
		log.Printf("could not record the installer version: %v", err)
	}
}

// shortcutIn создаёт ярлык ветки в папке, которую отдаёт dirOf.
func shortcutIn(dirOf func() (string, error), sys sysapi.System, lay layout.Layout, ch layout.Channel) error {
	dir, err := dirOf()
	if err != nil {
		return err
	}
	spec := sysapi.ShortcutSpec{Path: filepath.Join(dir, ch.ShortcutFile())}
	spec.Target, spec.WorkDir = lay.Exe(), lay.App()
	spec.IconPath, spec.Description = lay.Exe(), ch.DisplayName()
	return sys.CreateShortcut(spec)
}

// MakeShortcuts создаёт ярлыки в меню «Пуск» и на рабочем столе; сбой одного не мешает второму.
func MakeShortcuts(sys sysapi.System, lay layout.Layout, ch layout.Channel, desktop, startMenu bool, log applog.Logger) (failed bool) {
	var wanted []func() (string, error)
	if startMenu {
		wanted = append(wanted, sys.StartMenuDir)
	}
	if desktop {
		wanted = append(wanted, sys.DesktopDir)
	}
	for _, dirOf := range wanted {
		if err := shortcutIn(dirOf, sys, lay, ch); err != nil {
			log.Printf("shortcut failed: %v", err)
			failed = true
		}
	}
	return failed
}

// uninstallArgs — входные данные записи ветки для «Приложений», собранные внутри uninstallRecord.
type uninstallArgs struct {
	lay       layout.Layout
	ch        layout.Channel
	version   string
	sizeBytes int64
}

// uninstallRecord — запись ветки для «Приложений».
func uninstallRecord(lay layout.Layout, ch layout.Channel, version string, sizeBytes int64) sysapi.UninstallInfo {
	args := uninstallArgs{lay: lay, ch: ch, version: version, sizeBytes: sizeBytes}
	setup := args.lay.SetupExe()
	return sysapi.UninstallInfo{
		DisplayName:          args.ch.DisplayName(),
		DisplayVersion:       args.version,
		Publisher:            uninstallPublisher,
		InstallLocation:      args.lay.Root,
		DisplayIcon:          args.lay.Exe(),
		UninstallString:      fmt.Sprintf(`"%s" --uninstall`, setup),
		QuietUninstallString: fmt.Sprintf(`"%s" --uninstall --quiet`, setup),
		EstimatedSizeKB:      uint32(args.sizeBytes / 1024),
		InstallDate:          time.Now().Format("20060102"),
	}
}

// RegisterBranch пишет запись ветки в «Приложения» (HKCU).
func RegisterBranch(sys sysapi.System, lay layout.Layout, ch layout.Channel, version string, sizeBytes int64, log applog.Logger) error {
	info := uninstallRecord(lay, ch, version, sizeBytes)
	if err := sys.RegisterUninstall(ch, info); err != nil {
		log.Printf("could not register the uninstaller: %v", err)
		return err
	}
	return nil
}
