import { catalogCategoryForMod, cloudCatalogIDPattern, isCatalogBundle } from "../../catalog-utils.js";
import { catalogLandingSlots, workshopWeaponSlots } from "../../catalog-taxonomy.js";
import { modModelUrl } from "../../components/desktop/catalog/ModModelPreview.jsx";
import { isTattooPack } from "../clothing/clothing-catalog.js";
import { WEAR_EXTRA_SLOTS, wearSlotOfMod } from "./clothing-sections.js";
import { modColoursOf } from "../clothing/colour-mapping.js";
import { isCatalogWork } from "../workshop/works/catalog-work.js";
import { partKindOf } from "./pack-contents.js";
import { workshopSlotOf } from "./bundles/component-works.js";
import { openPartInWorkshop, partWorkshopKind } from "./part-workshop.js";
import { isEditableSound, openSoundInWorkshop } from "./sound-workshop.js";

// Подраздел → вид студии. Обычный объект: поиск по имени идёт как по свойству.
const STUDIO_BY_SUBCATEGORY = { "Мини-карты": "minimap" };

// Пакет вещи: манифест и адрес пакета своего каталога либо облачный uuid в id.
function hasPackage(mod) {
  const own = Boolean(mod.manifest && mod.packageBaseUrl);
  return own || cloudCatalogIDPattern.test(mod.id || "");
}

const modelOf = (mod) => "catalog:" + mod.id;

const weaponShelfOf = (mod) => [mod.catalogSlot, mod.domain?.weapon?.slot].find(Boolean) ?? "";

// Динамические соседи: страница мода не тянет их, пока кнопку не нажали.
const LAZY = {
  returnMemory: () => import("./editor-return.js"),
  works: () => import("../workshop/works/catalog-work.js"),
  registry: () => import("../workshop/useWorkshopEditors.jsx"),
  clothingModels: () => import("../../components/desktop/workshop/gun/clothing-models.js"),
};

// Параметры openModEditor и их умолчания (подставляются только вместо undefined).
/*
 * `returnPage` — куда ведёт «назад» из редактора: `"detail"` (по умолчанию) — на карточку мода (`returnTo`), `"home"` — на Главную (port-shell, карточки настоящих вещей в блоке «Мастерская»). Значение живёт только
 * в одном открытии: каждый вызов заново ставит его в реестре редакторов (`presetWorkshopEditor`), «залипнуть» ему негде. Остальное возвращается тем же: `returnTop` — прокрутка страницы, `returnPick` — выбранное на ней.
 */
export const RETURN_DETAIL = "detail";
/* `"cart"` — в корзину (владелец, 16.11.2026): работа открыта щелчком по названию в корзине, «назад» приводит на страницу, откуда корзину открыли (`features/cart/cart-return.js`). */
export const RETURN_CART = "cart";
export const RETURN_HOME = "home";
const returnPageOf = (page) => (page === RETURN_HOME || page === RETURN_CART ? page : RETURN_DETAIL);

const OPTION_DEFAULTS = { mods: Object.freeze([]), locale: "ru", returnTo: null, returnTop: null, returnPick: "", returnPage: RETURN_DETAIL, installed: null, weapon: "", colour: "" };

function settle(options) {
  const settled = { navigate: options.navigate };
  for (const [name, fallback] of Object.entries(OPTION_DEFAULTS)) {
    settled[name] = options[name] === undefined ? fallback : options[name];
  }
  settled.returnPage = returnPageOf(settled.returnPage);
  return settled;
}

function toWorkshop(navigate) {
  navigate("workshop");
  return true;
}

// Стадии выбора редактора по порядку: undefined — дальше, иначе ответ (в том числе null).
const STAGES = [
  function gate(mod) {
    const closed = !mod || !mod.id || isCatalogBundle(mod) || isCatalogWork(mod);
    return closed ? null : undefined;
  },
  function sound(mod) {
    if (isEditableSound(mod)) return { kind: "sound", sound: true };
  },
  function byFiles(mod) {
    const kind = partWorkshopKind(mod);
    if (kind) return kind === "minimap" ? { kind, part: true, copyKey: "minimap-part" } : { kind, part: true };
  },
  function farFromLargeMap(mod, hold) {
    hold.category = mod.catalogCategory || catalogCategoryForMod(mod);
    hold.slot = mod.catalogSlot || "";
    if (hold.slot === "large-map" || mod.catalogSubcategory === "Большая карта") return null;
  },
  function weapon(mod, hold) {
    if (mod.catalogSection !== "gunpacks" && hold.category !== "skins") return undefined;
    const shelf = weaponShelfOf(mod);
    const model = modModelUrl(mod);
    const known = workshopWeaponSlots.some((slot) => slot.id === shelf);
    return model && known ? { kind: "weapon", section: "gunpacks", slotId: shelf, model: modelOf(mod) } : null;
  },
  function clothing(mod, hold) {
    if (mod.catalogSection !== "clothing" && hold.category !== "clothing") return undefined;
    /* Причёска и борода — слоты `hair` и `beards` (одна `clothingSectionOf` с подкатегориями каталога), в посадочных слотах их нет. */
    const shelf = wearSlotOfMod(mod);
    const listed = WEAR_EXTRA_SLOTS.includes(shelf) || (catalogLandingSlots.clothing ?? []).some((slot) => slot.id === shelf);
    if (!shelf || !listed || !hasPackage(mod) || isTattooPack(mod)) return null;
    return { kind: "clothing", section: "clothing", slotId: shelf, model: modelOf(mod) };
  },
  function studio(mod, hold) {
    const kind = hold.slot === "minimap" ? "minimap" : STUDIO_BY_SUBCATEGORY[mod.catalogSubcategory];
    return kind ? { kind, section: mod.catalogSection || "redux", slotId: kind } : null;
  },
];

