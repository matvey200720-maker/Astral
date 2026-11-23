import { BaseballCap, Beard, Eyeglasses, HandPalm, HandbagSimple, MaskHappy, Pants, PersonSimpleWalk, Scissors, Shield, Sneaker, TShirt } from "../../../../ui/icons.jsx";
import { tr } from "../../../../../locales/ui.js";
import { CLOTHING_CATEGORIES } from "../clothing-categories.js";
import { arcCategories } from "./wear-slots.js";

/*
 * Слоты костюма в колонке инструментов слева (слово владельца 31.10.2026: «шапка, очки, маска, футболка — где собирают свой костюм, перенести
 * в левую часть, как у нас в мастерской оружия. Сделать как обычные инструменты, которые раскрываются, с надписями: шапка, аксессуары, маски»).
 *
 * Дуга круглых кнопок у края кадра (`WearArc`) ушла: слот — такой же инструмент колонки, как «Модели» и «Краска» у оружия. Слоты собраны в группы по телу
 * (`useRailGroups`, описание — `design-qa.md`): значок группы в колонке, а выбор слота внутри неё — переключатель над панелью, значком над словом
 * («Шапки · Аксессуары · Маски»). Щелчок по значку группы открывает тот слот, где человек был в ней в прошлый раз, а в первый заход — первый.
 *
 * Только данные: порядок слотов — тот же, что у дуги (`wear-slots.js`), названия — те же, что у категорий мастерской (`clothing-categories.js`).
 */

const GLYPHS = {
  hats: BaseballCap,
  hair: Scissors,
  accessories: Eyeglasses,
  masks: MaskHappy,
  beards: Beard,
  tshirts: TShirt,
  armor: Shield,
  gloves: HandPalm,
  bags: HandbagSimple,
  pants: Pants,
  shoes: Sneaker,
  tattoos: PersonSimpleWalk,
};

/* Короткое слово слота в переключателе: полное имя категории («Головные уборы», «Бронежилеты») в треть колонки не помещается. */
const PICK = {
  hats: () => tr("Шапки"),
  hair: () => tr("Причёска"),
  accessories: () => tr("Аксессуары"),
  masks: () => tr("Маски"),
  beards: () => tr("Борода"),
  tshirts: () => tr("Верх"),
  armor: () => tr("Броня"),
  gloves: () => tr("Перчатки"),
  bags: () => tr("Сумки"),
  pants: () => tr("Низ"),
  shoes: () => tr("Обувь"),
  tattoos: () => tr("Тело"),
};

/**
 * Группы колонки: голова, торс, ноги, тело. Подписи групп — слова колонки (`label`), а пунктов — короткие слова слотов (`pick`);
 * `tabs` — значок над словом у каждого пункта (сегментов из одних значков нет, `design-qa.md`, п. 13).
 */
export const WEAR_RAIL_GROUPS = Object.freeze([
  { id: "head", ids: ["hats", "hair", "accessories", "masks", "beards"], label: "Голова", icon: <BaseballCap />, tabs: true },
  { id: "torso", ids: ["tshirts", "armor", "gloves", "bags"], label: "Торс", icon: <TShirt />, tabs: true },
  { id: "legs", ids: ["pants", "shoes"], label: "Ноги", icon: <Pants />, tabs: true },
  { id: "tattoos", ids: ["tattoos"], label: "Тело", icon: <PersonSimpleWalk /> },
]);

/** Слоты мастерской одежды как инструменты колонки (в порядке дуги); подписи читаются при каждом вызове, поэтому список пересобирают на смене языка. */
export function wearRailTools() {
  return arcCategories(CLOTHING_CATEGORIES).map((item) => {
    const Glyph = GLYPHS[item.id] || TShirt;
    return {
      id: item.id,
      /* Полное имя категории — в подсказке пункта; в переключателе стоит короткое слово. */
      label: tr(item.title),
      pick: PICK[item.id]?.(),
      icon: <Glyph />,
      group: "wear",
    };
  });
}
