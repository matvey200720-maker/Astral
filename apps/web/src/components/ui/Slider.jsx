/*
 * Ползунок со значением.
 *
 * Внешний вид живёт в дизайн-пакете (`.ui-slider` в ui.css) и общий для всего
 * лаунчера. Здесь — только то, что нельзя выразить в CSS: доля пройденной
 * дорожки. Браузер не сообщает её стилям, поэтому она считается тут и уходит
 * переменной `--ui-slider-fill`; без неё дорожка была бы ровной линией, и
 * ползунок читался бы как чужой системный элемент, а не как часть Astral.
 *
 * Раскладка — та же `ui-field`, что у остальных полей: подпись, орган
 * управления, значение. Своя сетка в каждом редакторе означала бы, что колонки
 * значений в них никогда не совпадут.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { tr, useTr } from "../../locales/ui.js";

function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

/**
 * Доля пройденной дорожки в процентах.
 * Выведена отдельно для тех мест, где рядом с ползунком стоит поле ввода и
 * готовая раскладка `Slider` не подходит: закраска всё равно должна считаться
 * одинаково, иначе два ползунка рядом заполнены по-разному.
 */
export function sliderFill(value, min, max) {
  const span = Number(max) - Number(min) || 1;
  const clamped = Math.min(
    Math.max(Number(value) || 0, Number(min)),
    Number(max),
  );
  return `${((clamped - Number(min)) / span) * 100}%`;
}

/** Сколько знаков после запятой даёт шаг: 0.05 — два, 1 — ни одного. */
function stepDecimals(step) {
  const text = String(step);
  return text.includes(".") ? Math.min(text.split(".")[1].length, 3) : 0;
}

/** Значение показывается ровно с той точностью, с какой его можно задать. */
function formatValue(value, step) {
  const numeric = Number(value) || 0;
  return numeric.toFixed(stepDecimals(step));
}

/**
 * Число из набранного текста.
 *
 * Набирают так, как пишут: «12,5», «−90°», «8 px», «40 %». Запятая — та же
 * точка, длинный минус — тот же минус, единицы и пробелы отбрасываются. Текст
 * без единой цифры числом не считается: стёртое поле значит «передумал», а не
 * «ноль».
 */
export function parseSliderInput(text) {
  const cleaned = String(text ?? "")
    .replace(/[‒–—−]/g, "-")
    .replace(/,/g, ".")
    .replace(/[^0-9.+-]/g, "");
  if (!/\d/.test(cleaned)) return null;
  const number = Number.parseFloat(cleaned);
  return Number.isFinite(number) ? number : null;
}

/**
 * Набранное число в границах дорожки и на её шаге.
 *
 * С клавиатуры нельзя получить то, чего нельзя получить бегунком: иначе
 * «толщина 99» ушла бы в настройку мимо предела, который держит сама дорожка.
 */
export function snapSliderValue(value, min, max, step) {
  const low = Number(min);
  const high = Number(max);
  const size = Number(step) > 0 ? Number(step) : 1;
  const bounded = Math.min(Math.max(Number(value), low), high);
  const snapped = low + Math.round((bounded - low) / size) * size;
  return Number(
    Math.min(Math.max(snapped, low), high).toFixed(stepDecimals(size)),
  );
}

/**
 * Значение, которое можно набрать.
 *
 * В покое это то же число с единицей, что и у обычного ползунка. В фокусе
 * единица уходит и число выделяется целиком — набранное заменяет его, а не
 * дописывается рядом. Enter или уход фокуса принимают, Escape возвращает
 * прежнее, стрелки вверх и вниз шагают по шагу дорожки (с Shift — по десять).
 */
