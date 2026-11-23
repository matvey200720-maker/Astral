/*
 * Подкатегории «Одежды» в каталоге (владелец, 14.11.2026: «одежду можно было раскрывать и смотреть там подкатегории, как ганпаки…
 * верх, низ, борода, маски, татуировки, перчатки, ногти… рюкзаки»). Вид вещи — из карточки (`domain.clothing`): категория, компонент
 * педа и подвид. Верхних ключей карточки нет (у облачных карточек строгий контракт, тегов сервер не хранит): подвид едет внутри свободного
 * блока `domain.clothing.subkind` — `"beard"` (категория `masks`), `"nails"` и `"gloves"` (категория `gloves`); его пишет конвейер карточек. Запасной путь для
 * локальных карточек и работ авторов — тег «борода» / «ногти» у самой карточки.
 *
 * Порядок — сверху вниз по телу. Вещь стоит ровно в одной подкатегории: у подвида («Бороды», «Ногти», «Нижний слой») есть условие,
 * и он забирает вещь, только когда условие сработало; без него вещь остаётся в «материнской» («Маски», «Перчатки», «Верх»).
 * Подпись — русский ключ: слова языка берёт отрисовка (`catalog-words.js`).
 */
import { shelfOfCategory } from "@modovik/clothing/taxonomy";
import { clothingOf } from "../clothing/clothing-catalog.js";

/* Подвид из блока карточки как он лежит в данных: `normalizeClothingCard` берёт только известные ключи, `subkind` в проверенный блок не попадает — читается из исходного. */
const subkindOf = (mod) => {
  const raw = mod?.domain?.clothing || mod?.clothing;
  return raw && typeof raw.subkind === "string"
    ? raw.subkind.trim().toLowerCase()
    : "";
};

/* Запасной путь: теги самой карточки («борода», «ногти»). Решётка и регистр не важны. */
const plainTag = (tag) => String(tag).trim().replace(/^#/, "").toLowerCase();
const taggedWith = (mod, words) =>
  Array.isArray(mod?.tags) &&
  mod.tags.some((tag) => words.includes(plainTag(tag)));

/* Подвид сработал: у карточки есть `subkind` — решает он («gloves» — обычные перчатки, даже с тегом «ногти»); нет — один из тегов. */
const subkind =
  (kind, ...tags) =>
  (block, mod) => {
    const own = subkindOf(mod);
    return own ? own === kind : taggedWith(mod, tags);
  };

const section = (id, label, kinds, when = null) =>
  Object.freeze({ id, label, kinds: Object.freeze(kinds), when });

/* id | подпись | категории карточки | подвид (условие над блоком одежды и модом). */
export const CLOTHING_SECTIONS = Object.freeze([
  section("hats", "Головные уборы", ["hats"]),
  section("hair", "Причёски", ["hair"]),
  section("masks", "Маски", ["masks"]),
  section("beards", "Бороды", ["masks"], subkind("beard", "борода", "бороды")),
  section("glasses", "Очки", ["glasses"]),
  section("ears", "Серьги", ["ears"]),
  section("tshirts", "Верх", ["tshirts"]),
  section(
    "underlayer",
    "Нижний слой",
    ["tshirts"],
    (block) => block.component === "accs",
  ),
  section("armor", "Бронежилеты", ["armor"]),
  section("gloves", "Перчатки", ["gloves"]),
  section("nails", "Ногти", ["gloves"], subkind("nails", "ногти", "ноготь")),
  section("watches", "Часы и браслеты", ["watches", "bracelets"]),
  section("accessories", "Аксессуары", ["accessories"]),
  section("bags", "Сумки и рюкзаки", ["bags"]),
  section("pants", "Низ", ["pants"]),
  section("shoes", "Обувь", ["shoes"]),
  section("tattoos", "Татуировки", ["tattoos"]),
  /* Виды без пожеланий владельца, но с настоящими карточками: пустые меню прячет, а вещь не должна пропасть из выбора по виду. */
  section("decals", "Нашивки", ["decals"]),
  section("government-clothing", "Госодежда", ["government-clothing"]),
]);

/* Подкатегория вещи: id из `CLOTHING_SECTIONS` или null (нет блока одежды — комплект и прочее без вида). */
export function clothingSectionOf(mod) {
  const block = clothingOf(mod);
  if (!block) return null;
  const own = CLOTHING_SECTIONS.filter((item) =>
    item.kinds.includes(block.category),
  );
  const found =
    own.find((item) => item.when?.(block, mod)) ??
    own.find((item) => !item.when);
  return found ? found.id : null;
}

/*
 * Вещи каталога для слота мастерской одежды (14.11.2026): «Борода» — маски с тегом «борода» (то же правило, что у подкатегории «Бороды»), «Маски» — без них; остальные слоты — как отдаёт индекс.
 * `index.modsForSlot(раздел, слот)` — `createWorkshopModIndex`.
 */
export function wearSlotMods(index, slot) {
  if (slot === "beards")
    return index
      .modsForSlot("clothing", "masks")
      .filter((mod) => clothingSectionOf(mod) === "beards");
  const mods = index.modsForSlot("clothing", slot);
  return slot === "masks"
    ? mods.filter((mod) => clothingSectionOf(mod) !== "beards")
    : mods;
}

/* Слоты мастерской одежды, которых нет в списке «посадочных» слотов каталога (`catalogLandingSlots.clothing`, там их не заводят): причёска и борода — вещи мастерской (14.11.2026). */
export const WEAR_EXTRA_SLOTS = Object.freeze(["hair", "beards"]);

/*
 * Слот мастерской одежды для карточки каталога («Открыть в мастерской», соседи по слоту; ревью №2): причёска — `hair`, борода — `beards` (решает та же `clothingSectionOf`, второго списка нет:
 * иначе борода открывалась бы как маска и прятала причёску облика); остальные — полка категории (очки и часы — «Аксессуары»).
 */
export function wearSlotOfMod(mod) {
  const section = clothingSectionOf(mod);
  if (section === "hair" || section === "beards") return section;
  return shelfOfCategory(mod?.catalogSlot || clothingOf(mod)?.category || "");
}
