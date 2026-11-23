import { SERVER_PRESET_MAP, ZONE_TEMPLATE_MAP, markerTier } from "./catalog.js";
import { LABEL_SET_MAP, ZONE_SET_MAP, renameDistrictZones } from "./label-sets.js";
import { applyServerPreset, normalizeWorldMap } from "./model.js";

export const MAP_SET_FORMAT = "astral-world-map-layer";

const FILE_VERSION = 2;
const LIMIT = { title: 60, slug: 28, fallback: 40 };
const SET_SECTIONS = ["zones", "markers"];
const NOT_A_SET_SECTION = "Наборы бывают только у зон и обозначений.";

// ---- маленькие помощники ----

const through = (value, ...steps) => steps.reduce((acc, step) => step(acc), value);
const merge = (...parts) => parts.reduce((acc, part) => ({ ...acc, ...part }), {});
const omit = (record, key) =>
  Object.fromEntries(Object.entries(record ?? {}).filter(([name]) => name !== String(key)));
const joined = (...lists) => lists.flatMap((list) => [...list]);
const need = (ok, message) => {
  if (!ok) throw new Error(message);
};

// Правка раздела таблицей «поле → как получить новое значение из старого».
const revise = (value, rules) =>
  merge(
    value,
    Object.fromEntries(Object.entries(rules).map(([field, rule]) => [field, rule(value[field])])),
  );
const withSection = (config, section, rules) =>
  merge(config, { [section]: revise(config[section], rules) });

// Общая процедура раздела: нормализовать, поправить раздел, нормализовать снова.
const editSection = (config, section, rules) =>
  SET_SECTIONS.includes(section)
    ? through(normalizeWorldMap(config), (current) =>
        normalizeWorldMap(withSection(current, section, rules)),
      )
    : normalizeWorldMap(config);

const sameGroup = (wanted) => ({ group }) => (group || "") === (wanted || "");
const notInGroup = (wanted) => (item) => !sameGroup(wanted)(item);
const when = (test, change) => (item) => (test(item) ? change(item) : item);

// Имя то в списке, то нет; порядок и повторы — как у множества.
const flip = (names, key, present) =>
  [...new Set(present ? [...names, key] : names)].filter((name) => present || name !== key);

// ---- ключ, имена, виды ----

export const groupKey = (group) => group || "own";

export const LEGACY_GROUP_TITLES = Object.freeze(
  Object.fromEntries([
    ["cat-places", "Места и ориентиры"],
    ["cat-roads", "Дороги, мосты и тоннели"],
    ["cat-gov", "Госструктуры"],
    ["cat-work", "Работы и промзоны"],
    ["cat-business", "Бизнесы и аренда"],
    ["cat-homes", "Дома и жильё"],
    ["cat-crime-majestic", "Majestic: капты, респы, гансопы"],
    ["cat-crime-gta5rp", "GTA 5 RP: гетто, кишки, бетонки, ЛГ"],
    ["cat-events", "ВЗП, ВЗХ и мероприятия"],
    ["cat-climb", "Залазы и объекты"],
    ["cat-misc", "Прочее"],
  ]),
);

export const EMPTY_GROUP_STYLE = Object.freeze(
  Object.fromEntries([
    ["font", ""],
    ["scale", 100],
    ["color", ""],
    ["weight", ""],
    ["outline", null],
    ["outlineColor", ""],
    ["caps", false],
    ["spacing", 0],
    ["lineStep", null],
    ["fillMode", ""],
    ["fillOpacity", null],
    ["strokeWidth", null],
    ["strokeAlign", ""],
    ["glow", null],
    ["dotScale", 100],
  ]),
);

// Откуда берётся имя набора; первое «истинное» побеждает.
const TITLE_SOURCES = [
  (group, titles) => titles[group],
  (group) => LABEL_SET_MAP[group]?.title,
  (group) => ZONE_SET_MAP[group]?.title,
  (group) => ZONE_TEMPLATE_MAP[group]?.title,
  (group) => SERVER_PRESET_MAP[group] && `${SERVER_PRESET_MAP[group].title} · точки`,
  (group) => LEGACY_GROUP_TITLES[group],
];

