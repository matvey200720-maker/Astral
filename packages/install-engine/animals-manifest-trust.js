import { createHash } from "node:crypto";

/*
 * Животные — облик животных игры в своём контейнере слоя (05.11.2026).
 *
 * Редактор «Животные» кладёт в игру файлы животных базовой игры (`x64e.rpf`, `a_c_*`) под их же именами: игра берёт
 * контейнеры `update.rpf` раньше базовых архивов, и файл слоя заменяет одноимённый файл базовой игры.
 *   • `<животное>.ytd` и `<животное>/<часть>_diff_… .ytd` — листы цвета (перекраска): пиксели те же по размеру, формату и
 *     числу ступеней, имена листов не меняются;
 *   • `<животное>.ydd` и `<животное>/<часть>.ydd` — модель тела с меткой над животным и/или светящейся оболочкой (новая
 *     геометрия, скинованная на корневую кость). Скелет, физика и столкновения лежат в `.yft` — их пакет не несёт и
 *     принять не может: хитбокс животного остаётся прежним.
 * Контейнер — `x64/astral/astral_animals.rpf`, свой, чтобы животные ставились и снимались порознь от других работ.
 *
 * Строгая форма: только такие файлы, только у животных базовой игры, каждый по разу, ни одного лишнего. Список животных
 * скопирован сюда нарочно, чтобы проверку нельзя было ослабить правкой чужого пакета; совпадение со списком окна держит тест.
 * Символ доверия предъявить может только install-engine.
 */
export const LOCAL_ANIMALS_TRUST = Symbol("local-animals-package");

export const ANIMALS_CONTAINER = "x64/astral/astral_animals.rpf";
export const ANIMALS_SLOT = "animals";
export const ANIMALS_SCHEMA = 1;

/* Животные базовой игры, которых можно ставить: пакеты дополнений грузятся после слоя, и их файлы слой не перекроет. */
export const ANIMAL_BASE_IDS = Object.freeze([
  "a_c_boar",
  "a_c_cat_01",
  "a_c_chickenhawk",
  "a_c_chimp",
  "a_c_chop",
  "a_c_cormorant",
  "a_c_cow",
  "a_c_coyote",
  "a_c_crow",
  "a_c_deer",
  "a_c_dolphin",
  "a_c_fish",
  "a_c_hen",
  "a_c_humpback",
  "a_c_husky",
  "a_c_killerwhale",
  "a_c_mtlion",
  "a_c_pig",
  "a_c_pigeon",
  "a_c_poodle",
  "a_c_pug",
  "a_c_rabbit_01",
  "a_c_rat",
  "a_c_retriever",
  "a_c_rhesus",
  "a_c_rottweiler",
  "a_c_seagull",
  "a_c_sharkhammer",
  "a_c_sharktiger",
  "a_c_shepherd",
  "a_c_stingray",
  "a_c_westy",
  "a_c_whalegrey",
]);

/* Потоковые животные (собаки, пума, тигровая акула): тело — папкой с частями; остальные — четыре файла в корне. */
export const ANIMAL_STREAMED_IDS = Object.freeze([
  "a_c_chop",
  "a_c_husky",
  "a_c_mtlion",
  "a_c_retriever",
  "a_c_rottweiler",
  "a_c_sharktiger",
  "a_c_shepherd",
]);

const PART_NAME = /^(?:accs|head|hair|lowr|teef|uppr)_(?:diff_)?\d{3}(?:_[a-z0-9]{1,3}){0,2}\.(?:ytd|ydd)$/;
const MAX_RESOURCE_BYTES = 16 * 1024 * 1024;

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
  "animals",
  "files",
]);
const ANIMALS_KEYS = Object.freeze(["schemaVersion", "sourceDigest", "resourceCount"]);
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

const versionOf = (suffix) => `${ANIMALS_SCHEMA}.0.0-${suffix}`;
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Имя файла в контейнере допустимо: у обычного животного — `<id>.ytd|ydd`, у потокового — `<id>/<часть>`.
 * Регистр строчный (игра ищет запись по имени строчными).
 */
