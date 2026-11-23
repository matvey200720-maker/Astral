import {
  applyLabelSet,
  applyZoneSet,
  applyZoneTemplateSet,
  mapGroupPristine,
  mapGroupTitle,
  mapGroups,
  patchMapGroup,
  removeMapGroup,
  setMapGroupVisible,
} from "./groups.js";
import { DEFAULT_MARKER_SECTION, DEFAULT_ZONES, normalizeWorldMap } from "./model.js";

const SECTIONS = ["zones", "markers"];

const jsonOf = JSON.stringify;
const sameJson = (a, b) => jsonOf(a) === jsonOf(b);
const through = (value, ...steps) => steps.reduce((acc, step) => step(acc), value);
const frozenOf = (pairs) => Object.freeze(Object.fromEntries(pairs));
const perSection = (make) =>
  Object.fromEntries(SECTIONS.map((section) => [section, make(section)]));
const addTo = (lists, section, id) => ({ ...lists, [section]: [...lists[section], id] });

// Общий вид разделов: шаблон ложится поверх него.
const BASE_LOOK = {
  zones: frozenOf([
    ["enabled", true],
    ["fillMode", "recolor"],
    ["fillOpacity", 100],
    ["strokeAlign", "inside"],
    ["strokeWidth", 1.7],
    ["glow", 0],
    ["labels", true],
    ["labelAuto", true],
  ]),
  markers: frozenOf([
    ["enabled", true],
    ["icons", true],
    ["iconSize", 15],
    ["font", "astral"],
    ["labelSize", 16],
    ["letterSpacing", 6],
    ["labelCase", "upper"],
    ["labelAuto", true],
    ["declutter", true],
    ["dotSize", 7],
  ]),
};

const FACTORY = { zones: DEFAULT_ZONES, markers: DEFAULT_MARKER_SECTION };

// Вид «Города» для снятых шаблонов.
const CITY_LOOK = frozenOf([
  ["font", "heavy"],
  ["iconSize", 12],
  ["labelSize", 9.5],
  ["letterSpacing", 2],
  ["dotSize", 5],
]);

export const MARKUP_SERVERS = Object.freeze(
  [
    ["majestic", "Majestic RP"],
    ["gta5rp", "GTA 5 RP"],
  ].map(([id, title]) => Object.freeze({ id, title })),
);

