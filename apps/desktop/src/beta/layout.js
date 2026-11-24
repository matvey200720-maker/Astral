// Раскладка установки закрытой сборки: где лежат лицензия, секрет привязки, интерфейс и установщик.
// Модуль только называет пути по расположению исполняемого файла; на диск не ходит и ничего не меняет.
import { win32 } from "node:path";

export const SETUP_EXE_NAME = "AstralBetaSetup.exe";

const isDriveOrShareRoot = (folder) => win32.dirname(folder) === folder;

function layoutOf(exe, appDir, root) {
  const beta = win32.join(root, "beta");
  return {
    exe,
    appDir,
    root,
    beta,
    licenseFile: win32.join(beta, "license"),
    bindFile: win32.join(beta, "bind"),
    pakFile: win32.join(beta, "astral-web.pak"),
    manifestFile: win32.join(beta, "manifest.json"),
    setupExe: win32.join(root, SETUP_EXE_NAME),
  };
}

// Раскладка по пути `<корень>\app\Astral*.exe`; любое другое расположение — null (лаунчер остановится).
export function resolveLayout(exePath) {
  if (typeof exePath !== "string") return null;
  const exe = win32.normalize(exePath);
  if (!win32.isAbsolute(exe)) return null;
  if (!/^astral.*\.exe$/i.test(win32.basename(exe))) return null;
  const appDir = win32.dirname(exe);
  if (win32.basename(appDir).toLowerCase() !== "app") return null;
  const root = win32.dirname(appDir);
  if (isDriveOrShareRoot(root)) return null;
  return layoutOf(exe, appDir, root);
}
