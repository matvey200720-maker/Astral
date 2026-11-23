/*
 * Починка фильма мини-карты, испорченного опцией «HP по всему экрану (проба)».
 *
 * До beta.81 опция собирала `minimap.gfx` со сценой шире штатной (1211×416 вместо 191×136) и первым действием корня
 * `this._x = 510; this._y = 140`. Карту паузы рисует тот же фильм, поэтому она уезжала в правый нижний угол и сжималась
 * (проверено кадрами из игры, 31.10.2026). Опцию убрали, а файл остался: у работы, поставленной с опцией, он в её патче, а
 * после установки через движок — ещё и в основе (`compositionBase`, запись `minimap.gfx` с пустыми `layers`), и снятие
 * пакета большой карты его не убирает.
 *
 * КАК ОТЛИЧИТЬ — по самому файлу, а не по памяти окна: сцена начинается с нуля и больше штатной ровно на удвоенный сдвиг, а
 * первое действие первого кадра — только этот сдвиг корня (`minimapFilmDamage`). Чужой фильм со своей сценой так не выглядит.
 *
 * КАК ЧИНИТЬ — двумя точками стопки, сверху вниз:
 *
 *   1. `healMinimapFilm` кладёт штатные `minimap.gfx` и `frontend.xml` (опция растила и записи `minimap*`/`bigmap*`) тем же
 *      `install-rpf-patch`, что и «Применить»: с проверкой, копией архива и откатом при сбое. Накладки «Групповых меток» из
 *      живого файла переносятся в штатный (`baseWithOverlays`).
 *   2. Окно ставит поверх работу человека обычным `installMinimap`, если она есть (`tasks/minimap-film-repair.js`): работа и
 *      картинки живут только в окне.
 *
 * Первая точка нужна и при второй: точка отката работы — копия архива до неё. Без лечения снятие работы вернуло бы в игру
 * испорченный фильм. Лечебная точка в «Что стоит в игре» не показывается: это не работа, снимать там нечего
 * (`isFilmRepairPatch`). Перемотка мимо неё ставит её обратно обычным порядком, и старый патч опции ниже по стопке всё равно
 * оказывается закрыт штатным файлом.
 *
 * Проверка при запуске дешёвая: пока архив не менялся, ответ берётся из отметки (размер и время правки). Один раз: у исправного
 * файла отметка «исправен», а у неудачной починки счётчик попыток на этот же архив — по кругу не чинит.
 *
 * Широкий фильм нынешнего «HP отдельно от карты» — работа, а не порча: в том же действии у него метка `astralWideScene`
 * (`minimapWideScene`), и сюда он не попадает.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { MINIMAP_SCENE } from "@modovik/minimap-contract";
import { appLog } from "./app-log.js";
import { requireGameRoot, UPDATE_ARCHIVE } from "./game-scaleform-base.js";
import { provisionArchiveSupport } from "./loader-provisioner.js";
import { MINIMAP_FRONTEND_ENTRY, MINIMAP_GFX_ENTRY } from "./minimap-gfx-compiler.js";
import { baseWithOverlays, readLiveGameFile, resolveMinimapBase } from "./minimap-customizer.js";
import { minimapFilmDamage } from "./minimap-film-damage.js";
import { callNativeEngine } from "./native-engine.js";
import { isFilmRepairPatch, MINIMAP_FILM_REPAIR_FAMILY } from "./native-restore-chain.js";

export { isFilmRepairPatch, minimapFilmDamage };

const MARK_FILE = "minimap-film-check.json";
const MARK_SCHEMA = 1;
/* Сколько раз пробовать на одном и том же архиве: сбой может быть разовым (занятый файл, мало места), но чинить при каждом
   запуске то, что не чинится, нельзя. Архив сменился — считается заново. */
export const MINIMAP_FILM_MAX_ATTEMPTS = 2;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sameRoot = (left, right) =>
  Boolean(left && right) && path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
const liveArchive = (gameRoot) => path.join(gameRoot, "update", "update.rpf");

const defaultTools = () => ({
  native: callNativeEngine,
  archiveSupport: provisionArchiveSupport,
  readGameFile: readLiveGameFile,
  log: (entry) => appLog.record({ source: "install", ...entry }),
});

async function stampOf(file) {
  const info = await fs.stat(file).catch(() => null);
  return info?.isFile() ? { size: info.size, mtimeMs: Math.round(info.mtimeMs) } : null;
}

async function readMark(stateDir) {
  try {
    const mark = JSON.parse(await fs.readFile(path.join(stateDir, MARK_FILE), "utf8"));
    return mark?.schema === MARK_SCHEMA ? mark : null;
  } catch {
    return null;
  }
}

