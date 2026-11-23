/*
 * Маршрутизация записей редукса по классам (R6, проект `docs/INSTALL-RUST-REDUX.md`, раздел 3.1).
 *
 * Редукс — карточка из нескольких подписанных частей; каждая часть кладёт записи в `update.rpf` (новые контейнеры слоя
 * Astral, замены записей корня, правки внутри штатных вложенных архивов). Включение и выключение редукса — смена
 * оглавления `update.rpf` (`switch-rpf-layers`), а такое делается не со всякой записью. Поэтому записи делятся:
 *
 *   D         новый контейнер слоя `x64/astral/<имя>.rpf/<запись>` — самая тяжёлая часть редукса (карты, модели,
 *             текстуры). Ложится в свой dlc `astral_redux_<id>`, который пишется один раз; включение — строка в
 *             `dlclist.xml`. Контейнер с `_manifest.ymf` остаётся в `update.rpf` (вопрос 2 проекта: манифест в dlc по
 *             записи хоста мест ронял игру), пока слово `manifestInDlc` не скажет иначе.
 *   U-switch  запись корня `update.rpf` целиком (замена или добавление), реестры `content.xml` и `dlclist.xml` и записи с
 *             merge-стратегией (тело собирается из слоёв нескольких модов): малый слой дозаписью; общие записи — через
 *             список `registry` движка. Переключается: слово записи «до» остаётся в файле.
 *   U-linked  всё, что сменой оглавления не переключается: правка внутри существующего вложенного архива, снятие записи,
 *             штатные и свои dlc мастерской как цель, контейнер с `_manifest.ymf`. Идёт прежним путём.
 *
 * Модуль чистый: без диска, без движка, без состояния. Видимых пользователю строк нет: у каждого вердикта слово-причина.
 */

export const REDUX_CLASSES = Object.freeze({ D: "D", SWITCH: "U-switch", LINKED: "U-linked" });

/** Общие записи корня, которые собирает вызывающий из включённых слоёв (`registry` движка). */
export const REDUX_REGISTRY_ENTRIES = Object.freeze(["content.xml", "common/data/dlclist.xml"]);

const UPDATE_TARGETS = new Set(["update/update.rpf", "mods/update/update.rpf"]);
const ACTIONS = new Set(["replace", "import", "upsert"]);
/* Имя контейнера слоя Astral: как проверяет регистрация в `content.xml` (`mergeAstralContentXml`). */
const CONTAINER = /^x64\/astral\/([a-z0-9][a-z0-9._-]{0,119}\.rpf)\/(.+)$/;
const OWN_DLC_TARGET = /^update\/x64\/dlcpacks\/astral_[a-z0-9_]+\/dlc\.rpf$/;
const STOCK_DLC_TARGET = /^update\/x64\/dlcpacks\/[a-z0-9_]+\/dlc\.rpf$/;
const MANIFEST = "_manifest.ymf";

const pathOf = (value) =>
  String(value ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+/, "")
    .toLowerCase();

/** Первый вложенный архив в пути записи (звено `.rpf`, не последнее): `{ archive, inner }` или `null`. */
function nestedOf(entry) {
  const segments = entry.split("/");
  const at = segments.findIndex((segment, index) => index < segments.length - 1 && segment.endsWith(".rpf"));
  if (at < 0) return null;
  return { archive: segments.slice(0, at + 1).join("/"), inner: segments.slice(at + 1).join("/") };
}

/** Запись в контейнере слоя Astral: `{ archive, name, inner }` (всё строчными) или `null`. */
export function reduxContainerOf(entry) {
  const match = CONTAINER.exec(pathOf(entry));
  return match ? { archive: `x64/astral/${match[1]}`, name: match[1], inner: match[2] } : null;
}

const verdict = (kind, reason, extra = {}) => ({ class: kind, reason, shared: false, registry: false, ...extra });

/**
 * Класс одной записи манифеста: `{ target, entry, action, merge? }`.
 *
 * `options.baseHasArchive(путь)` — есть ли такой вложенный архив в основе игры (путь строчными). Без него любой вложенный
 * архив вне слоя Astral считается штатным (осторожно: запись уйдёт прежним путём).
 * `options.manifestInDlc` — контейнеры с `_manifest.ymf` тоже в dlc (только после проверки в игре); на запись по отдельности
 * это не влияет, слово работает в `routeReduxFiles`.
 */
