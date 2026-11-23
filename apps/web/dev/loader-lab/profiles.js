/*
 * Сценарии лаборатории карточки загрузки (18.11.2026). Время — мс от начала; одни и те же сценарии идут и на «до», и на «после».
 *
 * Это НЕ записи настоящих загрузок: игру владельца эта машина не читает (`?qa-wear=game` и `?qa-weapons=game` — чтение игры), а сцены
 * песочницы почти не дают карточки с ходом. Тайминги взяты из документированных замеров (`docs/3D.md`: «Завод» ~6,6 с на холодном
 * входе, «Ашан» ~7,5, арена ~10,4 с; примерка одежды ~5 с, `wear-tryon-speed`), а занятость главного потока — по профилю тех же
 * входов (сборка модели 300–500 мс, заливка листов в видеокарту 250–700 мс, первая отрисовка с программами шейдеров 350–450 мс).
 * Шаги карточки, счёт листов, число и полосу рисует настоящий код приложения.
 *
 *   mode "stages": `events: [{ at, stage }]` — этап загрузки (`GunStudio.loadStage`: read → build → textures → light);
 *   mode "sheets": `events: [{ at, done, total }]` — счёт листов текстур (`ModelStage`); «всего» растёт волнами, как у больших сцен;
 *   blocks: `[{ at, ms }]` — главный поток занят `ms` мс без отдачи кадров; done — сцена готова (карточка растворяется).
 */

/** Детерминированный ряд 0…1 (одно зерно — одни и те же сценарии при каждом прогоне). */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Листы: `count` штук, готовятся неравномерно (пачки и паузы) между `from` и `to`; `total` известен с `known`. */
function sheetsRun({ seed, from, to, count, base = 0, total, known }) {
  const rnd = seeded(seed);
  const weights = Array.from({ length: count }, () => 0.35 + rnd() * 1.3);
  const sum = weights.reduce((a, b) => a + b, 0);
  const events = [];
  let at = from;
  let done = base;
  if (known != null) events.push({ at: known, done, total });
  weights.forEach((w) => {
    at += ((to - from) * w) / sum;
    done += 1;
    events.push({ at: Math.round(at), done, total });
  });
  return events;
}

/** Подставить «всего» по расписанию `[[мс, всего], …]` и добавить события на самих ростах. */
function growing(events, schedule) {
  const totalAt = (at) =>
    schedule.filter(([from]) => from <= at).at(-1)?.[1] ?? 0;
  const out = events.map((e) => ({ ...e, total: totalAt(e.at) }));
  for (const [at, total] of schedule) {
    const before = events.filter((e) => e.at <= at).at(-1);
    out.push({ at, done: before?.done ?? 0, total });
  }
  return out.sort((a, b) => a.at - b.at);
}

export const PROFILES = {
  /* Одежда, примерка: этапы по имени (`GunStudio`, карточка первой загрузки), ~5 с. */
  "try-on": {
    kit: "clothing",
    mode: "stages",
    events: [
      { at: 0, stage: "read" },
      { at: 600, stage: "build" },
      { at: 1400, stage: "textures" },
      { at: 4300, stage: "light" },
    ],
    blocks: [
      { at: 650, ms: 350 },
      { at: 1700, ms: 450 },
      { at: 3100, ms: 400 },
      { at: 4350, ms: 450 },
    ],
    done: 4900,
    note: "примерка одежды ~5 с, этапы по имени",
  },
  /* Студия оружия: этапы по имени, ~4,3 с. */
  gun: {
    kit: "weapon",
    mode: "stages",
    events: [
      { at: 0, stage: "read" },
      { at: 450, stage: "build" },
      { at: 1300, stage: "textures" },
      { at: 3600, stage: "light" },
    ],
    blocks: [
      { at: 500, ms: 300 },
      { at: 1500, ms: 500 },
      { at: 2600, ms: 350 },
      { at: 3700, ms: 400 },
    ],
    done: 4300,
    note: "студия оружия ~4,3 с, этапы по имени",
  },
  /* «Завод»: счёт листов (38), ~5,8 с. */
  factory: {
    kit: "hall",
    mode: "sheets",
    events: sheetsRun({
      seed: 11,
      from: 900,
      to: 5200,
      count: 38,
      total: 38,
      known: 650,
    }),
    blocks: [
      { at: 1500, ms: 250 },
      { at: 2800, ms: 400 },
      { at: 4100, ms: 300 },
      { at: 5300, ms: 350 },
    ],
    done: 5800,
    note: "«Завод» ~5,8 с, 38 листов",
  },
  /* Большая сцена («Мегамолл»): «всего» листов известно сразу — 171, ~13,6 с. */
  megamall: {
    kit: "interiors",
    mode: "sheets",
    events: sheetsRun({
      seed: 23,
      from: 1500,
      to: 12600,
      count: 171,
      total: 171,
      known: 1000,
    }),
    blocks: [
      { at: 2200, ms: 500 },
      { at: 4000, ms: 600 },
      { at: 6500, ms: 700 },
      { at: 9500, ms: 600 },
      { at: 12000, ms: 500 },
    ],
    done: 13600,
    note: "«Мегамолл» ~13,6 с, 171 лист, «всего» известно сразу",
  },
  /* «Всего» листов растёт, пока карточка на экране (сцена просит ещё пачками): 52 → 118 → 171, листы идут без остановки, ~13,6 с.
     Волны после первого «готово» — полоска, не карточка (`use-sheets-progress.js`), сюда не входят. */
  "megamall-waves": {
    kit: "building",
    mode: "sheets",
    events: growing(
      sheetsRun({
        seed: 23,
        from: 1500,
        to: 12600,
        count: 171,
        total: 0,
        known: 1000,
      }),
      [
        [1000, 52],
        [3800, 118],
        [7500, 171],
      ],
    ),
    blocks: [
      { at: 2200, ms: 500 },
      { at: 4000, ms: 600 },
      { at: 6500, ms: 700 },
      { at: 9500, ms: 600 },
      { at: 12000, ms: 500 },
    ],
    done: 13600,
    note: "«всего» листов растёт 52 → 118 → 171 прямо на карточке, ~13,6 с",
  },
};

export const PROFILE_NAMES = Object.keys(PROFILES);
