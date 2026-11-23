/*
 * Радуга: где она стоит, когда видна и насколько яркая.
 *
 * В игре радуга — объект Astral (`SkyRainbowCommands.cs`): одна дуга в
 * вертикальной плоскости в трёх километрах к востоку от центра города, над
 * холмами. Одна — по слову владельца (26.09.2026): радуга стоит в одном месте
 * и за сутки никуда не переезжает. Прежние утренняя дуга над морем и вечерняя
 * над холмами, да ещё побочная дуга над главной, в кадре читались как «две
 * радуги».
 *
 * Видна она по часам объекта (`CTimeArchetypeDef`, биты часов 0…23), и эти
 * часы задаёт человек:
 *
 *  • «Вечером» — как в природе: 17–19, напротив заходящего солнца;
 *  • «Весь день» — с шести утра до девяти вечера;
 *  • «Круглосуточно» — все 24 часа, ночью тусклая, как лунная;
 *  • «Свои часы» — любые часы суток.
 *
 * Яркость в каждый час идёт за небом игрока — `rainbow-light.js`.
 *
 * Модуль один на окно и на главный процесс: кадр предпросмотра и модель,
 * которая уходит в игру, считают часы и место одними числами.
 */

export const RAINBOW_SCHEDULES = Object.freeze([
  "natural",
  "daytime",
  "always",
  "custom",
]);

const range = (from, to) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

/*
 * Где стоит дуга — ровно как в модели: направление от центра города
 * (x — восток, y — север), расстояние до плоскости дуги, антисолнечная
 * точка под горизонтом (отсюда высота дуги: 42° − 17° = 25°), угловой
 * радиус, ширина полосы и на сколько метров концы уходят под землю. Кадр
 * строит по этим числам ту же плоскость, иначе показывал бы дугу не там, где
 * её поставит игра. Те же числа — в `SkyRainbowCommands.cs`.
 */
export const RAINBOW_PLACEMENT = Object.freeze({
  direction: Object.freeze([0.97, 0.25]),
  distance: 3000,
  depressionDegrees: 17,
  radiusDegrees: 42,
  widthDegrees: 2.2,
  sinkMetres: 50,
});

export const ALL_HOURS = Object.freeze(range(0, 23));

const SCHEDULE_HOURS = Object.freeze({
  natural: Object.freeze([17, 18, 19]),
  daytime: Object.freeze(range(6, 20)),
  always: ALL_HOURS,
});

/*
 * Излучение модели в полдень ясного дня — то же число, что пишет в модель
 * `SkyRainbowCommands.cs` (`BaseEmissiveMultiplier`). В остальные часы оно
 * уменьшается вместе с небом (`rainbow-light.js`).
 */
export const RAINBOW_EMISSIVE = 3.5;

/* Яркость — доля от излучения модели по умолчанию (`RAINBOW_EMISSIVE`). */
export const RAINBOW_LIMITS = Object.freeze({
  brightness: Object.freeze({ min: 0.25, max: 3 }),
});

export function createRainbow() {
  return { schedule: "natural", hours: [], brightness: 1 };
}

const cleanHours = (value) =>
  Array.isArray(value)
    ? [
        ...new Set(
          value
            .map(Number)
            .filter((hour) => Number.isInteger(hour) && hour >= 0 && hour < 24),
        ),
      ].sort((a, b) => a - b)
    : [];

/**
 * Настройки радуги в границах. Кривое поле становится значением по
 * умолчанию, а не отказом: настройки приходят и из кода работы, и из старой
 * версии приложения, где их не было вовсе.
 */
export function normalizeRainbow(raw) {
  const base = createRainbow();
  if (!raw || typeof raw !== "object") return base;
  const hours = cleanHours(raw.hours);
  let schedule = RAINBOW_SCHEDULES.includes(raw.schedule)
    ? raw.schedule
    : base.schedule;
  /* «Свои часы» без единого часа — это не радуга: вернуть природный режим,
     а не поставить в игру невидимую модель. */
  if (schedule === "custom" && !hours.length) schedule = base.schedule;
  const brightness = Number(raw.brightness);
  return {
    schedule,
    hours: schedule === "custom" ? hours : [],
    brightness: Number.isFinite(brightness)
      ? Math.min(
          Math.max(brightness, RAINBOW_LIMITS.brightness.min),
          RAINBOW_LIMITS.brightness.max,
        )
      : base.brightness,
  };
}

/** Часы, в которые радуга видна: `[17, 18, 19]`. */
export function rainbowHours(raw) {
  const rainbow = normalizeRainbow(raw);
  return rainbow.schedule === "custom"
    ? [...rainbow.hours]
    : [...SCHEDULE_HOURS[rainbow.schedule]];
}

/**
 * Насколько радуга видна в этот час: 1 — в свой час, 0 — вне его. На краю
 * часа она гаснет за десять минут, как объект игры, которому разрешено
 * исчезнуть на глазах (бит 24 у ytyp), — между двумя соседними часами
 * она не мигает.
 */
export function rainbowVisibility(hours, hour) {
  const set = new Set(hours || []);
  if (!set.size) return 0;
  const h = ((Number(hour) % 24) + 24) % 24;
  const current = Math.floor(h);
  const within = h - current;
  const fade = 1 / 6;
  const on = (value) => set.has(((value % 24) + 24) % 24);
  if (on(current)) return 1;
  /* Час кончился — радуга гаснет первые десять минут следующего. */
  if (on(current - 1) && within < fade) return 1 - within / fade;
  /* Час вот-вот начнётся — проявляется за десять минут до него. */
  if (on(current + 1) && within > 1 - fade) return (within - (1 - fade)) / fade;
  return 0;
}

/**
 * Час, в который радугу видно в кадре редактора, — или `null`, если её уже
 * видно: середина её часов. Человек включил радугу в полдень — кадр не должен
 * молчать, будто она не поставится.
 */
export function rainbowShowcaseHour(raw, hour) {
  const hours = rainbowHours(raw);
  if (!hours.length) return null;
  if (rainbowVisibility(hours, hour) >= 1) return null;
  return hours[Math.floor((hours.length - 1) / 2)] + 0.5;
}

/** Подпись режима для людей. */
export const RAINBOW_SCHEDULE_LABELS = Object.freeze({
  natural: "Вечером",
  daytime: "Весь день",
  always: "Круглосуточно",
  custom: "Свои часы",
});