export function classifyReduxFile(file, options = {}) {
  const target = pathOf(file?.target);
  const entry = pathOf(file?.entry);
  const action = String(file?.action ?? "replace").trim().toLowerCase();
  if (!UPDATE_TARGETS.has(target)) {
    if (OWN_DLC_TARGET.test(target)) return verdict(REDUX_CLASSES.LINKED, "own-dlc");
    if (STOCK_DLC_TARGET.test(target)) return verdict(REDUX_CLASSES.LINKED, "stock-dlc");
    return verdict(REDUX_CLASSES.LINKED, "other-target");
  }
  if (!entry) return verdict(REDUX_CLASSES.LINKED, "entry");
  const container = reduxContainerOf(entry);
  const own = container ? { container: container.archive, name: container.name, inner: container.inner } : {};
  if (action === "delete") return verdict(REDUX_CLASSES.LINKED, "delete", own);
  if (!ACTIONS.has(action)) return verdict(REDUX_CLASSES.LINKED, "action", own);
  const nested = nestedOf(entry);
  if (!nested) {
    const archiveBody = entry.endsWith(".rpf");
    if (REDUX_REGISTRY_ENTRIES.includes(entry)) return verdict(REDUX_CLASSES.SWITCH, "registry", { shared: true, registry: true, archiveBody });
    if (file?.merge) return verdict(REDUX_CLASSES.SWITCH, "merge", { shared: true, archiveBody });
    return verdict(REDUX_CLASSES.SWITCH, "root-record", { archiveBody });
  }
  if (container) {
    if (container.inner.split("/").slice(0, -1).some((segment) => segment.endsWith(".rpf"))) {
      return verdict(REDUX_CLASSES.LINKED, "nested-too-deep", own);
    }
    if (options.baseHasArchive?.(container.archive)) return verdict(REDUX_CLASSES.LINKED, "container-exists", own);
    return verdict(REDUX_CLASSES.D, "own-container", own);
  }
  if (typeof options.baseHasArchive !== "function") return verdict(REDUX_CLASSES.LINKED, "inside-archive");
  return verdict(REDUX_CLASSES.LINKED, options.baseHasArchive(nested.archive) ? "inside-stock-archive" : "new-archive");
}

const byName = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

/**
 * Разложить все записи редукса по классам.
 *
 * Контейнер слоя либо целиком в dlc, либо целиком остаётся: часть контейнера в dlc не лежит. Контейнер уходит прежним
 * путём, если в нём есть `_manifest.ymf` (без `manifestInDlc`) или хоть одна запись, которой в dlc не место (снятие,
 * вложенный архив глубже одного уровня, контейнер уже есть в основе).
 *
 * @returns {{
 *   perFile: object[], classes: string[], d: { container, name, files: { index, file, inner }[] }[],
 *   switch: { index, file, shared, registry, archiveBody, reason }[], linked: { index, file, reason }[],
 *   containers: { path, name, class, reason, files }[], counts: object, reasons: object, switchable: boolean }}
 */
