/*
 * Чем опознаётся правка внутри чужого редукса.
 *
 * Два источника, и оба — не догадки.
 *
 * Первый: точные маршруты из `@modovik/mod-targets`. Эта таблица уже
 * описывает, куда именно приложение ставит каждую категорию каталога, и
 * проверена установками на живой игре. Если тронутая запись совпала с
 * маршрутом, категория известна точно — и заодно известно, чем её потом
 * ставить.
 *
 * Второй: структурные признаки для того, что маршрутом по имени не задать.
 * Оружия, вещей одежды и кусков мира в игре тысячи, перечислять их поимённо
 * бессмысленно — зато у них устойчивая форма имени и место в архиве.
 *
 * Чего здесь нет намеренно: угадывания «по смыслу». Файл, не подошедший ни под
 * одно правило, попадает в находку «не опознано» вместе со своим путём.
 * Подписать его знакомой категорией наугад хуже, чем не подписать вовсе:
 * неверно опознанный мод уедет в каталог под чужим именем, и заметят это уже
 * игроки.
 */

import { listLegacyModTargets } from "@modovik/mod-targets";
import { isWaterFogTile } from "@modovik/mod-targets/water-files";

/** Категории находок: как называется человеку и куда ведёт в каталоге. */
export const FINDING_CATEGORIES = Object.freeze({
  minimap: { label: "Мини-карта", section: "redux", slot: "minimap" },
  "large-map": { label: "Большая карта", section: "redux", slot: "large-map" },
  "minimap-position": {
    label: "Положение мини-карты",
    section: "redux",
    slot: "minimap-position",
  },
  timecycle: { label: "Таймцикл", section: "redux", slot: "timecycle" },
  "kill-effects": {
    label: "Килл-эффекты",
    section: "redux",
    slot: "kill-effects",
  },
  reticle: { label: "Прицел", section: "redux", slot: "crosshair" },
  tracers: { label: "Трассеры", section: "redux", slot: "tracers" },
  "particle-effects": { label: "Эффекты", section: "redux", slot: "effects" },
  "blood-effects": {
    label: "Эффекты попадания",
    section: "redux",
    slot: "hit-effects",
  },
  vegetation: { label: "Растительность", section: "redux", slot: "vegetation" },
  water: { label: "Вода", section: "redux", slot: "water" },
  optimization: {
    label: "Оптимизация",
    section: "other",
    slot: "optimization",
  },
  "fast-entry": { label: "Быстрый вход", section: "other", slot: "fast-entry" },
  "weapon-model": { label: "Модели оружия", section: "gunpacks", slot: null },
  clothing: { label: "Одежда", section: "clothing", slot: null },
  mapping: { label: "Маппинг", section: "redux", slot: "mapping" },
  /* Штатные объекты игры, заменённые своими: пустые полки магазинов,
     упрощённые урны. Это оптимизация, а не новый мир — ставится тем же
     слоем, что маппинг, но в каталоге лежит среди оптимизаций. */
  "object-optimization": {
    label: "Оптимизация объектов",
    section: "other",
    slot: "optimization",
  },
  "large-map-zoom": {
    label: "Отдаление большой карты",
    section: "redux",
    slot: "large-map-zoom",
  },
  arenas: { label: "Арена", section: "redux", slot: "arenas" },
  /* Места мастерской (16.10): полки каталога — полки её редакторов. */
  hangar: { label: "Ангар", section: "redux", slot: "hangar" },
  zones: { label: "Зоны", section: "redux", slot: "forbidden-zones" },
  schedule: { label: "Расписание", section: "redux", slot: "schedule" },
  climbs: { label: "Залазы", section: "other", slot: "climbing" },
  interiors: { label: "Интерьеры", section: "redux", slot: "interior" },
  roads: { label: "Дороги", section: "redux", slot: "roads" },
  "world-objects": {
    label: "Объекты мира",
    section: "other",
    slot: "world-objects",
  },
  vehicles: { label: "Транспорт", section: "other", slot: "vehicles" },
  sounds: { label: "Звук", section: "redux", slot: "sounds" },
  interface: { label: "Интерфейс", section: "other", slot: "interface" },
  "game-data": { label: "Игровые данные", section: "other", slot: null },
  textures: { label: "Текстуры", section: "other", slot: null },
  registration: { label: "Регистрации DLC", section: null, slot: null },
  "astral-layer": { label: "Слой Astral", section: null, slot: null },
  scripts: { label: "Скрипты игры", section: null, slot: null },
  /* Файлы, которые отличаются из-за версии игры, а не правки автора: архив
     собран под другую сборку, и разница здесь — обновления Rockstar. */
  "build-drift": { label: "Отличия сборки игры", section: null, slot: null },
  /* Только дальние модели (LOD) чужого места (17.10, TIFFANY «Основной»):
     без самого места частью не бывают, — строка описи. */
  "world-lod": { label: "Дальние модели (LOD)", section: null, slot: null },
  /* Файлы игры, перенесённые автором в свой контейнер (17.10, 12 globl:
     46 карт окклюзии hei_*_occl — те же байты, что в dlc_patch/mpheist). */
  "stock-copy": { label: "Копии файлов игры", section: null, slot: null },
  unknown: { label: "Не опознано", section: null, slot: null },
});

