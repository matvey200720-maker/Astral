import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Корень приложения: от папки модуля (apps/desktop/src) три уровня вверх.
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RUNTIME_DIR = path.join(APP_ROOT, "runtime");

const LOCAL_KEY_FILE = "catalog-public.pem";
const CLOUD_KEY_FILE = "catalog-cloud-public.pem";

// Места, где лежит файл, по порядку: runtime репозитория, потом ресурсы сборки.
// Без process.resourcesPath вторым местом остаётся просто имя файла.
function placesOf(fileName, resourcesPath) {
  return [path.join(RUNTIME_DIR, fileName), path.join(resourcesPath || "", fileName)];
}

// Первое место, где файл прочитался (пустой тоже считается): null, если нигде.
function firstReadable(places) {
  return places.reduce(
    (found, place) => found.then((text) => text ?? fs.readFile(place, "utf8").catch(() => null)),
    Promise.resolve(null),
  );
}

export async function catalogPublicKey() {
  const resourcesPath = process.resourcesPath;
  const local = await firstReadable(placesOf(LOCAL_KEY_FILE, resourcesPath));
  if (!local) {
    throw new Error("Открытый ключ каталога не найден.");
  }
  const cloud = await firstReadable(placesOf(CLOUD_KEY_FILE, resourcesPath));
  // Облачный ключ необязателен; без него локальный отдаётся как есть.
  return cloud ? `${local.trim()}\n${cloud.trim()}\n` : local;
}
