import { groupKey, mapGroups, ownSetGroup, ownSetItems, placeMapGroup } from "./groups.js";
import { normalizeWorldMap } from "./model.js";

// Хранилище окна берёт эти два имени отсюда, а не из groups.js.
export { ownSetGroup, ownSetItems };

export const OWN_SET_LIMIT = 5000;

const NAME_LIMIT = 40;
const STRIP_LIMIT = 8;
const SET_SECTIONS = ["markers", "zones"];
// Ключи подписей вида по разделам: их сохраняют в записи и кладут обратно.
const LABEL_KEYS = {
  markers: ["labelColor", "labelOutlineColor", "labelOutline"],
  zones: ["labelColor", "labelOutline"],
};
// Эти поля предмета в записи набора не хранятся: их выдаёт ownSetItems заново.
const ITEM_ONLY_KEYS = ["id", "group", "locked", "iconAssetId"];

// Допустимый id записи: «own-» и от 4 до 40 знаков из строчных латинских букв, цифр и дефиса.
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789-";
const ID_PREFIX = "own-";
const ID_TAIL = [4, 40];

const MESSAGES = {
  setSection: "Свой набор бывает только у подписей и зон.",
  setName: "Назовите набор.",
  setPick: "Отметьте хотя бы один набор.",
  lookName: "Назовите вид.",
  lookImage: "Вид из своей картинки не сохранить: картинка лежит только в этом проекте.",
};

const patch = (base, changes) => ({ ...base, ...changes });
const demand = (ok, message) => {
  if (!ok) throw new Error(message);
};

const isObject = (value) => value !== null && typeof value === "object";
const sameJson = (...pair) => new Set(pair.map((value) => JSON.stringify(value))).size === 1;

function pickKeys(source, keys) {
  const out = {};
  for (const key of keys) out[key] = source[key];
  return out;
}

function dropKeys(source, names) {
  const out = {};
  for (const [key, value] of Object.entries(source)) {
    if (!names.includes(key)) out[key] = value;
  }
  return out;
}


const validId = (id) => {
  const text = String(id);
  const tail = text.slice(ID_PREFIX.length);
  return (
    text.startsWith(ID_PREFIX) &&
    tail.length >= ID_TAIL[0] &&
    tail.length <= ID_TAIL[1] &&
    [...tail].every((char) => ID_ALPHABET.includes(char))
  );
};

// Годный id остаётся, иначе записи выдаётся новый.
export const newOwnId = () => ["own", Date.now().toString(36), Math.random().toString(36).slice(2, 8)].join("-");
const recordId = (id) => (validId(id) ? id : newOwnId());

const isHexText = (value) => /^#[\da-f]{6}$/i.test(String(value || ""));

export const cleanOwnName = (value) => String(value || "").split(/\s+/).filter(Boolean).join(" ").slice(0, NAME_LIMIT);

export const ownSetOfGroup = (group) => /^my-(own-[^]*)/.exec(String(group || ""))?.[1] ?? null;

// Запись набора или вида годна, если у неё верный id и непустое имя.
const identify = (value) => {
  const id = isObject(value) ? String(value.id || "") : "";
  const name = isObject(value) ? cleanOwnName(value.name) : "";
  return validId(id) && name ? { id, name } : null;
};

const savedAtOf = (value) => String(value.savedAt || "");

// ---------- запекание отличий набора в подпись или зону ----------

const styleScales = (...styles) => styles.map((style) => style.scale || 100);

// Правила «когда → что записать в предмет»; own — стиль набора предмета, main — стиль главного набора.
const BAKE_RULES = {
  markers: [
    [(item) => !item.font, (item, { own, main, font }) => ({ font: own.font || (main.font ? font : "") })],
    [(item, { own }) => !item.weight && own.weight, (item, { own }) => ({ weight: own.weight })],
    [(item, { own }) => !item.labelColor && own.color, (item, { own }) => ({ labelColor: own.color })],
    [
      (item, { own, main }) => item.caps == null && own.caps !== (main.caps || false),
      (item, { own }) => ({ caps: Boolean(own.caps) }),
    ],
    [
      (item, { own, main }) => styleScales(own, main).reduce((a, b) => a / b) !== 1,
      (item, { own, main }) => ({
        labelScale: Math.round(
          Math.min(300, Math.max(40, (item.labelScale || 100) * styleScales(own, main).reduce((a, b) => a / b))),
        ),
      }),
    ],
  ],
  zones: [
    [
      (item, { own, main }) => item.width == null && own.strokeWidth != null && own.strokeWidth !== main.strokeWidth,
      (item, { own }) => ({ width: own.strokeWidth }),
    ],
    [(item, { own, main }) => own.fillOpacity === 0 && main.fillOpacity !== 0, () => ({ fill: false })],
  ],
};

const bake = (section, item, context) =>
  BAKE_RULES[section].reduce((baked, [when, then]) => (when(item, context) ? patch(baked, then(item, context)) : baked), item);

// ---------- свой набор ----------

// Наборы раздела, которые человек отметил; пустая строка — свои предметы без набора.
const chosenGroups = (project, section, groups) => {
  const wanted = (groups || []).map((group) => group || "");
  return mapGroups(project, section).filter(({ id }) => wanted.includes(id));
};

