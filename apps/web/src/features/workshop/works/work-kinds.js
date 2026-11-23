/*
 * Виды работ мастерской — у кода, у «Моих работ» и у редакторов один
 * словарь.
 *
 * Вид — это то, что открывает одна плитка мастерской: трейсеры, попадания и
 * огонь — три вида, хотя в игру они уезжают одним патчем эффектов. Человек
 * приходит в «Трейсеры» за трассером, сохраняет трассер и делится
 * трассером; код, в котором заодно лежали бы его кровь и огонь, открыл бы у
 * друга чужие попадания поверх его собственных.
 *
 * Здесь только имена и адреса — без разбора данных, чтобы словарь можно было
 * держать в стартовом куске каталога.
 */

/* Отдельные редакторы (правка в своём ключе хранилища) и студия (проект в
   хранилище проектов). `part` — часть общего набора эффектов. */
export const WORK_KINDS = Object.freeze({
  /* «Оптимизация»: какие слои оптимизации Astral включить (17.10 — у части
     редукса; ТЗ 24.10.2026 — у человека и у сборки). Своих файлов и своего
     редактора у работы нет — её ставит очередь раздела «Оптимизация»,
     открывается она самим разделом мастерской (`section`), а не плиткой, и
     плитки у неё нет. С 24.10 она лежит в «Моих работах» (`linkKey`): ввоз
     из кода сборки и вывоз в код идут тем же путём, что у остальных видов;
     снимок — `{ layers }`, «стоит» — слои работы входят в то, что стоит. */
  optimization: Object.freeze({
    type: "optimization",
    section: "optimization",
    linkKey: "optimization",
  }),
  tracer: Object.freeze({
    type: "effects",
    part: "tracer",
    slotId: "tracers",
    linkKey: "effects:tracer",
  }),
  impact: Object.freeze({
    type: "effects",
    part: "impact",
    slotId: "hit-effects",
    linkKey: "effects:impact",
  }),
  fire: Object.freeze({
    type: "effects",
    part: "environment",
    slotId: "fire-explosions",
    linkKey: "effects:environment",
  }),
  sky: Object.freeze({
    type: "timecycle",
    slotId: "timecycle",
    linkKey: "timecycle",
  }),
  kill: Object.freeze({
    type: "kill-effect",
    slotId: "kill-effects",
    linkKey: "kill-effect",
  }),
  /* След на экране, когда попадают по игроку: своя картинка в код не едет. */
  "screen-hits": Object.freeze({
    type: "screen-hits",
    slotId: "screen-hits",
    linkKey: "screen-hits",
  }),
  /* Метки и GPS: цвет и значок метки, маршруты сервера, точность; своя
     картинка значка в код не едет. */
  gps: Object.freeze({
    type: "gps",
    slotId: "blips",
    linkKey: "gps",
  }),
  /* «Полоска HP» (задача 2 ТЗ 11.10.2026): полоска над игроком целиком —
     своих файлов человека в работе нет, код передаёт её без потерь. */
  "target-hp": Object.freeze({
    type: "target-hp",
    slotId: "target-hp",
    linkKey: "target-hp",
  }),
  /* «Групповые метки» (задача 21 ТЗ 18.10.2026, вечер): цвет, убрать — в коде; своя картинка метки в
     код не едет (хранится на этом компьютере). */
  "group-markers": Object.freeze({
    type: "group-markers",
    slotId: "group-markers",
    linkKey: "group-markers",
  }),
  /* «Дым из-под колёс» (ТЗ 11.10.2026, вечер): вид, цвета, ползунки и где —
     своих файлов человека в работе нет, код передаёт её без потерь. */
  "wheel-smoke": Object.freeze({
    type: "wheel-smoke",
    slotId: "wheel-smoke",
    linkKey: "wheel-smoke",
  }),
  lamps: Object.freeze({
    type: "lamps",
    slotId: "lights",
    linkKey: "lamps",
  }),
  /* Прострелы — облик подсветки укрытий на каптах; залазы у них свои. */
  wallbang: Object.freeze({
    type: "wallbang",
    slotId: "wallbang",
    linkKey: "wallbang",
  }),
  /* Наборы перекраски — цвет модов мира: запретные зоны на картах каптов.
     `recolor` — договор работы берётся из общей таблицы наборов. */
  zones: Object.freeze({
    type: "zones",
    slotId: "forbidden-zones",
    linkKey: "zones",
    recolor: true,
  }),
  /* Завод — цвет корпусов, земли, контейнеров и реквизита мода cs4_13. */
  factory: Object.freeze({
    type: "factory",
    slotId: "factory",
    linkKey: "factory",
    recolor: true,
  }),
  /* Ангар — цвет каркаса снаружи и внутри и своя эмблема (она в код не едет). */
  hangar: Object.freeze({
    type: "hangar",
    slotId: "hangar",
    linkKey: "hangar",
    recolor: true,
  }),
  /* Маппинг — цвет мест карты из мода маппинга (ферма, база байкеров…). */
  mapping: Object.freeze({
    type: "mapping",
    slotId: "mapping",
    linkKey: "mapping",
    recolor: true,
  }),
  /* Вода — цвет и прозрачность моря, озёр и рек: набор без файлов мода. */
  water: Object.freeze({
    type: "water",
    slotId: "water",
    linkKey: "water",
    recolor: true,
  }),
  /* Растительность — листва деревьев и «Трава по миру». */
  vegetation: Object.freeze({
    type: "vegetation",
    slotId: "vegetation",
    linkKey: "vegetation",
    recolor: true,
  }),
  /* Арена — GTA 5 RP или Majestic; свои картинки в код не едут. */
  arenas: Object.freeze({
    type: "arenas",
    slotId: "arenas",
    linkKey: "arenas",
    recolor: true,
  }),
  /* Мегамолл — здание из игры; свои картинки (баннеры, логотипы) в код не едут. */
  megamall: Object.freeze({
    type: "megamall",
    slotId: "mega-mall",
    linkKey: "megamall",
    recolor: true,
  }),
  /* «Ашан / Икея» — здание You Tool из игры; свои картинки в код не едут. */
  youtool: Object.freeze({
    type: "youtool",
    slotId: "ashan",
    linkKey: "youtool",
    recolor: true,
  }),
  /* «Вайнвуд» — своё слово на холме; свой логотип в код не едет. */
  vinewood: Object.freeze({
    type: "vinewood",
    slotId: "vinewood",
    linkKey: "vinewood",
    recolor: true,
  }),
  /* «Остановки» — облик остановок всей карты; свои картинки в код не едут. */
  busstops: Object.freeze({
    type: "busstops",
    slotId: "busstops",
    linkKey: "busstops",
    recolor: true,
  }),
  /* «МСЛ-зоны» — линии зон на земле; всё — числа, в код едут целиком. */
  mslzones: Object.freeze({
    type: "mslzones",
    slotId: "msl-zones",
    linkKey: "msl-zones",
    recolor: true,
  }),
  /* «Летающее лого» — своя картинка в код не едет, надпись — едет. */
  floatlogo: Object.freeze({
    type: "floatlogo",
    slotId: "float-logo",
    linkKey: "float-logo",
    recolor: true,
  }),
  /* «Дирижабли» (ТЗ 11.10.2026) — своя картинка дирижабля в код не едет, надпись и небо — едут. */
  airships: Object.freeze({
    type: "airships",
    slotId: "airships",
    linkKey: "airships",
    recolor: true,
  }),
  /* «Интерьеры» — облик помещений магазинов; свои картинки стен в код не едут. */
  shops: Object.freeze({
    type: "shops",
    slotId: "shops",
    linkKey: "shops",
    recolor: true,
  }),
  /* «Билборды» — облик рекламных щитов; свои картинки щитов в код не едут. */
  billboards: Object.freeze({
    type: "billboards",
    slotId: "billboards",
    linkKey: "billboards",
    recolor: true,
  }),
  /* «Зоны каптов» — облик шайб мода heix; своих картинок нет, код едет целиком. */
  captzones: Object.freeze({
    type: "captzones",
    slotId: "capt-zones",
    linkKey: "capt-zones",
    recolor: true,
  }),
  /* «Расписание» — табло сервера Majestic; свои картинки строк и свой шрифт в код не едут. */
  schedule: Object.freeze({
    type: "schedule",
    slotId: "schedule",
    linkKey: "schedule",
    recolor: true,
  }),
  /* «Флаги» (задача 7 ТЗ 10.10.2026, вечер) — флаги стран едут в коде, свои картинки — нет. */
  flags: Object.freeze({
    type: "flags",
    slotId: "flags",
    linkKey: "flags",
    recolor: true,
  }),
  /* «Банкоматы» (задача 4 ТЗ 17.10.2026) — цвета едут в коде, свои картинки — нет. */
  atms: Object.freeze({
    type: "atms",
    slotId: "atms",
    linkKey: "atms",
    recolor: true,
  }),
  /* «Интерьеры проектов» (задача 10 ТЗ 17.10.2026, вечер) — цвета и «поставить» едут в коде, сами файлы интерьеров — нет. */
  projectinteriors: Object.freeze({
    type: "projectinteriors",
    slotId: "project-interiors",
    linkKey: "project-interiors",
    recolor: true,
  }),
  /* «Интерьеры Majestic RP» (25.10.2026) — цвета едут в коде, сами файлы интерьеров — нет. */
  majesticinteriors: Object.freeze({
    type: "majesticinteriors",
    slotId: "majestic-interiors",
    linkKey: "majestic-interiors",
    recolor: true,
  }),
  /* «Дороги» — асфальт, грунтовки, тротуары и разметка; свои текстуры в код не едут. */
  roads: Object.freeze({
    type: "roads",
    slotId: "roads",
    linkKey: "roads",
    recolor: true,
  }),
  /* Шрифты — свой шрифт в текстах игры; свой файл шрифта в код не едет. */
  fonts: Object.freeze({
    type: "fonts",
    slotId: "fonts",
    linkKey: "fonts",
    recolor: true,
  }),
  /* Звуки — выстрелы семей стволов и попадания одним снимком студии: в игру
     они уезжают разными модами, но делают и сохраняют их вместе. */
  sound: Object.freeze({
    type: "sound-kit",
    slotId: "sounds",
    linkKey: "sound-kit",
  }),
  minimap: Object.freeze({
    type: "minimap",
    slotId: "minimap",
    studio: true,
    sourceModId: "custom-minimap",
    modules: Object.freeze(["minimap"]),
  }),
  reticle: Object.freeze({
    type: "reticle",
    slotId: "crosshair",
    studio: true,
    sourceModId: "crosshair",
    modules: Object.freeze(["crosshair", "sniper-scope"]),
  }),
  "world-map": Object.freeze({
    type: "world-map",
    slotId: "large-map",
    studio: true,
    sourceModId: "custom-world-map",
    modules: Object.freeze(["world-map"]),
  }),
  climbs: Object.freeze({
    type: "climbs",
    slotId: "climbing",
    studio: true,
    sourceModId: "custom-climbs",
    modules: Object.freeze(["climbs"]),
  }),
  /* Скин оружия. Ствол у каждой работы свой (`slot` в снимке), поэтому и
     связь «редактор ↔ работа» ведётся по стволу: сохранённый револьвер не
     перепишется, пока человек красит карабин. */
  weapon: Object.freeze({
    type: "gun",
    slotId: "",
    section: "gunpacks",
    linkKey: "gun",
    perSlot: true,
  }),
  /* Покраска одежды — та же студия, своя вещь у каждой работы. */
  clothing: Object.freeze({
    type: "clothing-paint",
    slotId: "",
    section: "clothing",
    linkKey: "cloth",
    perSlot: true,
  }),
});

