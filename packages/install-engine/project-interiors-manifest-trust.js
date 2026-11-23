import { createHash } from "node:crypto";

/*
 * «Интерьеры проектов» (ТЗ 17.10.2026, вечер, задача 10, фаза 3) — интерьер
 * из файлов игрока в одиночную игру, каждый в своём контейнере слоя.
 *
 * Интерьеры Majestic и GTA 5 РП Astral не везёт: ни одного байта чужих
 * моделей в поставке нет. Ставятся файлы, что лежат у самого игрока (папка
 * или сборка, которую он выбрал), — модели, словари, коллизии, типы, карта
 * размещения и `_manifest.ymf`, — и в `update.rpf` его же копии игры. Каждый
 * интерьер — свой контейнер `x64/astral/astral_proj_<номер>.rpf` со своим
 * манифестом: `_manifest.ymf` в контейнере один, и интерьеры не должны
 * делить его друг с другом и с другими работами Astral (см.
 * `manifest-containers.js`).
 *
 * Форма доверия здесь НЕ закрытый список имён, как у прострелов: набор файлов
 * зависит от пака, который выбрал человек. Поэтому доверие идёт по описи
 * имён самого пака, а не по списку из поставки, и держится на четырёх вещах:
 *
 *   1. запись пишется только в контейнер `astral_proj_<номер>.rpf` того же
 *      интерьера, чей номер записан в манифесте — больше никуда;
 *   2. имена — строчными, без вложенных папок (единственный особый символ —
 *      `hi@` в начале имени коллизии высокой детализации), из закрытого
 *      набора расширений моделей, словарей, коллизий, типов и карт; `hei_*` (файлы
 *      карты, что игра берёт только из своей группы) не пишутся вовсе;
 *   3. интерьер — комплект: ровно один `_manifest.ymf`, хотя бы один тип, одна
 *      карта и одна модель, а имя любого файла встречается во всех
 *      интерьерах манифеста один раз (два интерьера с одной моделью
 *      перекрыли бы друг друга в игре);
 *   4. опись связана с id и версией хэшем: подделать имя, размер или
 *      содержимое файла, не сменив id пакета, нельзя.
 *
 * Что имя не пересекается с файлами самой игры, этот модуль знать не может —
 * игры у него нет. Это держит сборщик установки (`project-interiors/install.js`)
 * по оглавлению игры игрока до сборки пакета; здесь это дополнительно записано
 * в тестах-отказах и в списке для ревьюера (docs/interior-editor).
 *
 * Список ограничений скопирован сюда нарочно — как у прострелов: проверку
 * нельзя ослабить правкой чужого пакета. Символ доверия предъявить может
 * только install-engine.
 */
export const LOCAL_PROJECT_INTERIORS_TRUST = Symbol("local-project-interiors-package");

export const PROJECT_INTERIORS_SLOT = "project-interiors";
export const PROJECT_INTERIORS_SCHEMA = 1;

/* Не больше интерьеров за раз: у игроков update.rpf уже 3 ГБ из 4. */
export const PROJECT_INTERIORS_MAX_UNITS = 24;
export const PROJECT_INTERIORS_MAX_FILES_PER_UNIT = 400;
/* Движок принимает до 5 000 файлов в пакете; интерьеры укладываются в половину. */
export const PROJECT_INTERIORS_MAX_FILES = 2400;
export const PROJECT_INTERIORS_MAX_FILE_BYTES = 160 * 1024 * 1024;
export const PROJECT_INTERIORS_MAX_TOTAL_BYTES = 900 * 1024 * 1024;

export const PROJECT_INTERIOR_EXTENSIONS = Object.freeze(["ydr", "ydd", "yft", "ytd", "ybn", "ycd", "ytyp", "ymap", "ymf"]);
export const PROJECT_INTERIOR_MANIFEST_FILE = "_manifest.ymf";

const MODEL_EXTENSIONS = Object.freeze(["ydr", "ydd", "yft"]);
const UNIT_ID = /^p[0-9a-f]{8}$/;
/* Имя записи: строчные, без папок; ведущее подчёркивание — только у `_manifest.ymf`; `hi@` в начале — коллизия высокой детализации (`hi@shelter.ybn`). */
const FILE_NAME = /^(?:hi@)?[a-z0-9_][a-z0-9._+~-]{0,119}$/;
/* Файлы карты (`hei_*`) игра берёт только из своей группы; `hei_prop_*` — обычные вещи. */
const GROUP_MAP_NAME = /^hei_(?!prop_)/;

