// Реестр моделей студии оружия: записи из всех источников с постоянным id,
// слоты (варианты одного ствола вместе) и поиск.

export const MODEL_SOURCES = Object.freeze(["builtin", "catalog", "game", "gunpack", "custom", "server"]);

// Обычный объект: имена свойств любого объекта (toString, constructor) тоже «известны».
// Подписи на всех языках интерфейса (uk, de, pl, fr — как в словаре окна).
const SOURCE_LABELS = {
  builtin: { ru: "Как в игре", en: "Stock", uk: "Як у грі", de: "Wie im Spiel", pl: "Jak w grze", fr: "Comme dans le jeu" },
  catalog: { ru: "Из каталога", en: "From the catalog", uk: "З каталогу", de: "Aus dem Katalog", pl: "Z katalogu", fr: "Du catalogue" },
  game: { ru: "Из игры", en: "From the game", uk: "З гри", de: "Aus dem Spiel", pl: "Z gry", fr: "Du jeu" },
  gunpack: { ru: "Из ганпака", en: "From a gunpack", uk: "З ганпака", de: "Aus dem Gunpack", pl: "Z gunpacka", fr: "Du gunpack" },
  custom: { ru: "Своя модель", en: "Your own", uk: "Власна модель", de: "Eigenes Modell", pl: "Własny model", fr: "Modèle personnalisé" },
  server: { ru: "С сервера", en: "From the server", uk: "З сервера", de: "Vom Server", pl: "Z serwera", fr: "Du serveur" },
};

// Место варианта в слоте: меньше — раньше. Тело персонажа — раньше всех.
const SOURCE_RANK = new Map([
  ["builtin", 0],
  ["catalog", 1],
  ["server", 1.5],
  ["game", 2],
  ["gunpack", 3],
  ["custom", 4],
]);
const BODY_RANK = -1;

const LIMIT = 120;
const VARIANT_KEY_LIMIT = 64;
const URL_LIMIT = 2048;
const DIRECTORY_LIMIT = 4096;
const HASH_LENGTH = 64;
const CUSTOM_PREFIX = "own-";
const CUSTOM_NAME = "Своя модель";
const SLOT_PREFIXES = ["weapon-", "weapon_"];
const SLOT_EXTENSIONS = [".glb", ".gltf", ".ydr", ".ytd", ".zip"];

// Счётчик своих моделей без хеша — одно состояние на модуль.
let customSequence = 0;

function clean(value, limit = LIMIT) {
  return (value == null ? "" : String(value)).trim().slice(0, limit);
}

const isLowerLatin = (ch) => ch >= "a" && ch <= "z";
const isDigit = (ch) => ch >= "0" && ch <= "9";
const isLowerHex = (ch) => isDigit(ch) || (ch >= "a" && ch <= "f");

function isFileHash(value) {
  return typeof value === "string" && value.length === HASH_LENGTH && [...value].every(isLowerHex);
}

// Только свои ключи таблицы: «constructor» и «toString» — не источники, а неизвестный
// источник подписывается как штатный.
export function sourceLabel(source, language = "ru") {
  const labels = Object.hasOwn(SOURCE_LABELS, source) ? SOURCE_LABELS[source] : SOURCE_LABELS.builtin;
  return labels[language] ?? labels.ru;
}

// «w_» + две латинские буквы + «_» в начале.
function hasWeaponPrefix(text) {
  return text.startsWith("w_") && isLowerLatin(text[2] ?? "") && isLowerLatin(text[3] ?? "") && text[4] === "_";
}

export function normalizeSlot(value) {
  let slot = clean(value).toLowerCase();
  const weaponWord = SLOT_PREFIXES.find((prefix) => slot.startsWith(prefix));
  if (weaponWord) slot = slot.slice(weaponWord.length);
  if (hasWeaponPrefix(slot)) slot = slot.slice(5);
  const extension = SLOT_EXTENSIONS.find((ext) => slot.endsWith(ext));
  if (extension) slot = slot.slice(0, -extension.length);
  return [...slot].filter((ch) => isLowerLatin(ch) || isDigit(ch)).join("");
}

// Целое не меньше нуля: строка «7» — число 7, а не начало текста «71».
export function resetCustomSequence(value = 0) {
  customSequence = Math.max(0, Math.trunc(Number(value))) || 0;
}

export function createModelEntry(fields) {
  const { source } = fields;
  if (!MODEL_SOURCES.includes(source)) throw new Error(`Неизвестный источник модели: ${source}`);
  const key = clean(fields.key || fields.weaponId || fields.name);
  if (!key) throw new Error("У модели нет ключа.");

  const packId = clean(fields.packId);
  const variantKey = clean(fields.variantKey, VARIANT_KEY_LIMIT);
  const id = source === "gunpack" ? `gunpack:${packId}:${variantKey ? `${variantKey}:` : ""}${key}` : `${source}:${key}`;

  const entry = {
    id,
    source,
    key,
    name: clean(fields.name) || key,
    slot: normalizeSlot(fields.slot) || normalizeSlot(fields.weaponId) || normalizeSlot(key),
    weaponId: clean(fields.weaponId),
    family: clean(fields.family),
    type: clean(fields.type),
    url: clean(fields.url, URL_LIMIT),
    preview: clean(fields.preview, URL_LIMIT),
    packId,
    packName: clean(fields.packName),
    packDirectory: clean(fields.packDirectory, DIRECTORY_LIMIT),
    zip: clean(fields.zip),
    library: fields.library === "studio" ? "studio" : "",
    variantKey,
    vertices: Number(fields.vertices) || 0,
    materials: Number(fields.materials) || 0,
    variant: Number.isInteger(fields.variant) && fields.variant >= 0 ? fields.variant : null,
    body: Boolean(fields.body),
  };
  if (fields.gender === "female" || fields.gender === "male") entry.gender = fields.gender;
  return Object.freeze(entry);
}

