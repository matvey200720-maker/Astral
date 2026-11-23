/*
 * Подсказка к дальности зон каптов на шести языках окна (ru, uk, en, de, pl, fr).
 *
 * Строка собирается из числа метров, имени зоны («Farm») и одного из трёх условий — «стенка появляется, только когда
 * заедешь внутрь», «ровно у края», «за столько-то до края». Порядок слов у языков разный, поэтому это функции словаря
 * по языку (как `features/reshade/reshade-copy.js`), а не русская строка со вставками, которую слой перевода разбирал
 * по кускам и оставлял с русским хвостом («Wie im Mod: … Wand появляется, только когда заедешь…»).
 * Русский текст — прежний слово в слово.
 */

const UNITS = Object.freeze({
  ru: { m: "м", km: "км", decimal: "," },
  uk: { m: "м", km: "км", decimal: "," },
  en: { m: "m", km: "km", decimal: "." },
  de: { m: "m", km: "km", decimal: "," },
  pl: { m: "m", km: "km", decimal: "," },
  fr: { m: "m", km: "km", decimal: "," },
});

const COPY = Object.freeze({
  ru: {
    lead: ({ from, zone, radius }) => `Как в моде: зону видно с ${from} от её середины — у зоны ${zone} (радиус ${radius})`,
    inside: ({ lead, depth }) => `${lead} стенка появляется, только когда заедешь внутрь на ${depth}.`,
    edge: ({ lead }) => `${lead} стенка появляется ровно у края.`,
    before: ({ lead, gap }) => `${lead} стенка появляется за ${gap} до края.`,
    custom: ({ gap, zone, lod }) => `Зону видно за ${gap} до края: игра считает дальность от середины зоны, поэтому у зоны ${zone} это ${lod} от середины.`,
  },
  uk: {
    lead: ({ from, zone, radius }) => `Як у моді: зону видно з ${from} від її середини — у зони ${zone} (радіус ${radius})`,
    inside: ({ lead, depth }) => `${lead} стінка з’являється, лише коли заїдеш усередину на ${depth}.`,
    edge: ({ lead }) => `${lead} стінка з’являється рівно біля краю.`,
    before: ({ lead, gap }) => `${lead} стінка з’являється за ${gap} до краю.`,
    custom: ({ gap, zone, lod }) => `Зону видно за ${gap} до краю: гра рахує відстань від середини зони, тому в зони ${zone} це ${lod} від середини.`,
  },
  en: {
    lead: ({ from, zone, radius }) => `As in the mod: the zone is visible from ${from} from its centre — for zone ${zone} (radius ${radius})`,
    inside: ({ lead, depth }) => `${lead}: the wall appears only when you drive ${depth} inside.`,
    edge: ({ lead }) => `${lead}: the wall appears right at the edge.`,
    before: ({ lead, gap }) => `${lead}: the wall appears ${gap} before the edge.`,
    custom: ({ gap, zone, lod }) => `The zone is visible ${gap} before the edge: the game measures the distance from the centre of the zone, so for zone ${zone} that is ${lod} from the centre.`,
  },
  de: {
    lead: ({ from, zone, radius }) => `Wie im Mod: die Zone ist ab ${from} von ihrer Mitte sichtbar — bei der Zone ${zone} (Radius ${radius})`,
    inside: ({ lead, depth }) => `${lead}: Die Wand erscheint erst, wenn man ${depth} ins Innere fährt.`,
    edge: ({ lead }) => `${lead}: Die Wand erscheint genau am Rand.`,
    before: ({ lead, gap }) => `${lead}: Die Wand erscheint ${gap} vor dem Rand.`,
    custom: ({ gap, zone, lod }) => `Die Zone ist ${gap} vor dem Rand sichtbar: Das Spiel misst die Entfernung ab der Mitte der Zone, daher sind es bei der Zone ${zone} ${lod} ab der Mitte.`,
  },
  pl: {
    lead: ({ from, zone, radius }) => `Jak w modzie: strefa jest widoczna od ${from} od jej środka — w strefie ${zone} (promień ${radius})`,
    inside: ({ lead, depth }) => `${lead}: ścianka pojawia się dopiero po wjechaniu ${depth} w głąb.`,
    edge: ({ lead }) => `${lead}: ścianka pojawia się dokładnie przy krawędzi.`,
    before: ({ lead, gap }) => `${lead}: ścianka pojawia się ${gap} przed krawędzią.`,
    custom: ({ gap, zone, lod }) => `Strefa jest widoczna ${gap} przed krawędzią: gra liczy odległość od środka strefy, więc dla strefy ${zone} to ${lod} od środka.`,
  },
  fr: {
    lead: ({ from, zone, radius }) => `Comme dans le mod\u00a0: la zone est visible à partir de ${from} de son centre — pour la zone ${zone} (rayon ${radius})`,
    inside: ({ lead, depth }) => `${lead}\u00a0: le mur n’apparaît que lorsque vous êtes entré de ${depth} à l’intérieur.`,
    edge: ({ lead }) => `${lead}\u00a0: le mur apparaît exactement au bord.`,
    before: ({ lead, gap }) => `${lead}\u00a0: le mur apparaît ${gap} avant le bord.`,
    custom: ({ gap, zone, lod }) => `La zone est visible ${gap} avant le bord\u00a0: le jeu mesure la distance depuis le centre de la zone, donc pour la zone ${zone}, cela fait ${lod} depuis le centre.`,
  },
});

/** Подписи подсказки на языке `language` (чужой язык — русский). */
export const captZonesCopyFor = (language) => COPY[language] || COPY.ru;

/** Метры и километры на языке `language`: «260 м», «1,5 км», «1.5 km». */
export function captZonesUnits(language) {
  const { m, km, decimal } = UNITS[language] || UNITS.ru;
  const number = (value, digits) => String(Math.round(value * 10 ** digits) / 10 ** digits).replace(".", decimal);
  return {
    metres: (value) => `${number(value, value < 10 ? 1 : 0)} ${m}`,
    distance: (value) => (value >= 1000 ? `${number(value / 1000, 2)} ${km}` : `${Math.round(value)} ${m}`),
  };
}
