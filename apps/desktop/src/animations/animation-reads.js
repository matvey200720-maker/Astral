/*
 * Чтение анимаций для окна (ТЗ 29.10.2026-d) — функции потока чтения игры (`game-read-host.js`): главный процесс Electron
 * игру не читает. Каждая функция — `(запрос, context, stateDir, tools)`, как у остальных читателей (`weapon-in-hands.js`).
 *
 *   listAnimations   — список: анимации игры и свои файлы;
 *   readAnimationRig — персонаж со скелетом одним GLB;
 *   readAnimationTrack — дорожка клипа (повороты костей по кадрам);
 *   readAnimationPoses — по одной позе на плитку сетки;
 *   addAnimationSource / removeAnimationSource — свои файлы анимаций.
 *
 * Только чтение: игра и файлы человека не меняются.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { appLog } from "../app-log.js";
import { clothingArchiveTools, atomicWrite } from "../clothing-models.js";
import { provisionArchiveSupport } from "../loader-provisioner.js";
import { animationsFolder, pool, readGameIndex } from "./animation-index.js";
import {
  addOwnSource,
  readOwnIndex,
  readOwnSources,
  removeOwnSource,
} from "./own-sources.js";
import { listProjectEntries } from "./project-source.js";
import { lazyModule } from "../lazy-import.js";

/*
 * Скелет персонажа (`animation-rig.js`) и дорожки с позами (`animation-track.js`) подгружаются при первом вызове, которому они нужны, а не при запуске потока (18.11.2026): список анимаций
 * их не зовёт, а дерево этих двух модулей — ≈ 130 мс запуска потока (замер, Electron как Node: 518 → ≈ 390 мс). Одновременные первые вызовы ждут один `import()`, ошибка загрузки не запоминается.
 */
const rigModule = lazyModule(() => import("./animation-rig.js"));
const trackModule = lazyModule(() => import("./animation-track.js"));

const refusal = (code, message) => Object.assign(new Error(message), { code });
const POSES_PER_CALL = 24;

function gameRootOf(input) {
  const gameRoot = String(input?.gameRoot || "");
  if (!gameRoot) return "";
  if (!path.isAbsolute(gameRoot))
    throw refusal("ANIMATION_GAME", "Выберите папку GTA V Legacy.");
  return gameRoot;
}

const tools = (stateDir, extra) => ({
  ...clothingArchiveTools(stateDir),
  ...(extra || {}),
});

/* Свои источники читаются один раз на набор: клипы — это запуск движка на каждый словарь. */
let ownMemo = { key: "", value: null };

async function ownIndex(input, context, stateDir, resolved, keysDirectory) {
  const extra = (Array.isArray(input?.extra) ? input.extra : [])
    .filter((item) => typeof item === "string")
    .slice(0, 8);
  const sources = await readOwnSources(stateDir);
  const key = JSON.stringify([sources.map((item) => item.path), extra]);
  if (!input?.refresh && ownMemo.key === key && ownMemo.value)
    return ownMemo.value;
  const value = await readOwnIndex(
    { stateDir, keysDirectory, extra },
    context,
    resolved,
  );
  ownMemo = { key, value };
  return value;
}

/** Список анимаций: `{ entries, sources, problems, gameBuilt }`. Игры нет — только свои файлы. */
export async function listAnimations(input, context, stateDir, extra = {}) {
  const gameRoot = gameRootOf(input);
  const resolved = tools(stateDir, extra);
  /* Ключи архивов нужны только сборке списка и открытию своего `.rpf`: поставка (`provisionArchiveSupport`) зовётся, когда это правда случилось, и один раз на вызов (18.11.2026). `extra.provisionKeys` — для проверок. */
  let provided = null;
  const keys = () =>
    (provided ??= (extra.provisionKeys || provisionArchiveSupport)({ stateDir }).then(
      (support) => support?.directory || "",
      () => "",
    ));
  const game = gameRoot
    ? await readGameIndex(
        { gameRoot, stateDir, keys, refresh: Boolean(input?.refresh) },
        context,
        resolved,
      )
    : { entries: [] };
  const own = await ownIndex(input, context, stateDir, resolved, keys);
  if (input?.refresh) ownMemo = { key: "", value: null };
  /* Анимации проектов («GTA 5 RP», «Nova RP») — по индексу, файлы словарей качаются по требованию (`project-source.js`). */
  /* Не вышло — раздел проекта в этот раз пуст, но причина в журнале приложения, а не тишина. */
  const projects = await listProjectEntries().catch((error) => {
    appLog.record({
      level: "error",
      source: "animations",
      message: `Анимации проектов: список не собрался (${error?.code || error?.message || error})`,
    });
    return [];
  });
  return {
    entries: [...own.entries, ...game.entries, ...projects],
    sources: own.sources,
    problems: own.problems,
    hasGame: Boolean(gameRoot),
  };
}

