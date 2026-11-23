// Установка update.rpf через нативный движок: имена точки отката и стейджа, запись
// «подмена движком» для журнала транзакции, переключатель по окружению, защита
// пакета для переигрывания.
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const ENGINE_ENV = "ASTRAL_ENGINE_INSTALL";

const NAME_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
// Форма имени: приставка и хвост из 1..maxTail знаков заданного набора.
const POINT_SHAPE = { prefix: "rpf-", alphabet: NAME_CHARS, maxTail: 70 };
const STAGE_SHAPE = { prefix: ".astral-stage-", alphabet: `${NAME_CHARS}.`, maxTail: 64 };

const SWAP_ERRORS = {
  paths: "Подмена движком: путь архива и корень точек должны быть абсолютными.",
  names: "Подмена движком: имена точки или стейджа не прошли проверку.",
  run: "Подмена движком: нет функции установки.",
};

function matchesShape(value, { prefix, alphabet, maxTail }) {
  const text = `${value}`;
  if (!text.startsWith(prefix)) return false;
  const tail = text.slice(prefix.length);
  return tail.length >= 1 && tail.length <= maxTail && Array.from(tail).every((char) => alphabet.includes(char));
}

// Путь строго внутри каталога: не сам каталог, не соседний, не выше и не на другом диске.
function isStrictlyInside(storeDir, candidate) {
  const rel = relative(storeDir, candidate);
  if (rel === "" || isAbsolute(rel)) return false;
  return rel !== ".." && !rel.startsWith(`..${sep}`);
}

export function assertReplayInside(stateDir, packageRoot, workName = "работа") {
  if (stateDir && packageRoot) {
    const packageDir = resolve(String(packageRoot));
    if (isStrictlyInside(resolve(String(stateDir)), packageDir)) return packageDir;
  }
  throw new Error(
    `Работа «${workName}»: пакет лежит вне хранилища Astral — переустановите работу, пакет будет взят из хранилища.`,
  );
}

// Элементы списка из переменной окружения: делится по запятой, пустой текст даёт один пустой элемент.
function* commaItems(text) {
  let from = 0;
  for (;;) {
    const comma = text.indexOf(",", from);
    yield text.slice(from, comma === -1 ? text.length : comma);
    if (comma === -1) return;
    from = comma + 1;
  }
}

export function engineInstallEnabled(moduleName, env = process.env) {
  const listed = String(env[ENGINE_ENV] || "");
  const wanted = String(moduleName).toLowerCase();
  for (const item of commaItems(listed)) {
    if (item.trim().toLowerCase() === wanted) return true;
  }
  return false;
}

export function newEngineSwapNames(random = randomBytes) {
  const drawHex = () => random(16).toString("hex");
  const pointHex = drawHex();
  const stageHex = drawHex();
  return {
    pointId: ["rpf", Date.now().toString(36), pointHex].join("-"),
    stageName: `.astral-stage-${stageHex}`,
  };
}

// Корень точки лежит под корнем точек, стейдж — рядом с живым архивом.
function swapLocations(live, points, { pointId, stageName }) {
  return { pointRoot: join(points, pointId), stageDir: join(dirname(live), stageName) };
}

/*
 * «До» рядом с живым архивом (установка из операций, `ops-build.js`): когда ссылка в папку точек невозможна
 * (кэш на другом томе), движок оставляет прежний архив вторым именем `<архив>.astral-before-<точка>` на томе
 * игры, а не копией в папке точек. Имя то же, что у `aside_path` в движке. Журнал транзакции убирает его вместе
 * с точкой при откате (`transaction.js`), а после успешной установки оно принадлежит точке: уходит с ней при
 * откате точки, а брошенные подбирает следующая установка в тот же архив.
 */
export function engineBeforeBesidePath(livePath, pointId) {
  return `${livePath}.astral-before-${pointId}`;
}

/*
 * Уборка при запуске: «до» рядом, чья точка уже убрана (кэш чистили, точку забыли), или точка брошена недописанной
 * дольше шести часов (как у `cache-housekeeping.js`). Живая точка свою ссылку сохраняет. Те же правила, что у
 * `sweep_orphan_asides` в движке, — его следующая установка в тот же архив уберёт то же самое. Возвращает убранные имена.
 */
const ORPHAN_POINT_ID = /^[A-Za-z0-9_-]{1,80}$/;
export async function sweepOrphanBeforeBeside(livePath, pointsRoot, { now = Date.now(), staleMs = 6 * 60 * 60 * 1000 } = {}) {
  const head = `${basename(String(livePath))}.astral-before-`;
  const removed = [];
  for (const name of await fs.readdir(dirname(String(livePath))).catch(() => [])) {
    if (!name.startsWith(head)) continue;
    const pointId = name.slice(head.length);
    if (!ORPHAN_POINT_ID.test(pointId)) continue;
    const point = join(String(pointsRoot), pointId);
    const stat = await fs.stat(point).catch(() => null);
    let orphan = stat === null;
    if (stat !== null) {
      const hasManifest = await fs.stat(join(point, "restore.json")).then((facts) => facts.isFile(), () => false);
      orphan = !hasManifest && now - stat.mtimeMs > staleMs;
    }
    if (orphan && (await fs.rm(join(dirname(String(livePath)), name), { force: true }).then(() => true, () => false))) removed.push(name);
  }
  return removed;
}

export function engineSwapItem({
  relativePath,
  livePath,
  pointsRoot,
  run,
  onDone = null,
  names = newEngineSwapNames(),
}) {
  const live = String(livePath);
  const points = String(pointsRoot);

  // Проверки лениво и по порядку: побеждает первая сработавшая.
  const failure = [
    [() => isAbsolute(live) && isAbsolute(points), SWAP_ERRORS.paths],
    [() => matchesShape(names.pointId, POINT_SHAPE) && matchesShape(names.stageName, STAGE_SHAPE), SWAP_ERRORS.names],
    [() => typeof run === "function", SWAP_ERRORS.run],
  ].find(([passes]) => !passes());
  if (failure) throw new Error(failure[1]);

  const { pointId, stageName } = names;
  return {
    relativePath,
    livePath,
    engineSwap: {
      pointId,
      stageName,
      ...swapLocations(live, points, names),
      beforeBeside: engineBeforeBesidePath(live, pointId),
      run,
      onDone,
    },
  };
}
