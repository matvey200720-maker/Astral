/*
 * Разделы «На что поставить?» (владелец, 25.10.2026: «одежда сядет на любую одежду»): вещь мода можно поставить не только на вещь
 * своего вида, но и на любой, который пускает движок (`crossFit`, `@modovik/clothing/targets`): кобура — на футболку, сумка — на
 * куртку. Части тела (голова, причёска, руки) и аксессуары с одеждой не мешаются — их в списке нет. Раздел мода — первый и стоит
 * по умолчанию; остальные — по порядку частей тела игры.
 */
import { BODY_COMPONENTS, crossFit } from "@modovik/clothing/targets";
import { COMPONENTS } from "@modovik/clothing/taxonomy";

const byPlace = (left, right) =>
  Number(right.own) - Number(left.own) ||
  COMPONENTS[left.id].prop - COMPONENTS[right.id].prop ||
  COMPONENTS[left.id].index - COMPONENTS[right.id].index;

/**
 * Разделы, на которые можно поставить вещь с `wear` (`{ gender, component, prop }`): `[{ id, label, own, cross }]`. Пусто — у мода
 * нет вида вещи. `withBlocked` (окно «На что поставить?», правка владельца 18.11.2026): часть тела (причёска, руки, голова) на другие разделы не встаёт,
 * но ряд разделов у неё такой же, как у масок — свой раздел первым, дальше те же соседи; их чипы выключены (`blocked: true`, причина — подсказка), раскрытый «Ещё N» показывает все.
 */
export function crossSections(wear, { withBlocked = false } = {}) {
  if (!wear?.component) return [];
  const list = [];
  for (const id of Object.keys(COMPONENTS)) {
    const fit = crossFit(wear.component, id, {
      sourceProp: Boolean(wear.prop),
      targetProp: COMPONENTS[id].prop,
    });
    if (!fit.ok) continue;
    list.push({ id, label: COMPONENTS[id].label, own: id === wear.component, cross: fit.cross });
  }
  if (withBlocked && BODY_COMPONENTS.includes(wear.component) && !wear.prop) {
    for (const id of Object.keys(COMPONENTS)) {
      if (id === wear.component || COMPONENTS[id].prop || BODY_COMPONENTS.includes(id)) continue;
      list.push({ id, label: COMPONENTS[id].label, own: false, cross: true, blocked: true });
    }
  }
  return list.sort(byPlace);
}

/** `wear` для раздела `component`: тот же пол, вид и проп — раздела. */
export const wearForSection = (wear, component) =>
  !wear || component === wear.component
    ? wear
    : { ...wear, component, prop: Boolean(COMPONENTS[component]?.prop) };