// Строки: id, сервер, вид карточки, заголовок, подсказка, наборы зон, заготовки районов,
// наборы подписей, прежние зоны, прежние подписи.
const TEMPLATE_ROWS = [
  [
    "majestic-mcl", "majestic", "city", "МЦЛ: капты",
    "73 территории, точки каптов, респы и гансопы, госы и крафт в кругах — как на картах МЦЛ",
    ["mcl-territories", "majestic-circles"], [], ["cat-majestic-crime"],
    ["majestic-iskra"], ["majestic-mcl-labels", "cat-crime-majestic"],
  ],
  [
    "majestic-gov", "majestic", "state", "Госы и крафт",
    "Восемь кругов МЦЛ — что в каждом, подписано прямо на карте",
    ["majestic-circles"], [], [],
    [], ["regions-ru"],
  ],
  [
    "majestic-places", "majestic", "dense", "Места и дороги",
    "Горы, пляжи, маяк, казино, мосты, тоннели и трассы — как их зовут игроки Majestic",
    [], [], ["cat-majestic-places"],
    [], ["cat-places", "cat-roads"],
  ],
  [
    "majestic-services", "majestic", "dense", "Службы и магазины",
    "EMS, LSPD, FIB, аренда, автосалоны, магазины, бары, АЗС и дома — подписи Majestic",
    [], [], ["cat-majestic-city"],
    [], ["services", "commerce", "cat-gov", "cat-business", "cat-homes"],
  ],
  [
    "majestic-work", "majestic", "dense", "Работы",
    "Фермы, карьер, ветряки, нефть, порт, заводы, стройки и лесопилки Majestic",
    [], [], ["cat-majestic-work"],
    [], ["cat-work"],
  ],
  [
    "majestic-city", "majestic", "city", "Город и АЗС",
    "АЗС по районам, больницы, полиция, аэропорты; магазины — значками",
    [], [], ["regions-ru", "services", "fuel-named", "commerce"],
    [], [],
  ],
  [
    "gta5rp-homa", "gta5rp", "city", "Зоны и гетто",
    "Золотые и красные зоны, 50 граффити гетто с номерами вики и сленг гетто: ЛГ, кишки, бетонки",
    ["gta5rp-gold", "gta5rp-red"], [], ["cat-gta5rp-crime", "gta5rp-graffiti"],
    [], ["gta5rp-homa-labels", "gta5rp-homa-points", "cat-crime-gta5rp"],
  ],
  [
    "gta5rp-bw", "gta5rp", "city", "Гетто и зелёные",
    "Зелёные зоны, 50 граффити гетто с номерами вики и службы, магазины и дома, как их зовут игроки",
    ["gta5rp-green"], [], ["gta5rp-graffiti", "cat-gta5rp-city"],
    [], ["gta5rp-bw-labels", "gta5rp-bw-points", "gucci-ghetto-points", "cat-homes"],
  ],
  [
    "gta5rp-sites", "gta5rp", "state", "ВЗП, ВЗХ и площадки",
    "Арены ВЗХ, Стройки и Контов, зоны ВЗП и всё, что подписано внутри, — с карты Redux",
    ["redux-sites", "redux-events"], [], ["cat-gta5rp-events", "redux-site-points"],
    [], ["cat-events"],
  ],
  [
    "gta5rp-places", "gta5rp", "dense", "Места и дороги",
    "Горы, пляжи, маяк, казино, мосты, тоннели и трассы — как их зовут игроки GTA 5 RP",
    [], [], ["cat-gta5rp-places"],
    [], ["cat-places", "cat-roads"],
  ],
  [
    "gta5rp-services", "gta5rp", "dense", "Службы и магазины",
    "EMS, LSPD, FIB, аренда, автосалоны, магазины, бары, АЗС и дома — подписи GTA 5 RP",
    [], [], ["cat-gta5rp-city"],
    [], ["services", "commerce", "cat-gov", "cat-business", "cat-homes"],
  ],
  [
    "gta5rp-work", "gta5rp", "dense", "Работы",
    "Фермы, карьер, ветряки, нефть, порт, заводы, стройки и лесопилки GTA 5 RP",
    [], [], ["cat-gta5rp-work"],
    [], ["cat-work"],
  ],
  [
    "gta5rp-trucks", "gta5rp", "state", "Грузовики и точки",
    "Красные грузовики GUCCI, джипы ВЗХ у ТЭЦ и белые чемоданы Redux — там же и того же размера",
    [], [], ["gucci-trucks", "gucci-vzh-jeeps", "redux-cases"],
    [], [],
  ],
  [
    "gta5rp-city", "gta5rp", "city", "Город и АЗС",
    "АЗС №1–30, больницы, полиция, аэропорты; магазины — значками",
    [], [], ["regions-ru", "services", "fuel-numbered", "commerce"],
    [], [],
  ],
  [
    "city", "any", "city", "Службы и магазины",
    "Больницы, полиция, аэропорты, порт и вокзал; магазины — значками",
    [], [], ["services", "commerce"],
    [], [],
  ],
  [
    "places", "any", "state", "Места и дороги",
    "Горы, пляжи, маяк, казино, мосты, тоннели и трассы — подписи со всех карт паков",
    [], [], ["cat-places", "cat-roads"],
    [], [],
  ],
  [
    "work", "any", "city", "Работы и бизнесы",
    "Фермы, карьер, порт, заводы, аренда, автосалоны и госструктуры — где что на карте",
    [], [], ["cat-work", "cat-business", "cat-gov"],
    [], [],
  ],
  [
    "events", "any", "state", "Мероприятия",
    "Шесть кругов под ивенты за городом — передвиньте и назовите",
    ["events-blank"], [], ["regions-ru"],
    [], [],
  ],
  [
    "districts", "any", "state", "Районы цветом",
    "Все районы штата своим цветом и с подписями",
    [], ["full"], ["regions-ru"],
    [], [],
  ],
];

// Что у шаблона сверх наборов: правки наборов, свой вид разделов, признак «снят».
const EXTRAS = {
  "majestic-city": {
    groups: { markers: { commerce: { label: false } } },
    markers: CITY_LOOK,
    retired: true,
  },
  "gta5rp-sites": { groups: { zones: { "redux-events": { color: "#ff9f1a" } } } },
  "gta5rp-trucks": {
    groups: { markers: { "gucci-vzh-jeeps": { color: "#ff9f1a" } } },
    retired: true,
  },
  "gta5rp-city": {
    groups: { markers: { commerce: { label: false } } },
    markers: CITY_LOOK,
    retired: true,
  },
  city: { groups: { markers: { commerce: { label: false } } }, markers: CITY_LOOK, retired: true },
  places: { retired: true },
  work: { retired: true },
  events: { retired: true },
  districts: {
    zones: { fillMode: "flat", fillOpacity: 22, strokeAlign: "center", strokeWidth: 1.2 },
    retired: true,
  },
};

