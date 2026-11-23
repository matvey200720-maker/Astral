import { useEffect, useMemo, useRef, useState } from "react";
import { ANIMAL_LIMITS, fitMarkerHeight, iconSvg, modelMarkerSpan } from "@modovik/climb-contract/animals";
import Button from "../../../components/ui/Button.jsx";
import { STAGE_IDLE, startStageLoop } from "../../../components/desktop/workshop/stage-loop.js";
import { markWheel } from "../../../components/ui/wheel-mark.js";
import { tr, useTr } from "../../../locales/ui.js";
import { useAnimalEmblem } from "./animal-emblem.js";
import { createAnimalScene } from "./animal-scene.js";

/*
 * Кадр редактора «Животные» (05.11.2026): тело животного из файлов игры игрока, с перекраской, свечением и меткой так, как они
 * лягут в игру. Мышь: левая кнопка — поворот, колесо — приближение, двойной щелчок — вернуть вид.
 *
 * Без Astral Desktop и без игры файлов Rockstar в окне нет (в поставку их не кладут) — тогда вместо модели стоит постановочная
 * схема: силуэт животного и метка над ним, и подпись под ней говорит об этом прямо.
 */

const MAX_STAGE_WIDTH = 3840;
const MAX_STAGE_HEIGHT = 2160;

const dataUri = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/**
 * Постановочная схема: силуэт в цвете перекраски, оболочка свечения, метка на палочке. Своя эмблема — сама картинка, копия
 * животного — его силуэт цветом метки (настоящая сетка тела читается только из игры).
 */
function StagedView({ animal, look }) {
  const colour = look.colour.on ? look.colour.hex : "#9a8f7e";
  const body = useMemo(() => dataUri(iconSvg(animal.icon, colour)), [animal.icon, colour]);
  const emblem = useAnimalEmblem(look.marker.kind === "emblem" ? look.marker.emblem : "");
  const marker = useMemo(() => {
    if (look.marker.kind === "emblem") return emblem.url;
    return dataUri(iconSvg(look.marker.kind === "model" ? animal.icon : look.marker.icon, look.marker.hex));
  }, [animal.icon, emblem.url, look.marker.kind, look.marker.icon, look.marker.hex]);
  const range = ANIMAL_LIMITS.markerHeight;
  /* Высота метки на схеме — доля от потолка, чтобы движение ползунка было видно. */
  const lift = 24 + ((look.marker.height - range.min) / (range.max - range.min)) * 46;
  return (
    <div className="animals-staged" role="img" aria-label={tr("Постановочная схема животного")}>
      {look.marker.on && marker && (
        <div className="animals-staged-marker" style={{ bottom: `calc(34% + ${look.marker.pole ? 0 : 0}px)`, height: `${lift}%` }}>
          <img src={marker} alt="" style={{ filter: `drop-shadow(0 0 ${4 + look.marker.power * 3}px ${look.marker.hex})` }} />
          {look.marker.pole && <i style={{ background: look.marker.hex }} />}
        </div>
      )}
      <img
        className="animals-staged-body"
        src={body}
        alt=""
        style={look.glow.on ? { filter: `drop-shadow(0 0 ${look.glow.reach * 2 + 2}px ${look.glow.hex}) drop-shadow(0 0 ${look.glow.power * 4}px ${look.glow.hex})` } : undefined}
      />
    </div>
  );
}

