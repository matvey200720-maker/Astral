/*
 * Звуковые события: человеческое имя вместо хеша.
 *
 * Просьба звучит просто — «хочу поставить свой звук на попадание в голову».
 * В игре такой строки нет, и это проверено по её же файлам, а не по форумам:
 *
 *   1. Дорожки внутри AWC-банка названы своими хешами. `awc-inspect` живого
 *      `RESIDENT.rpf` возвращает `name` равным `hash` у всех 516 дорожек
 *      банка `weapons`, 157 банка `explosions`, 99 банка `frontend` — таблицы
 *      имён в контейнерах нет.
 *   2. Хеш — joaat внутреннего имени Rockstar, и подобрать его нельзя:
 *      перебор осмысленных имён (`headshot`, `hud_headshot`, `hit_marker`, …)
 *      не дал ни одного совпадения ни в одном банке.
 *   3. Метаданные звука тоже молчат: в `sounds.dat54.rel`, `sp_sounds.dat54`,
 *      `game.dat151.rel` и их GTAO-парах нет ни одного имени со словом
 *      headshot, и joaat таких имён в них не встречается.
 *
 * Значит, справочником «событие → дорожка» задачу решить нельзя: справочник
 * пришлось бы выдумать, а выдуманный адрес молча заменил бы не тот звук.
 *
 * Событие устроено честно и делает ровно то, что просили: карточка с именем
 * стоит на виду в своём разделе, знает банки, в которых игра держит этот
 * класс звуков, и сама сужает сотни дорожек до коротких кандидатов. Человек
 * слушает кандидатов, один раз отмечает нужную дорожку — и дальше карточка
 * живёт под своим именем: показывает, что на неё положено, и меняется одним
 * файлом. Адрес дорожки приходит от человека, а не от нашей догадки.
 */

import { similarity } from "./analysis.js";

const RESIDENT = "x64/audio/sfx/RESIDENT.rpf";

/*
 * Кандидаты события.
 *
 * Отбором по классу и длине этот список не сузить: в банке столкновений 787
 * дорожек, и «короткие удары» — это семьсот из них. Отбор снимает заведомо
 * чужое (длинный хвост в событии удара), а решает порядок: у события есть
 * измеримая форма — длина, высота, резкость атаки, доля звучания, — и
 * дорожки выстраиваются по близости к ней той же функцией `similarity`,
 * которой студия ищет «похожие на эту». Первые в списке — те, что и правда
 * звучат как это событие.
 *
 * `like` — эта самая форма. Числа не выдуманы: они сняты с профилей живых
 * банков Legacy (`readSoundProfile` по RESIDENT.rpf), а не подобраны на глаз.
 * `tags` и `seconds` остаются грубым ситом до сортировки.
 */
export const SOUND_EVENTS = Object.freeze([
  Object.freeze({
    id: "weapon-fire",
    section: "weapons",
    title: "Выстрел",
    hint: "Сам выстрел: короткий, с резкой атакой",
    banks: Object.freeze([
      Object.freeze({ archive: RESIDENT, bank: "weapons" }),
    ]),
    pick: Object.freeze({
      tags: Object.freeze(["hit"]),
      seconds: 1.5,
      like: Object.freeze({
        seconds: 0.42,
        centroidHz: 1800,
        attackMs: 3,
        sustain: 0.32,
        tonality: 0.18,
        rms: -12,
      }),
    }),
  }),
  Object.freeze({
    id: "weapon-reload",
    section: "weapons",
    title: "Перезарядка",
    hint: "Механика: магазин, затвор, щелчки",
    banks: Object.freeze([
      Object.freeze({ archive: RESIDENT, bank: "weapons" }),
    ]),
    pick: Object.freeze({
      tags: Object.freeze(["hit"]),
      seconds: 0.5,
      like: Object.freeze({
        seconds: 0.22,
        centroidHz: 3600,
        attackMs: 2,
        sustain: 0.2,
        tonality: 0.12,
        rms: -20,
      }),
    }),
  }),
  Object.freeze({
    id: "headshot",
    section: "hit-sounds",
    title: "Попадание в голову",
    hint:
      "Игра играет попадание пули как удар по материалу — эти удары лежат " +
      "в банках столкновений. Послушайте кандидатов и отметьте свой.",
    banks: Object.freeze([
      Object.freeze({ archive: RESIDENT, bank: "collision" }),
      Object.freeze({ archive: RESIDENT, bank: "collisions" }),
    ]),
    pick: Object.freeze({
      tags: Object.freeze(["hit"]),
      seconds: 0.8,
      like: Object.freeze({
        seconds: 0.16,
        centroidHz: 2600,
        attackMs: 2,
        sustain: 0.22,
        tonality: 0.1,
        rms: -16,
      }),
    }),
  }),
  Object.freeze({
    id: "body-hit",
    section: "hit-sounds",
    title: "Попадание по телу",
    hint: "Второй удар той же семьи — по корпусу, а не по голове",
    banks: Object.freeze([
      Object.freeze({ archive: RESIDENT, bank: "collision" }),
      Object.freeze({ archive: RESIDENT, bank: "collisions" }),
    ]),
    pick: Object.freeze({
      tags: Object.freeze(["hit"]),
      seconds: 0.8,
      like: Object.freeze({
        seconds: 0.26,
        centroidHz: 1300,
        attackMs: 3,
        sustain: 0.3,
        tonality: 0.12,
        rms: -16,
      }),
    }),
  }),
  Object.freeze({
    id: "melee-hit",
    section: "hit-sounds",
    title: "Удар в ближнем бою",
    hint: "Кулак, бита, нож",
    banks: Object.freeze([Object.freeze({ archive: RESIDENT, bank: "melee" })]),
    pick: Object.freeze({
      tags: Object.freeze(["hit"]),
      seconds: 1,
      like: Object.freeze({
        seconds: 0.34,
        centroidHz: 1100,
        attackMs: 4,
        sustain: 0.35,
        tonality: 0.14,
        rms: -14,
      }),
    }),
  }),
  Object.freeze({
    id: "explosion",
    section: "explosions",
    title: "Взрыв",
    hint: "Основной раскат взрыва",
    banks: Object.freeze([
      Object.freeze({ archive: RESIDENT, bank: "explosions" }),
    ]),
    pick: Object.freeze({
      tags: Object.freeze(["long"]),
      seconds: 6,
      like: Object.freeze({
        seconds: 3.1,
        centroidHz: 480,
        attackMs: 6,
        sustain: 0.7,
        tonality: 0.1,
        rms: -9,
      }),
    }),
  }),
]);

