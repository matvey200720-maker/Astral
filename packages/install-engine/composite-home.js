/*
 * Где лежат сборки архивов (`<отпечаток>.rpf`): в хранилище движка или на диске игры (13.11.2026,
 * работа «Astral быстрее», решение владельца: «да, на диске игры»).
 *
 * Сборка update.rpf — 2 ГБ. Она писалась в хранилище (`payloads/_rpf-composites/<цель>`), а оттуда
 * копировалась в игру. У игрока с игрой не на том диске, где хранилище Astral (обычный случай: система
 * на C:, игры на D:), это два гигабайта записи на диск хранилища на каждую установку, и жёсткие ссылки
 * между дисками не встают. Замер на тестовом ПК (игра на NVMe D:, хранилище на QLC C:): «Применить»
 * 46 с, из них сборка 33 с; то же с хранилищем на диске игры — 19 с.
 *
 * Поэтому, когда хранилище и игра на разных томах, сборки цели лежат на томе игры:
 *
 *   `<диск игры>\Astral\_rpf-composites\<дом>\<цель>\<отпечаток>.rpf`
 *
 * — снаружи папки игры, как образ режима Rockstar (`rockstar-mode/store.js`): папку игры сверяет
 * лаунчер Rockstar. `<дом>` — имя этого хранилища (`composite-home.json` в его корне, переезжает
 * вместе с кэшем): уборка одного хранилища не трогает сборки другого профиля на том же диске.
 * Имя папки `_rpf-composites` прежнее: по нему сборку узнают транзакция и кладовая.
 *
 * Запасной путь — прежнее место в хранилище: том тот же, диск игры не буква диска, на нём мало
 * места, папку не создать, выключатель `ASTRAL_GAME_DISK_COMPOSITES=off`. Сборка, уже лежащая на
 * любом из двух мест, берётся оттуда и заново не собирается.
 *
 * `ASTRAL_GAME_DISK_COMPOSITES=<папка>` — свой корень вместо `<диск игры>\Astral` (тесты и стенды:
 * второго тома на машине тестов нет).
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const COMPOSITES_FOLDER = "_rpf-composites";
export const GAME_DISK_FOLDER = "Astral";
export const GAME_DISK_ENV = "ASTRAL_GAME_DISK_COMPOSITES";
export const HOME_MARKER = "composite-home.json";

const GIB = 1024 ** 3;
const DRIVE_ROOT = /^[A-Za-z]:\\$/;
const HOME_ID = /^[A-Za-z0-9-]{8,64}$/;
const OUTSIDE = "Контрольная точка содержит путь вне защищённого хранилища.";

const fold = (value) => String(value).toLowerCase();

function strictlyInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

const switchedOff = (env) => fold(env[GAME_DISK_ENV] || "").trim() === "off";

function forcedBase(env) {
  const value = String(env[GAME_DISK_ENV] || "").trim();
  return value && !switchedOff(env) && path.isAbsolute(value) ? path.join(path.resolve(value), COMPOSITES_FOLDER) : null;
}

/** Корень диска с буквой (`D:\`); сетевые пути и не-Windows — `null`. */
function driveRoot(place) {
  const root = path.parse(path.resolve(String(place || ""))).root;
  return DRIVE_ROOT.test(root) ? root.toUpperCase() : null;
}

/** Папка сборок в хранилище — прежнее и запасное место. */
export const cacheCompositesRoot = (paths) => path.join(paths.payloads, COMPOSITES_FOLDER);

/** Папка сборок всех хранилищ на диске игры: `<диск>\Astral\_rpf-composites`; `null` — диска с буквой нет. */
export function gameDiskCompositesBase(gamePlace, env = process.env) {
  if (switchedOff(env)) return null;
  const forced = forcedBase(env);
  if (forced) return forced;
  const root = driveRoot(gamePlace);
  return root ? path.join(root, GAME_DISK_FOLDER, COMPOSITES_FOLDER) : null;
}

/**
 * Файл лежит в доме сборок на диске игры: `<диск>\Astral\_rpf-composites\<дом>\<цель>\…`.
 * Какой дом — не сверяется: после переноса кэша состояние ссылается на сборки прежнего дома, и они
 * обязаны остаться годными. Байты сборки сверяются по отпечатку при подмене, как и в хранилище.
 */
export function insideGameDiskComposites(file, env = process.env) {
  if (typeof file !== "string" || !file || switchedOff(env)) return false;
  const resolved = path.resolve(file);
  const base = forcedBase(env) || gameDiskCompositesBase(resolved, env);
  if (!base || !strictlyInside(base, resolved)) return false;
  const [home, target, name] = path.relative(base, resolved).split(path.sep);
  return HOME_ID.test(home || "") && Boolean(target) && Boolean(name);
}