/** Ствол снимка скина оружия — `{ slot, project }` строкой или объектом. */
export function gunSlotOf(state) {
  try {
    const parsed = typeof state === "string" ? JSON.parse(state) : state;
    const slot = String(parsed?.slot || "");
    return /^[a-z0-9_-]{1,48}$/.test(slot) ? slot : "";
  } catch {
    return "";
  }
}

/**
 * Ключ связи редактора с работой. У вида «по стволу» он свой у каждого
 * ствола: `gun:revolver`.
 */
export function linkKeyOf(kind, state = null, slot = "") {
  const spec = WORK_KINDS[kind];
  if (!spec?.linkKey) return "";
  if (!spec.perSlot) return spec.linkKey;
  const owner = slot || gunSlotOf(state);
  return owner ? `${spec.linkKey}:${owner}` : "";
}

/** Вид — набор эффектов (трейсер, попадание, огонь): его ставит установщик эффектов, одно правило для установщика и для кнопок каталога. */
export const installsAsEffects = (kind) => WORK_KINDS[kind]?.type === "effects";

/* Часть набора эффектов → вид работы. */
export const EFFECTS_PART_KINDS = Object.freeze({
  tracer: "tracer",
  impact: "impact",
  environment: "fire",
});

/**
 * Вид работы по её типу в «Моих работах» и части набора. Работа эффектов
 * без части — набор прежних версий: вид у неё тот, что открывается первым.
 */
export function workKindOf(type, part = "") {
  if (type === "effects") return EFFECTS_PART_KINDS[part] || "";
  if (type === "gun") return "weapon";
  if (type === "clothing-paint") return "clothing";
  return (
    Object.entries(WORK_KINDS).find(
      ([, spec]) => spec.type === type && !spec.part,
    )?.[0] || ""
  );
}

/**
 * Вид студийной работы по модулям проекта. Порядок — порядок узнавания,
 * тот же, что был у списка работ: общий проект студии с несколькими
 * модулями узнаётся по мини-карте.
 */
export function studioKindOfModules(moduleIds = []) {
  const ids = new Set(moduleIds);
  if (ids.has("minimap")) return "minimap";
  if (ids.has("crosshair") || ids.has("sniper-scope")) return "reticle";
  if (ids.has("world-map")) return "world-map";
  if (ids.has("climbs")) return "climbs";
  return "";
}
