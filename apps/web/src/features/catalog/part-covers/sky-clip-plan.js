/*
 * План петли «смена суток» (25.10.2026): размер, частота, часы кадров. Без
 * зависимостей — тесты и карточка читают его, не подтягивая шейдер неба и
 * кодировщик (`sky-clip.js`).
 */

export const SKY_CLIP = Object.freeze({
  width: 960,
  height: 640,
  fps: 24,
  seconds: 8,
  /* Первый кадр — утро: петля начинается там, где обложка «день мода». */
  startHour: 7,
  /* Ключевой кадр раз в две секунды: петля перематывается на нулевой. */
  keyEvery: 48,
  bitrate: 700_000,
});

/*
 * Ролик суток для карточки таймцикла (26.10.2026, владелец: «видео в нашем нарисованном городе, как идут сутки, с 12 часов до 12 часов… очень
 * быстро загружается, не грузит компьютер»): полный круг от полудня до полудня, один ракурс и одна длительность у всех таймциклов. 20 к/с — небо
 * меняется плавно и без рывков, кадров втрое меньше, чем у петли в 24 к/с и 8 с, файл ≈ 2,4 МиБ (потолок ролика — 8 МиБ).
 */
export const DAY_CLIP = Object.freeze({
  width: 960,
  height: 640,
  fps: 20,
  seconds: 24,
  startHour: 12,
  /* Ключевой кадр раз в две секунды: перемотка по ползунку не ждёт далёкого ключа. */
  keyEvery: 40,
  bitrate: 800_000,
});

/* Три кадра галереи — те же часы, что у «дня мода» без ночи. */
export const SKY_STILLS = Object.freeze([
  Object.freeze({ id: "morning", hour: 7, caption: "part-sky-morning" }),
  Object.freeze({ id: "day", hour: 13, caption: "part-sky-day" }),
  Object.freeze({ id: "evening", hour: 19, caption: "part-sky-evening" }),
]);

/* Вес часа — сколько кадров приходится на час суток: рассвет и закат плотнее. */
const bell = (hour, center, width) => {
  const far = Math.abs(hour - center);
  const gap = Math.min(far, 24 - far);
  return Math.exp(-(gap * gap) / (2 * width * width));
};
const weightOf = (hour) =>
  0.6 + 2.2 * bell(hour, 6.2, 1.2) + 2.2 * bell(hour, 19.4, 1.5) + 0.5 * bell(hour, 13, 2.5);

/**
 * Часы кадров петли: `frames` значений от `startHour` вокруг суток; кадр
 * `frames` был бы кадром 0, поэтому петля замкнута.
 * @returns {number[]} часы 0…24
 */
export function clipHours(frames = SKY_CLIP.fps * SKY_CLIP.seconds, startHour = SKY_CLIP.startHour) {
  const steps = 2400;
  const cumulative = new Float64Array(steps + 1);
  for (let step = 0; step < steps; step += 1) {
    const hour = (startHour + ((step + 0.5) * 24) / steps) % 24;
    cumulative[step + 1] = cumulative[step] + weightOf(hour);
  }
  const total = cumulative[steps];
  const hours = [];
  let step = 0;
  for (let index = 0; index < frames; index += 1) {
    const target = (index / frames) * total;
    while (step < steps - 1 && cumulative[step + 1] < target) step += 1;
    const span = cumulative[step + 1] - cumulative[step] || 1;
    const fraction = (target - cumulative[step]) / span;
    hours.push((startHour + ((step + fraction) * 24) / steps) % 24);
  }
  return hours;
}

/* Накопленные веса суток от часа старта — одна таблица на `startHour`: ход времени ролика считается один раз, а не на каждый кадр прогона. */
const tables = new Map();
function cumulativeOf(startHour, steps = 2400) {
  if (!tables.has(startHour)) {
    const cumulative = new Float64Array(steps + 1);
    for (let step = 0; step < steps; step += 1)
      cumulative[step + 1] = cumulative[step] + weightOf((startHour + ((step + 0.5) * 24) / steps) % 24);
    tables.set(startHour, cumulative);
  }
  return tables.get(startHour);
}

/**
 * Час суток по доле ролика `progress` ∈ [0, 1): тот же ход времени, что у кадров ролика (`clipHours`), — для живого прогона суток в мастерской
 * (кнопка «Сутки»): небо идёт так же, как в файле.
 */
export function dayHourAt(progress, startHour = DAY_CLIP.startHour) {
  const cumulative = cumulativeOf(startHour);
  const steps = cumulative.length - 1;
  const target = (((progress % 1) + 1) % 1) * cumulative[steps];
  let low = 0;
  let high = steps - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (cumulative[middle + 1] < target) low = middle + 1;
    else high = middle;
  }
  const span = cumulative[low + 1] - cumulative[low] || 1;
  return (startHour + ((low + (target - cumulative[low]) / span) * 24) / steps) % 24;
}