export function createCustomModel({ name, url = "", slot = "", vertices = 0, hash = "" }) {
  let key;
  let fallbackName;
  if (isFileHash(hash)) {
    key = `${CUSTOM_PREFIX}${hash}`;
    fallbackName = CUSTOM_NAME;
  } else {
    customSequence = customSequence + 1;
    key = `${CUSTOM_PREFIX}${customSequence}`;
    fallbackName = `${CUSTOM_NAME} ${customSequence}`;
  }
  return createModelEntry({
    source: "custom",
    key,
    name: clean(name) || fallbackName,
    slot: slot || key,
    url,
    vertices,
  });
}

export function customModelHash(entry) {
  if (entry?.source !== "custom" || typeof entry.key !== "string") return "";
  const { key } = entry;
  if (!key.startsWith(CUSTOM_PREFIX)) return "";
  const hash = key.slice(CUSTOM_PREFIX.length);
  return isFileHash(hash) ? hash : "";
}

// Пак из «Моих паков»: варианты и их стволы.
function studioPackModels(pack) {
  const packId = clean(pack.id);
  const several = pack.variants.length > 1;
  const models = [];
  for (const variant of pack.variants) {
    const packName = several ? `${clean(pack.name)} · ${clean(variant.label)}`.trim() : clean(pack.name) || packId;
    for (const weapon of variant.weapons || []) {
      if (!weapon?.model || weapon.kind === "parts") continue;
      models.push(
        createModelEntry({
          source: "gunpack",
          library: "studio",
          key: weapon.model,
          slot: weapon.model,
          weaponId: weapon.model,
          name: weapon.name || weapon.model,
          family: weapon.family || "",
          packId,
          packName,
          variantKey: variant.key || "",
        }),
      );
    }
  }
  return models;
}

// Прежняя нативная библиотека: категории с архивом или ссылкой на модель.
function legacyPackModels(pack) {
  const packId = clean(pack.id || pack.name);
  const packName = clean(pack.name) || packId;
  return (pack.categories || [])
    .filter((category) => category && (category.zip || category.gltfUrl || category.url))
    .map((category) =>
      createModelEntry({
        source: "gunpack",
        key: category.baseName || category.displayName,
        name: category.displayName || category.baseName,
        slot: category.baseName || category.displayName,
        weaponId: category.baseName,
        url: category.gltfUrl || category.url || "",
        preview: category.previewUrl || "",
        packId,
        packName,
        packDirectory: pack.directory,
        zip: category.zip,
      }),
    );
}

export function gunpackModels(pack) {
  if (!pack) return [];
  return Array.isArray(pack.variants) ? studioPackModels(pack) : legacyPackModels(pack);
}

function variantRank(entry) {
  return entry.body ? BODY_RANK : SOURCE_RANK.get(entry.source);
}

function groupSlots(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const slot = entry.slot || entry.key;
    if (!groups.has(slot)) groups.set(slot, []);
    groups.get(slot).push(entry);
  }
  const slots = [...groups].map(([slot, variants]) => {
    // Без ранга сравнение даёт NaN — такой вариант остаётся на месте.
    variants.sort((a, b) => variantRank(a) - variantRank(b));
    const [first] = variants;
    return {
      slot,
      name: first.name,
      family: first.family,
      type: first.type,
      preview: variants.find((variant) => variant.preview)?.preview || "",
      variants,
    };
  });
  return slots.sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

export function buildModelRegistry({ builtin = [], catalog = [], game = [], packs = [], custom = [], server = [] } = {}) {
  const packModels = packs.map((pack) => gunpackModels(pack));
  const entries = [...builtin, ...game, ...catalog, ...server, ...packModels.flat(), ...custom];
  return {
    entries,
    slots: groupSlots(entries),
    byId: new Map(entries.map((entry) => [entry.id, entry])),
    packs: packs.map((pack, i) => ({
      id: clean(pack?.id || pack?.name),
      name: clean(pack?.name),
      models: packModels[i].length,
    })),
  };
}

export function findModel(registry, id) {
  return registry?.byId?.get(id) ?? null;
}

export function findSlot(registry, id) {
  const slots = registry?.slots ?? [];
  return slots.find((slot) => slot.variants.some((variant) => variant.id === id)) ?? null;
}

function variantMatches(variant, query) {
  return [variant.name, variant.packName, variant.weaponId, variant.key].some(
    (field) => field && field.toLowerCase().includes(query),
  );
}

export function searchModels(registry, query) {
  const needle = clean(query).toLowerCase();
  if (!needle) return registry.slots;
  return registry.slots
    .map((slot) => ({ ...slot, variants: slot.variants.filter((variant) => variantMatches(variant, needle)) }))
    .filter((slot) => slot.variants.length);
}