export const mapGroupTitle = (group, titles = {}) =>
  group
    ? TITLE_SOURCES.reduce((found, source) => found || source(group, titles), "") || group
    : "Свои";

const listIn = (section, field) => section?.[field] || [];

export const mapGroupVisible = (section, group) =>
  !listIn(section, "hiddenGroups").includes(groupKey(group));

export const mapGroupLocked = (section, group) =>
  listIn(section, "lockedGroups").includes(groupKey(group));

export const mapGroupStyle = (section, group) =>
  merge(EMPTY_GROUP_STYLE, section?.groupStyles?.[groupKey(group)]);

const LOOK_FIELDS = ["fillMode", "fillOpacity", "strokeWidth", "strokeAlign", "glow"];
const blank = (value) => [null, undefined, ""].includes(value);

export const zoneGroupLook = (zones, group) => {
  const style = zones?.groupStyles?.[groupKey(group)];
  return Object.fromEntries(
    LOOK_FIELDS.map((field) => [field, blank(style?.[field]) ? zones?.[field] : style[field]]),
  );
};

// ---- перечень наборов раздела ----

const summarize = (value) => {
  const [hidden, locked] = [value.hiddenGroups, value.lockedGroups].map(
    (names) => new Set(names || []),
  );
  const counts = [...value.items].reduce(
    (acc, { group }) => acc.set(group || "", (acc.get(group || "") ?? 0) + 1),
    new Map(),
  );
  return [...counts].map(([id, count]) => ({
    id,
    title: mapGroupTitle(id, value.groupTitles),
    count,
    visible: !hidden.has(groupKey(id)),
    locked: locked.has(groupKey(id)),
  }));
};

export const mapGroups = (config, section) => {
  const { [section]: value } = normalizeWorldMap(config);
  return value ? summarize(value) : [];
};

// ---- включение, закрепление, правка ----

const listEditor = (field, listedWhen) => (config, section, group, flag) =>
  editSection(config, section, {
    [field]: (names) => flip(names, groupKey(group), listedWhen(flag)),
  });

export const setMapGroupVisible = listEditor("hiddenGroups", (visible) => !visible);
export const setMapGroupLocked = listEditor("lockedGroups", Boolean);

export const patchMapGroup = (config, section, group, patch) =>
  editSection(config, section, {
    items: (items) => items.map(when(sameGroup(group), (item) => merge(item, patch))),
  });

export const setMapGroupStyle = (config, section, group, patch) =>
  editSection(config, section, {
    groupStyles: (styles) =>
      merge(styles, { [groupKey(group)]: merge(styles[groupKey(group)], patch) }),
  });

// ---- подписи набора «для всех» ----

const filled = (value) => ![null, undefined, "", false].includes(value);

// Что стирается у подписей, если правка вида набора перебивает их своё значение.
const ERASURES = [
  [
    (patch) => filled(patch.color),
    (item) => ({ labelColor: null, ...(item.dot ? {} : { color: null }) }),
  ],
  [(patch) => filled(patch.font), () => ({ font: "" })],
  [(patch) => filled(patch.weight), () => ({ weight: "" })],
  [(patch) => typeof patch.caps === "boolean", () => ({ caps: null })],
  [(patch) => typeof patch.outline === "number", () => ({ labelOutline: null })],
  [(patch) => filled(patch.outlineColor), () => ({ labelOutlineColor: null })],
];

// Какие поля убираются из оттенков меша (подписи донора).
const TINT_DROPS = [
  ["color", (patch) => filled(patch.color)],
  ["outlineColor", (patch) => filled(patch.outlineColor)],
];

const tintsWithout = (tints, drops) =>
  Object.fromEntries(
    Object.entries(tints)
      .map(([key, tint]) => [key, drops.reduce(omit, tint)])
      .filter(([, tint]) => Object.keys(tint).length),
  );

