/*
 * Оглавление одежды игры заранее (31.10.2026, ТЗ лида: «первое открытие категории ≤ 1 с, индекс строится в фоне после старта, в простое, в потоке чтения игры»).
 *
 * Оглавление (`game-clothing-index.js`) собирается раз на версию игры: 94 архива дополнений, 72 МБ магазинных файлов — 1,0–1,2 с процессора при 1× (было 2,3 с, до быстрого разбора) и
 * втрое больше у слабого ПК. Раньше его первым строило открытие категории — прямо в главном процессе. Теперь:
 *  - открытие категории читает готовое (25 мс) в потоке чтения;
 *  - после старта приложение само ставит работу в очередь: через `delayMs`, когда нет записи в игру и не запущена GTA V, поток читателя читает оглавление; пока кэш свежий —
 *    работа сводится к сверке отпечатка (5 мс);
 *  - если человек открыл полку раньше (`noteClothingIndexDemand`), прогрев не начинается: оглавление построит сам запрос; если прогрев уже идёт, запрос ждёт его конца
 *    (`clothingIndexWarmupSettled`), а не строит то же вторым потоком.
 * Работа идёт в своём потоке (этот модуль, лёгкий: без моделей и сцены), который закрывается через минуту простоя.
 */

/** Папка игры для оглавления — как у `pickGameRoot` (`game-clothing-items.js`): Legacy из найденных, иначе первая; модуль не тянет модели одежды в главный процесс. */
export const warmGameRoot = (games) => (games.find((item) => item.edition === "Legacy") || games[0])?.path || "";

/**
 * Нужно ли запросу персонажа оглавление одежды игры (15.11.2026): оно нужно, только когда в запросе есть вещь игры — главная или в комплекте (список категории строится из оглавления). Тело без вещей,
 * тело с вещами каталога, «одеть» без надетого оглавление не читают, и ждать, пока прогрев закончит свои 94 архива (до 20 с на занятом диске), им незачем: так «Тело» стояло на «Читаю вещь из игры».
 */
export function requestNeedsIndex(request) {
  const gameItem = (item) => !item?.manifest && Number.isInteger(Number(item?.variant)) && item?.variant !== null && item?.variant !== "";
  const own = request?.slot !== "tattoos" && request?.bare !== true && gameItem(request);
  const others = Array.isArray(request?.others) ? request.others : [];
  return own || others.some((item) => item?.slot !== "tattoos" && gameItem(item));
}

/**
 * Запросы персонажа, что окно шлёт первыми при входе в мастерскую одежды (15.11.2026): «Тело» без вещей и «одеть» без надетого. Прогрев (`warmWearBase`) собирает их заранее — файлы тела, скелет,
 * дорожка покоя и готовые GLB лежат в кэше, когда человек нажимает на плитку «Одежда». `look` — `{ gender, hair, face }` облика, если он известен.
 */
export function wearBaseRequests(gameRoot, look = {}) {
  const head = { gameRoot, onModel: true, animated: true, hair: Number(look.hair) || 0, face: Number(look.face) || 0, ahead: false, ...(look.gender === "female" ? { gender: "female" } : {}) };
  return [
    { ...head, slot: "tattoos", variant: 0 },
    { ...head, slot: "tshirts", bare: true },
  ];
}

/** В потоке чтения: прочитать оглавление игры (из кэша — сверка отпечатка, иначе построить и записать). */
export async function warmClothingIndexInThread(request, _context, stateDir) {
  const gameRoot = String(request?.gameRoot || "");
  if (!gameRoot) return { status: "no-game" };
  const { readGameClothingIndex } = await import("./game-clothing-index.js");
  const started = performance.now();
  let built = false;
  const index = await readGameClothingIndex(
    { gameRoot, stateDir, keysDirectory: request?.keys || null },
    {
      onBuild: () => {
        built = true;
      },
    },
  );
  return { status: built ? "built" : "ready", ms: Math.round(performance.now() - started), collections: index.collections.length };
}

