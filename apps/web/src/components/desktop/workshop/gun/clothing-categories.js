import { tr } from "../../../../locales/ui.js";
import { trKey } from "./gun-copy.js";

/*
 * Категории мастерской одежды: тело, потом вещи сверху вниз. Выбор категории — дугой круглых кнопок у края кадра (`wear/WearArc.jsx`):
 * как в Sims, персонаж в центре, слот открывает справа сетку вещей. Прежней «полки» категорий плитками поверх кадра («Редактирую ▾»,
 * «Тело / Одежда») больше нет (владелец, 29.10.2026: «поднос убрать»).
 */

export const CLOTHING_CATEGORIES = Object.freeze([
  { id: "tattoos", title: trKey("Тело"), hint: trKey("татуировки"), group: "body" },
  { id: "tshirts", title: trKey("Верх"), hint: trKey("футболки, куртки"), group: "wear" },
  { id: "pants", title: trKey("Низ"), hint: trKey("штаны, шорты"), group: "wear" },
  { id: "shoes", title: trKey("Обувь"), hint: "", group: "wear" },
  { id: "hats", title: trKey("Головные уборы"), hint: trKey("кепки, шапки"), group: "wear" },
  /* Причёска и борода — вещи, а не только облик манекена (14.11.2026, слово владельца: «заменёнку на какую хочешь бороду… на причёску тоже»). */
  { id: "hair", title: trKey("Причёска"), hint: "", group: "wear" },
  { id: "masks", title: trKey("Маски"), hint: "", group: "wear" },
  { id: "beards", title: trKey("Борода"), hint: "", group: "wear" },
  { id: "gloves", title: trKey("Перчатки"), hint: "", group: "wear" },
  { id: "accessories", title: trKey("Аксессуары"), hint: trKey("очки"), group: "wear" },
  { id: "armor", title: trKey("Бронежилеты"), hint: "", group: "wear" },
  { id: "bags", title: trKey("Сумки"), hint: trKey("рюкзаки"), group: "wear" },
]);

export const clothingCategoryTitle = (id) => {
  const category = CLOTHING_CATEGORIES.find((item) => item.id === id);
  return category
    ? category.group === "body"
      ? `${tr(category.title)} · ${tr(category.hint)}`
      : tr(category.title)
    : "";
};
