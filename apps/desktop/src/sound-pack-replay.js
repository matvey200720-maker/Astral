import fs from "node:fs/promises";
import { join, resolve } from "node:path";
import { sha256File } from "@modovik/install-engine";
import { soundPackSourceDigest } from "@modovik/install-engine/sound-pack-manifest-trust.js";

const MODULE_WORD = "sound-packs";
const DEFAULT_TITLE = "звуки";
const DIGEST_PREFIX = "sha256:";
const FOLDER_ID_LENGTH = 12;
const STORE_PARTS = ["sound-packs", "packages"];
const PAYLOAD_PREFIX = "payload/";
const HEX_DIGITS = "0123456789abcdef";

// Видимые человеку отказы: вид беды → текст с названием работы.
const REFUSALS = {
  corrupt: (title) => `Работа «${title}»: запись переигрывания испорчена — поставьте набор заново.`,
  gone: (title) => `Работа «${title}»: пакет для переигрывания удалён — переустановите набор.`,
  changed: (title) => `Работа «${title}»: пакет для переигрывания изменён — переустановите набор.`,
};

const recordBank = ({ source, target, entry, size, sha256 }) => ({ source, target, entry, size, sha256 });

export function soundPackReplayRecord({ manifest }) {
  const { id, version, soundPack, files } = manifest;
  return {
    module: MODULE_WORD,
    workId: id,
    version,
    sourceDigest: soundPack.sourceDigest,
    multi: true,
    order: { files: files.map(recordBank) },
  };
}

// Годится только «sha256:» строчными и ровно 64 строчных шестнадцатеричных знака.
function isDigest(text) {
  if (!text.startsWith(DIGEST_PREFIX) || text.length !== DIGEST_PREFIX.length + 64) return false;
  return [...text.slice(DIGEST_PREFIX.length)].every((char) => HEX_DIGITS.includes(char));
}

// Разбор записи переигрывания: название работы, отпечаток и список банков.
class Claim {
  constructor(replay) {
    const named = replay?.workId;
    this.title = named ? String(named) : DEFAULT_TITLE;
    const sealed = replay?.sourceDigest;
    this.digest = sealed ? String(sealed) : "";
    const listed = replay?.order?.files;
    this.banks = Array.isArray(listed) ? listed : [];
  }

  isWellFormed() {
    return isDigest(this.digest) && this.banks.length > 0;
  }

  refusal(kind) {
    return new Error(REFUSALS[kind](this.title));
  }
}

// Корень пакета зависит только от папки состояния и отпечатка; пустая папка — текущая папка процесса.
function packageRootOf(stateDir, digest) {
  const base = stateDir ? String(stateDir) : "";
  const folder = digest.slice(DIGEST_PREFIX.length, DIGEST_PREFIX.length + FOLDER_ID_LENGTH);
  return resolve(base, ...STORE_PARTS, folder);
}

// Сведения о файле, если это обычный файл; любой сбой stat — «файла нет».
async function regularFileInfo(location) {
  try {
    const info = await fs.stat(location);
    return info.isFile() ? info : null;
  } catch {
    return null;
  }
}

function matchesRecord(item, info, sha256) {
  const wanted = item.sha256 ? String(item.sha256) : "";
  return wanted === sha256 && item.size === info.size;
}

// Осмотр одного банка: вердикт вместо броска. Порядок важен: файл, затем хэш и размер, и лишь потом путь.
async function inspectBank(packageRoot, item) {
  const source = item?.source;
  if (!source) return { kind: "gone" };

  const sourcePath = String(source);
  const location = join(packageRoot, sourcePath);
  const info = await regularFileInfo(location);
  if (!info) return { kind: "gone" };

  const sha256 = await sha256File(location);
  if (!matchesRecord(item, info, sha256)) return { kind: "changed" };
  if (!sourcePath.startsWith(PAYLOAD_PREFIX)) return { kind: "corrupt" };
  return { kind: "ok", entry: sourcePath.slice(PAYLOAD_PREFIX.length), sha256 };
}

// Банки осматриваются по порядку; первая беда обрывает обход.
async function surveyBanks(packageRoot, banks) {
  const rows = [];
  for (const item of banks) {
    const verdict = await inspectBank(packageRoot, item);
    if (verdict.kind !== "ok") return { failure: verdict.kind, rows };
    rows.push({ entry: verdict.entry, sha256: verdict.sha256 });
  }
  return { failure: null, rows };
}

// Весь осмотр записи: вердикт (null — всё цело), корень пакета и итоговый список.
async function examine(stateDir, claim) {
  if (!claim.isWellFormed()) return { verdict: "corrupt" };

  const packageRoot = packageRootOf(stateDir, claim.digest);
  const { failure, rows } = await surveyBanks(packageRoot, claim.banks);
  if (failure) return { verdict: failure };

  const recomputed = DIGEST_PREFIX + soundPackSourceDigest(rows);
  return { verdict: recomputed === claim.digest ? null : "changed", packageRoot, rows };
}

export async function soundPackReplayPackage(stateDir, replay) {
  const claim = new Claim(replay);
  const outcome = await examine(stateDir, claim);
  if (outcome.verdict) throw claim.refusal(outcome.verdict);
  return { packageRoot: outcome.packageRoot, files: outcome.rows };
}