const eraseOwnLabelLook = (item, patch) => {
  const erased = merge(
    item,
    ...ERASURES.filter(([test]) => test(patch)).map(([, erase]) => erase(item)),
  );
  const drops = TINT_DROPS.filter(([, test]) => test(patch)).map(([field]) => field);
  if (!item.meshTints || !drops.length) return erased;
  const kept = tintsWithout(item.meshTints, drops);
  return Object.keys(kept).length ? merge(erased, { meshTints: kept }) : omit(erased, "meshTints");
};

export const setMapGroupLabelStyle = (config, group, patch) =>
  editSection(setMapGroupStyle(config, "markers", group, patch), "markers", {
    items: (items) => items.map(when(sameGroup(group), (item) => eraseOwnLabelLook(item, patch))),
  });

// ---- убрать, поставить ----

export const removeMapGroup = (config, section, group) =>
  editSection(config, section, {
    hiddenGroups: (names) => names.filter((name) => name !== groupKey(group)),
    groupTitles: (titles) => omit(titles, group),
    groupStyles: (styles) => omit(styles, groupKey(group)),
    items: (items) => items.filter(notInGroup(group)),
  });

// Постановка предметов набора: прежние предметы набора заменяются, набор показывается.
const putSet = (config, section, group, items) =>
  editSection(config, section, {
    enabled: () => true,
    hiddenGroups: (names) => names.filter((name) => name !== group),
    items: (old) => joined(
      old.filter(({ group: owner }) => (owner || "") !== group),
      items,
    ),
  });

// Категории, которые встретились у новых точек, снова включаются.
const enableCategories = (config, items) =>
  normalizeWorldMap(
    withSection(config, "markers", {
      categories: (known) =>
        joined(items).reduce((dict, { category }) => {
          if (dict[category]) dict[category] = merge(dict[category], { enabled: true });
          return dict;
        }, merge(known)),
    }),
  );

export const placeMapGroup = (config, section, group, items, { title = "", style = null } = {}) =>
  through(
    putSet(config, section, group, items),
    (put) => (section === "markers" ? enableCategories(put, items) : put),
    (placed) =>
      editSection(placed, section, {
        groupTitles: (titles) => (title ? merge(titles, { [group]: title }) : titles),
        groupStyles: (styles) =>
          style
            ? merge(omit(styles, group), { [groupKey(group)]: style })
            : omit(styles, groupKey(group)),
      }),
  );

// ---- свои наборы ----

export const ownSetGroup = (id) => `my-${id}`;

const numbered = (group) => (item, index) =>
  merge(item, { id: `${group}-${index + 1}`, group });

export const ownSetItems = ({ id, items }) => items.map(numbered(ownSetGroup(id)));

// ---- наборы из каталога ----

const templateZones = (template, names) =>
  renameDistrictZones(template.zones, names).map((zone) =>
    merge(zone, { group: template.id, enabled: zone.enabled !== false, label: true }),
  );

// Зоны заготовки районов как предметы набора (для пустой заготовки наборов нет).
const templateFactory = (group, options) => {
  const template = ZONE_TEMPLATE_MAP[group];
  return template?.zones?.length
    ? { items: templateZones(template, options.names), style: null }
    : null;
};

// Что различает разделы наборов: каталог, выдача предметов и вида, дополнительный шаг.
const SET_KINDS = new Map([
  [
    "markers",
    {
      catalog: LABEL_SET_MAP,
      itemsOf: (set, options) => set.items(options),
      styleOf: (set) => set.style,
      after: enableCategories,
      absent: () => null,
    },
  ],
  [
    "zones",
    {
      catalog: ZONE_SET_MAP,
      itemsOf: (set) => set.zones(),
      styleOf: (set) => set.look,
      after: (config) => config,
      absent: templateFactory,
    },
  ],
]);