export function isAnimalFileName(name) {
  const text = String(name || "");
  const slash = text.indexOf("/");
  if (slash < 0) {
    const match = /^(a_c_[a-z0-9_]+)\.(?:ytd|ydd)$/.exec(text);
    return Boolean(match) && ANIMAL_BASE_IDS.includes(match[1]) && !ANIMAL_STREAMED_IDS.includes(match[1]);
  }
  const folder = text.slice(0, slash);
  const part = text.slice(slash + 1);
  return ANIMAL_STREAMED_IDS.includes(folder) && !part.includes("/") && PART_NAME.test(part);
}

/**
 * Хэш содержимого: отсортированные пары `имя\nsha256`. Одинаковый облик даёт один и тот же id пакета, и повторное
 * «Применить» с тем же обликом архив игры не пересобирает.
 */
export function animalsDigest(files) {
  const lines = files.map((file) => `${file.name}\n${file.sha256}`).sort(byName);
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

export const isAnimalsModId = (value) => /^local-legacy-animals-[a-f0-9]{12}$/.test(String(value || ""));

/** Манифест животных из описи собранных файлов `{ name, size, sha256 }`. */
export function buildAnimalsManifest(files) {
  const digest = animalsDigest(files);
  const suffix = digest.slice(0, 12);
  return {
    id: `local-legacy-animals-${suffix}`,
    version: versionOf(suffix),
    name: "Животные Astral",
    editions: ["Legacy"],
    scope: "game-root",
    adapter: "rpf-entry",
    requiresLoader: false,
    /* Метка над животным показывает игроку, где зверь, — это видно в мире, а не интерфейс окна. */
    gameplayChanges: true,
    capabilities: [...CAPABILITIES],
    slots: [ANIMALS_SLOT],
    animals: {
      schemaVersion: ANIMALS_SCHEMA,
      sourceDigest: `sha256:${digest}`,
      resourceCount: files.length,
    },
    files: [...files].sort((a, b) => byName(a.name, b.name)).map((file) => ({
      source: `payload/${file.name}`,
      target: "update/update.rpf",
      action: "import",
      entry: `${ANIMALS_CONTAINER}/${file.name}`,
      merge: { strategy: "rpf-resource-layer-v1" },
      size: file.size,
      sha256: file.sha256,
    })),
  };
}

export function isLocalAnimalsManifest(manifest, edition) {
  // Fail-closed: любое несовпадение с эталонной формой — false без деталей.
  if (String(edition || "").toLowerCase() !== "legacy") return false;
  if (!hasExactKeys(manifest, MANIFEST_KEYS)) return false;
  if (!hasExactKeys(manifest.animals, ANIMALS_KEYS)) return false;
  const idMatch = /^local-legacy-animals-([a-f0-9]{12})$/.exec(manifest.id);
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
  if (JSON.stringify(manifest.slots) !== JSON.stringify([ANIMALS_SLOT])) return false;
  if (manifest.animals.schemaVersion !== ANIMALS_SCHEMA) return false;
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.animals.sourceDigest || "")) return false;

  const files = manifest.files;
  if (!Array.isArray(files) || files.length < 1 || files.length > 400) return false;
  if (manifest.animals.resourceCount !== files.length) return false;
  const seen = new Set();
  const digestInput = [];
  for (const file of files) {
    if (!hasExactKeys(file, FILE_KEYS)) return false;
    if (typeof file.source !== "string" || !file.source.startsWith("payload/")) return false;
    const name = file.source.slice("payload/".length);
    if (!isAnimalFileName(name) || seen.has(name)) return false;
    seen.add(name);
    if (file.target !== "update/update.rpf") return false;
    if (file.action !== "import") return false;
    if (file.entry !== `${ANIMALS_CONTAINER}/${name}`) return false;
    if (!hasExactKeys(file.merge, ["strategy"])) return false;
    if (file.merge.strategy !== "rpf-resource-layer-v1") return false;
    if (!Number.isInteger(file.size) || file.size < 1 || file.size > MAX_RESOURCE_BYTES) return false;
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || "")) return false;
    digestInput.push({ name, sha256: file.sha256 });
  }

  // id, версия и digest связаны одним хэшем содержимого: подделать одно поле без остальных нельзя.
  const digest = animalsDigest(digestInput);
  if (manifest.animals.sourceDigest !== `sha256:${digest}`) return false;
  if (suffix !== digest.slice(0, 12)) return false;
  return true;
}