export const captureOwnSet = (config, section, groups, options = {}) => {
  const { id = "", name = "" } = options;
  demand(SET_SECTIONS.includes(section), MESSAGES.setSection);
  const title = cleanOwnName(name);
  demand(title, MESSAGES.setName);

  const project = normalizeWorldMap(config);
  const chosen = chosenGroups(project, section, groups);
  demand(chosen.length, MESSAGES.setPick);

  const data = project[section];
  const items = data.items.filter(({ group }) => chosen.some(({ id: pickedId }) => pickedId === group));
  demand(items.length <= OWN_SET_LIMIT, `В наборе ${items.length} — в свой набор помещается до ${OWN_SET_LIMIT}. Отметьте меньше.`);

  // Главный набор — самый большой; при ничьей — тот, что раньше в проекте.
  const biggest = Math.max(...chosen.map(({ count }) => count));
  const styleOf = (group) => ({ ...data.groupStyles[groupKey(group)] });
  const main = styleOf(chosen.find(({ count }) => count === biggest).id);
  const bakeOne = (item) => {
    const own = styleOf(item.group);
    return sameJson(own, main) ? item : bake(section, item, { own, main, font: data.font });
  };

  return normalizeOwnSet({
    id: recordId(id),
    kind: section,
    name: title,
    items: items.map(bakeOne),
    style: Object.keys(main).length === 0 ? null : main,
    savedAt: new Date().toISOString(),
  });
};

// Предметы записи, которые пережили нормализатор, и стиль их группы.
const settleSet = (kind, id, rawItems, style) => {
  const group = ownSetGroup(id);
  const section = normalizeWorldMap({
    [kind]: {
      items: ownSetItems({ id, items: rawItems }),
      groupStyles: isObject(style) ? { [group]: style } : {},
    },
  })[kind];
  return { items: section.items, style: section.groupStyles[group] || null };
};

export const normalizeOwnSet = (value) => {
  const who = identify(value);
  const kind = who && value.kind;
  if (!SET_SECTIONS.includes(kind) || !Array.isArray(value.items)) return null;

  const { items, style } = settleSet(kind, who.id, value.items.slice(0, OWN_SET_LIMIT).filter(isObject), value.style);
  const stored = Object.freeze(items.map((item) => dropKeys(item, ITEM_ONLY_KEYS)));
  return items.length
    ? Object.freeze({ id: who.id, kind, name: who.name, items: stored, style, savedAt: savedAtOf(value) })
    : null;
};

export const applyOwnSet = (config, entry) => {
  const { kind, name, style } = entry;
  const placed = placeMapGroup(config, kind, ownSetGroup(entry.id), ownSetItems(entry), { title: name, style });
  return normalizeWorldMap(patch(placed, { [kind]: patch(placed[kind], { enabled: true }) }));
};

// ---------- свой вид ----------

export const ownLookBlocked = (config) =>
  (normalizeWorldMap(config).base.source === "image" && MESSAGES.lookImage) || "";

const labelsOf = (project) =>
  Object.fromEntries(Object.entries(LABEL_KEYS).map(([section, keys]) => [section, pickKeys(project[section], keys)]));

export const captureOwnLook = (config, options = {}) => {
  const { id = "", name = "", strip = [] } = options;
  const title = cleanOwnName(name);
  demand(title, MESSAGES.lookName);
  const blocked = ownLookBlocked(config);
  demand(!blocked, blocked);

  const project = normalizeWorldMap(config);
  // Своя картинка-подложка и картинка-текстура живут в проекте, не в записи.
  const base = patch(project.base, {
    imageAssetId: "",
    ...(project.base.textureId === "image" && { textureId: "none", textureAssetId: "" }),
  });
  const { template, pauseMap } = project;
  return normalizeOwnLook({
    id: recordId(id),
    name: title,
    base,
    template,
    pauseMap,
    labels: labelsOf(project),
    strip,
    savedAt: new Date().toISOString(),
  });
};

export const normalizeOwnLook = (value) => {
  const who = identify(value);
  if (!who || !isObject(value.base)) return null;

  const { base, template, pauseMap, labels, strip, savedAt } = { ...value, savedAt: savedAtOf(value) };
  const project = normalizeWorldMap({
    base,
    template,
    pauseMap,
    markers: patch({}, labels?.markers),
    zones: patch({}, labels?.zones),
  });
  const colors = Array.isArray(strip) ? strip.filter(isHexText).slice(0, STRIP_LIMIT) : [];
  const { id, name } = who;

  return project.base.source === "image"
    ? null
    : Object.freeze({
        id,
        name,
        base: project.base,
        template: project.template,
        pauseMap: project.pauseMap,
        labels: labelsOf(project),
        strip: Object.freeze(colors),
        savedAt,
      });
};

export const applyOwnLook = (config, entry) => {
  const { base, template, pauseMap, labels } = entry;
  const project = normalizeWorldMap(config);
  const relabelled = (section) => patch(project[section], labels[section]);
  return normalizeWorldMap(
    patch(project, { base, template, pauseMap, markers: relabelled("markers"), zones: relabelled("zones") }),
  );
};

export const ownLookActive = (config, entry) => {
  const { base, template } = normalizeWorldMap(config);
  return sameJson(base, entry.base || {}) && template === entry.template;
};