const buildTemplate = ([id, server, view, title, hint, ...sets]) => {
  const [zoneSets, zoneTemplates, labelSets, oldZones, oldMarkers] = sets;
  const { groups = {}, zones = {}, markers = {}, retired = false } = EXTRAS[id] ?? {};
  return Object.freeze({
    zoneSets,
    zoneTemplates,
    labelSets,
    legacy: { zones: oldZones, markers: oldMarkers },
    groups,
    zones,
    markers,
    ...(retired && { retired }),
    id,
    server,
    title,
    hint,
    view,
  });
};

const ALL_TEMPLATES = TEMPLATE_ROWS.map(buildTemplate);
const BY_ID = new Map(ALL_TEMPLATES.map((template) => [template.id, template]));

export const MARKUP_TEMPLATES = Object.freeze(ALL_TEMPLATES.filter(({ retired }) => !retired));

export const MARKUP_TEMPLATE_MAP = Object.freeze(
  Object.fromEntries(ALL_TEMPLATES.map((template) => [template.id, template])),
);

const findTemplate = (id) => BY_ID.get(id) ?? null;

export const currentMarkupTemplate = (config) => findTemplate(config?.markup);

// ---- наборы шаблона ----

// По разделам: у зон сначала наборы, затем заготовки районов.
const pickSets = (markup) => {
  const [zoneSets, zoneTemplates, labelSets] = ["zoneSets", "zoneTemplates", "labelSets"].map(
    (field) => [...markup[field]],
  );
  return { zones: [...zoneSets, ...zoneTemplates], markers: labelSets };
};

// Всё, что шаблон мог поставить: к текущим наборам добавлены наборы прежних версий.
const everSets = (markup) => {
  const sets = pickSets(markup);
  return perSection((section) => [...sets[section], ...markup.legacy[section]]);
};

const wantedSets = (markup) => (markup ? pickSets(markup) : perSection(() => []));

const sectionLook = (markup, section) =>
  markup ? Object.assign({}, BASE_LOOK[section], markup[section]) : {};

const rowsOf = (config, wanted) =>
  SECTIONS.flatMap((section) => {
    const byId = new Map(mapGroups(config, section).map((row) => [row.id, row]));
    return wanted[section].filter((id) => byId.has(id)).map((id) => ({ section, ...byId.get(id) }));
  });

export const markupGroups = (config, markup) => (markup ? rowsOf(config, pickSets(markup)) : []);

// ---- вид шаблона ----

// Поле вида принимается, если оно нетронуто (заводское или как у прежнего шаблона);
// `enabled` принимается всегда. Прежние значения уходят в `was`.
const adoptLook = (section, look, previousLook, factory) =>
  Object.entries(look).reduce(
    ({ section: next, was }, [key, value]) => {
      const now = jsonOf(section[key]);
      const accepts = [
        () => now === jsonOf(factory[key]),
        () => Object.hasOwn(previousLook, key) && now === jsonOf(previousLook[key]),
        () => key === "enabled",
      ];
      if (!accepts.some((rule) => rule())) return { section: next, was };
      const changed = now !== jsonOf(value);
      return {
        section: { ...next, [key]: value },
        was: changed ? { ...was, [key]: section[key] } : was,
      };
    },
    { section: { ...section }, was: {} },
  );

// ---- смена прежнего шаблона: список шагов над парой «карта, спрятанное» ----

// Судьба набора прежнего шаблона: нетронутый убирается, правленый прячется.
const retireOne = (section, previous, options) => (acc, id) => {
  const patch = previous.groups?.[section]?.[id];
  if (mapGroupPristine(acc.config, section, id, { ...options, patch })) {
    return { ...acc, config: removeMapGroup(acc.config, section, id) };
  }
  const config = setMapGroupVisible(acc.config, section, id, false);
  const title = mapGroupTitle(id, config[section].groupTitles);
  return { config, hidden: [...acc.hidden, { section, id, title }] };
};

const hideAgain = (section) => (acc, id) => ({
  ...acc,
  config: setMapGroupVisible(acc.config, section, id, false),
});

const retireSection = (section, plan) => (acc) => {
  const present = new Set(mapGroups(acc.config, section).map(({ id }) => id));
  const leaving = (id) => !plan.wanted[section].includes(id) && present.has(id);
  const retire = retireOne(section, plan.previous, plan.options);
  const kept = plan.listed[section].filter(leaving).reduce(retire, acc);
  return (plan.state?.shown?.[section] ?? []).filter(leaving).reduce(hideAgain(section), kept);
};

// Прежний вид возвращается в тех полях, которые после шаблона не менялись.
const backSection = (section, look, saved) =>
  Object.entries(saved).reduce(
    (back, [key, old]) =>
      Object.hasOwn(look, key) && sameJson(back[key], look[key]) ? { ...back, [key]: old } : back,
    { ...section },
  );