export function routeReduxFiles(files, options = {}) {
  if (!Array.isArray(files)) throw new TypeError("Redux routes: files is a list.");
  const perFile = files.map((file, index) => ({ index, ...classifyReduxFile(file, options) }));

  // Контейнеры слоя: решение принимается по контейнеру, а не по записи.
  const groups = new Map();
  perFile.forEach((item, index) => {
    if (!item.container) return;
    if (!groups.has(item.container)) groups.set(item.container, []);
    groups.get(item.container).push(index);
  });
  const containers = [];
  for (const [path, indexes] of groups) {
    const manifest = !options.manifestInDlc && indexes.some((index) => perFile[index].inner === MANIFEST);
    const blocked = indexes.find((index) => perFile[index].class === REDUX_CLASSES.LINKED && perFile[index].reason !== "manifest-ymf");
    for (const index of indexes) {
      const item = perFile[index];
      if (manifest && (item.class === REDUX_CLASSES.D || item.inner === MANIFEST)) {
        Object.assign(item, verdict(REDUX_CLASSES.LINKED, "manifest-ymf", { container: item.container, name: item.name, inner: item.inner }));
      } else if (blocked !== undefined && item.class === REDUX_CLASSES.D) {
        Object.assign(item, verdict(REDUX_CLASSES.LINKED, "container-linked", { container: item.container, name: item.name, inner: item.inner }));
      }
    }
    const left = indexes.find((index) => perFile[index].class !== REDUX_CLASSES.D);
    containers.push({
      path,
      name: path.slice(path.lastIndexOf("/") + 1),
      class: left === undefined ? REDUX_CLASSES.D : REDUX_CLASSES.LINKED,
      reason: left === undefined ? "own-container" : perFile[left].reason,
      files: indexes.length,
    });
  }
  containers.sort((left, right) => byName(left.name, right.name));

  const d = [];
  const switched = [];
  const linked = [];
  const reasons = {};
  const dGroups = new Map();
  for (const item of perFile) {
    reasons[item.reason] = (reasons[item.reason] ?? 0) + 1;
    const file = files[item.index];
    if (item.class === REDUX_CLASSES.D) {
      if (!dGroups.has(item.container)) dGroups.set(item.container, { container: item.container, name: item.name, files: [] });
      dGroups.get(item.container).files.push({ index: item.index, file, inner: item.inner });
    } else if (item.class === REDUX_CLASSES.SWITCH) {
      switched.push({ index: item.index, file, shared: item.shared, registry: item.registry, archiveBody: item.archiveBody, reason: item.reason });
    } else {
      linked.push({ index: item.index, file, reason: item.reason });
    }
  }
  d.push(...[...dGroups.values()].sort((left, right) => byName(left.name, right.name)));
  const counts = {
    [REDUX_CLASSES.D]: d.reduce((total, group) => total + group.files.length, 0),
    [REDUX_CLASSES.SWITCH]: switched.length,
    [REDUX_CLASSES.LINKED]: linked.length,
  };
  return { perFile, classes: perFile.map((item) => item.class), d, switch: switched, linked, containers, counts, reasons, switchable: linked.length === 0 };
}

// ---------------------------------------------------------------------------------------------------------------------
// Деление на dlc
// ---------------------------------------------------------------------------------------------------------------------

const ALIGN = 512;
/* Голова архива не меньше сектора; на каждую запись — строка оглавления и место в блоке имён (с запасом). */
const HEAD_BYTES = 512;
const ROW_BYTES = 80;

/** Оценка длины архива по записям `{ size }`: голова, тела по 512 и запас на строку. Только для деления и для `expectBytes`. */
export function estimateReduxArchiveBytes(entries) {
  let total = HEAD_BYTES;
  for (const entry of entries ?? []) total += Math.ceil(Math.max(0, Number(entry?.size) || 0) / ALIGN) * ALIGN + ROW_BYTES;
  return total;
}

/**
 * Разложить контейнеры D по dlc: по порядку имён (порядок автора `NNN` идёт первым), контейнер не режется, новый dlc — когда
 * следующий контейнер не влезает в бюджет. Контейнер, который не влезает и один, — отказ `CONTAINER_TOO_LARGE`.
 *
 * @param {{ name: string, entries: { size: number }[] }[]} containers
 * @param {{ budgetBytes?: number }} [options]
 * @returns {object[][]} список dlc, в каждом — контейнеры
 */
export function splitReduxPacks(containers, { budgetBytes = 3_300_000_000 } = {}) {
  const sorted = [...(containers ?? [])].sort((left, right) => byName(left.name, right.name));
  const packs = [];
  let current = [];
  let used = 0;
  for (const container of sorted) {
    const bytes = estimateReduxArchiveBytes(container.entries);
    if (bytes > budgetBytes) {
      const error = new Error(`Redux routes: ${container.name} does not fit one dlc.`);
      error.code = "CONTAINER_TOO_LARGE";
      throw error;
    }
    if (current.length > 0 && used + bytes > budgetBytes) {
      packs.push(current);
      current = [];
      used = 0;
    }
    current.push(container);
    used += bytes;
  }
  if (current.length > 0) packs.push(current);
  return packs;
}
