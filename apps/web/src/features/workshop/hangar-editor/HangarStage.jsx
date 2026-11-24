/*
 * Кадр редактора ангара.
 *
 * Ангар стандартный (ТЗ 12.10.2026, ночь): в кадре — штатный ангар
 * ограблений из игры игрока на своём месте: корпус, нутро целиком (колонны,
 * фермы под крышей, кран, галерея с лестницами, комната, трубы, 16 ламп под
 * крышей) и лампы на стенах — на общей матовой плашке редакторов перекраски
 * (`ModelStage`). Геометрия — из сцены подготовки, листы Rockstar кадр
 * читает из GTA V игрока (без Astral Desktop — средним цветом листа).
 * Камера — общая на всю мастерскую (`stage-camera.js`). «Снаружи» — модель
 * медленно вращается, ЛКМ её крутит. «Внутри» — глаз стоит в зале у задней
 * стены и смотрит на ворота; щелчок ПКМ — полёт по залу (W A S D), и сквозь
 * стены и крышу он не проходит.
 *
 * Переключатели нутра — частями сцены: без ферм нет ни ферм, ни крана, а
 * подвесы ламп тянутся до крыши (`rodsLong`), как у установщика. Лампы
 * выключены — их огни и свечение плафонов гаснут. Ангар стандартный (ТЗ
 * 13.10.2026): ещё вентиляция (только с фермами), галерея с перилами, связи
 * на стенах и трубы — тоже частями сцены. ТЗ 17.10.2026: лампы убраны —
 * части «лампы» (плафоны и фонари на стенах) и подвесов в кадре нет;
 * штатная разметка пола — своя часть «lines», её выключатель — в «Внутри».
 *
 * Эмблему и надпись ставят прямо в кадре общим редактором эмблемы: левая
 * кнопка ставит и ведёт наклейку по стене под курсором, правая — камера,
 * колесо — размер, Q и E — поворот эмблемы. В игре они встанут плашками
 * перед стеной.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  HANGAR_EMBLEM_SIZE,
  HANGAR_INVENTORY,
  HANGAR_VIEW,
  hangarEmblemDecals,
  hangarStructure,
  hangarVisibleParts,
} from "@modovik/climb-contract/recolor/hangar";
import {
  EMBLEM_PLACING_HINT,
  EmblemPlacingBar,
  useEmblemPlacement,
} from "../emblem/emblem-placement.jsx";
import { useFinishTexture } from "../finish/finish-textures.js";
import ModelStage from "../model-stage/ModelStage.jsx";
import { sceneFingerprint } from "../model-stage/selection-markup-load.js";
import { useSelectionMarkup } from "../model-stage/use-selection-markup.js";
import { StageSheetsNote } from "../model-stage/StageControls.jsx";
import { placeBounds, ringDisc, ringEdgeFade } from "../model-stage/ring-fade.js";
import { emblemDecalLooks, useEmblemTextures } from "../emblem/emblem-items.js";
import { hangarAimHover, hangarAimSpec, hangarAimTarget, hangarHouseSurface } from "./hangar-aim.js";
import { HANGAR_SHOWCASE_YAW, hangarFrameLook } from "./hangar-text.js";
import { hangarFocusFor } from "./hangar-views.js";
import { hangarLampLights } from "./hangar-lights-look.js";
import { tr, useTr } from "../../../locales/ui.js";

import { steadyScope } from "../model-stage/selection-highlight.js";

/* Потолочные лампы в кадре (прожекторы вниз у 16 ламп нутра, цвет и сила — по «Свету ламп» работы): `hangar-lights-look.js`. */


