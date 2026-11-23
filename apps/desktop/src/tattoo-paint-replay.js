import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sha256File } from "@modovik/install-engine";
import { tattooPaintDigest } from "@modovik/install-engine/tattoo-paint-manifest-trust.js";

const MODULE_WORD = "tattoo-paint";
const DEFAULT_WORK_NAME = "покраска тату";
const PACKAGES_DIR = "tattoo-paint/packages";
const DIGEST_PREFIX = "sha256:";
const DIGEST_HEX_LENGTH = 64;
const FOLDER_ID_LENGTH = 12;

// Поля файла манифеста, которые переходят в запись, в порядке записи.
const RECORDED_FIELDS = ["source", "target", "action", "entry", "size", "sha256"];

const REFUSAL_TEXT = {
  corrupt: (work) => `Работа «${work}»: запись переигрывания испорчена — поставьте покраску заново из мастерской.`,
  gone: (work) => `Работа «${work}»: пакет для переигрывания удалён — переустановите покраску из мастерской.`,
  changed: (work) => `Работа «${work}»: пакет для переигрывания изменён — переустановите покраску из мастерской.`,
};

function refusal(kind, work) {
  return new Error(REFUSAL_TEXT[kind](work));
}

function recordedFile(manifestFile) {
  const copy = {};
  for (const field of RECORDED_FIELDS) copy[field] = manifestFile[field];
  if (manifestFile.merge) copy.merge = manifestFile.merge;
  return copy;
}

export function tattooPaintReplayRecord(built) {
  const { manifest } = built;
  return {
    module: MODULE_WORD,
    workId: manifest.id,
    version: manifest.version,
    sourceDigest: manifest.tattooPaint.digest,
    multi: true,
    order: { files: manifest.files.map(recordedFile) },
  };
}

function isLowerHex(text) {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const isDigit = code >= 48 && code <= 57;
    const isLetter = code >= 97 && code <= 102;
    if (!isDigit && !isLetter) return false;
  }
  return true;
}

function wellFormedDigest(text) {
  const body = text.slice(DIGEST_PREFIX.length);
  return text.startsWith(DIGEST_PREFIX) && body.length === DIGEST_HEX_LENGTH && isLowerHex(body);
}

// Сведения о файле, если это обычный файл; любой сбой stat читается как «файла нет».
function regularFileInfo(path) {
  return stat(path).then(
    (info) => (info.isFile() ? info : null),
    () => null,
  );
}

// Идёт по записи строго по порядку и отдаёт проверенные файлы; первая беда обрывает обход.
async function* verifiedFiles(packageRoot, items, work) {
  for (const item of items) {
    const source = item?.source;
    const path = source ? join(packageRoot, String(source)) : null;
    const info = path === null ? null : await regularFileInfo(path);
    if (info === null) throw refusal("gone", work);

    const hash = await sha256File(path);
    if (hash !== String(item.sha256 || "") || info.size !== item.size) throw refusal("changed", work);

    yield item.merge ? { entry: item.entry, sha256: hash, merge: item.merge } : { entry: item.entry, sha256: hash };
  }
}

export async function tattooPaintReplayPackage(stateDir, replay) {
  const work = String(replay?.workId || DEFAULT_WORK_NAME);
  const digest = String(replay?.sourceDigest || "");
  const listed = replay?.order?.files;
  const items = Array.isArray(listed) ? listed : [];
  if (!wellFormedDigest(digest) || items.length === 0) throw refusal("corrupt", work);

  const folderId = digest.slice(DIGEST_PREFIX.length, DIGEST_PREFIX.length + FOLDER_ID_LENGTH);
  const packageRoot = join(resolve(String(stateDir || "")), PACKAGES_DIR, folderId);

  const files = [];
  for await (const file of verifiedFiles(packageRoot, items, work)) files.push(file);

  if (DIGEST_PREFIX + tattooPaintDigest(files) !== digest) throw refusal("changed", work);
  return { packageRoot, files };
}
