/*
 * Сцена редактора прострелов.
 *
 * Два взгляда на одну и ту же подсветку:
 *   • «Укрытие» — выбранное укрытие в 3D на настоящем участке из игры (дом и
 *     участок вокруг, забор, крыша, бак): настоящая оболочка из мода под своей
 *     подсветкой, днём, в сумерках и ночью (`WallbangPlotFrame.jsx`, ТЗ
 *     19.10.2026); выбрали другое — камера подлетает к нему. Нет участка или он
 *     не загрузился — прежний кадр на нарисованной земле с человеком для
 *     масштаба; камера — общая на всю мастерскую (`stage-camera.js`): ЛКМ —
 *     повернуть, щелчок ПКМ — полёт, колесо — приблизить;
 *   • «Все укрытия» — шестнадцать плиток разом, как они встанут по картам
 *     каптов. Плитка и есть выбор: нажал — правишь её справа, инструментом
 *     «Укрытие».
 *
 * Раскладка — мастерская «как в Photoshop» (владелец, 03.10.2026): сцена
 * занимает кадр каркаса целиком; что показывать, время суток и укрытие в
 * кадре — органами поверх кадра (`StageBar`), подпись и то, что уйдёт в
 * игру, — подписью кадра.
 */

import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  WALLBANG_OBJECTS,
  WALLBANG_PLACEMENT_COUNT,
  wallbangObjectPlaces,
  wallbangVisibleObjects,
} from "@modovik/climb-contract/wallbang";
import { watchFrameGate } from "../../../attention.js";
import { sheetsExpected } from "../model-stage/scene-textures.js";
import { humanFailure } from "../../../utils/installFailure.js";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import Select from "../../../components/ui/Select.jsx";
import {
  StageBar,
  StageNote,
} from "../../../components/ui/StageOverlay.jsx";
import { WALLBANG_SCENES } from "./wallbang-look.js";
import WallbangPlotFrame from "./WallbangPlotFrame.jsx";
import { wallbangPlot } from "./wallbang-plot.js";
import { createWallbangScene } from "./wallbang-scene.js";
import { WALLBANG_VIEWS, placesText, zonesText } from "./wallbang-text.js";
import { tr, useTr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";

const CAPTIONS = Object.freeze({
  object: "Форма — настоящая оболочка из мода. Цвет, заливка и свечение — те же числа, что уедут в игру.",
  all: "Плитки — формы оболочек в облике работы. Нажмите на укрытие, чтобы править его отдельно.",
});

/* Участок из игры (кадр «Укрытие» на настоящей местности): что в кадре — из игры, что убрано. */
const PLOT_CAPTION =
  "Земля, дом и всё вокруг — кусок вашей GTA V: кадр читает её файлы на этом компьютере. Деревья у самого укрытия, дальние деревья и мелочь убраны, чтобы кадр был лёгким, а укрытие не закрывала крона. Оболочка — настоящая форма из мода, она стоит там же, где в игре; цвет, заливка и свечение — те же числа, что уедут в игру.";
const PLOT_CAPTION_BARE =
  "Игра на этом компьютере не подключена, поэтому участок показан без текстур — средним цветом поверхностей. Оболочка — настоящая форма из мода, она стоит там же, где в игре; цвет, заливка и свечение — те же числа, что уедут в игру.";




const SCENE_OPTIONS = WALLBANG_SCENES.map((item) => ({
  value: item.id,
  label: item.label,
}));

const frameLabel = (object) =>
  `${object?.label || tr("Укрытие")} под подсветкой. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.`;

/*
 * Кадр в 3D. Холст заводится вместе со сценой и уходит вместе с ней: у
 * каждого монтажа свой контекст WebGL, и снятый кадр освобождает его
 * целиком (`forceContextLoss`). Холст из разметки пережил бы снятие — в
 * строгом режиме React монтирует дважды, и второй рендерер получал бы уже
 * потерянный контекст. Форма, облик и время суток приходят в готовую
 * сцену; рисует она только по правке и пока рука ведёт камеру.
 */
function ObjectFrame({
  project,
  objectId,
  scene,
  shape,
  shapesFailure,
  sceneRef,
  onCamera,
}) {
  useTr();
  const hostRef = useRef(null);
  const canvasRef = useRef(null);
  const cameraRef = useRef(onCamera);
  const [failure, setFailure] = useState("");
  const object = WALLBANG_OBJECTS.find((item) => item.id === objectId);
  cameraRef.current = onCamera;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const canvas = document.createElement("canvas");
    canvas.className = "wallbang-canvas";
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "img");
    /* Первым в рамке: подписи — поверх холста. */
    host.prepend(canvas);
    canvasRef.current = canvas;
    let view;
    try {
      view = createWallbangScene({
        canvas,
        onContextLost: () =>
          setFailure("видеокарта отобрала контекст — откройте редактор заново"),
        onMode: (mode, info) => cameraRef.current?.(mode, info),
      });
    } catch (error) {
      setFailure(humanFailure(error));
      canvas.remove();
      canvasRef.current = null;
      return undefined;
    }
    sceneRef.current = view;
    if (import.meta.env?.DEV) window.__astralWallbangScene = view;
    const measure = () => {
      const box = canvas.getBoundingClientRect();
      view.resize(box.width, box.height, window.devicePixelRatio || 1);
    };
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(canvas);
    measure();
    /* Окно отвернулось — полёт не летит сам по себе и цикл стоит. */
    const stopGate = watchFrameGate(canvas, (open) => view.setActive(open));
    return () => {
      stopGate();
      observer?.disconnect();
      view.dispose();
      canvas.remove();
      canvasRef.current = null;
      sceneRef.current = null;
    };
  }, [sceneRef]);

  useEffect(() => {
    canvasRef.current?.setAttribute("aria-label", frameLabel(object));
  }, [object]);

  /* Новая форма — вид по умолчанию (сцена ставит его сама). */
  useEffect(() => {
    sceneRef.current?.setShape(shape || null);
  }, [shape, objectId, sceneRef]);

  useEffect(() => {
    sceneRef.current?.setLook(project, objectId, scene);
  }, [project, objectId, scene, shape, sceneRef]);

  const note = failure
    ? `3D-кадр недоступен: ${failure}`
    : shape
      ? ""
      : shapesFailure
        ? tr("Форма укрытия не загрузилась — облик в игру уйдёт тот же")
        : tr("Загружаем форму укрытия…");

  return (
    <div className={`wallbang-frame is-${scene}`} ref={hostRef}>
      {note && <p className="wallbang-frame-note">{note}</p>}
    </div>
  );
}

