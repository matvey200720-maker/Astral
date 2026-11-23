/* Слова значков на языке окна: имя со ступенью и подсказка. Имена и «как получить» — русские строки `badge-defs.js`, переводятся здесь, при отрисовке. */
import { tr } from "../../locales/ui.js";
import { trFill } from "../../locales/tr-fill.js";
import { railName } from "./profile-words.js";

const ROMAN = ["", "I", "II", "III", "IV", "V"];

/** Имя значка; у ступенчатого — со ступенью, к которой идёт человек («Коллекционер II»). */
export function stepName(badge, info) {
  const name = tr(badge.name);
  return badge.steps && info.stage < info.total
    ? `${name} ${ROMAN[info.stage + 1]}`
    : name;
}

/** Всплывающая подсказка медали: имя и, если значок в пути, сколько уже набрано. */
export function badgeTitle(badge, info) {
  if (info.state === "prog" || (info.ring && info.next))
    return `${stepName(badge, info)} · ${trFill("{0} из {1}", info.have, info.next || info.need)}`;
  return tr(badge.name);
}

/** Имя группы значков; «Мастерская» зовётся так же, как раздел рейки. */
export const groupName = (group) =>
  group.id === "workshop" ? railName(2) : tr(group.name);
