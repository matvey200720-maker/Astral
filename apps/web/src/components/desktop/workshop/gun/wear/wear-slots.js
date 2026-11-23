import { localVariant } from "@modovik/clothing/gender";

/*
 * Порядок слотов и панель слота мастерской одежды (ТЗ 29.10.2026-d): чистые функции — порядок слотов (дуга до 31.10.2026, теперь колонка слева, `wear-rail.jsx`), поиск
 * «Название или номер» и фильтр «Все / Каталог / GTA V / Мои». Без React и без сцены: считает и проверяется отдельно.
 */

/*
 * Порядок слотов — сверху вниз по телу: голова, лицо, верх, руки, сумка, ноги, ступни; «Тело» (татуировки) — последним. Берём
 * ровно те категории, что есть у мастерской (`CLOTHING_CATEGORIES`); отдельных слотов «уши», «шея», «часы» и «браслет» у
 * неё нет — их вещи лежат в «Аксессуарах».
 */
/*
 * Маска и борода — одно место `berd` (14.11.2026, слово ведущей): в игре вместе они не носятся — на фигуре и в реестре надетого остаётся одна. Соперник слота:
 * надевание снимает его (`wearInSlot`, `wear-outfit.js`), а в запрос к Desktop он не попадает никогда (`outfitWorn`, `outfit-paint.js`) — и в правке тоже.
 */
export const BERD_RIVAL = Object.freeze({ masks: "beards", beards: "masks" });

/**
 * Заменена ли причёска облика вещью-причёской (слова «Заменена вещью» у листалки облика; ревью №5): в «Одеть» — надета вещь слота «Причёска»; в правке слота «Причёска» — только когда вещь
 * слота выбрана (`model` не пуст и не «Без вещи»), иначе на фигуре по-прежнему причёска облика и слова были бы неверными.
 */
export const hairReplaced = ({ dressMode = false, wornHair = "", slotKey = "", model = null } = {}) =>
  Boolean(wornHair) || (!dressMode && slotKey === "hair" && Boolean(model) && model.source !== "bare");

export const WEAR_ARC_ORDER = Object.freeze([
  "hats",
  "hair",
  "accessories",
  "masks",
  "beards",
  "tshirts",
  "armor",
  "gloves",
  "bags",
  "pants",
  "shoes",
  "tattoos",
]);

/** Категории мастерской в порядке слотов; чего нет в списке — в конец, как есть. */
export function arcCategories(categories) {
  const rank = (id) => {
    const place = WEAR_ARC_ORDER.indexOf(id);
    return place < 0 ? WEAR_ARC_ORDER.length : place;
  };
  return [...categories].sort((a, b) => rank(a.id) - rank(b.id));
}

const fold = (value) =>
  String(value ?? "")
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е");

/** Номер вещи игры (номер заплатки Rockstar) — число или пусто; у вещей каталога номера нет. У женской вещи — её номер в игре, без смещения «Моделей». */
export const itemNumber = (variant) => (Number.isInteger(variant?.variant) && variant.variant >= 0 ? localVariant(variant.variant) : null);

/** Пол вещи в «Моделях»: у вещи без пола (встроенная, прежняя из каталога) — мужской, как и было. */
export const itemGender = (variant) => (variant?.gender === "female" ? "female" : "male");

/**
 * Какое тело ставить в слоте «Тело» (ревью 14.11.2026, п. 3): тело пола фигуры. Уже стоит оно — ничего; стоит тело другого пола — меняется (человек просил другую фигуру); встроенная модель или пусто — тоже,
 * если человек сам не выбирал модель (`picked`). Тела нужного пола в списке ещё нет (женский список приходит позже) — `null`, мужское под женским кадром не ставится.
 */
export function bodyToPick({ variants, model, figure, picked = false }) {
  const body = variants.find((item) => item.body && itemGender(item) === figure);
  if (!body || model?.id === body.id) return null;
  const wrongBody = Boolean(model?.body) && itemGender(model) !== figure;
  return wrongBody || (!picked && (!model || model.source === "builtin")) ? body : null;
}

/** Вещи одного пола; свои (`custom`) и вещи каталога без пола («на оба пола») остаются на месте при любом значении (слово владельца 14.11.2026); вещь игры и встроенная без пола — мужская, как и было. */
export const filterByGender = (variants, gender) =>
  variants.filter((item) => item.source === "custom" || (item.source === "catalog" && !item.gender) || itemGender(item) === gender);

/**
 * Поиск «Название или номер»: слова запроса — по названию и источнику, число — ещё и по номеру вещи (точно «12» или
 * начало «№12»). Пустой запрос — всё как есть. `names` отдаёт названия вещи, что показывает окно (перевод).
 */
export function searchVariants(variants, query, names = (item) => [item.name]) {
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return variants;
  return variants.filter((item) => {
    const number = itemNumber(item);
    const text = fold([...names(item), item.packName, item.source].filter(Boolean).join(" "));
    return tokens.every((token) => {
      const bare = token.replace(/^№|^#/, "");
      if (/^\d+$/.test(bare) && number !== null && String(number).startsWith(bare)) return true;
      return text.includes(token);
    });
  });
}

/** Группа фильтра у вещи: из игры, из каталога или своя. Источники групп — у профиля (`modelOrigins`). */
export function groupOf(variant, origins = []) {
  if (variant?.source === "custom") return "mine";
  return origins.find((origin) => origin.sources.includes(variant?.source))?.value || "game";
}

/** Фильтр списка: `all` — всё, остальное — по группе (`game`, `catalog`, `mine`). */
export const filterVariants = (variants, filter, origins) =>
  filter === "all" ? variants : variants.filter((item) => groupOf(item, origins) === filter);