function SliderValue({
  value,
  min,
  max,
  step,
  unit,
  format,
  disabled,
  name,
  onChange,
}) {
  useTr();
  const [draft, setDraft] = useState(null);
  const input = useRef(null);
  const cancelled = useRef(false);
  /* Выделять после отрисовки: в фокусе число меняется (уходит единица), а
     смена значения сбрасывает выделение, сделанное до неё. */
  const selectAfterRender = useRef(false);
  /* Щелчок мышью. Chrome на отпускании кнопки ставит курсор в точку щелчка
     и снимает выделение, сделанное при фокусе, — и набранные «45» вставали
     рядом со старым нулём, давая «450». Первое отпускание после фокуса мышью
     поэтому своего действия не выполняет. */
  const keepSelection = useRef(false);
  const shown = `${format ? format(value) : formatValue(value, step)}${unit}`;

  useLayoutEffect(() => {
    if (draft === null || !selectAfterRender.current) return;
    selectAfterRender.current = false;
    input.current?.select();
  }, [draft]);

  /*
   * Колесо над числом — шаг дорожки, с Shift — десять (ТЗ владельца
   * 22.10.2026, часть 1). Только пока поле в фокусе: иначе прокрутка панели,
   * проходя мимо ползунков, крутила бы их значения. Слушатель — свой, не
   * React: колесо React пассивное, и страница прокручивалась бы вместе с
   * числом.
   */
  const latestNudge = useRef(null);
  useEffect(() => {
    const field = input.current;
    if (!field) return undefined;
    const onWheel = (event) => {
      if (document.activeElement !== field || !event.deltaY) return;
      event.preventDefault();
      latestNudge.current?.(field.value, event.deltaY < 0 ? 1 : -1, event.shiftKey);
    };
    field.addEventListener("wheel", onWheel, { passive: false });
    return () => field.removeEventListener("wheel", onWheel);
  }, []);

  const accept = (next) => {
    if (next !== Number(value)) onChange?.(next);
  };
  const nudge = (text, direction, large) => {
    const base = parseSliderInput(text) ?? (Number(value) || 0);
    const size = Number(step) > 0 ? Number(step) : 1;
    const next = snapSliderValue(
      base + direction * size * (large ? 10 : 1),
      min,
      max,
      step,
    );
    setDraft(formatValue(next, step));
    accept(next);
  };
  latestNudge.current = nudge;

  return (
    <input
      ref={input}
      className="ui-slider-value"
      data-wheel="step"
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      disabled={disabled}
      aria-label={name ? `${name}: ${tr("значение")}` : tr("Значение")}
      value={draft ?? shown}
      onMouseDown={(event) => {
        if (document.activeElement !== event.currentTarget)
          keepSelection.current = true;
      }}
      onMouseUp={(event) => {
        if (!keepSelection.current) return;
        keepSelection.current = false;
        event.preventDefault();
      }}
      onFocus={() => {
        selectAfterRender.current = true;
        setDraft(formatValue(value, step));
      }}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancelled.current = true;
          event.currentTarget.blur();
        } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          nudge(
            event.currentTarget.value,
            event.key === "ArrowUp" ? 1 : -1,
            event.shiftKey,
          );
        }
      }}
      onBlur={(event) => {
        /* Текст берётся из самого поля, а не из состояния: Enter уводит фокус
           в том же событии, и состояние к этому моменту ещё старое. */
        const text = event.currentTarget.value;
        keepSelection.current = false;
        setDraft(null);
        if (cancelled.current) {
          cancelled.current = false;
          return;
        }
        const parsed = parseSliderInput(text);
        if (parsed !== null) accept(snapSliderValue(parsed, min, max, step));
      }}
    />
  );
}

/*
 * Перетаскивание бегунка не имеет права стоить кадра на каждое движение мыши.
 *
 * Мышь с частым опросом присылает `input` чаще, чем экран успевает кадр, и
 * каждое такое событие шло в проект целиком: правка модуля, снимок истории,
 * отпечаток «сохранено или нет» и перерисовка всего редактора. В прицеле это
 * восемь миллисекунд неоптимизируемой работы (редактор не мемоизирован — да и
 * мемоизировать нечего: от правки зависит весь его разбор) на событие, которых
 * за кадр прилетает два-три. Так и выглядело «прокрутки баганно работают,
 * фризится»: бегунок отстаёт от курсора, потому что очередь событий длиннее
 * кадра.
 *
 * Поэтому во время перетаскивания правка отдаётся наружу не чаще кадра.
 *
 * А сам бегунок держит своё «живое» значение, пока его тянут. Без этого он
 * отскакивал: `<input>` управляемый, и React после каждого `input` возвращает
 * ему значение из свойств — а новое значение редактор узнаёт только на
 * следующем кадре. Замер настоящей мышью (`npm run perf`) показал отскок на
 * 36 шагах из 36: бегунок дёргался назад и догонял курсор кадром позже, и это
 * было то самое «ползунки фризят» уже без всякой тяжёлой работы. Живое значение
 * перерисовывает только сам ползунок — это дёшево, — а редактору правка
 * по-прежнему уходит раз в кадр.
 *
 * Слияние включается только перетаскиванием. Клавиатура, щелчок по дорожке и
 * программная смена значения проходят как раньше, сразу: там события считанные,
 * и откладывать их — значит откладывать ответ на одно нажатие.
 */