export const WARMUP_DEFAULTS = Object.freeze({
  /* Через сколько после старта браться за работу: запуск и без того читает архивы и разбирает интерфейс. */
  delayMs: 15_000,
  /* Не вышло сейчас (запись в игру, игра запущена) — когда спросить снова и сколько раз. */
  retryMs: 60_000,
  attempts: 10,
  /* Сколько прогрев ещё может ждать запрос полки, не начиная своё чтение. */
  waitMs: 20_000,
  /* Человек открыл полку не раньше, чем прогрев успел: сколько после этого прогрев не нужен. */
  demandMs: 10 * 60_000,
});

const state = { phase: "idle", timer: null, running: null, demandedAt: -Infinity };

/** Для тестов: вернуть состояние прогрева к начальному. */
export function resetClothingIndexWarmup() {
  clearTimeout(state.timer);
  Object.assign(state, { phase: "idle", timer: null, running: null, demandedAt: -Infinity });
}

/** Состояние прогрева: `idle`, `scheduled`, `running`, `done`. */
export const clothingIndexWarmupPhase = () => state.phase;

/** Оглавление просит человек (полка, «На что поставить?», пары): прогрев, ещё не начатый, ни к чему — оглавление построит сам запрос. */
export function noteClothingIndexDemand(now = Date.now()) {
  state.demandedAt = now;
  if (state.phase === "scheduled") {
    clearTimeout(state.timer);
    state.timer = null;
    state.phase = "idle";
  }
}

/** Прогрев уже идёт — дождаться его конца (не дольше `waitMs`): оглавление тогда лежит в кэше. Не идёт — сразу. */
export async function clothingIndexWarmupSettled(waitMs = WARMUP_DEFAULTS.waitMs) {
  const running = state.running;
  if (state.phase !== "running" || !running) return;
  let timer;
  await Promise.race([running.catch(() => {}), new Promise((resolve) => (timer = setTimeout(resolve, waitMs)))]);
  clearTimeout(timer);
}

/**
 * Поставить прогрев в очередь. Зависимости — данные и функции главного процесса (`main.js`):
 *  `discover()` — найденные игры, `stateDir()` — папка состояния, `canRun()` — можно ли сейчас (нет записи в игру, GTA V не запущена),
 *  `keys()` — папка ключей чтения, если они уже на месте (без скачивания: фон ничего не качает), `run({ gameRoot, keys, stateDir })` — работа в потоке чтения,
 *  `log(entry)` — запись в журнал. Возвращает `{ cancel() }`.
 */
export function startClothingIndexWarmup({
  discover,
  stateDir,
  canRun = () => true,
  keys = defaultKeys,
  run = defaultRun,
  log = () => {},
  nativeContext = null,
  settings = {},
  now = Date.now,
  setTimer = setTimeout,
} = {}) {
  const config = { ...WARMUP_DEFAULTS, ...settings };
  let attempt = 0;
  const finish = (entry) => {
    state.phase = "done";
    state.timer = null;
    state.running = null;
    log(entry);
  };
  const arm = (ms) => {
    state.phase = "scheduled";
    state.timer = setTimer(() => void tick(), ms);
    state.timer?.unref?.();
  };
  async function tick() {
    state.timer = null;
    if (now() - state.demandedAt < config.demandMs) return finish({ level: "info", message: "Оглавление одежды: человек открыл полку раньше, прогрев не нужен." });
    try {
      attempt += 1;
      /* Человек открыл полку, пока мы спрашивали: оглавление построит запрос (`noteClothingIndexDemand` сбросил очередь). */
      const waiting = () => state.phase === "scheduled";
      if (!(await canRun())) {
        if (!waiting()) return;
        if (attempt >= config.attempts) return finish({ level: "info", message: "Оглавление одежды: занято, прогрев не начат." });
        return arm(config.retryMs);
      }
      const gameRoot = warmGameRoot(await discover());
      if (!waiting()) return;
      if (!gameRoot) return finish({ level: "info", message: "Оглавление одежды: игра не найдена." });
      const keysDirectory = await keys();
      if (!waiting()) return;
      if (!keysDirectory) return finish({ level: "info", message: "Оглавление одежды: ключей чтения архивов ещё нет, прогрев не начат." });
      const folder = await stateDir();
      if (!waiting()) return;
      state.phase = "running";
      state.running = Promise.resolve(run({ gameRoot, keys: keysDirectory, stateDir: folder, nativeContext }));
      const result = await state.running;
      finish({ level: "info", message: `Оглавление одежды: ${result?.status === "built" ? "построено" : "готово"} за ${result?.ms ?? "?"} мс.` });
    } catch (error) {
      finish({ level: "warn", message: `Оглавление одежды: прогрев не вышел (${String(error?.message || error).slice(0, 160)}), оно построится при открытии полки.` });
    }
  }
  if (state.phase === "scheduled" || state.phase === "running") return { cancel: () => {} };
  arm(config.delayMs);
  return {
    cancel() {
      clearTimeout(state.timer);
      if (state.phase === "scheduled") Object.assign(state, { phase: "idle", timer: null });
    },
  };
}