const restoreLook = (plan) => (acc) =>
  plan.state
    ? {
        ...acc,
        config: normalizeWorldMap({
          ...acc.config,
          ...perSection((section) =>
            backSection(
              acc.config[section],
              sectionLook(plan.previous, section),
              plan.state.look[section],
            ),
          ),
        }),
      }
    : acc;

// Отметка заготовки районов снимается вместе с её набором.
const dropStaleMark = (plan) => (acc) => {
  const mark = acc.config.zones.template;
  const stale =
    plan.listed.zones.includes(mark) &&
    !mapGroups(acc.config, "zones").some(({ id }) => id === mark);
  if (!stale) return acc;
  const zones = { ...acc.config.zones, template: "none" };
  return { ...acc, config: normalizeWorldMap({ ...acc.config, zones }) };
};

const retirePrevious = (config, previous, wanted, options) => {
  const idle = { config, hidden: [] };
  if (!previous) return idle;
  const state = config.markupState;
  const listed = state ? state.placed : everSets(previous);
  const plan = { previous, wanted, options, state, listed };
  return through(
    idle,
    ...SECTIONS.map((section) => retireSection(section, plan)),
    restoreLook(plan),
    dropStaleMark(plan),
  );
};

export const markupKeptGroups = (config, id, options = {}) => {
  const current = normalizeWorldMap(config);
  const wanted = wantedSets(findTemplate(id));
  return retirePrevious(current, currentMarkupTemplate(current), wanted, options).hidden;
};

// ---- постановка наборов нового шаблона ----

// План: что и в каком порядке ставить — заготовки районов, затем наборы зон, затем подписи.
const installPlan = (markup, options) => [
  ...markup.zoneTemplates.map((id) => [
    "zones",
    id,
    (map) => applyZoneTemplateSet(map, id, options),
  ]),
  ...markup.zoneSets.map((id) => ["zones", id, (map) => applyZoneSet(map, id)]),
  ...markup.labelSets.map((id) => ["markers", id, (map) => applyLabelSet(map, id, options)]),
];

// Готовый набор просто показывается, недостающий ставится из каталога.
const installOne = (carried) => (acc, [section, id, put]) => {
  const row = mapGroups(acc.config, section).find((entry) => entry.id === id);
  if (!row) {
    const fresh = acc.fresh[section].includes(id) ? acc.fresh : addTo(acc.fresh, section, id);
    return { ...acc, config: put(acc.config), fresh };
  }
  const revealed = !row.visible && !carried[section].includes(id);
  return {
    ...acc,
    config: setMapGroupVisible(acc.config, section, id, true),
    shown: revealed ? addTo(acc.shown, section, id) : acc.shown,
  };
};

// Правки наборов из шаблона касаются только что поставленных наборов.
const editsOf = (markup) =>
  Object.entries(markup.groups).flatMap(([section, byGroup]) =>
    Object.entries(byGroup).map(([id, patch]) => ({ section, id, patch })),
  );

const installSets = (start, markup, carry, options) => {
  const done = installPlan(markup, options).reduce(installOne(carry.placed), {
    config: start,
    fresh: perSection(() => []),
    shown: carry.shown,
  });
  const config = editsOf(markup)
    .filter(({ section, id }) => done.fresh[section].includes(id))
    .reduce((map, { section, id, patch }) => patchMapGroup(map, section, id, patch), done.config);
  return { ...done, config };
};

const settle = (retired, { markup, previous, state, carry, options }) => {
  const adopted = perSection((section) =>
    adoptLook(
      retired[section],
      sectionLook(markup, section),
      state ? {} : sectionLook(previous, section),
      FACTORY[section],
    ),
  );
  const looked = normalizeWorldMap({
    ...retired,
    zones: adopted.zones.section,
    markers: adopted.markers.section,
  });
  const installed = installSets(looked, markup, carry, options);
  const markupState = {
    placed: perSection((section) => [...carry.placed[section], ...installed.fresh[section]]),
    shown: installed.shown,
    look: perSection((section) => adopted[section].was),
  };
  return normalizeWorldMap({ ...installed.config, markup: markup.id, markupState });
};

export const applyMarkupTemplate = (config, id, options = {}) => {
  const current = normalizeWorldMap(config);
  const previous = currentMarkupTemplate(current);
  const markup = findTemplate(id);
  const wanted = wantedSets(markup);
  const state = current.markupState;
  const carried = (lists) =>
    perSection((section) =>
      (lists?.[section] ?? []).filter((name) => wanted[section].includes(name)),
    );
  const carry = { placed: carried(state?.placed), shown: carried(state?.shown) };
  const { config: retired } = retirePrevious(current, previous, wanted, options);
  return markup
    ? settle(retired, { markup, previous, state, carry, options })
    : normalizeWorldMap({ ...retired, markup: "", markupState: null });
};
