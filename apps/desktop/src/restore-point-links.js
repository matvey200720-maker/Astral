import { randomUUID } from "node:crypto";
import { link as fsLink, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fingerprintSha256 } from "@modovik/install-engine/file-fingerprint.js";

const TEMP_PREFIX = ".astral-link-";
const HEX_DIGITS = "0123456789abcdef";
const NO_LINK_CODES = new Set("EXDEV EPERM ENOTSUP EOPNOTSUPP EINVAL EACCES ENOSYS EMLINK".split(" "));

const lowerText = (value) => String(value || "").toLowerCase();
const looksLikeDigest = (text) => text.length === 64 && [...text].every((symbol) => HEX_DIGITS.includes(symbol));

// Оба файла уже одно и то же на одном томе; обе статистики стартуют вместе.
const shareInode = async (first, second) => {
  try {
    const [one, two] = await Promise.all([stat(first, { bigint: true }), stat(second, { bigint: true })]);
    return one.dev === two.dev && one.ino === two.ino && one.ino !== 0n;
  } catch {
    return false;
  }
};

// null — точка молча не подходит; { reason } — отказ по размеру; { size } — копия годится к замене.
const examine = async (point, wantedDigest, target) => {
  /* Копия рядом с живым файлом (`aside`) — в папке игры, а не в кэше: ссылку на неё не подменяют. */
  if (!point?.backup || point.aside || point.otherArchives?.length) return null;
  if (lowerText(point.before) !== wantedDigest) return null;
  if (await shareInode(point.backupPath, target.path)) return null;
  let copy;
  try {
    copy = await stat(point.backupPath);
  } catch {
    return null;
  }
  return copy.size === target.size ? { size: copy.size } : { reason: "size" };
};

// Положить ссылку на место копии: null при успехе, иначе причина отказа.
const placeLink = async (makeLink, sourcePath, copyPath) => {
  const temp = path.join(path.dirname(copyPath), TEMP_PREFIX + randomUUID());
  try {
    await makeLink(sourcePath, temp);
  } catch (failure) {
    return NO_LINK_CODES.has(failure?.code) ? "no-links" : "error";
  }
  try {
    await rename(temp, copyPath);
  } catch {
    await rm(temp, { force: true }).catch(() => {});
    return "rename";
  }
  return null;
};

// Сверка содержимого сборки с отпечатком: читается лениво, один раз.
const lazyGenuine = (verify, compositePath, wantedDigest) => {
  let verdict;
  return async () => {
    if (verdict === undefined) {
      verdict = (await verify(compositePath).catch(() => "")) === wantedDigest;
    }
    return verdict;
  };
};

export const linkRestorePointsToComposite = async ({ points, composite, dryRun = false, tools = {} }) => {
  const makeLink = tools.link || fsLink;
  const verify = tools.sha256File || fingerprintSha256;
  const linked = [];
  const skipped = [];
  let bytes = 0;

  const wantedDigest = lowerText(composite?.sha256);
  if (!composite?.path || !looksLikeDigest(wantedDigest)) return { linked, skipped, bytes };
  let target;
  try {
    target = { path: composite.path, size: (await stat(composite.path)).size };
  } catch {
    return { linked, skipped, bytes };
  }

  const genuine = lazyGenuine(verify, composite.path, wantedDigest);
  for (const point of points || []) {
    const seen = await examine(point, wantedDigest, target);
    if (!seen) continue;

    let refusal = seen.reason || null;
    if (!refusal && !(await genuine())) refusal = "composite-mismatch";
    if (!refusal && !dryRun) refusal = await placeLink(makeLink, composite.path, point.backupPath);

    if (refusal) {
      skipped.push({ id: point.id, reason: refusal });
    } else {
      linked.push(point.id);
      bytes += seen.size;
    }
    // Битая сборка общая для всех точек: дальше не идём.
    if (refusal === "composite-mismatch") break;
  }
  return { linked, skipped, bytes };
};
