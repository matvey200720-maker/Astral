/*
 * Следы управляемых DLC в `newmods`, о которых состояние не знает (ТЗ ведущей 26.10.2026, Хелпер 19).
 *
 * Управляемый DLC (`managed-addon-dlc`: «Мега Молл — наложение», «Ашан») лежит в `newmods/dlcpacks/<имя>/dlc.rpf`, а строка
 * `dlcpacks:/<имя>/` — в `newmods/common/data/dlclist.xml`. Снимает их только то, что помнит состояние: запись
 * `dlcRegistrations` и ресурсы цели. Когда состояние забыло установку, ни «Удалить» в библиотеке, ни «Вернуть GTA V без
 * модов» этих файлов не видят — оба обходят состояние. У владельца так остался `astral_davis_megamall`: живой прогон
 * 20.08.2026 (`scripts/verify-real-mega-mall-overlay-install.js`) положил пакет и список, запись о них пропала со сбросом
 * состояния, а игра читает пакет по строке и пишет в OpenIV.log `bad magic` на каждом запуске (стенд Х15). Заодно такой
 * список принимался за «оригинал» при следующей установке управляемого DLC (`ensureManagedDlcListResource`) и возвращал строку
 * при каждом снятии.
 *
 * Здесь — поиск таких следов и их чистка той же транзакцией, что и обычная установка или возврат:
 *  - строка Astral в списке `newmods`, которой нет ни среди регистраций, ни среди прямых DLC (их строки приходят в список из
 *    `update.rpf`), — «чужая нашей памяти»: список пересобирается из основы и регистраций;
 *  - пакет `newmods/dlcpacks/astral_<имя>/dlc.rpf` без регистрации — файл, которого игра не должна читать, он удаляется;
 *  - регистрация без пакета (файла нет и слоёв нет) — «висячая», она снимается из состояния и из списка.
 * update.rpf не трогается: прямые DLC и их строки живут по своим правилам (`direct-dlcs.js`, `astral-layer.js`).
 */
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { astralDlcRegistrations } from "./astral-paths.js";
import { resolveInside } from "./manifest.js";
import { MANAGED_DLC_LIST_TARGET, composeManagedDlcList } from "./registry-composers.js";
import { ensureManagedDlcListResource } from "./resource-composition.js";
import { traceNote } from "./install-trace.js";
import { ownRecordValue, setRecordValue } from "./state-record.js";
import { missingBaseline } from "./storage-state.js";

const PACKS_DIR = "newmods/dlcpacks";
const PACK_NAME = /^astral_[a-z0-9_]+$/i;
const lower = (value) => String(value).toLowerCase();

/** Цель файла пакета управляемого DLC: `newmods/dlcpacks/astral_x/dlc.rpf`. */
export const managedPackTarget = (name) => `${PACKS_DIR}/${name}/dlc.rpf`;

const missing = (error) => ["ENOENT", "ENOTDIR"].includes(error?.code);

async function readRegularFile(file) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return await fs.readFile(file);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

/* Пакеты в игре: имена папок как на диске, у которых есть обычный файл dlc.rpf. */
async function livePacks(root) {
  let names;
  try {
    names = await fs.readdir(resolveInside(root, PACKS_DIR));
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }
  const found = [];
  for (const name of names) {
    if (!PACK_NAME.test(name)) continue;
    const stat = await fs.lstat(resolveInside(root, managedPackTarget(name))).catch(() => null);
    if (stat?.isFile() && !stat.isSymbolicLink()) found.push(name);
  }
  return found.sort((a, b) => a.localeCompare(b));
}

/**
 * Что в `newmods` лишнее: `{ strayLines, strayPacks, dangling, listed, any }`. Имена строчными, кроме `strayPacks` — они
 * как на диске (по ним строится путь).
 */