/**
 * Находки, которые нельзя предлагать к публикации, что бы ни говорила
 * готовность маршрута.
 *
 * `registration` и `astral-layer` — это не мод, а следы установки: реестр DLC
 * и метка нашего же слоя. `scripts` — скомпилированный игровой код: его
 * публикация меняет правила игры на сервере, и решение об этом принимает не
 * разбор архива.
 */
export const NEVER_PUBLISHABLE = Object.freeze(
  new Set([
    "registration",
    "astral-layer",
    "scripts",
    "build-drift",
    "world-lod",
    "stock-copy",
    "unknown",
  ]),
);

const normalize = (value) =>
  String(value || "")
    .replace(/\\/g, "/")
    .toLowerCase();

/**
 * Точные маршруты из таблицы целей: `entry` → категории, которые на него
 * претендуют.
 *
 * Претендентов может быть несколько: `timecycle_mods_*.xml` — это и таймцикл,
 * и килл-эффект, и одна из оптимизаций, потому что все трое правят разные
 * модификаторы внутри одного файла. Разобрать такое по имени файла нельзя, и
 * находка честно перечисляет всех претендентов, а не выбирает первого.
 */
export function exactRouteIndex() {
  const routes = new Map();
  const claim = (entry, id, extra = {}) => {
    const path = normalize(entry);
    if (!path || path.includes(":")) return;
    if (!routes.has(path)) routes.set(path, []);
    routes.get(path).push({ id, ...extra });
  };

  for (const definition of listLegacyModTargets()) {
    for (const item of definition.targets || [])
      claim(item.entry, definition.id, {
        archive: item.archive,
        action: item.action || "replace",
      });
    for (const [option, items] of Object.entries(definition.options || {}))
      for (const item of items)
        claim(item.entry, definition.id, {
          archive: item.archive,
          option,
          action: item.action || "replace",
        });
  }
  return routes;
}

/*
 * Структурные правила. Порядок значим: первое подошедшее выигрывает, поэтому
 * узкие правила стоят выше широких, а «просто текстура» — последней.
 *
 * `group` разводит находки одной категории на отдельные карточки: каждое
 * оружие и каждый предмет одежды — свой мод со своим слотом, и складывать их
 * в одну кучу «оружие» значило бы предложить модератору публиковать ганпак
 * целиком там, где в каталоге лежат отдельные стволы.
 */
