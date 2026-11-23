/*
 * Игра переехала в другую папку (задача 1 ТЗ 10.10.2026).
 *
 * Цель движка привязана к папке игры: id цели у Astral — из начала пути
 * (`steam-<первые байты пути>`), `gameRoot` — полный путь. Человек переносит
 * GTA V на другой диск, возвращает её из резервной копии в другую папку,
 * переустанавливает Steam в другую библиотеку — и для Astral это была новая
 * игра: установленное оставалось за старой целью и пропадало из библиотеки, а
 * подготовка новой упиралась в «В update.rpf уже есть слой Astral, но
 * резервной копии оригинала в этом профиле нет» (тот же id и другая папка —
 * в «Идентификатор профиля уже связан с другой папкой GTA V»). Тупик в обоих
 * случаях: в игре стоят наши же моды, а Astral отказывался их узнать.
 *
 * Здесь цель, чьей папки больше нет (нет исполняемого файла GTA V), переезжает
 * на новую папку вместе со всем установленным. Если таких целей несколько,
 * выбирается та, чей update.rpf совпал с живым. Дальше движок работает как
 * обычно: архив тот же — всё на месте; проверка файлов уже прошла — это видит
 * сверка с игрой (задача 2), и моды ждут «Установить снова».
 */
import fs from "node:fs/promises";
import path from "node:path";
import { noteReconcile } from "./reconcile-report.js";

const EXECUTABLES = Object.freeze(["GTA5.exe", "GTA5_Enhanced.exe", "PlayGTAV.exe"]);
const UPDATE_ARCHIVE = "update/update.rpf";

const caseless = process.platform === "win32";
const samePlace = (left, right) => {
  const a = path.resolve(String(left || ""));
  const b = path.resolve(String(right || ""));
  return caseless ? a.toLowerCase() === b.toLowerCase() : a === b;
};

const exists = async (file) => {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
};

/** Стоит ли ещё по этому пути GTA V. */
export async function gameStillThere(gameRoot, { probe = exists } = {}) {
  if (!gameRoot) return false;
  for (const name of EXECUTABLES) if (await probe(path.join(path.resolve(gameRoot), name))) return true;
  return false;
}

/* Отпечатки update.rpf, которые знает цель: что она положила и с чего начинала. */
function knownUpdateHashes(target) {
  const resource = target?.resources?.[UPDATE_ARCHIVE];
  return new Set(
    [
      resource?.layers?.at(-1)?.sha256,
      resource?.compositionBase?.sha256,
      resource?.compositionBase?.liveSha256,
      resource?.original?.sha256,
      resource?.pristine?.sha256,
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase()),
  );
}

const hasSomething = (target) =>
  Boolean((target?.installed || []).length || Object.keys(target?.resources || {}).length);

/**
 * Цель, переехавшую на `root`, — из прежних целей, чьей папки нет. `liveSha`
 * — отпечаток живого update.rpf на новом месте (`async () => sha`), считается
 * только когда кандидатов больше одного.
 */
export async function findMovedTarget(state, { targetKey, root, edition = null, liveSha = null, probe = exists }) {
  const candidates = [];
  for (const [key, target] of Object.entries(state?.targets || {})) {
    if (key === targetKey || !target?.gameRoot || samePlace(target.gameRoot, root)) continue;
    if (edition && target.edition && String(target.edition) !== String(edition)) continue;
    if (target.vanillaGuard && target.vanillaGuard.phase !== "restored") continue;
    if (!hasSomething(target)) continue;
    if (await gameStillThere(target.gameRoot, { probe })) continue;
    candidates.push([key, target]);
  }
  if (!candidates.length) return null;
  /* Одна прежняя цель без папки — это она: архив мог уже смениться
     проверкой файлов, и сверка с игрой разберётся с ним сама (задача 2). */
  if (candidates.length === 1) return candidates[0];
  const live = typeof liveSha === "function" ? String((await liveSha().catch(() => "")) || "").toLowerCase() : "";
  const matched = live ? candidates.filter(([, target]) => knownUpdateHashes(target).has(live)) : [];
  return matched.length === 1 ? matched[0] : null;
}

/**
 * Переносит цель `fromKey` в `toKey` на папку `root` (состояние меняется на
 * месте). Пути копий остаются как были — они к хранилищу, а не к игре.
 */
export function moveTarget(state, { fromKey, toKey, root, edition = null }) {
  const target = state.targets[fromKey];
  const from = target.gameRoot;
  const moved = {
    ...target,
    id: toKey,
    gameRoot: path.resolve(root),
    edition: edition || target.edition || null,
    movedFrom: [...new Set([...(Array.isArray(target.movedFrom) ? target.movedFrom : []), from])],
  };
  moved.installed = (moved.installed || []).map((item) => (item?.targetId ? { ...item, targetId: toKey } : item));
  delete state.targets[fromKey];
  state.targets[toKey] = moved;
  if (state.restorePoints && Object.hasOwn(state.restorePoints, fromKey)) {
    state.restorePoints[toKey] = [
      ...(Array.isArray(state.restorePoints[fromKey]) ? state.restorePoints[fromKey] : []),
      ...(Array.isArray(state.restorePoints[toKey]) ? state.restorePoints[toKey] : []),
    ];
    delete state.restorePoints[fromKey];
  }
  noteReconcile(moved, { kind: "game-moved", from, to: moved.gameRoot, fromTarget: fromKey });
  return moved;
}

/**
 * Та же цель, другая папка: прежней папки нет — цель переезжает на новую
 * (`true`); прежняя на месте — это другая копия игры (`false`).
 */
export async function repointTarget(target, root, { probe = exists } = {}) {
  if (!target?.gameRoot || samePlace(target.gameRoot, root)) return true;
  if (await gameStillThere(target.gameRoot, { probe })) return false;
  const from = target.gameRoot;
  target.movedFrom = [...new Set([...(Array.isArray(target.movedFrom) ? target.movedFrom : []), from])];
  target.gameRoot = path.resolve(root);
  noteReconcile(target, { kind: "game-moved", from, to: target.gameRoot });
  return true;
}

/**
 * Цель `targetKey` в состоянии `state` для папки `root`: нет её — прежняя
 * цель переехавшей игры встаёт под этот id; есть, но с другой папкой —
 * переезжает на новую, если прежней нет. Другая живая копия игры с тем же
 * id — отказ, как раньше.
 */
export async function settleTargetPlace(state, { targetKey, root, edition = null, liveSha = null }) {
  let target = state?.targets?.[targetKey];
  if (!target) {
    const found = await findMovedTarget(state, { targetKey, root, edition, liveSha });
    if (found) target = moveTarget(state, { fromKey: found[0], toKey: targetKey, root, edition });
  }
  if (target?.gameRoot && !samePlace(target.gameRoot, root) && !(await repointTarget(target, root)))
    throw new Error("Идентификатор профиля уже связан с другой папкой GTA V.");
  return target || null;
}

/** Точка отката снята с этой же игры — до или после её переезда. */
export function snapshotOfThisGame(snapshot, target) {
  if (!snapshot?.gameRoot) return true;
  if (samePlace(snapshot.gameRoot, target.gameRoot)) return true;
  return (target.movedFrom || []).some((from) => samePlace(from, snapshot.gameRoot));
}