export default function HangarStage({
  project,
  view,
  /* Пункт «Отделки», взятый щелчком над панелью: `{ tool: "outside" | "inside" | "structure", at }` — камера к нему (31.10.2026). */
  shot = null,
  placing = false,
  placingLabel = "Эмблема в руке",
  onPlace = null,
  onAdjust = null,
  onPlaced = null,
  /* Слова надписей прямо в кадре: `useEmblemEditor().stage` — двойной щелчок и поле ввода. */
  textStage = null,
  onCamera = null,
  /* Свои модели (задача 1 ТЗ 11.10.2026, вечер): `usePlaceModels().stageProps` и плашка ручек. */
  stageRef: modelsStageRef = null,
  models = null,
  modelSelection = null,
  modelHandlers = null,
  onSceneBounds = null,
  /* Щелчок по кадру: `onAim(hit, target)` — своя модель (`usePlaceModels().onAim`) или деталь ангара (`hangarAimTarget`). */
  onAim = null,
  /* Взятый инструмент и выбранный в нём переключатель: подсвечиваются штрихами, пока взяты. */
  tool = "",
  element = "",
  overlay = null,
}) {
  useTr();
  const ownStageRef = useRef(null);
  const stageRef = modelsStageRef || ownStageRef;
  const [asset, setAsset] = useState(null);
  /* Разметка выделения сцены (раздел D ТЗ 26.10.2026): запись `scene.selection` в описи; нет её или файла — прежний путь (остров сетки). */
  const fingerprint = useMemo(() => sceneFingerprint(asset, HANGAR_INVENTORY.scene.sha256), [asset]);
  const { markup } = useSelectionMarkup(HANGAR_INVENTORY.scene.selection, { scene: fingerprint });
  const emblemTextures = useEmblemTextures(project.emblems);
  const inside = view === "inside";
  const structure = hangarStructure(project);

  /* Текстуры отделки поверхностей: узор, картинка, градиент. */
  const outside = useFinishTexture(project.outside);
  const insideFinish = useFinishTexture(project.inside);
  const floor = useFinishTexture(project.floor);
  /* Потолок со своей отделкой — своя текстура; «как у стен» берёт отделку нутра (`finishKeyOf`). */
  const ceiling = useFinishTexture(project.ceiling);
  const textures = useMemo(
    () => ({ outside, inside: insideFinish, floor, ceiling }),
    [outside, insideFinish, floor, ceiling],
  );
  const decals = useMemo(
    () => emblemDecalLooks(hangarEmblemDecals(project), emblemTextures),
    [project, emblemTextures],
  );

  const look = useCallback(
    (index, info) => hangarFrameLook(project, info, { decals, textures }),
    [project, decals, textures],
  );

  /* Железяки нутра, подвесы и лампы — по переключателям, как у установщика. */
  const { trusses, crane, vents, gallery, bracing, pipes, lampModels } =
    structure;
  /* Штатная разметка пола (ТЗ 17.10.2026) — своя часть сцены. */
  const markings = project.markings !== false;
  const parts = useMemo(() => {
    if (!asset) return null;
    const visible = hangarVisibleParts({
      trusses,
      crane,
      vents,
      gallery,
      bracing,
      pipes,
      lampModels,
      markings,
    });
    const shown = asset.parts
      .map((part, index) => (visible(part.id) ? index : -1))
      .filter((index) => index >= 0);
    return shown.length === asset.parts.length ? null : shown;
  }, [
    asset,
    trusses,
    crane,
    vents,
    gallery,
    bracing,
    pipes,
    lampModels,
    markings,
  ]);

  const lights = structure.lamps ? hangarLampLights(project.lights) : null;

  /* «Внутри», «Конструкции», «Цвет труб» и «Комната»: глаз у задней стены (на ворота или вверх, на железяки), у стены с трубами или в комнате (`hangar-views.js`); перелёт — один на вход (`at`). */
  const insideFocus = useMemo(() => (inside ? hangarFocusFor(shot) : null), [inside, shot]);

  const frame = useCallback(
    (loaded) => {
      const shell = loaded.parts.find((item) => item.id === "shell");
      const bounds = shell?.bounds || loaded.bounds;
      if (inside)
        return {
          bounds,
          ground: false,
          inside: {
            eye: HANGAR_VIEW.eye,
            yaw: HANGAR_VIEW.yaw,
            pitch: HANGAR_VIEW.pitch,
            fov: 72,
          },
          lighting: "interior",
        };
      return {
        bounds,
        ground: !ringDisc(loaded),
        person: true,
        view: { yaw: HANGAR_SHOWCASE_YAW, pitch: 0.34, zoom: 0.78 },
      };
    },
    [inside],
  );

  /* Наклейка ложится на корпус — стену снаружи или изнутри, крышу, пол.
     Управление — общий редактор эмблемы (`emblem-placement.jsx`). */
  const onShell = useCallback(
    (hit) => asset?.parts[hit?.part]?.id === "shell",
    [asset],
  );
  const placement = useEmblemPlacement({
    active: placing,
    onPlace,
    onAdjust,
    sizeRange: HANGAR_EMBLEM_SIZE,
    accept: onShell,
    onDone: onPlaced,
  });

  /*
   * Что будет править щелчок и наведение. Пока в руке эмблема, левая кнопка ставит
   * её, а у выбранной модели свои ручки — деталь тогда не выбирается и не светится.
   */
  const aimOff = Boolean(placing) || Boolean(modelSelection?.canEdit);
  /* Цвет домика сейчас (для видимой подсветки на нём): `hangarHouseSurface`. */
  const houseSurface = hangarHouseSurface(project);
  /* Подсвечено то, что правится (п. 7 `docs/3D-ELEMENTS-PICTURES.md`, владелец 31.10.2026: «я выделил одно это, а у меня покрасилось всё»):
     правка инструмента ложится на всю его деталь — светится она вся, и под курсором, и выбранная. */
  const aimTarget = useCallback(
    (hit) => {
      if (aimOff) return null;
      /* С «Узорами» светятся только стены и пол — куда узор ляжет. */
      if (tool === "patterns") {
        const target = hangarAimTarget(asset, hit);
        if (target?.tool !== "outside" && target?.tool !== "inside") return null;
      }
      /* Подпись у курсора — деталь («Фермы», «Пол», «Дом») и сторона («Снаружи», «Внутри»): `hangar-aim.js`. */
      return hangarAimHover(asset, hit, tr, houseSurface);
    },
    [aimOff, asset, tool, houseSurface],
  );
  const onAimed = useCallback(
    (hit) => {
      onAim?.(hit, aimOff ? null : hangarAimTarget(asset, hit));
    },
    [aimOff, asset, onAim],
  );
  const selected = useMemo(() => (aimOff ? null : steadyScope(hangarAimSpec(asset, tool, element, houseSurface))), [aimOff, asset, tool, element, houseSurface]);

  const label = inside
    ? tr(
        "Ангар изнутри в облике работы: мышь или стрелки — оглядеться, правая кнопка — полёт по залу.",
      )
    : tr(
        "Ангар снаружи в облике работы. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.",
      );

  return (
    <div className="fx-stage recolor-stage is-studio">
      <ModelStage loadKit="interiors"
        ref={stageRef}
        scene={HANGAR_INVENTORY.scene.url}
        look={look}
        parts={parts}
        frame={frame}
        /* Вокруг ангара — круг настоящего мира из игры (`prepare-world-ring.mjs`); дальше круга — чёрный купол. */
        edgeFade={ringEdgeFade(asset)}
        /* Снаружи — та же рамка заново (камера летит к ней и при повторном щелчке); изнутри — перелёт глаза (`insideFocus`). */
        frameKey={shot && !inside ? `${view}:${shot.at}` : view}
        insideFocus={insideFocus}
        onScene={(loaded) => {
          setAsset(loaded);
          onSceneBounds?.(placeBounds(loaded));
        }}
        onCamera={onCamera}
        lights={lights}
        placing={placing}
        onPlace={placement.onPlace}
        onAdjust={placement.onAdjust}
        {...textStage}
        models={models}
        modelSelection={modelSelection}
        modelHandlers={modelHandlers}
        onAim={onAim ? onAimed : null}
        aimTarget={aimTarget}
        highlight={selected}
        markup={markup}
        label={label}
      >
        {placing && (
          <EmblemPlacingBar
            text={EMBLEM_PLACING_HINT}
            label={placingLabel}
            onDone={onPlaced}
          />
        )}
        {overlay}
      </ModelStage>
      <StageSheetsNote />
    </div>
  );
}
