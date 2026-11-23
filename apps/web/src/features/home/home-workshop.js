// «Мастерская» на Главной (владелец, 16.11.2026): карточки с настоящими вещами, клик открывает вещь сразу в её редакторе.
//   - оружие: у нового пользователя — штатный карабин игры (`STOCK_GUN`), студия открывается на нём без скина; каталог для этого не нужен (вечер 16.11: вместо «Револьвера»);
//   - одежда: футболка из каталога (`topKindOf`: верх кроя «футболка»), клик открывает её правку (вечер 16.11: вместо «Головных уборов»); нет футболок — другая вещь верха;
//     броня, сумки, шапки и прочие аксессуары не берутся никогда;
//   - остальное: мини-карта, таймцикл, прицел — что найдётся в каталоге.
// Своё вытесняет стартовое: свежий черновик студии ствола или одежды, последний поставленный мод (`HomeContinue.jsx`).
// Выбор — только из каталога, который окно уже держит в памяти: никаких запросов на Главной. Новый при каждом запуске окна, а в пределах запуска стабильный
// (тот же `seed`, а вещь выбирается по наименьшему хешу `seed + id`, а не по номеру в списке — подгрузка каталога выбор не перетасовывает). Нет вещи нужного вида —
// берётся следующий вид. Открывает вещь `openWorkshopWith` → существующий открыватель каталога `features/catalog/mod-editor.js` (`openModEditor`), он тяжёлый и
// подгружается только при наведении или нажатии.
import {
  cloudCatalogIDPattern,
  catalogCategoryForMod,
} from "../../catalog-utils.js";
import { garmentKindOf } from "@modovik/clothing/garment-kinds";
import { hasOwnCover } from "../../utils/catalogMedia.js";
import { partKindOf } from "../catalog/part-kind.js";
import { openingEditor } from "../catalog/editor-opening.js";
import { tr } from "../../locales/ui.js";

/** Виды карточек по порядку: одежда, затем остальное по кругу от `seed` (оружие — штатный карабин, не из каталога). */
export const OTHER_KINDS = Object.freeze(["minimap", "timecycle", "crosshair"]);

/**
 * Штатный карабин игры (слот «Карабинная винтовка» мастерской, id как у `weaponCatalogSlots`): стартовая карточка оружия нового пользователя.
 * Таксономию каталога (48 КБ) в стартовый кусок не тянем — id, имя и кадр здесь; кадр лежит в поставке (`public/assets/catalog/weapons`),
 * а студию на этом слоте открывает `continueStudio({ section: "gunpacks", slot })`.
 */
export const STOCK_GUN = Object.freeze({
  slot: "carbine-rifle",
  name: "Карабинная винтовка",
  image: "/assets/catalog/weapons/carbine-rifle.webp?v=catalog-v6",
  /* Происхождение кадра — только в подсказке (CLAUDE.md): картинка — рендер модели из игры, не кадр игры. */
  hint: "Штатный карабин игры: картинка — рендер его модели из GTA V, не кадр игры",
});

/* Случайное число запуска окна: одно на всю жизнь модуля, поэтому Главная при возврате показывает те же вещи. */
export const SESSION_SEED = Math.floor(Math.random() * 2 ** 32);

const modelOf = (mod) =>
  typeof mod?.model === "string" ? mod.model : mod?.model?.url || "";
const shelfOf = (mod) =>
  [mod.catalogSlot, mod.domain?.weapon?.slot].find(Boolean) ?? "";
const hasPackage = (mod) =>
  Boolean(mod.manifest && mod.packageBaseUrl) ||
  cloudCatalogIDPattern.test(mod.id || "");

/* Хеш строки в число 0…2³²: FNV-1a, дальше перемешивание — одинаково в любом окружении. */
export function hashOf(text, seed) {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}

/* Куда вести «назад» из редактора, открытого с Главной (на Главную, а не на карточку мода): имя страницы для параметра возврата открывателя `openModEditor` (`RETURN_HOME` в `mod-editor.js`:
   тяжёлый модуль сюда статически не тянем, имя одно и то же). Прокрутку и карточку на Главную возвращает `useHomeReturn` (`home-return.js`). */
export const HOME_RETURN_PAGE = "home";

/** Какого вида вещь каталога может открыться в редакторе; «» — никакого. Лёгкая проверка по полям, без тяжёлых модулей: она повторяет вердикт `modEditor` (`features/catalog/mod-editor.js`). */
export function workshopKindOf(mod) {
  if (!mod || !mod.id || mod.internal || !hasOwnCover(mod)) return "";
  if (
    mod.catalogSection === "gunpacks" ||
    catalogCategoryForMod(mod) === "skins"
  ) {
    /* Полка не сверяется со списком полок (`catalog-taxonomy.js` весит 48 КБ и на старте окна ему нечего делать): незнакомую полку отсекает вердикт открывателя. */
    return modelOf(mod) && shelfOf(mod) ? "weapon" : "";
  }
  if (
    mod.catalogSection === "clothing" ||
    catalogCategoryForMod(mod) === "clothing"
  ) {
    const block = mod.domain?.clothing || mod.clothing;
    if (!block || block.category === "tattoos" || !hasPackage(mod)) return "";
    return "clothing";
  }
  const part = partKindOf(mod);
  return OTHER_KINDS.includes(part) && hasPackage(mod) ? part : "";
}