const MANIFEST_KEYS = Object.freeze([
  "id",
  "version",
  "name",
  "editions",
  "scope",
  "adapter",
  "requiresLoader",
  "gameplayChanges",
  "capabilities",
  "slots",
  "projectInteriors",
  "files",
]);
const BLOCK_KEYS = Object.freeze(["schemaVersion", "sourceDigest", "interiors"]);
const UNIT_KEYS = Object.freeze(["id", "files"]);
const FILE_KEYS = Object.freeze(["source", "target", "action", "entry", "merge", "size", "sha256"]);
const CAPABILITIES = Object.freeze([
  "rpf-container-entry-v1",
  "astral-content-rpf-v1",
  "direct-update-rpf-v1",
  "direct-update-entries-v1",
]);

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const hasExactKeys = (value, keys) =>
  isPlainObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const versionOf = (suffix) => `${PROJECT_INTERIORS_SCHEMA}.0.0-${suffix}`;
const extensionOf = (name) => name.slice(name.lastIndexOf(".") + 1);

/** Контейнер интерьера: `p0123abcd` → `x64/astral/astral_proj_0123abcd.rpf`. */
export const projectInteriorContainer = (id) => `x64/astral/astral_proj_${String(id).slice(1)}.rpf`;

export const isProjectInteriorId = (value) => UNIT_ID.test(String(value || ""));

export const isProjectInteriorsModId = (value) => /^local-legacy-projint-[a-f0-9]{12}$/.test(String(value || ""));

/** Годится ли имя файла интерьера для записи в контейнер. */
export function isProjectInteriorFileName(name) {
  const value = String(name || "");
  if (!FILE_NAME.test(value)) return false;
  if (value.startsWith("_") && value !== PROJECT_INTERIOR_MANIFEST_FILE) return false;
  if (!PROJECT_INTERIOR_EXTENSIONS.includes(extensionOf(value))) return false;
  /* `.ymf` в контейнере — только его собственный манифест. */
  if (extensionOf(value) === "ymf" && value !== PROJECT_INTERIOR_MANIFEST_FILE) return false;
  return !GROUP_MAP_NAME.test(value);
}

/**
 * Хэш содержимого: отсортированные пары `номер/имя\nsha256`. Тот же набор
 * интерьеров в том же облике даёт тот же id пакета, и повторное «Применить»
 * архив игры не пересобирает.
 */
