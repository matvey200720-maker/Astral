import { compareVersions } from "./semver.js";
import { ManifestError, verifyManifest } from "./manifest.js";
import fs from "node:fs/promises";

const PARTS = ["base", "web"];

// Манифест (байты) и подпись (текст) читаются строго по очереди: элементы массива вычисляются слева направо.
async function readReleaseFiles(paths) {
  return [await fs.readFile(paths.manifest), await fs.readFile(paths.signature, "utf8")];
}

// Нет файла — установленного нет и молчим; любая другая причина попадает в журнал.
function noteUnreadable(error, log) {
  if (error.code === "ENOENT") {
    return;
  }
  log(`установленный манифест не прочитан: ${error.message}`);
}

// Проверка подписи и разбора: отказ проверки возвращается как отказ, остальные ошибки летят дальше.
function judge(bytes, signature, keyring) {
  let manifest;
  try {
    manifest = verifyManifest({ bytes, signature, keyring });
  } catch (error) {
    if (error instanceof ManifestError) {
      return { refusal: error };
    }
    throw error;
  }
  return { release: { manifest, bytes } };
}

export async function readInstalledRelease({ paths, keyring, log = () => {} }) {
  let read = null;
  try {
    read = await readReleaseFiles(paths);
  } catch (error) {
    noteUnreadable(error, log);
  }
  if (read === null) {
    return null;
  }

  const verdict = judge(read[0], read[1], keyring);
  if (verdict.refusal) {
    const { code, message } = verdict.refusal;
    log(`установленный манифест не принят (${code}): ${message}`);
    return null;
  }
  return verdict.release;
}

const hashOf = (release, part) => release.artifacts[part].sha256;

export function planDownload(installed, manifest) {
  const [needBase, needWeb] = PARTS.map(
    (part) => !installed || hashOf(installed.manifest, part) !== hashOf(manifest, part),
  );
  return { needBase, needWeb, metadataOnly: !(needBase || needWeb) };
}

const orElse = (compute, fallback) => {
  try {
    return compute();
  } catch {
    return fallback;
  }
};

export function isNewerThanInstalled(installed, manifest) {
  if (!installed) {
    return true;
  }
  const [heldChannel, offeredChannel] = [installed.manifest.channel, manifest.channel];
  if (heldChannel === offeredChannel) {
    const [offered, held] = [manifest.sequence, installed.manifest.sequence];
    return offered > held;
  }
  // Другой канал: у каждого свой счётчик sequence, решает версия; нечитаемая версия — решает сервер.
  return orElse(() => compareVersions(manifest.version, installed.manifest.version) >= 0, true);
}