const applyCatalogSet = (section, config, setId, options) => {
  const { catalog, itemsOf, styleOf, after } = SET_KINDS.get(section);
  const set = catalog[setId];
  if (!set) return normalizeWorldMap(config);
  const items = itemsOf(set, options);
  const style = styleOf(set);
  const placed = after(putSet(config, section, set.id, items), items);
  return style ? setMapGroupStyle(placed, section, set.id, style) : placed;
};

export const applyLabelSet = (config, setId, options = {}) =>
  applyCatalogSet("markers", config, setId, options);

export const applyZoneSet = (config, setId) => applyCatalogSet("zones", config, setId);

// ---- заводской вид набора ----

export const mapGroupFactory = (section, group, options = {}) => {
  const own = (options.own || []).find(
    (entry) => entry.kind === section && ownSetGroup(entry.id) === group,
  );
  if (own) return { items: ownSetItems(own), style: own.style || null };
  const kind = SET_KINDS.get(section);
  const set = kind?.catalog[group];
  if (!set) return kind ? kind.absent(group, options) : null;
  return { items: kind.itemsOf(set, options), style: kind.styleOf(set) || null };
};

const storedOf = (map, section, group) => ({
  items: map[section].items.filter(sameGroup(group)),
  style: map[section].groupStyles[groupKey(group)] || null,
});

export const mapGroupPristine = (config, section, group, options = {}) => {
  const factory = mapGroupFactory(section, group, options);
  if (!factory) return false;
  const patch = options.patch || null;
  const current = normalizeWorldMap(config);
  const fresh = normalizeWorldMap(
    withSection(current, section, {
      items: () => (patch ? factory.items.map((item) => merge(item, patch)) : factory.items),
      groupStyles: () => (factory.style ? { [groupKey(group)]: factory.style } : {}),
    }),
  );
  const [now, wanted] = [current, fresh].map((map) =>
    JSON.stringify(storedOf(normalizeWorldMap(map), section, group)),
  );
  return now === wanted;
};

export const resetMapGroup = (config, section, group, options = {}) => {
  const factory = mapGroupFactory(section, group, options);
  return factory
    ? editSection(config, section, {
        groupStyles: (styles) =>
          merge(
            omit(styles, groupKey(group)),
            factory.style && { [groupKey(group)]: factory.style },
          ),
        items: (items) => {
          const rest = items.filter(notInGroup(group));
          const at = items.findIndex(sameGroup(group));
          return rest.toSpliced(at < 0 ? rest.length : at, 0, ...factory.items);
        },
      })
    : normalizeWorldMap(config);
};

// ---- профиль сервера и заготовки районов ----

const setTemplateMark = (mark) => (config) =>
  normalizeWorldMap(withSection(config, "zones", { template: () => mark }));

const renamedZones = (names) => (config) =>
  normalizeWorldMap(
    withSection(config, "zones", { items: (items) => renameDistrictZones(items, names) }),
  );

// Категории выбранных ярусов выключаются.
const hideTiers = (tiers) => (config) =>
  normalizeWorldMap(
    withSection(config, "markers", {
      categories: (known) =>
        Object.fromEntries(
          Object.entries(known).map(([id, category]) => [
            id,
            tiers.includes(markerTier(id)) ? merge(category, { enabled: false }) : category,
          ]),
        ),
    }),
  );

export const applyServerProfile = (config, presetId, options = {}) => {
  const base = applyServerPreset(config, presetId);
  const preset = SERVER_PRESET_MAP[presetId];
  return through(
    base,
    ...[
      options.names && renamedZones(options.names),
      ...(preset?.labelSets || []).map((id) => (map) => applyLabelSet(map, id, options)),
      ...(preset?.zoneSets || []).map((id) => (map) => applyZoneSet(map, id)),
      preset?.zonesHidden &&
        preset.zoneTemplate &&
        ((map) => setMapGroupVisible(map, "zones", preset.zoneTemplate, false)),
      preset?.hiddenTiers?.length && hideTiers(preset.hiddenTiers),
    ].filter(Boolean),
  );
};