export function projectInteriorsDigest(units) {
  const lines = units
    .flatMap((unit) => unit.files.map((file) => `${unit.id}/${file.name}\n${file.sha256}`))
    .sort(compare);
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

/**
 * Манифест из описи собранных файлов: `units` — `[{ id, files: [{ name, size,
 * sha256 }] }]`. Порядок интерьеров и файлов значения не имеет.
 */
export function buildProjectInteriorsManifest(units) {
  const sorted = [...units]
    .map((unit) => ({ id: unit.id, files: [...unit.files].sort((a, b) => compare(a.name, b.name)) }))
    .sort((a, b) => compare(a.id, b.id));
  const digest = projectInteriorsDigest(sorted);
  const suffix = digest.slice(0, 12);
  return {
    id: `local-legacy-projint-${suffix}`,
    version: versionOf(suffix),
    name: "Интерьеры проектов Astral",
    editions: ["Legacy"],
    scope: "game-root",
    adapter: "rpf-entry",
    requiresLoader: false,
    // Новый интерьер в мире — с коллизией и местом на карте, а не косметика.
    gameplayChanges: true,
    capabilities: [...CAPABILITIES],
    slots: [PROJECT_INTERIORS_SLOT],
    projectInteriors: {
      schemaVersion: PROJECT_INTERIORS_SCHEMA,
      sourceDigest: `sha256:${digest}`,
      interiors: sorted.map((unit) => ({ id: unit.id, files: unit.files.length })),
    },
    files: sorted.flatMap((unit) =>
      unit.files.map((file) => ({
        source: `payload/${unit.id}/${file.name}`,
        target: "update/update.rpf",
        action: "import",
        entry: `${projectInteriorContainer(unit.id)}/${file.name}`,
        merge: { strategy: "rpf-resource-layer-v1" },
        size: file.size,
        sha256: file.sha256,
      })),
    ),
  };
}

export function isLocalProjectInteriorsManifest(manifest, edition) {
  // Fail-closed: любое несовпадение с эталонной формой — false без деталей.
  if (String(edition || "").toLowerCase() !== "legacy") return false;
  if (!hasExactKeys(manifest, MANIFEST_KEYS)) return false;
  if (!hasExactKeys(manifest.projectInteriors, BLOCK_KEYS)) return false;
  const idMatch = /^local-legacy-projint-([a-f0-9]{12})$/.exec(manifest.id);
  if (!idMatch) return false;
  const suffix = idMatch[1];
  if (manifest.version !== versionOf(suffix)) return false;
  if (typeof manifest.name !== "string" || !manifest.name.trim() || manifest.name.length > 120) return false;
  if (JSON.stringify(manifest.editions) !== JSON.stringify(["Legacy"])) return false;
  if (manifest.scope !== "game-root") return false;
  if (manifest.adapter !== "rpf-entry") return false;
  if (manifest.requiresLoader !== false) return false;
  if (manifest.gameplayChanges !== true) return false;
  if (JSON.stringify(manifest.capabilities) !== JSON.stringify(CAPABILITIES)) return false;
  if (JSON.stringify(manifest.slots) !== JSON.stringify([PROJECT_INTERIORS_SLOT])) return false;
  const block = manifest.projectInteriors;
  if (block.schemaVersion !== PROJECT_INTERIORS_SCHEMA) return false;
  if (!/^sha256:[a-f0-9]{64}$/.test(block.sourceDigest || "")) return false;

  /* Интерьеры: по возрастанию номера, каждый по разу, у каждого — своё число файлов. */
  const interiors = block.interiors;
  if (!Array.isArray(interiors) || !interiors.length || interiors.length > PROJECT_INTERIORS_MAX_UNITS) return false;
  const declared = new Map();
  let previous = "";
  for (const unit of interiors) {
    if (!hasExactKeys(unit, UNIT_KEYS)) return false;
    if (typeof unit.id !== "string" || !UNIT_ID.test(unit.id) || unit.id <= previous) return false;
    if (!Number.isInteger(unit.files) || unit.files < 1 || unit.files > PROJECT_INTERIORS_MAX_FILES_PER_UNIT) return false;
    previous = unit.id;
    declared.set(unit.id, unit.files);
  }

  const files = manifest.files;
  if (!Array.isArray(files) || !files.length || files.length > PROJECT_INTERIORS_MAX_FILES) return false;
  if (files.length !== [...declared.values()].reduce((sum, count) => sum + count, 0)) return false;

  const perUnit = new Map([...declared.keys()].map((id) => [id, { names: new Set(), kinds: new Set(), manifests: 0 }]));
  const everyName = new Set();
  const digestInput = new Map([...declared.keys()].map((id) => [id, []]));
  const seen = new Set();
  let total = 0;
  for (const file of files) {
    if (!hasExactKeys(file, FILE_KEYS)) return false;
    if (typeof file.source !== "string") return false;
    /* `payload/<номер>/<имя>`: номер — из манифеста, имя — без вложений. */
    const parts = file.source.split("/");
    if (parts.length !== 3 || parts[0] !== "payload") return false;
    const [, id, name] = parts;
    const unit = perUnit.get(id);
    if (!unit) return false;
    if (!isProjectInteriorFileName(name)) return false;
    const key = `${id}/${name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (file.target !== "update/update.rpf") return false;
    if (file.action !== "import") return false;
    if (file.entry !== `${projectInteriorContainer(id)}/${name}`) return false;
    if (!hasExactKeys(file.merge, ["strategy"])) return false;
    if (file.merge.strategy !== "rpf-resource-layer-v1") return false;
    if (!Number.isInteger(file.size) || file.size < 1 || file.size > PROJECT_INTERIORS_MAX_FILE_BYTES) return false;
    total += file.size;
    if (total > PROJECT_INTERIORS_MAX_TOTAL_BYTES) return false;
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || "")) return false;

    if (name === PROJECT_INTERIOR_MANIFEST_FILE) unit.manifests += 1;
    else {
      /* Имя модели, словаря, типа или карты — в игре одно на всё: два интерьера с одним именем перекрыли бы друг друга. */
      if (everyName.has(name)) return false;
      everyName.add(name);
    }
    unit.kinds.add(MODEL_EXTENSIONS.includes(extensionOf(name)) ? "model" : extensionOf(name));
    unit.names.add(name);
    digestInput.get(id).push({ name, sha256: file.sha256 });
  }

  for (const [id, unit] of perUnit) {
    if (unit.names.size !== declared.get(id)) return false;
    if (unit.manifests !== 1) return false;
    if (!unit.kinds.has("ytyp") || !unit.kinds.has("ymap") || !unit.kinds.has("model")) return false;
  }

  // id, версия и опись связаны одним хэшем содержимого.
  const digest = projectInteriorsDigest([...digestInput].map(([id, list]) => ({ id, files: list })));
  if (block.sourceDigest !== `sha256:${digest}`) return false;
  if (suffix !== digest.slice(0, 12)) return false;
  return true;
}
