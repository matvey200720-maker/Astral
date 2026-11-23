/*
 * Меню каталога «2.0» (владелец, 13.11.2026): три группы через черту, без подписей групп.
 *
 *   Моды:            Редуксы · Оружие (Ганпаки, Выборочные) · Звуки · Одежда (Все и виды вещей) · Прочее
 *   Настройка игры:  Таймциклы · Трейсеры · Эффекты · Килл-эффекты · Хит-эффекты · Шрифты и HUD ·
 *                    Маппинг (места по одному, «Мир и зоны» по одному, Растительность) · Прицелы · Миникарта · Большая карта
 *   Система:         Оптимизация
 *
 * Меню — только способ выбрать место: каждый пункт ведёт в то же состояние каталога, что и прежняя колонка
 * (`category`, `shelf`, `group`), поэтому поиск, сортировка, избранное и сетка работают как раньше. Два места новые:
 * `selective` («Выборочные» — свой экран) и `other` («Прочее» — страница функций, пока скрыта флагом).
 *
 * Файл ленивый (стартовый кусок не растёт): его читает только каталог. Подписи — русские ключи словаря, перевод — на месте (`tr`).
 */
import {
  GlyphClothing,
  GlyphRedux,
  GlyphSkins,
  GlyphSounds,
} from "@astral/glyphs";
import {
  Buildings,
  DotsThree,
  Gauge,
  Sparkle,
} from "../../../components/ui/icons.jsx";
import { tr } from "../../../locales/ui.js";
import { shelfIcon } from "../catalog-row-icons.js";
import { CLOTHING_PACKS_SHELF, shelvesFor } from "../catalog-shelves.js";
import { CLOTHING_SECTIONS } from "../clothing-sections.js";

/* Пока у страницы «Прочее» нет функций, пункт меню скрыт. Часть 3 «Каталога 2.0» включает его. */
export const OTHER_PAGE_READY = false;

const FOR_REDUX = "for-redux";

/* Места, которых нет в списке редакторов мастерской: меню собирает их само. */
export const MENU_PLACES = Object.freeze(["selective", "other"]);

/* Группы редакторов для подпунктов, у которых больше одной полки. Идентификаторы — со своей приставкой:
   у групп мастерской (`EDITOR_GROUPS`) другие имена, и они остаются на своих местах. */
export const MENU_EDITOR_GROUPS = Object.freeze([
  Object.freeze({
    id: "menu-effects",
    label: "Эффекты",
    face: "fire-explosions",
    editors: Object.freeze(["fire-explosions", "wheel-smoke"]),
  }),
  Object.freeze({
    id: "menu-places",
    label: "Места",
    face: "mega-mall",
    editors: Object.freeze(
      "arenas hangar factory mega-mall ashan vinewood busstops schedule airships wallbang lights billboards banners flags atms float-logo shops project-interiors majestic-interiors".split(
        " ",
      ),
    ),
  }),
  Object.freeze({
    id: "menu-world",
    label: "Мир и зоны",
    face: "water",
    editors: Object.freeze(
      "water roads climbing forbidden-zones capt-zones msl-zones".split(" "),
    ),
  }),
]);

export const menuGroupOf = (id) =>
  MENU_EDITOR_GROUPS.find((group) => group.id === id) || null;

const editorIcon = (id) => shelfIcon(FOR_REDUX, id);

const leaf = (id, label, icon, route) =>
  Object.freeze({ id, label, icon, route: Object.freeze(route) });
const editorLeaf = (id, label, editor = id) =>
  leaf(id, label, editorIcon(editor), { category: FOR_REDUX, shelf: editor });

/* Подпись редактора — та же, что у его полки в мастерской и в колонке каталога (`catalog-shelves.js`); у редактора без полки — его id. */
const SHELF_LABELS = new Map(
  shelvesFor(FOR_REDUX).map((shelf) => [shelf.id, shelf.label]),
);
const shelfLabel = (id) => SHELF_LABELS.get(id) || id;