function meters(value) {
  return (Math.round(value * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export default function AnimalStage({ animal, look, model, onReady }) {
  useTr();
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const viewRef = useRef(null);
  const loopRef = useRef(null);
  const sizeRef = useRef(null);
  const sceneRef = useRef(null);
  const [unavailable, setUnavailable] = useState(false);
  const [shown, setShown] = useState(null);
  const ready = model.status === "ready" && model.model;
  /* Сцена живёт, пока читается и стоит тело: переключение между животными не отдаёт рендерер окна и не собирает его заново. */
  const sceneWanted = model.status === "ready" || model.status === "loading";

  /* Сцена: берётся у окна, пока кадр на экране. Рендерер занят — сцены нет, и окно говорит об этом. */
  useEffect(() => {
    if (!sceneWanted) return undefined;
    const scene = createAnimalScene({ onChange: () => loopRef.current?.invalidate() });
    sceneRef.current = scene;
    setUnavailable(!scene);
    return () => {
      sceneRef.current = null;
      setShown(null);
      scene?.dispose();
    };
  }, [sceneWanted]);

  /* Тело животного: GLB из игры. */
  useEffect(() => {
    const scene = sceneRef.current;
    if (!ready || !scene) return undefined;
    let cancelled = false;
    setShown(null);
    scene
      .load(model.model.glb, { id: model.id, bounds: model.model.bounds })
      .then(() => {
        if (cancelled) return;
        setShown(model.id);
        onReady?.(model.model);
        loopRef.current?.invalidate();
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, model.id, model.model]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Перекраска и украшения следуют за обликом. Высота метки подрезается по шару видимости модели. */
  const emblem = useAnimalEmblem(look.marker.kind === "emblem" ? look.marker.emblem : "");
  const picture = emblem.status === "ready" ? emblem.url : "";
  const fitted = useMemo(() => {
    const bounds = model.model?.bounds;
    const top = bounds?.max?.[1];
    if (!Number.isFinite(top)) return { height: look.marker.height, clamped: false, topY: NaN };
    /* Копия животного — «размер» в метрах у неё свой: высота копии по габариту тела и длинной стороне (как считает сборка). */
    const size =
      look.marker.kind === "model"
        ? modelMarkerSpan([bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]], look.marker.modelSize).height
        : look.marker.size;
    const fit = fitMarkerHeight({ height: look.marker.height, size }, top, ANIMAL_LIMITS.markerHeight.min);
    /* Верх метки в осях сцены: верх тела + высота + половина метки. */
    return { ...fit, topY: top + fit.height + size / 2 };
  }, [look.marker, model.model]);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || shown !== model.id) return undefined;
    const timer = window.setTimeout(() => {
      scene.paint(look.colour);
      loopRef.current?.invalidate();
    }, 40);
    return () => window.clearTimeout(timer);
  }, [look.colour, shown, model.id]);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || shown !== model.id) return;
    scene.decorate({ glow: look.glow, marker: { ...look.marker, picture }, markerHeight: fitted.height });
    loopRef.current?.invalidate();
  }, [look.glow, look.marker, picture, fitted.height, shown, model.id]);

  /* Кадровый цикл: рисует по просьбе (поворот, правка), в покое кадров не просит. */
  useEffect(() => {
    const element = viewRef.current;
    const canvas = canvasRef.current;
    if (!sceneWanted || !element || !canvas) return undefined;
    const measure = () => {
      const width = Math.floor(element.clientWidth);
      const height = Math.floor(element.clientHeight);
      sizeRef.current = width > 40 && height > 40 ? [Math.min(MAX_STAGE_WIDTH, width - (width % 2)), Math.min(MAX_STAGE_HEIGHT, height)] : null;
      loopRef.current?.invalidate();
    };
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    const loop = startStageLoop({
      element,
      frame() {
        const size = sizeRef.current;
        const scene = sceneRef.current;
        if (!size || !scene || !scene.hasBody()) return STAGE_IDLE;
        scene.render(canvas, size);
        return STAGE_IDLE;
      },
    });
    loopRef.current = loop;
    return () => {
      observer?.disconnect();
      loop.stop();
      loopRef.current = null;
    };
  }, [sceneWanted, unavailable]);

  /* Мышь: поворот и приближение. Колесо слушается напрямую, чтобы отменять прокрутку страницы. */
  useEffect(() => {
    const element = wrapRef.current;
    if (!sceneWanted || !element) return undefined;
    const drag = { id: null, x: 0, y: 0 };
    const down = (event) => {
      /* Подпись под кадром — не поле для вращения: захват мыши увёл бы щелчок мимо кнопки в ней. */
      if (event.button !== 0 || event.target?.closest?.(".animals-stage-caption")) return;
      drag.id = event.pointerId;
      drag.x = event.clientX;
      drag.y = event.clientY;
      element.setPointerCapture?.(event.pointerId);
    };
    const move = (event) => {
      if (drag.id !== event.pointerId) return;
      sceneRef.current?.orbit(event.clientX - drag.x, event.clientY - drag.y);
      drag.x = event.clientX;
      drag.y = event.clientY;
      loopRef.current?.invalidate();
    };
    const up = (event) => {
      if (drag.id === event.pointerId) drag.id = null;
    };
    const wheel = (event) => {
      event.preventDefault();
      sceneRef.current?.zoom(event.deltaY > 0 ? 1.1 : 0.9);
      loopRef.current?.invalidate();
    };
    const reset = () => {
      sceneRef.current?.reset();
      loopRef.current?.invalidate();
    };
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
    element.addEventListener("wheel", wheel, { passive: false });
    /* Колесо над кадром — приближение: метка для правила `scroll`. */
    const unmarkWheel = markWheel(element);
    element.addEventListener("dblclick", reset);
    return () => {
      unmarkWheel();
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("dblclick", reset);
    };
  }, [sceneWanted]);

  const bounds = model.model?.bounds;
  const length = bounds ? Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]) : 0;
  const height = bounds ? bounds.max[1] - bounds.min[1] : 0;

  return (
    <div className="animals-stage" ref={wrapRef} data-state={model.status} data-ready={shown === model.id ? "" : undefined}>
      {sceneWanted && !unavailable && (
        <div className="animals-view" ref={viewRef}>
          <canvas ref={canvasRef} className="animals-canvas" aria-label={tr("Модель животного из вашей игры")} />
        </div>
      )}
      {model.status === "staged" && animal && <StagedView animal={animal} look={look} />}
      {model.status === "loading" && (
        <p className="animals-stage-note" role="status">
          <i aria-hidden="true" />
          {tr("Читаю животное из ваших файлов игры…")}
        </p>
      )}
      {model.status === "error" && (
        <p className="animals-stage-note is-error" role="alert">
          {tr("Животное не прочиталось")}
          <small>{model.reason}</small>
        </p>
      )}
      {sceneWanted && unavailable && <p className="animals-stage-note is-error" role="alert">{tr("Кадр недоступен: рендерер окна занят другим редактором. Закройте его и откройте «Животных» снова.")}</p>}
      <footer className="animals-stage-caption">
        {model.status === "staged" ? (
          <span>{tr("Постановочная схема: файлов GTA V под рукой нет, текстур Rockstar в поставке нет. В Astral с вашей игрой здесь — настоящая модель животного.")}</span>
        ) : (
          <span>
            {tr("Модель и текстуры — из ваших файлов игры")}
            {bounds ? ` · ${tr("длина")} ${meters(length)} ${tr("м")} · ${tr("высота")} ${meters(height)} ${tr("м")}` : ""}
          </span>
        )}
        {look.marker.on && model.status === "ready" && shown === model.id && (look.marker.kind !== "emblem" || picture) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              sceneRef.current?.revealMarker(fitted.topY);
              loopRef.current?.invalidate();
            }}
          >
            {tr("Показать метку целиком")}
          </Button>
        )}
        {fitted.clamped && look.marker.on && (
          <b className="animals-clamp">{tr("Метка опущена до {0} м: выше животное пропадёт из виду вместе с ней.").replace("{0}", String(fitted.height).replace(".", ","))}</b>
        )}
      </footer>
    </div>
  );
}
