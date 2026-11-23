/*
 * Карточки раздела «Оптимизация» (03.10.2026).
 *
 * Семь вещей, которые человек узнаёт в игре глазами: улицы, транспорт,
 * прохожие, растительность, тени, погода, эффекты. В карточку собрано всё,
 * что раздел умеет, по тому, что меняется в кадре: переключатели правят
 * числа в трёх файлах (`catalog.js`, группа = карточка), слои из модов —
 * свои файлы игры (`layers.js`). Включил карточку — её состав уходит в
 * игру, выключил — снимается; готовых наборов и кнопки «Применить» нет.
 *
 * `optional` — часть, которую переключатель карточки не включает: она
 * меняет вид всей игры, и ставить её заодно с остальным было бы нечестно.
 * Включается отдельно в составе карточки, а снимается вместе с карточкой.
 * Лёгкие текстуры были такой частью «Улиц»; с 05.10.2026 это последняя
 * ступень своей вкладки «Ухудшение текстур» (`texture-levels.js`), и её
 * слои — как и остальные ступени — ни в одну карточку не входят.
 *
 * `fps` — честная метка без чисел, как у слоёв: `more` — снимает тяжёлую
 * часть кадра, `some` — мелочь или только в своей сцене (дождь).
 *
 * `shot` — кадр «до/после» одной строкой. Кадры лежат в
 * `apps/web/src/assets/optimization-shots/` (`<карточка>-before`,
 * `<карточка>-after`); пока их нет, карточка показывает подписанную
 * заглушку, а что, где и как снимать — в `README.md` той же папки.
 *
 * `partShots` — части, которые видно отдельно: у них свои кадры
 * (`<карточка>-<часть>-before/after`), окно «Что входит» показывает их тем
 * же ползунком (ТЗ 04.10.2026, задача 11).
 */

import { OPTIMIZER_GROUPS, OPTIMIZER_TWEAKS } from "./catalog.js";
import { OPTIMIZATION_LAYER_IDS } from "./layer-ids.js";
import { TEXTURE_LEVEL_LAYERS } from "./texture-levels.js";

