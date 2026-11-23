/*
 * Какие формы выбранной перчатки получат модель набора перчаток мода (правило общей ведущей, 16.11.2026): есть отметка блока — ставим как раньше, отметки нет — формы без пары не трогаем.
 *
 * Набор перчаток — несколько моделей, по одной на крой торса (`glove-forms.js`). Место формы в блоке известно у вещей игры (блок из 11 форм, тип торса; блоки других размеров — по месту в блоке) и у номеров самого автора мода
 * (подряд идущие номера): отметка `glove` на самой форме. Подбор по таким данным — `matchGloveForms`, и «ближайший крой» там — подбор по известному, об этом окно говорит прежней строкой.
 * У строк и групп сервера (`extra.look`, 16.11.2026) отметки блока нет: о виде руки ничего не известно, а позиция в группе без признака формы — сдвиг, а не пара.
 *   1. Форма без отметки блока не трогается (остаётся как в игре); окно говорит «подойдёт к N из M форм», в запрос установки идут только формы с парой.
 *   2. Ни одной формы с отметкой нет — плитка для этого мода (из нескольких форм) не предлагается.
 *   3. Мод из одной модели (ногти, вид `pick`, набор с одной формой) ставится на все формы одной моделью.
 */
import { matchGloveForms } from "@modovik/clothing/glove-forms";

/**
 * Само место вещи, а не плитка: у плитки-группы (`lookTiles`) «лицо» — копия первой формы, и её `glove` — запасная отметка размера 1 (`gloveTiles`), а не настоящее место в блоке. Настоящая отметка лежит у формы в `together`.
 */
export const rawPlace = (item) =>
  item?.together?.find((place) => place.key === item.key) || item;

/** Формы плитки (или выбранные места): сырые места, без запасных отметок плитки. */
export const placesOfTile = (tile) =>
  (tile?.together?.length ? tile.together : [tile]).filter(Boolean);

/** Ключ места, как его знает запрос установки: папка (строчными) и номер. */
export const placeKey = (item) =>
  `${String(item.folder || "").toLowerCase()}|${item.drawable}`;

/**
 * Пары набора перчаток с формами цели. `own` — формы мода (`modGloveForms`: `[{ drawable, index, size }]`), `places` — места цели (плитка или `state.chosen`).
 * Ответ: `pairs` — формы с отметкой блока (`[{ target, source, exact }]`: точный крой торса или ближайший), `total` — сколько форм у цели, `count` — у скольких есть пара,
 * `single` — мод из одной модели, `notExact`/`unused` — как у `matchGloveForms` (по формам с отметкой).
 */
export function gloveFitFor(own, places) {
  const raw = (places || []).map(rawPlace).filter(Boolean);
  const total = raw.length;
  if (!own?.length)
    return {
      pairs: [],
      total,
      count: 0,
      single: false,
      notExact: 0,
      unused: 0,
    };
  if (own.length === 1)
    return {
      pairs: raw.map((place) => ({
        target: { drawable: place.drawable, folder: place.folder },
        source: own[0],
        exact: true,
      })),
      total,
      count: total,
      single: true,
      notExact: 0,
      unused: 0,
    };
  const marked = raw
    .filter((place) => place.glove)
    .map((place) => ({
      drawable: place.drawable,
      folder: place.folder,
      index: place.glove.index,
      size: place.glove.size,
    }));
  const { pairs, notExact, unused } = matchGloveForms(own, marked);
  return { pairs, total, count: pairs.length, single: false, notExact, unused };
}
