// Переигрывание «заменёнки» одежды: запись для состояния установки и проверка пакета на диске.
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sha256File } from "@modovik/install-engine";
import { clothingReplaceSourceDigest } from "@modovik/install-engine/clothing-replace-manifest-trust.js";

const MODULE_WORD = "clothing-replace";
const DEFAULT_TITLE = "замена одежды";
const PACKAGES_DIR = ["clothing-replacements", "packages"];
const DIGEST_PREFIX = "sha256:";
const DIGEST_HEX_LENGTH = 64;
const FOLDER_NAME_LENGTH = 12;
const HEX_DIGITS = new Set("0123456789abcdef");

// Поля файла манифеста, которые переходят в запись (без action).
const RECORD_FILE_FIELDS = ["source", "target", "entry", "size", "sha256"];

const REFUSALS = {
  broken: (title) => `Работа «${title}»: запись переигрывания испорчена — поставьте замену заново из каталога.`,
  gone: (title) => `Работа «${title}»: пакет для переигрывания удалён — переустановите замену из каталога.`,
  changed: (title) => `Работа «${title}»: пакет для переигрывания изменён — переустановите замену из каталога.`,
};

const copyRecordFile = (row) => Object.fromEntries(RECORD_FILE_FIELDS.map((key) => [key, row[key]]));

export function clothingReplaceReplayRecord(built) {
  const { manifest } = built;
  return {
    module: MODULE_WORD,
    workId: manifest.id,
    version: manifest.version,
    sourceDigest: manifest.clothingReplace.sourceDigest,
    multi: true,
    order: { files: manifest.files.map(copyRecordFile) },
  };
}

function isDigestText(text) {
  if (text.length !== DIGEST_PREFIX.length + DIGEST_HEX_LENGTH || !text.startsWith(DIGEST_PREFIX)) return false;
  return [...text.slice(DIGEST_PREFIX.length)].every((char) => HEX_DIGITS.has(char));
}

async function sizeOfRegularFile(path) {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

// Идёт по файлам записи строго по порядку и отдаёт то, что пойдёт в отпечаток; первая беда обрывает обход.
async function* inspectPackageFiles(root, items, refuse) {
  for (const item of items) {
    const path = item?.source ? join(root, String(item.source)) : null;
    const size = path === null ? null : await sizeOfRegularFile(path);
    if (size === null) throw refuse("gone");
    const actualHash = await sha256File(path);
    const recordedHash = String(item.sha256 || "");
    if (actualHash !== recordedHash || size !== item.size) throw refuse("changed");
    yield { entry: String(item.entry || ""), sha256: actualHash };
  }
}

export async function clothingReplaceReplayPackage(stateDir, replay) {
  const title = String(replay?.workId || DEFAULT_TITLE);
  const refuse = (reason) => new Error(REFUSALS[reason](title));
  const digest = String(replay?.sourceDigest || "");
  const listed = replay?.order?.files;
  const items = Array.isArray(listed) ? listed : [];
  if (!isDigestText(digest) || items.length === 0) throw refuse("broken");

  const folderName = digest.slice(DIGEST_PREFIX.length, DIGEST_PREFIX.length + FOLDER_NAME_LENGTH);
  const packageRoot = join(resolve(String(stateDir || "")), ...PACKAGES_DIR, folderName);

  const files = [];
  for await (const file of inspectPackageFiles(packageRoot, items, refuse)) files.push(file);
  if (DIGEST_PREFIX + clothingReplaceSourceDigest(files) !== digest) throw refuse("changed");
  return { packageRoot, files };
}
