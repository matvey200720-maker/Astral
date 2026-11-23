import fs from "node:fs/promises";
import { join, resolve } from "node:path";
import { sha256File } from "@modovik/install-engine";
import { serverTattooDigest } from "@modovik/install-engine/server-tattoo-manifest-trust.js";

const MODULE_WORD = "server-tattoos";
const DEFAULT_TITLE = "тату сервера";
const DIGEST_PREFIX = "sha256:";
const FOLDER_ID_LENGTH = 12;
const STORE_PARTS = ["server-tattoos", "packages"];

// Видимые человеку отказы: ключ говорит, что случилось, значение — хвост сообщения.
const REFUSAL_TAIL = {
  corrupt: "запись переигрывания испорчена — поставьте тату заново из мастерской.",
  gone: "пакет для переигрывания удалён — переустановите тату из мастерской.",
  changed: "пакет для переигрывания изменён — переустановите тату из мастерской.",
};

// Поля файла манифеста, которые попадают в запись (без action), по порядку.
const FILE_FIELDS = ["source", "target", "entry", "size", "sha256"];

function recordFile(file) {
  return Object.fromEntries(FILE_FIELDS.map((field) => [field, file[field]]));
}

// Столбцы записи в порядке ключей; каждый читает своё значение из манифеста.
const RECORD_COLUMNS = {
  module: () => MODULE_WORD,
  workId: (manifest) => manifest.id,
  version: (manifest) => manifest.version,
  sourceDigest: (manifest) => manifest.serverTattoo.digest,
  multi: () => true,
  order: (manifest) => ({ files: manifest.files.map(recordFile) }),
};

export function serverTattooReplayRecord(built) {
  const { manifest } = built;
  return Object.fromEntries(
    Object.entries(RECORD_COLUMNS).map(([column, read]) => [column, read(manifest)]),
  );
}

// Шестнадцатеричное тело отпечатка вида «sha256:<64 знака>» или null, если строка не годится.
function digestBody(text) {
  if (!text.startsWith(DIGEST_PREFIX)) return null;
  const body = text.slice(DIGEST_PREFIX.length);
  return /^[0-9a-f]{64}$/.test(body) ? body : null;
}

// Осмотр единственного файла записи: либо вердикт отказа, либо хэш содержимого.
async function inspectFile(packageRoot, item) {
  const relative = item?.source;
  if (!relative) return { verdict: "gone" };

  const location = join(packageRoot, String(relative));
  let info;
  try {
    info = await fs.stat(location);
  } catch {
    return { verdict: "gone" };
  }
  if (!info.isFile()) return { verdict: "gone" };

  const hash = await sha256File(location);
  const intact = hash === String(item.sha256 || "") && info.size === item.size;
  return intact ? { verdict: null, hash } : { verdict: "changed" };
}

export async function serverTattooReplayPackage(stateDir, replay) {
  const title = String(replay?.workId || DEFAULT_TITLE);
  const refuse = (kind) => new Error(`Работа «${title}»: ${REFUSAL_TAIL[kind]}`);

  const claimed = String(replay?.sourceDigest || "");
  const rows = Array.isArray(replay?.order?.files) ? replay.order.files : [];
  const body = digestBody(claimed);
  if (body === null || rows.length !== 1) throw refuse("corrupt");

  const packageRoot = join(
    resolve(String(stateDir || "")),
    ...STORE_PARTS,
    body.slice(0, FOLDER_ID_LENGTH),
  );
  const item = rows[0];
  const seen = await inspectFile(packageRoot, item);
  if (seen.verdict) throw refuse(seen.verdict);

  // В ответ запись идёт как есть, а в отпечаток — строкой (ложное значение — пустая).
  const { entry } = item;
  const sealed = serverTattooDigest({ entry: String(entry || ""), sha256: seen.hash });
  if (DIGEST_PREFIX + sealed !== claimed) throw refuse("changed");

  return { packageRoot, files: [{ entry, sha256: seen.hash }] };
}