export const SOUND_EVENT_MAP = Object.freeze(
  Object.fromEntries(SOUND_EVENTS.map((event) => [event.id, event])),
);

export const SOUND_EVENT_IDS = Object.freeze(
  SOUND_EVENTS.map((event) => event.id),
);

/** События раздела в объявленном порядке. */
export function sectionEvents(section) {
  const id = String(section || "");
  return SOUND_EVENTS.filter((event) => event.section === id);
}

/** Событие по id или null. */
export const findSoundEvent = (id) => SOUND_EVENT_MAP[String(id || "")] || null;

/** Держит ли событие этот банк. */
export function eventCoversBank(event, archive, bank) {
  const target = String(archive || "");
  const name = String(bank || "").toLowerCase();
  return Boolean(
    event?.banks?.some((item) => item.archive === target && item.bank === name),
  );
}

/**
 * Кандидаты события среди дорожек банка — по убыванию похожести.
 *
 * Сито грубое: длина в потолке события и хотя бы один класс из `tags`. Оно
 * снимает заведомо чужое, но не сужает — в банке столкновений короткими
 * ударами оказываются семьсот дорожек из семисот восьмидесяти семи.
 * Сужает порядок: дорожки выстраиваются по близости к форме события
 * (`pick.like`) той же функцией `similarity`, что и «похожие на эту», и
 * человек слушает первые десять, а не листает банк.
 *
 * Профиль считается не всегда (банк может быть ещё не разобран). Без него
 * решает одна длина, а порядок остаётся исходным: показать чуть больше и в
 * прежнем порядке честнее, чем показать пустой список или выдуманный.
 */
export function eventCandidates(event, streams, profile = null) {
  if (!event) return [];
  const tags = new Set(event.pick?.tags || []);
  const ceiling = Number(event.pick?.seconds) || Infinity;
  /* Профиль приходит и списком (`[{stream, tags}]`), и картой хеш → признаки:
     первую форму отдаёт разбор банка, вторую — окно, которое уже разложило
     его по хешам. Событию всё равно, какой именно, — ему нужны классы. */
  const tracks = profile?.tracks;
  const tagsOfStream = new Map(
    Array.isArray(tracks)
      ? tracks.map((track) => [
          String(track.stream || track.hash || "").toUpperCase(),
          track.tags || [],
        ])
      : Object.entries(tracks || {}).map(([hash, track]) => [
          String(hash).toUpperCase(),
          track?.tags || [],
        ]),
  );
  const featuresOf = new Map(
    Array.isArray(tracks)
      ? tracks.map((track) => [
          String(track.stream || track.hash || "").toUpperCase(),
          track,
        ])
      : Object.entries(tracks || {}).map(([hash, track]) => [
          String(hash).toUpperCase(),
          track,
        ]),
  );
  const passed = (Array.isArray(streams) ? streams : []).filter((stream) => {
    const seconds = Number(stream?.seconds) || 0;
    if (seconds > ceiling) return false;
    const known = tagsOfStream.get(String(stream?.hash || "").toUpperCase());
    if (!known || !known.length) return true;
    return known.some((tag) => tags.has(tag));
  });

  const like = event.pick?.like;
  if (!like || !featuresOf.size) return passed;
  const distance = new Map(
    passed.map((stream) => {
      const item = featuresOf.get(String(stream?.hash || "").toUpperCase());
      /* Дорожка без профиля не выбрасывается, но и вперёд не лезет: её место
         в хвосте, за всеми, о ком что-то известно. */
      return [stream, item ? similarity(like, item) : Number.POSITIVE_INFINITY];
    }),
  );
  return [...passed].sort((left, right) => {
    const gap = distance.get(left) - distance.get(right);
    return Number.isFinite(gap) && gap !== 0
      ? gap
      : passed.indexOf(left) - passed.indexOf(right);
  });
}