/** Сборка — из хранилища (`payloads`) или из дома сборок на диске игры; иначе отказ, как у прочих путей состояния. */
export function assertCompositeSource(paths, candidate, env = process.env) {
  const resolved = path.resolve(String(candidate));
  if (strictlyInside(paths.payloads, resolved) || insideGameDiskComposites(resolved, env)) return resolved;
  throw new Error(OUTSIDE);
}

/** То же для «Вернуть как было»: всё хранилище (основы и сборки) или дом сборок на диске игры. */
export function assertStoredOrComposite(paths, candidate, env = process.env) {
  const resolved = path.resolve(String(candidate));
  if (strictlyInside(paths.root, resolved) || insideGameDiskComposites(resolved, env)) return resolved;
  throw new Error(OUTSIDE);
}

const homes = new Map();

async function readHome(paths) {
  try {
    const id = JSON.parse(await fs.readFile(path.join(paths.root, HOME_MARKER), "utf8"))?.id;
    return HOME_ID.test(String(id || "")) ? String(id) : null;
  } catch {
    return null;
  }
}

/** Имя дома этого хранилища, если оно уже заведено (уборка ничего не создаёт). */
export async function knownHomeId(paths) {
  const key = fold(path.resolve(paths.root));
  if (!homes.has(key)) {
    const id = await readHome(paths);
    if (id) homes.set(key, id);
  }
  return homes.get(key) || null;
}

/** Имя дома этого хранилища; заводится при первой сборке на диске игры. */
export async function homeId(paths) {
  const known = await knownHomeId(paths);
  if (known) return known;
  const id = randomUUID();
  const marker = path.join(paths.root, HOME_MARKER);
  const staging = `${marker}.${process.pid}.${randomUUID()}.tmp`;
  await fs.mkdir(paths.root, { recursive: true });
  await fs.writeFile(staging, `${JSON.stringify({ id })}\n`);
  await fs.rename(staging, marker);
  /* Два процесса завели дом разом — в силе тот, чей файл лёг последним. */
  const settled = (await readHome(paths)) || id;
  homes.set(fold(path.resolve(paths.root)), settled);
  return settled;
}

/** Для тестов: забыть запомненные имена домов. */
export function forgetCompositeHomes() {
  homes.clear();
}

async function freeBytes(place, statfs) {
  try {
    const stats = await statfs(place);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

/**
 * Папка сборок цели. На диске игры — когда хранилище на другом томе и на диске игры хватает места
 * под две сборки (новая и придержанная прежняя) с запасом в гигабайт; иначе — в хранилище.
 */
export async function compositesDirectory({ paths, targetKey, gameRoot, expectedBytes = 0, env = process.env, statfs = fs.statfs }) {
  const inCache = path.join(cacheCompositesRoot(paths), targetKey);
  const base = gameDiskCompositesBase(gameRoot, env);
  if (!base) return inCache;
  if (!forcedBase(env) && driveRoot(gameRoot) === driveRoot(paths.root)) return inCache;
  try {
    const directory = path.join(base, await homeId(paths), targetKey);
    await fs.mkdir(directory, { recursive: true });
    const free = await freeBytes(directory, statfs);
    const needed = 2 * Math.max(Number(expectedBytes) || 0, GIB) + GIB;
    if (free !== null && free < needed) return inCache;
    return directory;
  } catch {
    return inCache;
  }
}

/** Место сборки с таким именем: готовая с любого из двух мест, иначе — предпочтительное. */
export async function compositePlace({ name, ...request }) {
  const preferred = path.join(await compositesDirectory(request), name);
  const fallback = path.join(cacheCompositesRoot(request.paths), request.targetKey, name);
  for (const place of [preferred, fallback]) {
    const stat = await fs.stat(place).catch(() => null);
    if (stat?.isFile()) return { output: place, cached: true };
  }
  return { output: preferred, cached: false };
}

/**
 * Папки сборок этого хранилища на дисках игр — для уборки (`cache-housekeeping.js`): по папке на цель.
 * Диски берутся из путей игр состояния и из мест, на которые оно ссылается: после переноса кэша на
 * диск игры новые сборки ложатся в хранилище, а прежние на диске игры всё ещё нужно убирать.
 */
export async function gameDiskCompositeDirectories({ paths, gameRoots = [], referenced = [], env = process.env }) {
  const id = await knownHomeId(paths);
  if (!id) return [];
  const bases = new Map();
  const note = (base) => base && bases.set(fold(base), base);
  for (const root of gameRoots) note(gameDiskCompositesBase(root, env));
  for (const place of referenced) if (insideGameDiskComposites(place, env)) note(forcedBase(env) || gameDiskCompositesBase(place, env));
  const found = [];
  for (const base of bases.values()) {
    const home = path.join(base, id);
    const entries = await fs.readdir(home, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) if (entry.isDirectory() && !entry.isSymbolicLink()) found.push(path.join(home, entry.name));
  }
  return found;
}