/* Подзаголовок внутри ветки: не пункт, без маршрута, фокус и стрелки его пропускают. */
const heading = (id, label, editors) =>
  Object.freeze({ id, label, heading: true, editors: Object.freeze(editors) });

/* Вид «Маппинга»: свой пункт у каждого редактора. Пустой для выбранного сервера пункт прячется (`visibleMenu`, счёт даёт каталог). */
const placeLeaf = (id, label = shelfLabel(id)) =>
  Object.freeze({ ...editorLeaf(id, label), hideEmpty: true });

/* Места по порядку владельца (14.11.2026). Магазины и интерьеры проектов и Majestic своей полки в каталоге не имеют (редакторы скрыты
   в колонке), пункта у них нет — их моды лежат там же, где и раньше. */
export const MENU_PLACE_EDITORS = Object.freeze(
  "arenas mega-mall ashan factory hangar vinewood busstops schedule lights wallbang billboards banners flags atms float-logo airships".split(
    " ",
  ),
);
export const MENU_WORLD_EDITORS = Object.freeze(
  "water roads climbing forbidden-zones capt-zones msl-zones".split(" "),
);
const groupLeaf = (id, label, groupId, icon) =>
  leaf(id, label, icon, { category: FOR_REDUX, group: groupId });
const parent = (id, label, icon, children) =>
  Object.freeze({ id, label, icon, children: Object.freeze(children) });

/* Вид вещи в «Одежде»: свой пункт у каждой подкатегории (`clothing-sections.js`). Пустую для выбранного сервера меню прячет (`hideEmpty`, счёт даёт каталог — тот же `counts`, что у «Маппинга»). */
const wearLeaf = (shelf, label) =>
  Object.freeze({
    ...leaf(`clothing-${shelf}`, label, null, { category: "clothing", shelf }),
    hideEmpty: true,
  });

/* Группы меню по порядку. Пункт: `id`, `label` (русский ключ), `icon`, `route` или `children`. */
export const MENU_GROUPS = Object.freeze([
  Object.freeze([
    leaf("redux", "Редуксы", GlyphRedux, { category: "redux" }),
    parent("weapons", "Оружие", GlyphSkins, [
      leaf("gunpacks", "Ганпаки", null, { category: "skins" }),
      leaf("selective", "Выборочные", null, { category: "selective" }),
    ]),
    leaf("sounds", "Звуки", GlyphSounds, { category: "sounds" }),
    /* Раскрывается как «Оружие» (владелец, 14.11.2026): «Все» и виды вещей сверху вниз по телу; «Все» — прежний вход в раздел. «Прочее» стоит отдельно под ней (каталог 2.0, `e9a8cf285`). */
    parent("clothing", "Одежда", GlyphClothing, [
      leaf("clothing-all", "Все", null, { category: "clothing" }),
      ...CLOTHING_SECTIONS.map(({ id, label }) => wearLeaf(id, label)),
      wearLeaf(CLOTHING_PACKS_SHELF, "Комплекты"),
    ]),
    leaf("other", "Прочее", DotsThree, { category: "other" }),
  ]),
  Object.freeze([
    editorLeaf("timecycle", "Таймциклы"),
    editorLeaf("tracers", "Трейсеры"),
    groupLeaf("effects", "Эффекты", "menu-effects", Sparkle),
    editorLeaf("kill-effects", "Килл-эффекты"),
    editorLeaf("hit-effects", "Хит-эффекты"),
    editorLeaf("fonts", "Шрифты и HUD"),
    parent("mapping", "Маппинг", Buildings, [
      ...MENU_PLACE_EDITORS.map((id) => placeLeaf(id)),
      heading("mapping-world", "Мир и зоны", MENU_WORLD_EDITORS),
      ...MENU_WORLD_EDITORS.map((id) =>
        placeLeaf(id, id === "forbidden-zones" ? "Запретные зоны" : undefined),
      ),
      Object.freeze({
        ...editorLeaf("vegetation", shelfLabel("vegetation")),
        hideEmpty: true,
      }),
    ]),
    editorLeaf("crosshair", "Прицелы"),
    editorLeaf("minimap", "Миникарта"),
    editorLeaf("large-map", "Большая карта"),
  ]),
  Object.freeze([
    leaf("optimization", "Оптимизация", Gauge, {
      category: FOR_REDUX,
      shelf: "optimization",
    }),
  ]),
]);

