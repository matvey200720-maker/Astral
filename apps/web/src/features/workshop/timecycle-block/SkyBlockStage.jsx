/*
 * Кадр неба с кварталом из игры (задача 4Б ТЗ 18.10.2026): настоящий кусок
 * карты из установленной GTA V — Davis, Мега Молл и соседи, с дальними LOD —
 * под небом и светом таймцикла, лента суток над ним.
 *
 * Квартал читается из игры игрока на его машине (в поставке Astral текстур и
 * моделей Rockstar нет): здания, дороги и пропы — оттуда, свет, небо, туман,
 * экспозиция и кривая — по числам таймцикла, а материалы, тени и отражения
 * упрощены, и подпись кадра говорит об этом. Земля и вода за краем квартала
 * нарисованы Astral — как прежде весь город.
 *
 * Камера — общая на все 3D-кадры мастерской: WASD над кадром — полёт, ЛКМ —
 * осмотреться, колесо — приближение, двойной щелчок — вид по умолчанию.
 * Время — лентой, как у плоского кадра неба (`SkyTimebar`): смена часа сразу
 * в кадре, программы квартала собраны заранее и час их не пересобирает.
 *
 * Когда квартал показать нельзя — браузер без Astral Desktop, игры нет,
 * видеокарта не умеет рисовать в буфер с плавающей точкой — кадр сообщает
 * причину (`onUnavailable`), и редактор остаётся на нарисованном квартале.
 *
 * Тот же кадр берут «Фонари» (задача 19 ТЗ 18.10.2026): уличные лампы на
 * столбах квартала (`lampSlots`, `onScene`), свои виды камеры (`pose`,
 * `frame`) и своя подпись (`caption`).
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowCounterClockwise } from "../../../components/ui/icons.jsx";
import { watchFrameGate } from "../../../attention.js";
import { grabCanvas, registerFrameShot } from "../frame-shot.js";
import { humanFailure } from "../../../utils/installFailure.js";
import Button from "../../../components/ui/Button.jsx";
import { StageBar, StageNote } from "../../../components/ui/StageOverlay.jsx";
import { useFrameHold } from "../../../components/ui/stage-busy.js";
import { SkyTimebar } from "../../../components/desktop/workshop/SkyStage.jsx";
import { createSkyRendererAsync } from "../../../components/desktop/workshop/sky-renderer.js";
import { createBlockScene } from "./block-scene.js";
import { holdFrame, takeHeldFrame } from "./held-frame.js";
import { blockLowered, blockNote } from "./block-copy.js";
import { tr, useTr } from "../../../locales/ui.js";

/* Прежний кадр: сколько уходит после готовности квартала и сколько держится, если тот не готов (мс). */
const HOLD_FADE_MS = 420;
const HOLD_LIMIT_MS = 20000;