const PARTS = Object.freeze({
  streets: {
    layers: ["litter-small", "litter-large", "street-dirt", "shelf-goods"],
    fps: "more",
    shot: {
      ru: "Улица в Строберри днём: мусорный бак у забора и сор у бордюра",
      uk: "Вулиця в Строберрі вдень: сміттєвий бак біля паркану й сміття біля бордюру",
      en: "A Strawberry street by day: a wheelie bin by the fence, debris by the kerb",
      de: "Eine Straße in Strawberry bei Tag: eine Mülltonne am Zaun und Unrat am Bordstein",
      pl: "Ulica w Strawberry w dzień: kosz na śmieci przy płocie i śmieci przy krawężniku",
      fr: "Une rue de Strawberry de jour\u00a0: une poubelle près de la clôture et des déchets le long du trottoir",
    },
    partShots: {
      "litter-small": {
        shot: {
          ru: "Лагерь под эстакадой у «Ванильного единорога»: газеты, бумажки и мелочь на земле",
          uk: "Табір під естакадою біля «Vanilla Unicorn»: газети, папірці й дрібниці на землі",
          en: "A camp under the overpass by the Vanilla Unicorn: newspapers, paper and small rubbish",
          de: "Ein Lager unter der Überführung beim „Vanilla Unicorn“: Zeitungen, Papier und Kleinkram auf dem Boden",
          pl: "Obóz pod wiaduktem przy „Vanilla Unicorn”: gazety, papierki i drobiazgi na ziemi",
          fr: "Un campement sous le viaduc près du «\u00a0Vanilla Unicorn\u00a0»\u00a0: journaux, papiers et petits déchets par terre",
        },
      },
      "litter-large": {
        shot: {
          ru: "Двор в Ранчо днём: мешки с мусором и картон у забора",
          uk: "Двір у Ранчо вдень: мішки зі сміттям і картон біля паркану",
          en: "A Rancho yard by day: bin bags and cardboard by the fence",
          de: "Ein Hof in Rancho bei Tag: Müllsäcke und Pappe am Zaun",
          pl: "Podwórze w Rancho w dzień: worki ze śmieciami i karton przy płocie",
          fr: "Une cour à Rancho de jour\u00a0: sacs-poubelle et cartons près de la clôture",
        },
      },
      "street-dirt": {
        shot: {
          ru: "Улица в Строберри днём: банки и бумага у бордюра",
          uk: "Вулиця в Строберрі вдень: банки й папір біля бордюру",
          en: "A Strawberry street by day: cans and paper by the kerb",
          de: "Eine Straße in Strawberry bei Tag: Dosen und Papier am Bordstein",
          pl: "Ulica w Strawberry w dzień: puszki i papier przy krawężniku",
          fr: "Une rue de Strawberry de jour\u00a0: canettes et papiers le long du trottoir",
        },
      },
      "shelf-goods": {
        shot: {
          ru: "Магазин 24/7 на бульваре Иннусенс: полки с продуктами и напитками",
          uk: "Крамниця 24/7 на бульварі Іносенс: полиці з продуктами й напоями",
          en: "A 24/7 on Innocence Boulevard: shelves of groceries and drinks",
          de: "Ein 24/7-Laden am Innocence Boulevard: Regale mit Lebensmitteln und Getränken",
          pl: "Sklep 24/7 przy Innocence Boulevard: półki z jedzeniem i napojami",
          fr: "Une supérette 24/7 sur Innocence Boulevard\u00a0: rayons de produits alimentaires et de boissons",
        },
      },
    },
  },
  vehicles: {
    layers: ["wheel-smoke", "car-dirt"],
    fps: "more",
    shot: {
      ru: "Площадка аэропорта днём: шесть машин в 12–170 м",
      uk: "Майданчик аеропорту вдень: шість машин на відстані 12–170 м",
      en: "The airport apron by day: six cars 12–170 m away",
      de: "Das Flughafenvorfeld bei Tag: sechs Autos in 12–170 m Entfernung",
      pl: "Płyta lotniska w dzień: sześć aut w odległości 12–170 m",
      fr: "Le tarmac de l'aéroport de jour\u00a0: six voitures à 12–170 m",
    },
  },
  peds: {
    layers: [],
    fps: "some",
    shot: {
      ru: "Площадка аэропорта днём: шесть прохожих в 8–70 м",
      uk: "Майданчик аеропорту вдень: шість перехожих на відстані 8–70 м",
      en: "The airport apron by day: six pedestrians 8–70 m away",
      de: "Das Flughafenvorfeld bei Tag: sechs Fußgänger in 8–70 m Entfernung",
      pl: "Płyta lotniska w dzień: sześciu przechodniów w odległości 8–70 m",
      fr: "Le tarmac de l'aéroport de jour\u00a0: six piétons à 8–70 m",
    },
  },
  vegetation: {
    layers: ["grass", "lawn-grass"],
    fps: "more",
    shot: {
      ru: "Склон под знаком Vinewood днём: трава, кусты и деревья",
      uk: "Схил під написом Vinewood вдень: трава, кущі й дерева",
      en: "The slope below the Vinewood sign by day: grass, bushes and trees",
      de: "Der Hang unter dem Vinewood-Schriftzug bei Tag: Gras, Büsche und Bäume",
      pl: "Zbocze pod napisem Vinewood w dzień: trawa, krzewy i drzewa",
      fr: "La colline sous l'enseigne Vinewood de jour\u00a0: herbe, buissons et arbres",
    },
  },
  shadows: {
    layers: [],
    fps: "more",
    shot: {
      ru: "Заправка в Строберри ночью, с 55 м: колонки под светом навеса",
      uk: "Заправка в Строберрі вночі, з 55 м: колонки під світлом навісу",
      en: "A Strawberry petrol station at night from 55 m: pumps under the canopy lights",
      de: "Eine Tankstelle in Strawberry bei Nacht aus 55 m: Zapfsäulen unter dem Licht des Vordachs",
      pl: "Stacja benzynowa w Strawberry nocą, z 55 m: dystrybutory w świetle zadaszenia",
      fr: "Une station-service de Strawberry de nuit, à 55 m\u00a0: les pompes sous les lumières de l'auvent",
    },
  },
  weather: {
    layers: [],
    fps: "some",
    shot: {
      ru: "Пирс Дель-Перро ночью в грозу: капли и свет фонарей",
      uk: "Пірс Дель-Перро вночі під час грози: краплі й світло ліхтарів",
      en: "Del Perro Pier at night in a thunderstorm: rain and lamp light",
      de: "Der Del Perro Pier bei Nacht im Gewitter: Tropfen und Laternenlicht",
      pl: "Molo Del Perro nocą w czasie burzy: krople i światło latarni",
      fr: "La jetée de Del Perro de nuit, sous l'orage\u00a0: gouttes de pluie et lumière des lampadaires",
    },
  },
  effects: {
    /* Эмбиент и частицы выстрелов (ТЗ 17.10.2026, задача 2) — частями этой же
       карточки: каждая включается в «Что входит» своим тумблером. */
    layers: ["particles", "ambient", "ambient-region", "bullet-impacts", "collision-particles", "decals", "explosion-shake", "drug-effects", "damage-screen"],
    fps: "some",
    shot: {
      ru: "Плитка у площади Легион после двух взрывов: подпалины",
      uk: "Плитка біля площі Легіон після двох вибухів: підпалини",
      en: "Paving by Legion Square after two explosions: scorch marks",
      de: "Pflaster am Legion Square nach zwei Explosionen: Brandspuren",
      pl: "Kostka przy Legion Square po dwóch wybuchach: przypalenia",
      fr: "Les pavés près de Legion Square après deux explosions\u00a0: traces de brûlure",
    },
  },
});