export async function findStaleManagedDlc({ target, root }) {
  const owned = new Set(Object.keys(target?.dlcRegistrations || {}).map(lower));
  const direct = new Set(Object.keys(target?.directDlcRegistrations || {}).map(lower));
  const listBytes = await readRegularFile(resolveInside(root, MANAGED_DLC_LIST_TARGET));
  const listed = listBytes !== null;
  const lines = listed ? astralDlcRegistrations(listBytes.toString("utf8")) : [];
  const packs = await livePacks(root);
  const packNames = new Set(packs.map(lower));
  const hasLayers = (name) =>
    (target?.resources?.[managedPackTarget(name)]?.layers || []).length > 0;
  const strayLines = lines.filter((name) => !owned.has(name) && !direct.has(name));
  const strayPacks = packs.filter((name) => !owned.has(lower(name)));
  const dangling = [...owned].filter((name) => !packNames.has(name) && !hasLayers(name));
  return {
    listed,
    strayLines,
    strayPacks,
    dangling,
    any: Boolean(strayLines.length || strayPacks.length || dangling.length),
  };
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * Убрать следы из состояния цели и собрать, что транзакции записать в игре: `affected` — `[{ relativePath, livePath,
 * sourcePath }]` (`sourcePath: null` — удалить). Игра не меняется, пока транзакция не выполнена; список, чьи байты уже такие,
 * в `affected` не попадает. `stale` — что нашлось (для журнала).
 */
export async function settleStaleManagedDlc({ target, targetKey, root, paths, edition = null, dlcListProvider = null }) {
  const stale = await findStaleManagedDlc({ target, root });
  const affected = [];
  if (!stale.any) return { affected, stale };
  for (const name of stale.dangling)
    for (const key of Object.keys(target.dlcRegistrations || {}))
      if (lower(key) === name) delete target.dlcRegistrations[key];
  if ((stale.strayLines.length || stale.dangling.length) && (stale.listed || target.resources?.[MANAGED_DLC_LIST_TARGET])) {
    await ensureManagedDlcListResource({ target, root, paths, targetKey, edition, dlcListProvider });
    const composed = await composeManagedDlcList({ target, targetKey, paths });
    const livePath = resolveInside(root, MANAGED_DLC_LIST_TARGET);
    const live = await readRegularFile(livePath);
    const next = composed ? await fs.readFile(composed) : null;
    const same = live === null ? next === null : next !== null && sha256(live) === sha256(next);
    if (!same) affected.push({ relativePath: MANAGED_DLC_LIST_TARGET, livePath, sourcePath: composed });
  }
  /* Забытый пакет в состоянии — «до Astral файла не было»: установка того же DLC поверх него не примет старый файл за оригинал
     (иначе снятие вернуло бы его), а возврат «без модов» удалит. Запись нужна на время транзакции (`releaseStalePacks`). */
  for (const name of stale.strayPacks) {
    const relativePath = managedPackTarget(name);
    if (!ownRecordValue(target.resources, relativePath))
      setRecordValue(target.resources, relativePath, {
        base: missingBaseline(),
        compositionBase: missingBaseline(),
        original: missingBaseline(),
        clean: missingBaseline(),
        layers: [],
      });
    affected.push({ relativePath, livePath: resolveInside(root, relativePath), sourcePath: null });
  }
  return { affected, stale };
}

/** Записи забытых пакетов, которые установка так и не заняла своим слоем, из состояния уходят: файлов в игре у них уже нет. */
export function releaseStalePacks(target, stale) {
  for (const name of stale?.strayPacks || []) {
    const relativePath = managedPackTarget(name);
    const resource = ownRecordValue(target.resources, relativePath);
    if (resource && !(resource.layers || []).length) delete target.resources[relativePath];
  }
}

/** Чистка следов для обычной установки: отказ чистки установку не останавливает — она не её дело, только запись в журнал. */
export async function settleStaleForInstall(options) {
  const settled = await settleStaleManagedDlc(options).catch((error) => {
    traceNote("следы newmods", `чистка пропущена: ${error?.message || error}`);
    return { affected: [], stale: null };
  });
  if (settled.affected.length) traceNote("следы newmods", settled.affected.map((item) => item.relativePath).join(", "));
  return settled;
}

/** Следы — в ту же транзакцию, что и установка (без повторов), и забытые пакеты без слоя — из состояния. */
export function joinStaleAffected(affected, settled, target) {
  for (const item of settled.affected)
    if (!affected.some((own) => own.relativePath === item.relativePath)) affected.push(item);
  releaseStalePacks(target, settled.stale);
}