export default function SkyBlockStage({
  state,
  hour,
  onHourChange,
  band = [],
  selected = [],
  textures = null,
  clouds = null,
  hats = null,
  sheets = null,
  /* Настройки радуги (`rainbow.js`), когда она включена; иначе `null`. */
  rainbow = null,
  /* Погода кадра: осадки, ветер, молния, туман (`previewConditions`); `null` — таймцикл без добавок. */
  conditions = null,
  /* Переключатель «Квартал: из игры / нарисованный» — орган редактора, а не кадра. */
  modeControl = null,
  /* Квартал не собрался: причина — редактору, он вернёт нарисованный. */
  onUnavailable = null,
  /* Кадр фонарей и светофоров: число прожекторов ламп, глаз и рамка камеры, сцена — родителю, своя подпись. */
  lampSlots = 0,
  sectionId = "",
  /* Детали, которых в игре на этом месте нет, — кадр ставит их сам: `{ piece, at, yaw }` в метрах от якоря секции. */
  extraPlacements = undefined,
  pose = undefined,
  frame = undefined,
  /* Объём кадра (`makeVolume`): за его краями чёрная пустота; докуда летит камера; детали секции без подмен издалека. */
  volume = undefined,
  farWorld = undefined,
  flight = undefined,
  fixedDetail = false,
  /* Вид разрешает лететь (WASD): подпись холста для вида без полёта называет только осмотр. */
  flying = true,
  onScene = null,
  /* Небо кадра — жилец рендерера окна (шаг Б фазы 5), а не свой контекст WebGL. */
  share = false,
}) {
  useTr();
  const canvasRef = useRef(null);
  const skyRef = useRef(null);
  const sceneRef = useRef(null);
  const unavailableRef = useRef(onUnavailable);
  unavailableRef.current = onUnavailable;
  const sceneCallbackRef = useRef(onScene);
  sceneCallbackRef.current = onScene;
  const [failure, setFailure] = useState("");
  const [note, setNote] = useState({ status: "loading", reason: "", progress: null });
  const [ready, setReady] = useState(false);

  /* Прежний кадр (кадр пересоздали — «Дорога» ↔ «Под мостом»): лежит поверх, пока квартал не готов (П6.6, `held-frame.js`). */
  const [held] = useState(takeHeldFrame);
  const [holding, setHolding] = useState(Boolean(held));
  const holdHostRef = useRef(null);
  useLayoutEffect(() => {
    if (held && holdHostRef.current) holdHostRef.current.appendChild(held);
  }, [held]);

  /*
   * Небо и квартал — на одном холсте и одном контексте. Шейдер неба собирает
   * видеочип (`createSkyRendererAsync`, KHR_parallel_shader_compile), программы
   * квартала — тоже параллельно (`block-view.js`): окно живёт, пока они готовятся.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let cancelled = false;
    let observer = null;
    let stopGate = null;
    let scene = null;
    let sky = null;
    const giveUp = (error) => {
      /* Стенд разработки видит сырую причину: человеку идёт `humanFailure`. */
      if (import.meta.env?.DEV) window.__astralBlockFailure = error;
      const reason = humanFailure(error);
      setFailure(reason);
      unavailableRef.current?.(reason);
    };
    createSkyRendererAsync(canvas, { share }).then(
      (created) => {
        if (cancelled) {
          created.dispose();
          return;
        }
        sky = created;
        try {
          scene = createBlockScene({
            canvas,
            sky,
            lampSlots,
            sectionId,
            ...(extraPlacements ? { extraPlacements } : {}),
            ...(pose ? { pose } : {}),
            ...(frame ? { frame } : {}),
            ...(volume ? { volume } : {}),
            ...(farWorld ? { farWorld } : {}),
            ...(flight ? { flight } : {}),
            ...(fixedDetail ? { fixedDetail } : {}),
            onStatus: (next) => {
              setNote(next);
              if (next.status === "unavailable") unavailableRef.current?.(next.reason);
            },
          });
        } catch (error) {
          sky.dispose();
          sky = null;
          giveUp(error);
          return;
        }
        skyRef.current = sky;
        sceneRef.current = scene;
        sceneCallbackRef.current?.(scene);
        /* Стенд разработки видит сцену: что решил глаз, сколько кадр стоит. */
        if (import.meta.env?.DEV) window.__astralBlockScene = scene;
        const measure = () => {
          const box = canvas.getBoundingClientRect();
          scene.resize(box.width, box.height, window.devicePixelRatio || 1);
        };
        observer = new ResizeObserver(measure);
        observer.observe(canvas);
        measure();
        stopGate = watchFrameGate(canvas, (open) => (open ? scene.start() : scene.stop()));
        setReady(true);
      },
      (error) => {
        if (!cancelled) giveUp(error);
      },
    );
    return () => {
      cancelled = true;
      stopGate?.();
      observer?.disconnect();
      sceneCallbackRef.current?.(null);
      /* Последняя картинка уходящего кадра — новому на время загрузки; рисуем её тут же, пока буфер холста цел. */
      if (scene && scene.status?.status === "ready") {
        try {
          scene.renderOnce();
          holdFrame(canvas);
        } catch {
          /* Кадр уже закрывается — прежней картинки не будет, и только. */
        }
      }
      scene?.dispose();
      sky?.dispose();
      skyRef.current = null;
      sceneRef.current = null;
      if (import.meta.env?.DEV) window.__astralBlockScene = null;
    };
    // Сцена создаётся один раз: число ламп, глаз и рамка — начальные, виды меняет родитель через `onScene`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Снимок работы (`frame-shot.js`): вид по умолчанию, нарисовать, забрать холст и вернуть камеру за одну задачу — человек этого не видит. */
  useEffect(
    () =>
      registerFrameShot({
        shoot: () => {
          const scene = sceneRef.current;
          if (!scene || scene.status?.status !== "ready") return null;
          const back = scene.camera.holdHome();
          try {
            scene.renderOnce();
            return grabCanvas(canvasRef.current);
          } finally {
            back();
            scene.renderOnce();
          }
        },
      }),
    [],
  );

  /* Луна и звёзды из игры приезжают позже холста. */
  useEffect(() => {
    skyRef.current?.setSkyTextures({ moon: textures?.moon || null, starfield: textures?.starfield || null });
    sceneRef.current?.invalidate();
  }, [textures, ready]);

  /* Облачные шапки игры: модели — одной описью, листы — по мере надобности. */
  useEffect(() => {
    skyRef.current?.setCloudHats(hats);
    sceneRef.current?.invalidate();
  }, [hats, ready]);

  useEffect(() => {
    const renderer = skyRef.current;
    if (!renderer || !sheets?.size) return;
    for (const [name, image] of sheets) if (!renderer.hasCloudHatSheet(name)) renderer.setCloudHatSheet(name, image);
    sceneRef.current?.invalidate();
  }, [hats, sheets, ready]);

  /* Небо, осадки и облака — в кадр на каждую правку: смена часа и погоды мгновенная. */
  useEffect(() => {
    sceneRef.current?.set({
      state,
      weather: rainbow || conditions ? { ...conditions, ...(rainbow ? { rainbow } : null) } : null,
      clouds,
    });
  }, [state, rainbow, conditions, clouds, ready]);

  const loading = !failure && note.status !== "ready";
  /* Комната открывается целиком (`components/ui/screen-ready.js`): занавес держится, пока квартал не приехал из игры или
     кадр не отказал, — таймциклы, фонари и вода рисуют этот кадр общим. Игры нет — отказ, и комната не ждёт. */
  useFrameHold(loading);
  /* Квартал готов (или не соберётся, или ждали слишком долго) — прежний кадр уходит плавно. */
  const holdDone = holding && (note.status === "ready" || Boolean(failure));
  useEffect(() => {
    if (!holding) return undefined;
    const timer = setTimeout(() => setHolding(false), holdDone ? HOLD_FADE_MS : HOLD_LIMIT_MS);
    return () => clearTimeout(timer);
  }, [holding, holdDone]);

  return (
    <div className="sky-stage sky-block-stage">
      <div className="sky-frame">
        {failure ? (
          <p className="sky-frame-failure">
            {tr("Предпросмотр неба недоступен:")} {failure}
          </p>
        ) : (
          <canvas
            ref={canvasRef}
            tabIndex={0}
            aria-label={
              flying
                ? tr("Предпросмотр неба с кварталом из игры. WASD — лететь, мышь с зажатой кнопкой — осмотреться, колесо — приближение, двойной щелчок — вид по умолчанию")
                : tr("Предпросмотр неба с кварталом из игры. Мышь с зажатой кнопкой — осмотреться, колесо — приближение, двойной щелчок — вид по умолчанию")
            }
            onContextMenu={(event) => event.preventDefault()}
          />
        )}
        {holding && <div ref={holdHostRef} className="sky-frame-hold" data-phase={holdDone ? "out" : "in"} aria-hidden="true" />}
        {loading && (
          <p className="sky-block-note" role="status">
            {blockNote(note)}
          </p>
        )}
      </div>
      <StageBar wide className="sky-stage-bar" label={tr("Время суток")}>
        <SkyTimebar hour={hour} onHourChange={onHourChange} band={band} selected={selected} />
        {modeControl}
        {!failure && (
          <Button
            size="sm"
            variant="ghost"
            icon={<ArrowCounterClockwise />}
            aria-label={tr("Вид по умолчанию")}
            title={tr("Вид по умолчанию (двойной щелчок по кадру)")}
            onClick={() => sceneRef.current?.resetView()}
          />
        )}
      </StageBar>
      {/* Кадр упрощён под видеокарту — строкой в панели редактора, не на картинке. */}
      {blockLowered({ step: note.step, antialias: note.antialias }).map((text) => (
        <StageNote key={text}>{text}</StageNote>
      ))}
    </div>
  );
}
