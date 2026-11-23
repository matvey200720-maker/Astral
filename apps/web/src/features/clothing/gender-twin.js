import { variantSiblings } from "../../catalog-utils.js";
import { foldSearchText } from "../catalog/search-text.js";
import { clothingOf } from "./clothing-catalog.js";

/*
 * Женский вариант замены (ТЗ 27.10.2026, п. 3.5; слова ведущего: «в GTA одежда привязана к модели педа: mp_m_freemode_01 — мужской,
 * mp_f_freemode_01 — женский. Есть в моде файлы mp_f_ — женский вариант есть, установка ставит обе стороны, в окне видны и женские вещи.
 * Нет — только мужской. Мужскую сетку на женского не переносим: скелет другой»).
 *
 * Как это лежит в данных. Один мод каталога — один пакет — одна модель одного пола (`describeClothingPackage` в Desktop отказывает
 * пакету с несколькими моделями). Мужской и женский файл одной вещи — два мода одной группы вариантов (`domain.variant.group`: разбор
 * сводит их по отпечатку геометрии и текстуры, `packages/publishing/clothing-variants.js`). Поэтому «в моде есть файлы mp_f_» — это
 * «в группе вариантов есть мод, чьи файлы лежат в папке персонажа другого пола». Пол мода берётся из имён его файлов (`entry`
 * манифеста: `astral_stream_00.rpf/mp_f_freemode_01_…/jbib_012_u.ydd`), а нет манифеста — из блока одежды карточки: его разбор выводит
 * из тех же папок. Если файлы и карточка расходятся — верят файлам.
 */

const FOLDER = /(?:^|\/)mp_([mf])_freemode_01/i;

/** Пол по именам файлов пакета: `male`, `female` или `null` (файлов нет, пол смешан, манифеста нет). */
export function fileGenderOf(mod) {
  const found = new Set();
  for (const file of Array.isArray(mod?.manifest?.files) ? mod.manifest.files : []) {
    const match = FOLDER.exec(String(file?.entry || ""));
    if (match) found.add(match[1].toLowerCase() === "f" ? "female" : "male");
  }
  return found.size === 1 ? [...found][0] : null;
}

/** Пол мода: по файлам пакета, иначе по блоку одежды карточки. */
export const genderOfMod = (mod) => fileGenderOf(mod) || clothingOf(mod)?.gender || null;

/** Мод того же набора для другого пола или `null`: мужской для женского и наоборот. */
export function genderTwin(mod, mods = []) {
  const block = clothingOf(mod);
  const gender = genderOfMod(mod);
  if (!gender || !block?.component || block.retexture || block.ownPlaces) return null;
  for (const item of variantSiblings(mod, mods)) {
    if (item.id === mod.id) continue;
    const other = clothingOf(item);
    const otherGender = genderOfMod(item);
    if (
      other &&
      otherGender &&
      otherGender !== gender &&
      other.component === block.component &&
      other.category === block.category &&
      !other.retexture &&
      !other.ownPlaces
    )
      return item;
  }
  return null;
}

const same = (left, right) => foldSearchText(left || "") === foldSearchText(right || "");

/**
 * Вещь другого пола, парная выбранной: тот же вид, проект (или игра), имя и — если у обеих он есть — магазин.
 * `candidates` — вещи в том же списке окна; берутся только другого пола. Пары нет или их несколько — `null`.
 */
export function twinItem(item, candidates = []) {
  if (!item?.name || !item.gender) return null;
  const found = candidates.filter(
    (candidate) =>
      candidate.gender &&
      candidate.gender !== item.gender &&
      candidate.component === item.component &&
      (candidate.server || null) === (item.server || null) &&
      same(candidate.name, item.name) &&
      (!item.shop || !candidate.shop || same(candidate.shop, item.shop)),
  );
  return found.length === 1 ? found[0] : null;
}