/*
 * Группы без скрытых пунктов: «Прочее» виден только с включённым флагом. С `counts` (`Map<id полки, число модов>` для выбранного сервера)
 * пустые виды «Маппинга» (`hideEmpty`) прячутся, чтобы не вести в пустоту; пока счёта нет — показаны все. `keep` — id пункта, который
 * остаётся всегда (тот, где человек сейчас). Ветка без видов и подзаголовок без видов под ним уходят вместе с ними.
 */
export function visibleMenu(
  ready = OTHER_PAGE_READY,
  { counts = null, keep = "" } = {},
) {
  const shown = (item) => {
    if (item.id === "other" && !ready) return false;
    if (!counts || !item.hideEmpty || item.id === keep) return true;
    return (counts.get(item.route.shelf) ?? 0) > 0;
  };
  /* Подзаголовок остаётся, пока виден хоть один из его видов («Мир и зоны» — вода, дороги, залазы, зоны). */
  const pruned = (children) => {
    const leaves = children.filter((child) => !child.heading && shown(child));
    return children.filter((child) =>
      child.heading
        ? leaves.some((leaf) => child.editors.includes(leaf.route.shelf))
        : leaves.includes(child),
    );
  };
  return MENU_GROUPS.map((items) =>
    items
      .filter((item) => item.children || shown(item))
      .map((item) =>
        item.children
          ? Object.freeze({
              ...item,
              children: Object.freeze(pruned(item.children)),
            })
          : item,
      )
      .filter((item) => !item.children || item.children.length),
  ).filter((items) => items.length);
}

/* Плоский обход: каждый пункт с маршрутом (листья), в порядке меню; подзаголовки не листья. */
export function menuLeaves(ready = OTHER_PAGE_READY) {
  return visibleMenu(ready).flatMap((items) =>
    items.flatMap((item) =>
      item.children ? item.children.filter((child) => !child.heading) : [item],
    ),
  );
}

/* Какой лист меню соответствует месту каталога; нет такого — null. Полка важнее группы, группа важнее раздела. */
export function leafOfPlace(
  { category, shelfId = "", groupId = "" },
  ready = OTHER_PAGE_READY,
) {
  const leaves = menuLeaves(ready);
  const shelf = leaves.find(
    (item) =>
      item.route.category === category &&
      item.route.shelf === shelfId &&
      shelfId,
  );
  if (shelf) return shelf;
  const group = leaves.find(
    (item) =>
      item.route.category === category &&
      item.route.group === groupId &&
      groupId &&
      !shelfId,
  );
  if (group) return group;
  if (category === FOR_REDUX) {
    /* Полка из группы меню (например «Дирижабли» внутри «Мест») подсвечивает свою группу. */
    const holder = MENU_EDITOR_GROUPS.find((entry) =>
      entry.editors.includes(shelfId),
    );
    const host =
      holder &&
      (leaves.find((item) => item.route.group === holder.id) ||
        leaves.find((item) => holder.editors.includes(item.route.shelf)));
    if (host) return host;
    return null;
  }
  return (
    leaves.find(
      (item) =>
        item.route.category === category &&
        !item.route.shelf &&
        !item.route.group,
    ) || null
  );
}

/* Подпись пункта и заголовка страницы: слова каталога (раздел называется в меню и в заголовке одинаково), нет такого слова — словарь окна. */
export function menuLabel(words, label) {
  const word = words.label(label);
  return word === label ? tr(label) : word;
}

export { menuEditorOf } from "./menu-editors.js";
