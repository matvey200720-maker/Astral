import { useRef } from "react";
import { Heartbeat, Rows, Shield, TextAa } from "../../../ui/icons.jsx";
import {
  MINIMAP_WIDGET_LABELS,
  minimapWidgetKind,
} from "../MinimapPreview.jsx";
import { useMinimapCopy } from "../minimap-lang.js";
import { useTr } from "../../../../locales/ui.js";
import {
  SCREEN_NUDGE,
  SCREEN_NUDGE_LARGE,
  placeWidgetOnScreen,
  screenHandleIds,
  screenPointOf,
} from "./screen-indicator.js";

/*
 * Кадр «Экран»: метка прицела и ручки элементов HP (владелец, 21.11.2026).
 *
 * Метка — крестик в середине экрана: там в игре стоит прицел, и индикатор «у прицела» ставят от него. Рисует его не мини-карта, а
 * прицел игры, поэтому метка только показывает место и мышь не берёт.
 *
 * Ручка — по одной на каждый видимый элемент группы HP, пока включено «HP отдельно от карты». Она стоит на экранном месте своего
 * элемента, тянется мышью и двигается стрелками (шаг 0,01 экрана, с Shift — 0,05) и двигает только его: вся группа тянется своей
 * рамкой (`VitalsHandle`). Протяжка идёт черновиком — окно показывает его, а в проект и историю место уходит одним шагом на
 * отпускании (как и у карты на экране); стрелки пишут сразу.
 */

/* Стрелки клавиатуры — направление шага. */
const ARROW_STEPS = Object.freeze({
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
});

const percent = (value) => `${value * 100}%`;
const clamp01 = (value) => Math.max(0, Math.min(1, value));

/** Метка прицела — середина экрана игры. Слой кадра «Экран» (`.mmc-screen`) считается от холста формы, поэтому 50 % и есть середина. */
export function AimMark() {
  return <span className="mmc-aim-mark" aria-hidden="true" />;
}

/* Значок ручки по виду элемента: полоса, цифры, значок HP или брони. Что именно — в подписи и подсказке. */
function handleIcon(id) {
  const kind = minimapWidgetKind(id);
  if (kind === "bar") return Rows;
  if (kind === "number") return TextAa;
  return id.startsWith("health") ? Heartbeat : Shield;
}

/**
 * @param {object} props
 * @param {object} props.config проект (с черновиком протяжки)
 * @param {{left:number, top:number, width:number, height:number}} props.frame кадр мини-карты на экране, доли экрана
 * @param {string|null} props.selected взятый элемент
 * @param {(id: string) => void} [props.onSelect] элемент взят ручкой
 * @param {(place: {id: string, x: number, y: number} | null) => void} props.onDraft место на время протяжки; `null` — протяжка кончилась
 * @param {(id: string, place: {x: number, y: number}, label: string) => void} props.onPlace место, которое уходит в проект
 * @param {{ moved: (name: string) => string, nudged: (name: string) => string } | null} [props.labels] свои подписи шагов истории (вид «Увеличенная»); без них — обычные
 */
export function ScreenWidgetHandles({
  config,
  frame,
  selected = null,
  onSelect = null,
  onDraft,
  onPlace,
  labels = null,
}) {
  useTr();
  const copy = useMinimapCopy();
  const moved = labels?.moved ?? copy.widgetMoved;
  const nudged = labels?.nudged ?? copy.widgetNudged;
  const dragRef = useRef(null);
  /* Ручка стоит на экране всегда: элемент старой работы мог лежать за краем, и без этого его было бы не достать. */
  const handleAt = (id) => {
    const widget = config.layout.widgets[id];
    const point = screenPointOf(frame, widget.x, widget.y);
    return { x: clamp01(point.x), y: clamp01(point.y) };
  };
  const start = (event, id) => {
    if (event.button !== 0) return;
    const box = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!box?.width || !box?.height) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus?.({ preventScroll: true });
    onSelect?.(id);
    dragRef.current = {
      id,
      box,
      startX: event.clientX,
      startY: event.clientY,
      from: handleAt(id),
      last: null,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const move = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.stopPropagation();
    const place = placeWidgetOnScreen(config, drag.id, frame, {
      x: drag.from.x + (event.clientX - drag.startX) / drag.box.width,
      y: drag.from.y + (event.clientY - drag.startY) / drag.box.height,
    });
    drag.last = place;
    onDraft({ id: drag.id, ...place });
  };
  const stop = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.stopPropagation();
    dragRef.current = null;
    onDraft(null);
    /* Щелчок без движения только берёт элемент: в проект и историю ничего не идёт. */
    if (drag.last)
      onPlace(drag.id, drag.last, moved(MINIMAP_WIDGET_LABELS[drag.id]));
  };
  const nudge = (event, id) => {
    const direction = ARROW_STEPS[event.key];
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect?.(id);
    const step = event.shiftKey ? SCREEN_NUDGE_LARGE : SCREEN_NUDGE;
    const from = handleAt(id);
    onPlace(
      id,
      placeWidgetOnScreen(config, id, frame, {
        x: from.x + direction[0] * step,
        y: from.y + direction[1] * step,
      }),
      nudged(MINIMAP_WIDGET_LABELS[id]),
    );
  };
  return screenHandleIds(config).map((id) => {
    const at = handleAt(id);
    const Icon = handleIcon(id);
    const name = copy.widgetDrag(MINIMAP_WIDGET_LABELS[id]);
    return (
      <button
        key={id}
        type="button"
        className={`mmc-screen-handle${selected === id ? " is-selected" : ""}`}
        data-widget={id}
        aria-label={name}
        title={name}
        aria-pressed={selected === id}
        style={{
          left: percent(at.x),
          top: percent(at.y),
          /* Цвет значка — цвет самой стороны: HP или брони, как их красит человек. */
          color: id.startsWith("health")
            ? config.effects.healthColor
            : config.effects.armorColor,
        }}
        /* Ручка — метка места элемента на экране, а не кнопка интерфейса: элементы вплотную (полоса и значок, два значка шкалы)
           легко ложатся друг на друга, и перекрытие здесь — суть кадра. */
        data-audit-ignore="covered"
        onPointerDown={(event) => start(event, id)}
        onPointerMove={move}
        onPointerUp={stop}
        onPointerCancel={stop}
        onKeyDown={(event) => nudge(event, id)}
        onFocus={() => onSelect?.(id)}
      >
        <Icon />
      </button>
    );
  });
}