function useDragCoalescedChange(onChange) {
  const pending = useRef(null);
  const frame = useRef(0);
  const dragging = useRef(false);
  const handler = useRef(onChange);
  handler.current = onChange;
  /* Значение под рукой, пока бегунок тянут; `null` — показываем свойства. */
  const [live, setLive] = useState(null);

  const flush = useCallback(() => {
    frame.current = 0;
    if (pending.current === null) return;
    const value = pending.current;
    pending.current = null;
    handler.current?.(value);
  }, []);

  useEffect(
    () => () => {
      if (frame.current) globalThis.cancelAnimationFrame?.(frame.current);
    },
    [],
  );

  return {
    live,
    onPointerDown: () => {
      dragging.current = true;
    },
    onPointerUp: () => {
      dragging.current = false;
      if (frame.current) {
        globalThis.cancelAnimationFrame?.(frame.current);
        flush();
      }
      /* Последняя правка ушла тем же событием, и обе перерисовки сольются:
         бегунок сразу встаёт на то, что принял редактор (он вправе поправить
         значение — например, упереть в край). */
      setLive(null);
    },
    onChange: (value) => {
      if (!dragging.current || typeof requestAnimationFrame !== "function") {
        handler.current?.(value);
        return;
      }
      setLive(value);
      pending.current = value;
      if (!frame.current) frame.current = requestAnimationFrame(flush);
    },
  };
}

export default function Slider({
  label,
  hint,
  value,
  min = 0,
  max = 100,
  step = 1,
  unit = "",
  format,
  onChange,
  disabled = false,
  /*
   * Значение можно набрать с клавиатуры.
   *
   * Бегунок хорош, пока нужно «побольше» или «поменьше». Когда нужно ровно
   * 12,5 % или −90°, тащить его до точки — это ловить пиксель мышью. Щелчок по
   * значению превращает его в поле ввода.
   *
   * Включено везде (владелец, 03.10.2026: «где ползунок — там и цифры»). Раньше
   * поле включали поштучно, и из трёх сотен ползунков мастерской набрать
   * число можно было у двух редакторов. Выключают его только там, где число
   * — не настройка, а показание: ход времени на дорожке воспроизведения.
   */
  editable = true,
  className = "",
  ariaLabel,
}) {
  useTr();
  const name = ariaLabel || (typeof label === "string" ? label : undefined);
  const drag = useDragCoalescedChange(onChange);
  /* Пока бегунок тянут, и дорожка, и число показывают то, что под рукой. */
  const shown = drag.live ?? value;
  const clamped = Math.min(
    Math.max(Number(shown) || 0, Number(min)),
    Number(max),
  );

  /* `Number(value) || 0` прощает нечисло молча: ползунок встаёт в ноль и
     выглядит исправным, а настройка, которой на деле нет, никак себя не
     выдаёт. Ползунок общий на всю мастерскую, и такую подмену ищут потом
     часами — поэтому в разработке она говорит о себе вслух. Ветка целиком
     вырезается из продуктовой сборки. */
  if (
    import.meta.env?.DEV &&
    value !== undefined &&
    !Number.isFinite(Number(value))
  )
    console.warn(
      `Slider «${name || tr("без имени")}»: значение ${String(value)} — не число, ползунок показывает ноль.`,
    );

  /*
   * Пояснение перестраивает строку в две.
   *
   * Одна строка верна, пока подпись — два слова. С пояснением она съедала
   * дорожку до нуля в колонке 336 px: ползунок есть, двигать нечего. Это
   * лечили дважды местным правилом — у эффектов и у килл-эффекта, слово в слово.
   * Условие одно и то же, значит и вид один: есть пояснение — дорожка уходит
   * на свою строку.
   */
  return (
    <label
      className={joinClassNames(
        "ui-field ui-slider",
        hint && "is-stacked",
        className,
      )}
    >
      <span className="ui-slider-copy">
        {label}
        {hint && <small title={typeof hint === "string" ? hint : undefined}>{hint}</small>}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={clamped}
        disabled={disabled}
        aria-label={name}
        style={{ "--ui-slider-fill": sliderFill(shown, min, max) }}
        onPointerDown={drag.onPointerDown}
        onPointerUp={drag.onPointerUp}
        onPointerCancel={drag.onPointerUp}
        /* Уход фокуса ловит и тот случай, когда кнопку отпустили за пределами
           окна: без него последнее значение осталось бы в очереди кадра. */
        onBlur={drag.onPointerUp}
        onChange={(event) => drag.onChange(Number(event.target.value))}
      />
      {editable ? (
        <SliderValue
          value={shown}
          min={min}
          max={max}
          step={step}
          unit={unit}
          format={format}
          disabled={disabled}
          name={name}
          onChange={onChange}
        />
      ) : (
        <output>
          {format ? format(shown) : formatValue(shown, step)}
          {unit}
        </output>
      )}
    </label>
  );
}