export const STRUCTURAL_RULES = Object.freeze([
  {
    id: "astral-layer",
    category: "astral-layer",
    evidence: "папка слоя Astral внутри архива",
    test: (path) => path.startsWith("x64/astral/"),
  },
  {
    id: "registration",
    category: "registration",
    evidence: "реестр подключённого контента",
    test: (path) =>
      path === "content.xml" ||
      path === "setup2.xml" ||
      path.endsWith("/content.xml") ||
      path.endsWith("/setup2.xml") ||
      path.endsWith("common/data/dlclist.xml") ||
      path.endsWith("common/data/extratitleupdatedata.meta"),
  },
  {
    id: "script",
    category: "scripts",
    evidence: "скомпилированный игровой скрипт",
    test: (path) => path.endsWith(".ysc") || path.includes("/script.rpf/"),
  },
  {
    id: "weapon-model",
    category: "weapon-model",
    evidence: "модель оружия в потоке ресурсов",
    // w_pi_pistol.ydr, w_ar_carbinerifle_hi.ydr, w_sb_smg+hi.ytd,
    // w_ar_carbinerifle_mk2.ydr, w_ar_carbinerifle_m31_mag1.ydr — в имени
    // ствола бывает не одно подчёркивание, поэтому тело имени ловится целиком.
    test: (path) =>
      /(^|\/)w_[a-z]{2}_[a-z0-9_+]+\.(ydr|ytd|yft|ydd)$/.test(path),
    // Один ствол — одна карточка: детали (`_hi`, магазин, прицел, глушитель)
    // ложатся к своему оружию, а не становятся отдельными модами.
    group: (path) => {
      const match = path.match(
        /(^|\/)(w_[a-z]{2}_[a-z0-9_+]+?)(_hi|\+hi|_mag\d|_sight|_supp)?\.(ydr|ytd|yft|ydd)$/,
      );
      return match ? match[2] : "weapon";
    },
  },
  {
    id: "clothing-component",
    category: "clothing",
    evidence: "компонент или словарь одежды персонажа",
    // jbib_001_u.ydd, lowr_diff_003_a_uni.ytd, p_head_010.ydd
    test: (path) =>
      /(^|\/)(jbib|lowr|uppr|feet|berd|task|accs|hand|teef|decl|hair|head|p_head|p_eyes|p_ears|p_lwrist|p_rwrist)(_diff|_norm|_spec)?_\d{3}[a-z_]*\.(ydd|ytd)$/.test(
        path,
      ),
    group: (path) => {
      const match = path.match(
        /(^|\/)((?:p_)?[a-z]+?)(?:_diff|_norm|_spec)?_(\d{3})/,
      );
      return match ? `${match[2]}-${match[3]}` : "clothing";
    },
  },
  {
    id: "interior-map",
    category: "interiors",
    evidence: "карта помещения",
    test: (path) =>
      /\.(ymap|ytyp)$/.test(path) &&
      /(^|\/)(int_|v_ilev|interior)/.test(path.split("/").pop() || ""),
  },
  {
    id: "world-map",
    category: "mapping",
    evidence: "карта или архетип мира",
    test: (path) => /\.(ymap|ytyp|ybn|ynv|ymf)$/.test(path),
  },
  {
    id: "vehicle-data",
    category: "vehicles",
    evidence: "таблица транспорта",
    test: (path) =>
      /(handling|vehicles|carvariations|carcols|vehiclelayouts)\.meta$/.test(
        path,
      ),
  },
  {
    id: "vehicle-model",
    category: "vehicles",
    evidence: "модель транспорта",
    test: (path) => /levels\/gta5\/vehicles.*\.(yft|ytd)$/.test(path),
    group: (path) => (path.split("/").pop() || "vehicle").replace(/\..*$/, ""),
  },
  {
    id: "road-texture",
    category: "roads",
    evidence: "дорожное покрытие или разметка",
    test: (path) =>
      /(globalroads|roadmarkings|im_road)/.test(path.split("/").pop() || ""),
  },
  {
    id: "audio-stream",
    category: "sounds",
    evidence: "звуковой банк",
    test: (path) => /\.(awc|rel)$/.test(path),
    group: (path) => (path.split("/").pop() || "bank").replace(/\..*$/, ""),
  },
  {
    id: "scaleform",
    category: "interface",
    evidence: "элемент интерфейса Scaleform",
    test: (path) => /scaleform[^/]*\.rpf\/.*\.gfx$/.test(path),
    group: (path) => (path.split("/").pop() || "gfx").replace(/\..*$/, ""),
  },
  {
    id: "world-prop",
    category: "world-objects",
    evidence: "пропс мира",
    test: (path) => /levels\/gta5\/props\/.*\.(ydr|yft|ydd|ytd)$/.test(path),
  },
  {
    /* Плитки тумана воды — вложенные `waterfog_txds(_dx).rpf`: сотни файлов автора, что маршрутом по имени не задать. Они — часть
       «Вода» вместе с water.xml, watertune.xml и water.ytd (`water-files.js`); без правила ложились бы в «словарь текстур». */
    id: "water-fog-tile",
    category: "water",
    evidence: "плитка тумана воды",
    test: (path) => isWaterFogTile(path),
  },
  {
    id: "effects-data",
    category: "particle-effects",
    evidence: "таблица эффектов",
    /* И `x64/data/effects/*.ymt` (17.10): `animpostfx.ymt` — эффекты
       экрана, `vfxpedinfo.ymt` — следы на персонажах; у kray v2 redux они
       уходили в «потеряно». */
    test: (path) =>
      /(common\/data\/effects\/.*\.(dat|meta|xml)|x64\/data\/effects\/[^/]+\.ymt)$/.test(
        path,
      ),
  },
  {
    /* Кадры погоды — вторая половина таймцикла. У маршрута каталога названы
       только файлы модификаторов, но редукс правит небо именно здесь:
       `w_clear.xml`, `w_rain.xml` и ещё дюжина. Без этого правила они уходили
       бы в «игровые данные», и таймцикл собирался бы без неба. */
    id: "weather-keyframes",
    category: "timecycle",
    evidence: "кадры погоды таймцикла",
    test: (path) => /common\/data\/timecycle\/w_[a-z0-9_]+\.xml$/.test(path),
  },
  {
    /* Отдаление карты — свои файлы у большой карты: уровни зума и разметка
       атласа. Без этого правила они уходили бы в «игровые данные». */
    id: "large-map-zoom",
    category: "large-map-zoom",
    evidence: "уровни отдаления большой карты",
    test: (path) =>
      path === "common/data/ui/mapzoomdata.meta" ||
      path === "x64/data/tune/minimap.ymt",
  },
  {
    id: "game-data",
    category: "game-data",
    evidence: "игровая таблица настроек",
    test: (path) => /common\/data\/.*\.(meta|dat|xml|ymt)$/.test(path),
  },
  {
    id: "texture-dictionary",
    category: "textures",
    evidence: "словарь текстур",
    test: (path) => /\.ytd$/.test(path),
  },
]);

/** Первое подошедшее правило или `null`. */
export function matchStructuralRule(path) {
  const normalized = normalize(path);
  for (const rule of STRUCTURAL_RULES)
    if (rule.test(normalized)) return { rule, normalized };
  return null;
}
