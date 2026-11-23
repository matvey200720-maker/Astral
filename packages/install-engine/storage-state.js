import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { cleanId } from "./state-record.js";
import { ensureStoredFile } from "./chunk-store.js";

export const DEFAULT_DIR = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), ".astral"),
  ...(process.env.LOCALAPPDATA ? ["Astral", "cache", "backups"] : ["backups"]),
);

export const initialState = () => ({
  schemaVersion: 6,
  mode: "transactional",
  targets: {},
  restorePoints: {},
  installed: [],
  updatedAt: null,
  lastTransaction: null,
});

/*
 * Есть ли файл. Копия архива игры может лежать кусками (`chunk-store.js`): путь в
 * состоянии тот же, файла нет, рядом опись. Для движка это всё ещё «есть»: файл
 * собирается здесь, и вопрос «есть ли основа» не превращается в «основа пропала»
 * (`base-recovery.js`). У файла без описи — одна лишняя проверка.
 */
export const exists = async (file) => {
  try {
    await fs.access(file);
    return true;
  } catch {
    return ensureStoredFile(file);
  }
};

export const statePaths = (stateDir = DEFAULT_DIR) => ({
  root: path.resolve(stateDir),
  state: path.join(path.resolve(stateDir), "install-state.json"),
  transactions: path.join(path.resolve(stateDir), "transactions"),
  payloads: path.join(path.resolve(stateDir), "payloads"),
  downloads: path.join(path.resolve(stateDir), "downloads"),
  bases: path.join(path.resolve(stateDir), "bases"),
});

export const missingBaseline = () => ({
  exists: false,
  path: null,
  sha256: null,
  verified: true,
});

const HASH = /^[0-9a-f]{64}$/;
const MAX_ABSORBED_DEPTH = 16;

/*
 * Что основа вобрала из живого архива под слоями движка (`direct-update-rebase.js`):
 * `{ запись: [{ source, step, prior }] }`, от старых к новым. `source` — живой архив,
 * с которого основа вобрала правку, `step` — номер операции движка (`engine-steps.js`),
 * `prior` — прежний вид записи (`{ path, sha256 }` или `{ absent: true }`). Чего не
 * разобрать — нет.
 */
export function copyAbsorbed(value) {
  if (!value || typeof value !== "object") return null;
  const out = {};
  for (const [entry, stack] of Object.entries(value)) {
    if (!entry || !Array.isArray(stack)) continue;
    const kept = stack
      .filter(
        (item) =>
          HASH.test(String(item?.source || "")) &&
          (item?.prior?.absent === true ||
            (typeof item?.prior?.path === "string" && HASH.test(String(item?.prior?.sha256 || "")))),
      )
      .slice(-MAX_ABSORBED_DEPTH)
      .map((item) => ({
        source: item.source,
        ...(typeof item.step === "string" && /^[0-9a-f-]{8,64}$/i.test(item.step) ? { step: item.step } : {}),
        /* Вобрано нашей же нативной правкой (работа мастерской), а не новой версией игры: `prior` — штатный вид записи (`stock-guard.js`). */
        ...(item.own === true ? { own: true } : {}),
        prior: item.prior.absent === true ? { absent: true } : { path: item.prior.path, sha256: item.prior.sha256 },
      }));
    if (kept.length) out[entry] = kept;
  }
  return Object.keys(out).length ? out : null;
}

/*
 * Записи, где работа мастерской лежит поверх слоя движка (`direct-base-cleanup.js`):
 * `{ запись: { modId, sha256 } }` — слой, которому достался архив. Пока верхний слой
 * записи тот же, сборка записи не трогает.
 */
export function copyWorkOver(value) {
  if (!value || typeof value !== "object") return null;
  const out = {};
  for (const [entry, over] of Object.entries(value)) {
    if (!entry || typeof over?.modId !== "string" || !over.modId) continue;
    if (!HASH.test(String(over.sha256 || ""))) continue;
    out[entry] = { modId: over.modId, sha256: over.sha256 };
  }
  return Object.keys(out).length ? out : null;
}

export const copyBaseline = (baseline, fallback = missingBaseline()) => {
  const source = baseline || fallback;
  const absorbed = copyAbsorbed(source?.absorbed);
  const workOver = copyWorkOver(source?.workOver);
  return {
    exists: Boolean(source?.exists),
    path: source?.path || null,
    sha256: source?.sha256 || null,
    verified: typeof source?.verified === "boolean" ? source.verified : true,
    /* Записи движка, которые эта основа уже несёт (перебазирование на живой
       архив, `direct-update-rebase.js`). */
    ...(Array.isArray(source?.carried) && source.carried.length
      ? { carried: source.carried.map(String) }
      : {}),
    /* Записи основы, которые слои вправе перекрыть (пустые постоянные
       типы основы пакета мест): установка ложится поверх, снятие
       возвращает запись основы. */
    ...(Array.isArray(source?.overlays) && source.overlays.length
      ? { overlays: source.overlays.map(String) }
      : {}),
    /* Основа очищена от записей Astral (`direct-base-cleanup.js`) и снята с
       живого архива с этим хешем. */
    ...(source?.withoutAstral === true ? { withoutAstral: true } : {}),
    /* Версия проверки сдвиговых записей (`healShiftEntries`): основа, прошедшая её, больше не проверяется. */
    ...(Number.isInteger(source?.shiftAudit) ? { shiftAudit: source.shiftAudit } : {}),
    ...(/^[0-9a-f]{64}$/.test(String(source?.liveSha256 || ""))
      ? { liveSha256: source.liveSha256 }
      : {}),
    ...(absorbed ? { absorbed } : {}),
    ...(workOver ? { workOver } : {}),
  };
};

export const activeBaseline = (target, resource) => {
  const baseline = copyBaseline(
    target?.baselineMode === "clean" ? resource?.clean : resource?.original,
    resource?.original || resource?.base || missingBaseline(),
  );
  return !baseline.exists && resource?.persistentManaged
    ? copyBaseline(resource.compositionBase)
    : baseline;
};

export const activeBaselinePath = (target, resource) => {
  const baseline = activeBaseline(target, resource);
  if (baseline.exists) return baseline.path;
  return resource?.persistentManaged && resource?.compositionBase?.exists
    ? resource.compositionBase.path
    : null;
};

export function targetKeyFor(targetId, gameRoot) {
  return (
    cleanId(targetId) ||
    createHash("sha256")
      .update(path.resolve(gameRoot).toLowerCase())
      .digest("hex")
      .slice(0, 16)
  );
}

export async function assertGameRoot(root) {
  if (!(await exists(root))) throw new Error("Папка GTA V не найдена.");
  const detected = await Promise.all(
    ["GTA5.exe", "GTA5_Enhanced.exe", "PlayGTAV.exe"].map((name) =>
      exists(path.join(root, name)),
    ),
  );
  if (!detected.some(Boolean)) {
    throw new Error("В выбранной папке не найден исполняемый файл GTA V.");
  }
}
