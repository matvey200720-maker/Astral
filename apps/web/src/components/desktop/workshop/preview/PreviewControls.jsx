/*
 * Органы управления общим окном предпросмотра.
 *
 * Сцена умеет погоду и качество с самого начала — `setTime(час, погода)` и
 * `setQuality` лежат в `preview-stage.js` и работают через императивные
 * методы, не пересобирая контекст WebGL. Органа у них не было, поэтому каждый
 * редактор зашивал значение прямо в разметке: арена навсегда осталась в
 * `EXTRASUNNY`, качество у всех стояло «авто» без права передумать.
 * Возможность, до которой нельзя дотянуться рукой, — это возможность, о
 * которой никто не узнает.
 *
 * Ряды опциональные и просятся по одному, как и скраббер времени: редактор, у
 * которого погода выведена из собственных данных, не должен получить второй
 * орган, спорящий с первым. Так в дорогах — там погода следует за мокростью
 * покрытия, и кнопка «Ясно» поверх мокрого асфальта показала бы картинку,
 * которой в игре не бывает.
 *
 * Всё, что здесь есть, разбито на памятливые куски. Окно перерисовывается
 * дважды в секунду — столько раз сцена приносит замер кадра, — и без этого
 * тринадцать плиток суток и пятнадцать кнопок погоды пересобирались бы в
 * разметке впустую два раза в секунду поверх работающего рендерера.
 */

import { memo, useMemo } from "react";
import {
  TIMECYCLE_SAMPLES,
  WEATHER_TYPES,
  dayExposureStops,
  findWeather,
  swatchAtHour,
} from "@modovik/timecycle";
import { baselineDocument, normalizeHour } from "./preview-lighting.js";
import { tr, useTr } from "../../../../locales/ui.js";

const SAMPLE_COUNT = TIMECYCLE_SAMPLES.length;

/*
 * Ступени качества ровно те, что понимает сцена (`QUALITY_LEVELS` плюс
 * «авто»). Лишнее значение сцена молча свела бы к своей ступени по умолчанию,
 * и кнопка соврала бы про то, что она сделала.
 */
const QUALITY_STEPS = Object.freeze([
  Object.freeze({
    value: "auto",
    label: "Авто",
    hint: "Окно меряет первые кадры и выбирает ступень само",
  }),
  Object.freeze({
    value: "low",
    label: "Низкое",
    hint: "Без теней, плотность пикселей 1.0",
  }),
  Object.freeze({
    value: "medium",
    label: "Среднее",
    hint: "Тени 1024, плотность пикселей 1.25",
  }),
  Object.freeze({
    value: "high",
    label: "Высокое",
    hint: "Тени 2048, плотность пикселей 1.5",
  }),
]);

/** Ширина плитки пропорциональна тому, сколько часов держится опорный кадр. */
function sampleSpan(index) {
  const current = TIMECYCLE_SAMPLES[index];
  const next = TIMECYCLE_SAMPLES[(index + 1) % SAMPLE_COUNT];
  const span =
    index === SAMPLE_COUNT - 1 ? 24 - current.hour : next.hour - current.hour;
  return Math.max(span, 1);
}

/*
 * Цветная полоса суток.
 *
 * Полоса — сплошная лента, а не тринадцать плашек: цвет здесь данные. По нему
 * видно, где ночь и где закат, и куда вести ползунок, не пробуя каждый час по
 * очереди. Считается той же функцией, что и полоса в редакторе неба, и с одной
 * экспозицией на все сутки: дать каждому часу свою — значит выровнять полночь
 * и полдень по яркости и получить ряд одинаково блёклых пятен вместо дуги
 * «темно → тепло → светло → тепло → темно».
 */
const TimeBand = memo(function TimeBand({ weather, onPick }) {
  const swatches = useMemo(() => {
    const document = baselineDocument(weather);
    const exposure = dayExposureStops({ document, project: null, weather });
    return TIMECYCLE_SAMPLES.map((sample) => ({
      ...sample,
      colour: swatchAtHour({
        document,
        project: null,
        weather,
        hour: sample.hour,
        exposure,
      }),
    }));
  }, [weather]);

  return (
    <div className="preview-window-band">
      {swatches.map((sample, index) => (
        <button
          key={sample.index}
          type="button"
          style={{
            background: `rgb(${sample.colour.join(",")})`,
            flexGrow: sampleSpan(index),
          }}
          aria-label={`Перевести время на ${sample.label}`}
          title={sample.label}
          onClick={() => onPick(sample.hour)}
        />
      ))}
    </div>
  );
});