async function writeMark(stateDir, mark) {
  const file = path.join(stateDir, MARK_FILE);
  const stage = `${file}.${process.pid}.stage`;
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(stage, `${JSON.stringify({ schema: MARK_SCHEMA, ...mark }, null, 2)}\n`);
  await fs.rename(stage, file);
}

const markFits = (mark, gameRoot, stamp) =>
  Boolean(mark && stamp) &&
  sameRoot(mark.gameRoot, gameRoot) &&
  mark.archive?.size === stamp.size &&
  mark.archive?.mtimeMs === stamp.mtimeMs;

async function readLiveFilm({ gameRoot, stateDir, readGameFile }) {
  const directory = path.join(stateDir, "minimap-patches", `film-check-${randomUUID()}`);
  await fs.mkdir(directory, { recursive: true });
  try {
    return await readGameFile({
      gameRoot,
      archive: UPDATE_ARCHIVE,
      entry: MINIMAP_GFX_ENTRY,
      output: path.join(directory, "live.gfx"),
    });
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

const sceneText = (damage) =>
  `сцена ${damage.scene.width}×${damage.scene.height}, сдвиг ${damage.shift.x}/${damage.shift.y}`;

/**
 * Что с фильмом мини-карты в живом архиве. Ничего не пишет в игру.
 *
 * @returns {Promise<{state: "sound"|"damaged"|"deferred"|"unknown"|"gave-up", damage?: object, reason?: string}>}
 *   `deferred` — фильм испорчен, но игра запущена: до следующего запуска; `unknown` — не прочитался, решать не о чем;
 *   `gave-up` — на этом архиве починка уже не вышла положенное число раз.
 */
export async function checkMinimapFilm(input, stateDir, { assertRuntimeSafety, ...overrides } = {}) {
  const gameRoot = requireGameRoot(input);
  const tools = { ...defaultTools(), ...overrides };
  const stamp = await stampOf(liveArchive(gameRoot));
  if (!stamp) return { state: "unknown", reason: "no-archive" };
  const mark = await readMark(stateDir);
  if (markFits(mark, gameRoot, stamp)) {
    if (mark.state === "sound") return { state: "sound", remembered: true };
    if (mark.state === "failed" && mark.attempts >= MINIMAP_FILM_MAX_ATTEMPTS)
      return { state: "gave-up", reason: mark.reason || "" };
  }
  let film;
  try {
    film = await readLiveFilm({ gameRoot, stateDir, readGameFile: tools.readGameFile });
  } catch (error) {
    /* Нет ключей или помощника, чужой архив: ничего не утверждаем и в отметку не пишем. */
    return { state: "unknown", reason: String(error?.message || error).slice(0, 200) };
  }
  const damage = minimapFilmDamage(film);
  if (!damage) {
    await writeMark(stateDir, { gameRoot, archive: stamp, state: "sound", at: new Date().toISOString() });
    return { state: "sound" };
  }
  if (assertRuntimeSafety) {
    try {
      await assertRuntimeSafety(gameRoot);
    } catch (error) {
      tools.log({
        level: "info",
        message: `Фильм мини-карты испорчен (${sceneText(damage)}), починка отложена: ${String(error?.message || error).slice(0, 160)}`,
      });
      return { state: "deferred", damage };
    }
  }
  tools.log({ level: "warn", message: `Фильм мини-карты испорчен: ${sceneText(damage)}, штатная сцена ${MINIMAP_SCENE.width}×${MINIMAP_SCENE.height}. Чиним.` });
  return { state: "damaged", damage };
}

/* Папка патча в том же виде, что собирает `buildMinimapPatch`: хост проверяет её и ставит как любую работу. */
async function writeRepairPatch({ root, film, frontend }) {
  const directory = path.join(root, randomUUID());
  const payload = path.join(directory, "payload");
  await fs.mkdir(payload, { recursive: true });
  await fs.writeFile(path.join(payload, "minimap.gfx"), film, { flag: "wx" });
  await fs.writeFile(path.join(payload, "frontend.xml"), frontend, { flag: "wx" });
  const actions = [
    { target: MINIMAP_GFX_ENTRY, source: "payload/minimap.gfx", bytes: film },
    { target: MINIMAP_FRONTEND_ENTRY, source: "payload/frontend.xml", bytes: frontend },
  ].map(({ target, source, bytes }) => ({
    Type: "Replace",
    TargetPath: `update:/${target}`,
    SourcePath: source,
    Size: bytes.length,
    Sha256: sha256(bytes),
    IsWholeReplaceNestedRpf: false,
  }));
  await fs.writeFile(
    path.join(directory, "manifest.json"),
    `${JSON.stringify(
      {
        ReduxName: "Astral minimap film repair",
        ParsedAt: new Date().toISOString(),
        TotalPatchSize: film.length + frontend.length,
        Actions: actions,
      },
      null,
      2,
    )}\n`,
    { flag: "wx" },
  );
  return directory;
}

/**
 * Вернуть в игру штатный фильм и штатные записи `frontend.xml`.
 * Фильм исправен — ничего не делает: `{ healed: false }`; игра запущена — `{ healed: false, deferred: true }`.
 *
 * @returns {Promise<{healed: boolean, id?: string, patch?: string, gfxSha256?: string, frontendSha256?: string, base?: string}>}
 */
export async function healMinimapFilm(input, context, stateDir, { assertRuntimeSafety, ...overrides } = {}) {
  const gameRoot = requireGameRoot(input);
  const tools = { ...defaultTools(), ...overrides };
  /* Игру запустили, пока работа ждала очереди: это не сбой починки — до следующего запуска. */
  try {
    await assertRuntimeSafety?.(gameRoot);
  } catch (error) {
    tools.log({ level: "info", message: `Фильм мини-карты: починка отложена: ${String(error?.message || error).slice(0, 160)}` });
    return { healed: false, deferred: true };
  }
  const live = await readLiveFilm({ gameRoot, stateDir, readGameFile: tools.readGameFile });
  const damage = minimapFilmDamage(live);
  if (!damage) return { healed: false };
  const base = await resolveMinimapBase({ gameRoot, stateDir }, overrides);
  const workDirectory = path.join(stateDir, "minimap-patches");
  const filmFile = await baseWithOverlays({ base, gameRoot, workDirectory, readGameFile: tools.readGameFile });
  const film = await fs.readFile(filmFile);
  const frontend = await fs.readFile(base.frontendFile);
  /* Основа тоже бывает испорченной (копия снята поверх опции): такую не ставим, иначе починка ничего не починит. */
  if (minimapFilmDamage(film)) throw new Error("Штатная мини-карта в копии игры тоже испорчена.");
  const patch = await writeRepairPatch({ root: path.join(stateDir, MINIMAP_FILM_REPAIR_FAMILY), film, frontend });
  const support = await tools.archiveSupport({ stateDir });
  const installed = await tools.native(
    "install-rpf-patch",
    { patch, gameRoot, archiveFix: path.join(support.directory, "ArchiveFix.exe"), keys: support.directory },
    context,
  );
  /* Читаем обратно из архива: «поставилось» здесь значит «в игре лежит штатный фильм», а не «хост не упал». */
  const after = await readLiveFilm({ gameRoot, stateDir, readGameFile: tools.readGameFile });
  if (minimapFilmDamage(after) || sha256(after) !== sha256(film))
    throw new Error("После записи в update.rpf лежит не тот фильм мини-карты.");
  tools.log({
    level: "info",
    message: `Фильм мини-карты: вернули штатный из «${base.label}» (${film.length} байт, ${sha256(film).slice(0, 12)}), точка ${installed?.id || "—"}.`,
  });
  return {
    healed: true,
    id: installed?.id || "",
    patch,
    gfxSha256: sha256(film),
    frontendSha256: sha256(frontend),
    base: base.source,
  };
}

/**
 * Чем кончилась починка — в журнал и в отметку. `outcome`: `done` — фильм исправен (с работой или без), `failed` — нет.
 * Удачу подтвердит следующая проверка: время правки архива после неё другое.
 */
export async function reportMinimapFilm(input, stateDir, overrides = {}) {
  const gameRoot = requireGameRoot(input);
  const tools = { ...defaultTools(), ...overrides };
  const outcome = input?.outcome === "done" ? "done" : "failed";
  const detail = String(input?.detail || "").slice(0, 400);
  if (outcome === "done") {
    tools.log({ level: "info", message: `Фильм мини-карты починен${detail ? `: ${detail}` : "."}` });
    return { recorded: true };
  }
  const stamp = await stampOf(liveArchive(gameRoot));
  const mark = await readMark(stateDir);
  const attempts = markFits(mark, gameRoot, stamp) && mark.state === "failed" ? Number(mark.attempts || 0) + 1 : 1;
  await writeMark(stateDir, { gameRoot, archive: stamp, state: "failed", attempts, reason: detail, at: new Date().toISOString() });
  tools.log({ level: "error", message: `Фильм мини-карты не починен (попытка ${attempts} из ${MINIMAP_FILM_MAX_ATTEMPTS}): ${detail || "причина неизвестна"}` });
  return { recorded: true, attempts };
}