export const OPTIMIZATION_CARDS = Object.freeze(
  OPTIMIZER_GROUPS.map((group) => {
    const parts = PARTS[group.id];
    return Object.freeze({
      id: group.id,
      title: group.title,
      summary: group.summary,
      fps: parts.fps,
      shot: Object.freeze(parts.shot),
      /* Переключатели — в порядке каталога: так их видит и профиль. */
      tweaks: Object.freeze(
        OPTIMIZER_TWEAKS.filter((tweak) => tweak.group === group.id).map(
          (tweak) => tweak.id,
        ),
      ),
      layers: Object.freeze([...parts.layers]),
      optional: Object.freeze([...(parts.optional || [])]),
      partShots: Object.freeze({ ...(parts.partShots || {}) }),
    });
  }),
);

export const OPTIMIZATION_CARD_MAP = Object.freeze(
  Object.fromEntries(OPTIMIZATION_CARDS.map((card) => [card.id, card])),
);

/** Карточка, в которой стоит переключатель или слой, — или `null`. */
export function optimizationCardOf(partId) {
  return (
    OPTIMIZATION_CARDS.find(
      (card) =>
        card.tweaks.includes(partId) ||
        card.layers.includes(partId) ||
        card.optional.includes(partId),
    ) || null
  );
}

/**
 * Состав карточки по порядку: переключатели, слои, отдельные части.
 * @returns {Array<{ kind: "tweak"|"layer", id: string, optional: boolean }>}
 */
export function optimizationCardParts(card) {
  return [
    ...card.tweaks.map((id) => ({ kind: "tweak", id, optional: false })),
    ...card.layers.map((id) => ({ kind: "layer", id, optional: false })),
    ...card.optional.map((id) => ({ kind: "layer", id, optional: true })),
  ];
}

/**
 * Состояние карточки по тому, что стоит (или вот-вот встанет): `on` —
 * стоит весь основной состав, `count` — сколько частей стоит, считая
 * отдельные.
 *
 * @param {{ tweak: (id: string) => boolean, layer: (id: string) => boolean }} isOn
 */
export function optimizationCardState(card, isOn) {
  const parts = optimizationCardParts(card);
  const onParts = parts.filter((part) =>
    part.kind === "tweak" ? isOn.tweak(part.id) : isOn.layer(part.id),
  );
  const main = parts.filter((part) => !part.optional);
  const mainOn = onParts.filter((part) => !part.optional).length;
  return {
    on: main.length > 0 && mainOn === main.length,
    count: onParts.length,
    total: parts.length,
    partial: onParts.length > 0 && mainOn < main.length,
  };
}

/** Кадры «до/после» карточки: имена файлов в папке раздела. */
export function optimizationCardShotFiles(cardId) {
  return { before: `${cardId}-before`, after: `${cardId}-after` };
}

/** Кадры «до/после» части карточки. */
export function optimizationPartShotFiles(cardId, partId) {
  return {
    before: `${cardId}-${partId}-before`,
    after: `${cardId}-${partId}-after`,
  };
}

/* Сверка при загрузке модуля: ни одна часть раздела не потерялась и не
   попала в две карточки — это проверяет и тест, а здесь ошибка видна сразу. */
const seen = new Set();
for (const card of OPTIMIZATION_CARDS)
  for (const part of optimizationCardParts(card)) {
    if (seen.has(part.id))
      throw new Error(`Часть оптимизации в двух карточках: ${part.id}`);
    seen.add(part.id);
  }
for (const id of [
  ...OPTIMIZER_TWEAKS.map((tweak) => tweak.id),
  ...OPTIMIZATION_LAYER_IDS.filter((layerId) => !TEXTURE_LEVEL_LAYERS.includes(layerId)),
])
  if (!seen.has(id)) throw new Error(`Часть оптимизации без карточки: ${id}`);
