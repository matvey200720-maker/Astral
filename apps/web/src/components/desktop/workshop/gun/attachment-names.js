import { trKey } from "./gun-copy.js";

/*
 * Подписи обвесов (задача 6 ТЗ 17.10.2026, вторая половина) — по имени
 * обвеса в игре (`COMPONENT_AT_SCOPE_MEDIUM_MK2`), а не по английской
 * строке из чужого справочника. Здесь — русские ключи словаря; переводит
 * их окно в месте отрисовки (`tr`).
 */

/* Кость — по виду её обвесов. */
const POINT = Object.freeze({
  clip: trKey("Магазин и патроны"),
  barrel: trKey("Сменный ствол"),
  supp: trKey("Дуло"),
  muzzle: trKey("Дуло"),
  scope: trKey("Оптика"),
  flash: trKey("Фонарь на стволе"),
  grip: trKey("Рукоять"),
  cover: trKey("Планка"),
  camo: trKey("Камуфляж"),
  other: trKey("Обвес"),
});

/** Подпись кости ствола: «Магазин», «Дуло», «Камуфляж затвора»… */
export function pointLabel(point) {
  /* У пистолетов MK2 вторая кость камуфляжа — затвор. */
  if (point.kind === "camo" && /^wapscop/i.test(point.bone)) return trKey("Камуфляж затвора");
  return POINT[point.kind] || POINT.other;
}

const CLIPS = Object.freeze([
  [/_CLIP_TRACER$/, trKey("Трассирующие патроны")],
  [/_CLIP_INCENDIARY$/, trKey("Зажигательные патроны")],
  [/_CLIP_ARMORPIERCING$/, trKey("Бронебойные патроны")],
  [/_CLIP_FMJ$/, trKey("Цельнооболочечные патроны")],
  [/_CLIP_HOLLOWPOINT$/, trKey("Экспансивные патроны")],
  [/_CLIP_EXPLOSIVE$/, trKey("Разрывные патроны")],
  [/_CLIP_01$/, trKey("Штатный магазин")],
  [/_CLIP_02$/, trKey("Увеличенный магазин")],
]);

const MUZZLES = Object.freeze([
  trKey("Плоский дульный тормоз"),
  trKey("Тактический дульный тормоз"),
  trKey("Дульный тормоз с утолщением"),
  trKey("Точный дульный тормоз"),
  trKey("Усиленный дульный тормоз"),
  trKey("Скошенный дульный тормоз"),
  trKey("Раздвоенный дульный тормоз"),
  trKey("Квадратный дульный тормоз"),
  trKey("Дульный тормоз-раструб"),
]);

const SCOPES = Object.freeze([
  [/_PI_RAIL/, trKey("Прицел на рамке")],
  [/_SIGHTS/, trKey("Голографический прицел")],
  [/_SIGHT_01$/, trKey("Штатный прицел")],
  [/_SCOPE_MACRO/, trKey("Малый прицел")],
  [/_SCOPE_SMALL(_SMG)?_MK2$/, trKey("Средний прицел")],
  [/_SCOPE_MEDIUM_MK2$/, trKey("Большой прицел")],
  [/_SCOPE_LARGE(_FIXED_ZOOM)?_MK2$/, trKey("Прицел с увеличением")],
  [/_SCOPE_MAX$/, trKey("Продвинутый прицел")],
  [/_SCOPE_NV$/, trKey("Ночной прицел")],
  [/_SCOPE_THERMAL$/, trKey("Тепловизионный прицел")],
]);

const CAMOS = Object.freeze([
  [/_IND_01(_SLIDE)?$/, trKey("Патриот")],
  [/_VARMOD_XM3(_SLIDE)?$/, trKey("Праздничная отделка")],
  [/_CAMO(_SLIDE)?$/, trKey("Цифровой камуфляж")],
  [/_CAMO_02(_SLIDE)?$/, trKey("Мазки кистью")],
  [/_CAMO_03(_SLIDE)?$/, trKey("Лесной камуфляж")],
  [/_CAMO_04(_SLIDE)?$/, trKey("Черепа")],
  [/_CAMO_05(_SLIDE)?$/, "Sessanta Nove"],
  [/_CAMO_06(_SLIDE)?$/, trKey("Персей")],
  [/_CAMO_07(_SLIDE)?$/, trKey("Леопард")],
  [/_CAMO_08(_SLIDE)?$/, trKey("Зебра")],
  [/_CAMO_09(_SLIDE)?$/, trKey("Геометрия")],
  [/_CAMO_10(_SLIDE)?$/, trKey("Бум!")],
]);

const first = (rules, id) => rules.find(([pattern]) => pattern.test(id))?.[1] || null;

/** Подпись обвеса — русский ключ словаря. */
export function componentLabel(component) {
  const id = String(component?.id || "");
  const model = String(component?.model || "");
  switch (component?.kind) {
    case "clip":
      return (
        first(CLIPS, id) ||
        (/drum/.test(model) ? trKey("Барабанный магазин") : /box/.test(model) ? trKey("Коробчатый магазин") : trKey("Большой магазин"))
      );
    case "barrel":
      return /_02$/.test(id) ? trKey("Тяжёлый ствол") : trKey("Штатный ствол");
    case "muzzle":
      return MUZZLES[Number(/_(\d{2})$/.exec(id)?.[1] || 1) - 1] || trKey("Дульный тормоз");
    case "supp":
      return /_COMP/.test(id) ? trKey("Компенсатор") : trKey("Глушитель");
    case "scope":
      return first(SCOPES, id) || trKey("Оптический прицел");
    case "flash":
      return trKey("Тактический фонарь");
    case "grip":
      return trKey("Рукоять");
    case "cover":
      return trKey("Накладка на планку");
    case "camo":
      return first(CAMOS, id) || trKey("Камуфляж");
    default:
      return trKey("Обвес");
  }
}