/** Ключи чтения архивов, если лежат на месте (по размеру; хеш сверит чтение): фон не качает, как `archiveKeysDirectory` с `provision`. */
async function defaultKeys() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { ARCHIVE_READ_KEY_FILES, archiveSupportDirectory } = await import("./loader-provisioner.js");
  const directory = archiveSupportDirectory();
  for (const { name, size } of ARCHIVE_READ_KEY_FILES) {
    const info = await fs.stat(path.join(directory, name)).catch(() => null);
    if (!info || info.size !== size) return null;
  }
  return directory;
}

/** Работа в потоке чтения: свой лёгкий читатель (этот модуль), закрывается через минуту простоя. */
async function defaultRun({ gameRoot, keys, stateDir, nativeContext }) {
  const { gameReadHostFor } = await import("./game-read-host.js");
  const result = await gameReadHostFor(import.meta.url, nativeContext).callWithTools("warmClothingIndexInThread", [{ gameRoot, keys }, {}, stateDir], null);
  /* Тело и «одеть» — следом, в потоке персонажа, не задерживая конец прогрева (15.11.2026): к первому входу в мастерскую одежды файлы тела, скелет, дорожка покоя и готовые GLB уже на диске. */
  void warmWearBase({ gameRoot, stateDir, nativeContext });
  return result;
}

/** Собрать в потоке персонажа запросы, с которых начинается мастерская одежды (`wearBaseRequests`): по одному, ошибка прогрева ничего не ломает. */
export async function warmWearBase({ gameRoot, stateDir, nativeContext = null, look = {}, host = null }) {
  try {
    const { gameReadHostFor } = await import("./game-read-host.js");
    const reader = host || gameReadHostFor(new URL("./clothing-ahead.js", import.meta.url).href, nativeContext);
    for (const request of wearBaseRequests(gameRoot, look)) await reader.callWithTools("readClothingCharacterAhead", [request, {}, { stateDir }], [2, "tools"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Прогрев с зависимостями главного процесса (`main.js`, где на счету каждая строка): `busy()` — идёт запись в игру или установка, `gameRunning()` — запущена ли GTA V,
 * `installOptions()` — папка состояния, `record(entry)` — журнал; остальное (`run`, `keys`, `setTimer`, `settings`) — подмены тестов.
 */
export function startMainClothingIndexWarmup({ discoverGames, installOptions, busy, gameRunning, nativeContext, record, ...overrides }) {
  return startClothingIndexWarmup({
    discover: discoverGames,
    stateDir: async () => (await installOptions()).stateDir,
    canRun: async () => !busy() && !(await gameRunning().catch(() => false)),
    nativeContext,
    log: record,
    ...overrides,
  });
}