export function modEditor(mod) {
  const hold = {};
  for (const stage of STAGES) {
    const verdict = stage(mod, hold);
    if (verdict !== undefined) return verdict;
  }
  return null;
}

export function catalogWorkEditor(mod) {
  const reduxWork = isCatalogWork(mod) && mod.catalogSection === "redux";
  return reduxWork ? { kind: partKindOf(mod), part: true, work: true } : null;
}

// Запросы реестру редакторов по виду ветки.
const withNeighbours = (mod, mods, accepts) => [mod, ...mods.filter((other) => other.id !== mod.id)].filter(accepts);

const QUERIES = {
  weapon(editor, mod, mods) {
    const sameShelf = (one) => one.catalogSection === "gunpacks" && weaponShelfOf(one) === editor.slotId;
    return { slotId: editor.slotId, section: "gunpacks", model: editor.model, catalog: withNeighbours(mod, mods, sameShelf) };
  },
  async clothing(editor, mod, mods, colour) {
    const { clothingCatalogItems } = await LAZY.clothingModels();
    const sameShelf = (one) => one.catalogSection === "clothing" && wearSlotOfMod(one) === editor.slotId;
    const tiles = clothingCatalogItems(withNeighbours(mod, mods, sameShelf));
    return { slotId: editor.slotId, section: "clothing", model: editor.model, catalog: tiles.map((tile) => paintTile(tile, mod, colour)) };
  },
  studio({ slotId, section }, { id, name }) {
    return { slotId, section, variant: { id, name } };
  },
};

// Плитка открываемой вещи получает букву расцветки и, если у цвета есть кадр, обложку.
function paintTile(tile, mod, colour) {
  if (!colour || tile.id !== mod.id) return tile;
  const found = modColoursOf(mod).find((one) => one.letter === colour || one.letters?.includes(colour));
  return Object.freeze({ ...tile, colour, ...(found?.image ? { cover: found.image } : {}) });
}

const queryFor = (editor, ...rest) => (editor.kind === "weapon" || editor.kind === "clothing" ? QUERIES[editor.kind] : QUERIES.studio)(editor, ...rest);

// Способы открыть редактор; признак на описании решает, какой.
const LAUNCHERS = [
  [
    "work",
    async ({ mod, navigate }) => {
      const { openCatalogWork } = await LAZY.works();
      await openCatalogWork(mod);
      return toWorkshop(navigate);
    },
  ],
  [
    "part",
    async ({ mod, navigate, locale, returnTo, installed, returnPage }) => {
      await openPartInWorkshop(mod, { navigate, locale, owner: returnTo, installed, returnPage });
      return true;
    },
  ],
  ["sound", ({ mod, navigate, locale, weapon, returnPage }) => openSoundInWorkshop(mod, { navigate, locale, weapon, returnPage })],
];

async function openByRegistry({ editor, mod, mods, navigate, locale, colour, returnPage }) {
  const [registry, query] = await Promise.all([LAZY.registry(), queryFor(editor, mod, mods, colour)]);
  const opened = registry.presetWorkshopEditor(query, { locale, returnPage });
  return opened ? toWorkshop(navigate) : false;
}

/* Запись возврата: страница-владелец — карточка (`page`) или, при `returnPage: "home"`, Главная (`HOME_RETURN_ID` в `editor-return.js`). */
async function rememberReturn(page, top, pick = "", returnPage = RETURN_DETAIL) {
  const { rememberEditorReturn, homeReturnEntry } = await LAZY.returnMemory();
  /* Не вооружена: вернуть она может только после «назад» (`confirmEditorReturn` в `close()` реестра), а не при любом заходе на эту карточку. */
  rememberEditorReturn(returnPage === RETURN_HOME ? homeReturnEntry() : page, top, pick, false);
}

/**
 * «Сделать в мастерской» у компонента сборки: редактор того же вида открывается от стандартной основы (без файлов этой части), готовая
 * работа потом ставится на место компонента из окна «Компоненты». Вида без редактора — нет: действия тоже нет (`hasStandardEditor`).
 */
export async function openStandardEditor(part, options = {}) {
  const given = settle(options);
  const place = workshopSlotOf(part);
  if (!place || typeof given.navigate !== "function") return false;
  const registry = await LAZY.registry();
  if (!registry.workshopEditorExists(place)) return false;
  await rememberReturn(given.returnTo || part, given.returnTop, given.returnPick, given.returnPage);
  const opened = registry.presetWorkshopEditor(place, { locale: given.locale, returnPage: given.returnPage });
  return opened ? toWorkshop(given.navigate) : false;
}

export const hasStandardEditor = (part) => workshopSlotOf(part) !== null;

export async function openModEditor(mod, options = {}) {
  const given = settle(options);
  const editor = modEditor(mod) || catalogWorkEditor(mod);
  if (!(editor && typeof given.navigate === "function")) return false;

  await rememberReturn(given.returnTo || mod, given.returnTop, given.returnPick, given.returnPage);
  const launcher = LAUNCHERS.find(([flag]) => editor[flag]);
  return launcher ? launcher[1]({ ...given, editor, mod }) : openByRegistry({ ...given, editor, mod });
}