const ObjectTile = memo(function ObjectTile({
  object,
  href,
  selected,
  visible,
  onSelect,
}) {
  useTr();
  const places = wallbangObjectPlaces(object.id);
  return (
    <ChoiceTile
      className={`wallbang-tile${visible ? "" : " is-hidden"}${href ? "" : " is-named"}`}
      selected={selected}
      /* Картинки укрытия нет — только имя, без пустого гнезда (владелец 31.10.2026: пустых миниатюр не бывает). */
      media={href ? <img src={href} alt="" /> : null}
      title={object.label}
      tooltip={object.description}
      meta={
        visible
          ? `${placesText(places)} · ${zonesText(object.id)}`
          : tr("Скрыто в игре")
      }
      onClick={() => onSelect(object.id)}
    />
  );
});

/**
 * `onObject` — укрытие в кадре (список над кадром), `onPick` — плитка «Все
 * укрытия»: выбрать и править. `onCamera(mode)` — род камеры для строки
 * управления внизу кадра.
 */
export default function WallbangStage({
  project,
  objectId,
  onObject,
  onPick = onObject,
  view,
  onView,
  scene,
  onScene,
  shapes,
  shapesFailure = "",
  tiles,
  onCamera = null,
}) {
  useTr();
  const sceneRef = useRef(null);
  const object =
    WALLBANG_OBJECTS.find((item) => item.id === objectId) ||
    WALLBANG_OBJECTS[0];
  /* Участки, что не загрузились: у них кадр прежний, на нарисованной земле — и подпись говорит об этом. */
  const [failedPlots, setFailedPlots] = useState(() => new Set());
  const onPlotFail = useCallback(
    (id) => setFailedPlots((was) => (was.has(id) ? was : new Set(was).add(id))),
    [],
  );
  const plotShown =
    view === "object" &&
    Boolean(wallbangPlot(object.id)) &&
    !failedPlots.has(object.id);
  const visible = wallbangVisibleObjects(project);
  const visiblePlaces = visible.reduce(
    (sum, id) => sum + wallbangObjectPlaces(id),
    0,
  );
  const hidden = WALLBANG_OBJECTS.length - visible.length;
  const shownPlaces = wallbangObjectPlaces(object.id);

  return (
    <div className={`fx-stage wallbang-stage is-studio is-${view}`}>
      {view === "object" ? (
        <WallbangPlotFrame
          project={project}
          objectId={object.id}
          scene={scene}
          shapes={shapes}
          failed={failedPlots.has(object.id)}
          onFail={onPlotFail}
          onCamera={onCamera}
          fallback={
            <ObjectFrame
              project={project}
              objectId={object.id}
              scene={scene}
              shape={shapes?.get(object.id) || null}
              shapesFailure={shapesFailure}
              sceneRef={sceneRef}
              onCamera={onCamera}
            />
          }
        />
      ) : (
        <div
          className={`wallbang-grid is-${scene}`}
          role="group"
          aria-label={tr("Укрытия набора")}
        >
          {WALLBANG_OBJECTS.map((item) => (
            <ObjectTile
              key={item.id}
              object={item}
              href={tiles?.get(item.id) || ""}
              selected={item.id === object.id}
              visible={project.objects[item.id]?.visible !== false}
              onSelect={onPick}
            />
          ))}
        </div>
      )}
      <StageBar>
        <SegmentedControl
          label={tr("Что показывать")}
          size="sm"
          options={WALLBANG_VIEWS}
          value={view}
          onChange={onView}
        />
        <SegmentedControl
          label={tr("Время суток")}
          size="sm"
          options={SCENE_OPTIONS}
          value={scene}
          onChange={onScene}
        />
        {view === "object" && (
          <>
            <Select
              className="wallbang-object-select"
              ariaLabel={tr("Укрытие в кадре")}
              value={object.id}
              options={WALLBANG_OBJECTS.map((item) => [item.id, item.label])}
              onChange={onObject}
            />
          </>
        )}
      </StageBar>
      {/* Строки состояния кадра — в панели редактора, не на картинке; служебные — не жёлтые (правило 14 `design-qa.md`, 30.10.2026). */}
      {shapesFailure ? (
        <StageNote>{trFill("Формы укрытий не загрузились ({0}) — плитки и кадр пусты, но облик в игру уйдёт тот же.", shapesFailure)}</StageNote>
      ) : (
        <StageNote>
          {plotShown ? tr(sheetsExpected() ? PLOT_CAPTION : PLOT_CAPTION_BARE) : tr(CAPTIONS[view])}
        </StageNote>
      )}
      {view === "object" ? (
        <StageNote>{trFill("«{0}» — {1}: {2}.", tr(object.label), placesText(shownPlaces), zonesText(object.id))}</StageNote>
      ) : null}
      <StageNote>
        {hidden
          ? trFill("В игру уйдут укрытия: {0} из {1} — {2} на картах каптов; скрытые встанут прозрачными.", visible.length, WALLBANG_OBJECTS.length, placesText(visiblePlaces))
          : trFill("В игру уйдут все {0} укрытий — {1} на картах каптов.", WALLBANG_OBJECTS.length, placesText(WALLBANG_PLACEMENT_COUNT))}{" "}
        {tr("Места и формы — как в моде. Залазы ставятся своим редактором: прострелы их не трогают.")}
      </StageNote>
    </div>
  );
}