export const applyZoneTemplateSet = (config, templateId, options = {}) => {
  const template = ZONE_TEMPLATE_MAP[templateId];
  if (!template) return normalizeWorldMap(config);
  return template.zones.length
    ? through(
        putSet(config, "zones", template.id, templateZones(template, options.names)),
        setTemplateMark(template.id),
      )
    : through(
        normalizeWorldMap(config),
        ...Object.keys(ZONE_TEMPLATE_MAP).map((id) => (map) => removeMapGroup(map, "zones", id)),
        setTemplateMark("none"),
      );
};

// ---- файлы ----

export const exportMapGroup = (config, section, group) => {
  const value = normalizeWorldMap(config)[section];
  need(value, NOT_A_SET_SECTION);
  return {
    format: MAP_SET_FORMAT,
    version: FILE_VERSION,
    layer: section,
    set: { id: groupKey(group), title: mapGroupTitle(group, value.groupTitles) },
    items: value.items.filter(sameGroup(group)),
  };
};

const isAsciiAlnum = (ch) => /^[0-9A-Za-z]$/.test(ch);

// Расширение файла: точка и от одной до пяти латинских букв и цифр в конце.
const stripExtension = (name) => {
  const parts = name.split(".");
  const tail = parts.at(-1);
  const fits = tail.length >= 1 && tail.length <= 5;
  return parts.length > 1 && fits && [...tail].every(isAsciiAlnum)
    ? parts.slice(0, -1).join(".")
    : name;
};

// Знаки слага: латиница, цифры, кириллица а–я и ё.
const isSlugChar = (ch) => /^[a-z0-9а-яё]$/.test(ch);

const slugOf = (text) =>
  [...stripExtension(String(text || "").toLowerCase())]
    .map((ch) => (isSlugChar(ch) ? ch : " "))
    .join("")
    .split(" ")
    .filter(Boolean)
    .join("-")
    .slice(0, LIMIT.slug) || "set";

// Название набора из файла и ключ, под которым ему кладётся группа.
const namingOf = (payload, options) => {
  const fileTitle = stripExtension(String(options.fileName || "")).trim();
  const title = String(payload?.set?.title || fileTitle || "Набор из файла").slice(0, LIMIT.title);
  const rawId = payload?.set?.id;
  const fromSet = rawId && String(rawId) !== "own" ? String(rawId) : "";
  const fallback = `file-${slugOf(fromSet || title)}`.slice(0, LIMIT.fallback);
  return { title, fromSet, fallback };
};

export const importMapGroup = (config, section, payload, options = {}) => {
  const listed = [payload?.items, payload].find(Array.isArray);
  need(listed, "Файл не похож на набор карты.");
  const layer = SET_SECTIONS.includes(payload.layer) ? payload.layer : section;
  need(SET_SECTIONS.includes(layer), NOT_A_SET_SECTION);

  const { title, fromSet, fallback } = namingOf(payload, options);
  const items = listed
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const group = fromSet ? fallback : String(item.group || "") || fallback;
      return merge(item, { group, id: `${group}-${index + 1}` });
    });
  const owned = new Set(items.map(({ group }) => group));

  const merged = through(normalizeWorldMap(config), (current) =>
    normalizeWorldMap(
      withSection(current, layer, {
        enabled: () => true,
        hiddenGroups: (names) => names.filter((name) => !owned.has(name)),
        groupTitles: (titles) => merge(titles, { [fallback]: title }),
        items: (old) => joined(old.filter(({ group }) => !owned.has(group)), items),
      }),
    ),
  );
  const count = merged[layer].items.filter(({ group }) => owned.has(group)).length;
  need(count, "В файле не нашлось ни одного пригодного объекта.");
  return {
    config: layer === "markers" ? enableCategories(merged, items) : merged,
    section: layer,
    title,
    count,
  };
};
