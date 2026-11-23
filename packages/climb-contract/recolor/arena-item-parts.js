/*
 * Части вещей зала (слово владельца 30.10.2026, «выделение в Мастерской арены»: «не могу удалить ковры»).
 *
 * Бывает, что игра кладёт в одну модель две вещи, которые человек видит порознь: в `v_62_barrier01.ydr` (сущность 76 зала GTA 5 RP) вместе с перилами
 * стоят резиновые коврики (лист `xj_v_rubber`, 54 треугольника) и тень под ними (`gz_v_white256`, наклейка грязи, 24 треугольника). Сущность одна, поэтому
 * убрать коврики записью сущности нельзя — ушли бы и перила. Часть — отдельный предмет описи с номером вне номеров сущностей (`ARENA_PART_KEY_BASE` + номер
 * сущности): кадр метит сетки части этим номером (`arena-parts.js` окна), выбор, подсветка и «Удалить» работают как у любой вещи, а установщик убирает
 * часть из самой модели — каждый её треугольник сводится в точку (`hideGrimeDecals`, как тень под креслами `ARENA_SEAT_SHADOWS`).
 *
 * Чистые функции без DOM и Node: опись читают окно (кадр, панель), договор (убираемые вещи) и установщик.
 */

/* Номера частей — от этого числа: номера сущностей зала меньше (у GTA 5 RP — до 301), интерьер у них тот же (0). */
export const ARENA_PART_KEY_BASE = 50_000;

export const ARENA_ITEM_PARTS = Object.freeze({
  gta5rp: Object.freeze([
    Object.freeze({
      /* Имя модели части в описи (`arenaObjects`): по листу, как у вещей GTA 5 RP. */
      model: "xj_v_rubber",
      /* Сущность, чья модель несёт часть, и номер самой части. */
      entity: 76,
      key: ARENA_PART_KEY_BASE + 76,
      /* Файл модели игры (рядом с типами зала) и листы части в нём и в сцене кадра: имена строчными. */
      file: "v_62_barrier01.ydr",
      sheets: Object.freeze(["xj_v_rubber", "gz_v_white256"]),
    }),
  ]),
});

/** Части вещей зала сервера (у Majestic их нет). */
export const arenaItemParts = (server) => ARENA_ITEM_PARTS[server] || [];

/** Часть по её номеру или `null`. */
export const arenaPartByKey = (server, key) => arenaItemParts(server).find((part) => part.key === key) || null;

/** Части, что стоят в модели вещи `entity` (номер сущности). */
export const arenaPartsOfEntity = (server, entity) => arenaItemParts(server).filter((part) => part.entity === entity);

/** Убранные части из списка убранного: `[часть…]`; номера вещей без частей в список не попадают. */
export const arenaRemovedParts = (server, keys) => {
  const gone = new Set(keys || []);
  return arenaItemParts(server).filter((part) => gone.has(part.key));
};

/** Номера вещей без частей: записью сущности убираются только они. */
export const arenaEntityKeys = (server, keys) => (keys || []).filter((key) => !arenaPartByKey(server, key));

/** Файлы моделей игры, что установщик правит ради частей, — для доверия пакету. */
export const arenaItemPartFiles = () => [...new Set(Object.values(ARENA_ITEM_PARTS).flatMap((list) => list.map((part) => part.file)))];

/*
 * Сущности, где игра держит в одной модели несколько предметов, которые человек видит порознь (баннеры «Fame or Shame» — одна сущность на весь зал, знаки, эмблемы, телевизионные
 * наклейки, звезда с флагами): убрать или заменить можно только всю сущность разом, а картинки на них правятся по одной в «Плакатах», «Табличках», «Экранах», «Эмблемах». Не
 * часть вещи (у неё есть свой номер и своя модель) — окно предупреждает на странице предмета. Номера — сущности помещения GTA 5 RP по файлам игры (`v_int_62.rpf`).
 */
export const ARENA_ITEM_GROUPS = Object.freeze({
  gta5rp: Object.freeze([97, 120, 123, 126, 128, 129, 130, 138]),
});

/** Несколько предметов в одной сущности (убрать можно только все разом). */
export const arenaItemIsGroup = (server, key) => Boolean(ARENA_ITEM_GROUPS[server]?.includes(key));