export async function readAnimationRig(input, context, stateDir, extra = {}) {
  const gameRoot = gameRootOf(input);
  if (!gameRoot)
    throw refusal("ANIMATION_GAME", "Выберите папку GTA V Legacy.");
  const { readAnimationRig: buildRig } = await rigModule();
  const rig = await buildRig(
    { gameRoot },
    stateDir,
    tools(stateDir, extra),
    context,
  );
  return {
    glb: rig.glb.buffer.slice(
      rig.glb.byteOffset,
      rig.glb.byteOffset + rig.glb.byteLength,
    ),
    tags: rig.tags,
  };
}

async function ownRoots(stateDir, input) {
  const sources = await readOwnSources(stateDir);
  const extra = (Array.isArray(input?.extra) ? input.extra : [])
    .filter((item) => typeof item === "string")
    .map((item) => path.resolve(item));
  return [
    ...sources.map((item) => path.resolve(item.path)),
    ...extra,
    path.join(stateDir, "animations", "own"),
  ];
}

const trackKey = (entry) =>
  `${entry.source}|${entry.archive || entry.file || entry.sha256}|${entry.entry || ""}|${entry.clip}`;

/** Дорожка клипа: `{ fps, duration, frames, tags, rotations, mover }`. */
export async function readAnimationTrack(input, context, stateDir, extra = {}) {
  const gameRoot = gameRootOf(input);
  const { bakeTrack, checkEntry, dictionaryFile, readCachedTrack, writeCachedTrack, writeTrackTimings } = await trackModule();
  const entry = checkEntry(input?.entry, await ownRoots(stateDir, input));
  if (entry.source === "game" && !gameRoot)
    throw refusal("ANIMATION_GAME", "Выберите папку GTA V Legacy.");
  const key = trackKey(entry);
  const cached = await readCachedTrack(stateDir, gameRoot, key);
  if (cached) return cached;
  /* Счётчики пути дорожки (`ASTRAL_TRACK_TIMINGS=1`): строка JSON на дорожку в `<кэш анимаций>/timings.jsonl`; без переменной ничего не считается. */
  const stats =
    process.env.ASTRAL_TRACK_TIMINGS === "1" ? { wantTimings: true } : null;
  const resolved = {
    ...tools(stateDir, extra),
    ...(stats ? { trackStats: stats } : {}),
  };
  const file = await dictionaryFile(
    entry,
    { gameRoot, stateDir },
    context,
    resolved,
  );
  const began = performance.now();
  const track = await bakeTrack(file, entry.clip, context, resolved);
  if (stats)
    await writeTrackTimings(stateDir, gameRoot, {
      clip: entry.clip,
      track,
      stats,
      totalMs: performance.now() - began,
    }).catch(() => {});
  await writeCachedTrack(stateDir, gameRoot, key, track).catch(() => {});
  return track;
}

const poseFile = (stateDir, gameRoot, entry, POSE_BUILD) =>
  path.join(
    animationsFolder(stateDir, gameRoot),
    "poses",
    `${POSE_BUILD}-${createHash("sha1").update(trackKey(entry)).digest("hex").slice(0, 20)}.json`,
  );

/**
 * Позы для плиток: `{ poses: [{ id, tags, rotations, mover } | { id, failed }] }`. Не больше `POSES_PER_CALL` за вызов — окно
 * просит по мере прокрутки, а не всё сразу.
 */
export async function readAnimationPoses(input, context, stateDir, extra = {}) {
  const gameRoot = gameRootOf(input);
  const { POSE_BUILD, bakePose, checkEntry, dictionaryFile } = await trackModule();
  const roots = await ownRoots(stateDir, input);
  const wanted = (Array.isArray(input?.entries) ? input.entries : []).slice(
    0,
    POSES_PER_CALL,
  );
  const resolved = tools(stateDir, extra);
  const poses = await pool(wanted, 4, async (raw) => {
    const id = String(raw?.id || "");
    try {
      const entry = checkEntry(raw, roots);
      if (entry.source === "game" && !gameRoot)
        throw refusal("ANIMATION_GAME", "Выберите папку GTA V Legacy.");
      const cache = poseFile(stateDir, gameRoot, entry, POSE_BUILD);
      const stored = await fs
        .readFile(cache, "utf8")
        .then(JSON.parse)
        .catch(() => null);
      if (stored?.tags?.length)
        return {
          id,
          tags: stored.tags,
          rotations: Float32Array.from(stored.rotations),
          mover: Float32Array.from(stored.mover),
        };
      const file = await dictionaryFile(
        entry,
        { gameRoot, stateDir },
        context,
        resolved,
      );
      const pose = await bakePose(file, entry.clip, context, resolved);
      await fs.mkdir(path.dirname(cache), { recursive: true });
      await atomicWrite(
        cache,
        Buffer.from(
          JSON.stringify({
            tags: pose.tags,
            rotations: Array.from(pose.rotations),
            mover: Array.from(pose.mover),
          }),
        ),
      );
      return {
        id,
        tags: pose.tags,
        rotations: pose.rotations,
        mover: pose.mover,
      };
    } catch (error) {
      return { id, failed: String(error?.message || error).slice(0, 200) };
    }
  });
  return { poses };
}

export async function addAnimationSource(input, context, stateDir) {
  return addOwnSource(stateDir, input?.path);
}

export async function removeAnimationSource(input, context, stateDir) {
  return removeOwnSource(stateDir, String(input?.id || ""));
}