/*
 * Ряд погоды.
 *
 * Пятнадцать типов — весь набор Legacy-сборки, от ясного к тяжёлому, тем же
 * порядком, каким его читают в редакторах сообщества. Ряд не сокращён до
 * «интересных»: каждый тип приносит свой эталонный документ, то есть своё
 * небо, свой туман и свою экспозицию, — сокращать пришлось бы наугад.
 *
 * Одними именами, без цветных точек. Точку пробовали: на кнопке стоял цвет
 * горизонта в выбранный час, посчитанный тем же способом, что и полоса суток.
 * Смысла в ней не оказалось. В полдень пятнадцать погод дают от rgb(204,217,231)
 * до rgb(181,197,220) — десятая доля яркости, которой в кружке десять на десять
 * не видно; ночью весь ряд ложится в rgb(5…9) и различается на единицу канала.
 * Кадр при этом погода меняет сильно — в зале арены средняя яркость падает со
 * 115 до 68, — но меняет её туман и сила света, а не цвет неба у горизонта, и
 * точка показывала бы ровно ту величину, которая как раз и не решает. Кружок,
 * который выглядит как данные, но данными не является, хуже его отсутствия — а
 * вместе с ним ушли и пятнадцать эталонных документов, которые приходилось
 * считать заранее: сорок пять миллисекунд в кадре открытия редактора.
 */
const WeatherRail = memo(function WeatherRail({ value, onPick }) {
  useTr();
  /*
   * Нажатой отмечается та погода, которую сцена и правда рисует.
   *
   * Ключ приходит из проекта, а проект переживает и чужой файл, и снимок
   * постарше. Незнакомое имя сцена молча сводит к `EXTRASUNNY` — и без этой
   * же поправки ряд остался бы вовсе без нажатой кнопки: картинка ясная,
   * а нажатого нет, и человек ищет, где он.
   */
  const current = findWeather(value)?.id || "EXTRASUNNY";

  return (
    <div className="preview-window-rail" role="group" aria-label={tr("Погода")}>
      {WEATHER_TYPES.map((item) => {
        const active = item.id === current;
        return (
          <button
            key={item.id}
            type="button"
            className={`preview-window-chip${active ? " is-active" : ""}`}
            aria-pressed={active}
            title={`${item.label.ru} — небо, туман и свет из таймцикла ${item.id}`}
            onClick={() => onPick(item.id)}
          >
            {item.label.ru}
          </button>
        );
      })}
    </div>
  );
});

/*
 * Ряд качества.
 *
 * Ступень видно не по кнопке, а по кадру: на «низком» пропадают тени, на
 * «высоком» появляется полуторная плотность пикселей. Счётчик кадров в углу
 * кадра показывает, чего это стоило, и какую ступень выбрало «авто», —
 * поэтому цену выбора здесь не дублируем.
 */
const QualityRow = memo(function QualityRow({ value, onPick }) {
  useTr();
  return (
    <div className="preview-window-rail" role="group" aria-label={tr("Качество")}>
      {QUALITY_STEPS.map((step) => {
        const active = step.value === value;
        return (
          <button
            key={step.value}
            type="button"
            className={`preview-window-chip${active ? " is-active" : ""}`}
            aria-pressed={active}
            title={step.hint}
            onClick={() => onPick(step.value)}
          >
            {step.label}
          </button>
        );
      })}
    </div>
  );
});

/**
 * Полоса органов под кадром.
 *
 * @param {object} props
 * @param {number} props.timeOfDay Часы 0…24.
 * @param {string} props.weather Ключ погоды таймцикла.
 * @param {"auto"|"low"|"medium"|"high"} props.quality
 * @param {Function} [props.onTimeOfDayChange] Есть — показывается шкала суток.
 * @param {Function} [props.onWeatherChange] Есть — показывается ряд погоды.
 * @param {Function} [props.onQualityChange] Есть — показывается ряд качества.
 *
 * Обработчики обязаны быть постоянными между перерисовками, иначе память рядов
 * не сработает. Окно приводит их к постоянным само — редактору можно писать
 * стрелку прямо в разметке.
 */
export default memo(function PreviewControls({
  timeOfDay = 12,
  weather = "EXTRASUNNY",
  quality = "auto",
  onTimeOfDayChange = null,
  onWeatherChange = null,
  onQualityChange = null,
}) {
  if (!onTimeOfDayChange && !onWeatherChange && !onQualityChange) return null;

  return (
    <div className="preview-window-controls">
      {onTimeOfDayChange ? (
        /*
         * Скраббер здесь свой, а не лента неба из `SkyStage.jsx`.
         *
         * Та лента говорит про опорные кадры таймцикла — отметки под ней
         * ставят время ровно на кадр, который правят. В редакторе дороги или
         * арены никакой правки в кадр не попадает — время там просто
         * освещение, и отметки кадров сбивали бы с толку. Общее с редактором
         * неба — расчёт цвета полосы: он взят из пакета, а не переписан.
         */
        <div className="preview-window-timeline ui-slider">
          <TimeBand weather={weather} onPick={onTimeOfDayChange} />
          <input
            type="range"
            min={0}
            max={23.99}
            step={0.05}
            value={normalizeHour(timeOfDay)}
            aria-label={tr("Время суток")}
            onChange={(event) => onTimeOfDayChange(Number(event.target.value))}
          />
        </div>
      ) : null}

      {onWeatherChange ? (
        <WeatherRail value={weather} onPick={onWeatherChange} />
      ) : null}

      {onQualityChange ? (
        <QualityRow value={quality} onPick={onQualityChange} />
      ) : null}
    </div>
  );
});