const lowest = (list, seed) => {
  let best = null;
  let bestHash = Infinity;
  for (const mod of list) {
    const h = hashOf(mod.id, seed);
    if (h < bestHash) {
      best = mod;
      bestHash = h;
    }
  }
  return best;
};

/**
 * Верх и его крой. Категория «tshirts» у каталога — весь верх (футболка, худи, куртка), крой называет `garmentKindOf` по названию и хештегам.
 * Броня (`task`), сумки, шапки, перчатки и прочие аксессуары — не верх: пустая строка (вечер 16.11: «бронежилет — не футболка»).
 * Верх, чей крой по словам не узнан, остаётся верхом (`"top"`), но футболкой не считается.
 */
export function topKindOf(mod) {
  const block = mod?.domain?.clothing || mod?.clothing || {};
  if (block.category !== "tshirts") return "";
  if (block.component && !["jbib", "accs"].includes(block.component)) return "";
  const names = [mod.name, ...(Array.isArray(mod.tags) ? mod.tags : [])];
  return garmentKindOf({ component: "jbib", names }) || "top";
}

/**
 * @param {object[]} mods каталог, уже загруженный окном
 * @param {number} seed число запуска окна
 * @param {(mod: object) => boolean=} accepts вердикт открывателя: `Boolean(modEditor(mod) || catalogWorkEditor(mod))` из `features/catalog/mod-editor.js` — вещь, у которой он «нет», не берётся
 * @returns {{ kind: string, mod: object }[]} вещи по порядку: одежда, затем остальное по кругу от `seed` (чего нет — пропущено); оружия здесь нет: на его месте штатный карабин (`STOCK_GUN`)
 */
export function pickWorkshopCards(
  mods,
  seed = SESSION_SEED,
  accepts = () => true,
) {
  const cloth = { tee: [], top: [] };
  const rest = new Map(OTHER_KINDS.map((kind) => [kind, []]));
  for (const mod of Array.isArray(mods) ? mods : []) {
    const kind = workshopKindOf(mod);
    if (!kind || !accepts(mod)) continue;
    if (kind === "clothing") {
      const cut = topKindOf(mod);
      if (cut === "tshirt") cloth.tee.push(mod);
      else if (cut) cloth.top.push(mod);
    } else if (kind !== "weapon") rest.get(kind).push(mod);
  }
  const picked = [];
  /* Футболка; нет её — другая вещь верха; нет и верха — места одежды в выборе нет (броня и аксессуары не подходят). */
  const clothing = lowest(
    [cloth.tee, cloth.top].find((list) => list.length) || [],
    seed ^ 0x9e3779b9,
  );
  if (clothing) picked.push({ kind: "clothing", mod: clothing });
  const turn = seed % OTHER_KINDS.length;
  for (let k = 0; k < OTHER_KINDS.length; k += 1) {
    const kind = OTHER_KINDS[(turn + k) % OTHER_KINDS.length];
    const mod = lowest(rest.get(kind), seed ^ (0x85ebca6b + k));
    if (mod) picked.push({ kind, mod });
  }
  return picked;
}

/**
 * Единая точка входа «открыть вещь в мастерской» для Главной: `openWorkshopWith({ kind, modId, variantId }, { mods, navigate, language, installed })`.
 * Вид и вещь называются, редактор выбирает существующий `openModEditor` каталога (оружие — студия этого ствола, одежда — редактор на этой вещи с буквой расцветки
 * `variantId`, остальное — свой редактор); второго пути нет, `presetWorkshopEditor` и `navigate("workshop")` Главная сама не зовёт. `pick` — ключ карточки блока, с которой открыли:
 * вместе с прокруткой окна в этот миг уходит в открыватель (`returnTop`, `returnPick`), и «назад» возвращает Главную на то же место и на ту же карточку. Открытие идёт под экраном
 * «Готовлю редактор…» (`openingEditor`, как у страницы мода): повторный щелчок, пока он идёт, безопасен и ничего не делает. Возвращает `true`, если редактор открылся;
 * не открылся — `false`, и человек остаётся на Главной (карточка скажет об этом).
 */
export async function openWorkshopWith(
  { kind: _kind, modId, variantId = "", pick = "" },
  {
    mods = [],
    navigate,
    language = "ru",
    installed = null,
    returnPage = HOME_RETURN_PAGE,
    load = () => import("../catalog/mod-editor.js"),
  } = {},
) {
  const mod = mods.find((one) => one.id === modId);
  if (!mod || typeof navigate !== "function") return false;
  const top =
    typeof document === "undefined"
      ? 0
      : (document.querySelector(".desktop-main")?.scrollTop ?? 0);
  const settings = {
    mods,
    navigate,
    locale: language,
    installed,
    colour: variantId,
    returnPage,
    returnTop: top,
    returnPick: pick,
  };
  return openingEditor(
    { title: "", label: tr("Готовлю редактор по файлам мода…"), top },
    async () => {
      const { openModEditor } = await load();
      return openModEditor(mod, settings);
    },
  ).catch(() => false);
}

/** Греет открыватель, пока рука идёт к карточке: к нажатию подгружен. */
export const warmWorkshopOpener = (
  load = () => import("../catalog/mod-editor.js"),
) => void load().catch(() => {});
