/*
 * Кадр «снаружи» редактора «Интерьеры» (второй заход задачи 3 ТЗ 10.10.2026;
 * вернули 17.10.2026).
 *
 * Место — свои модели квартала игры игрока (навес, киоск, площадка, вывеска,
 * фасад) и колонки станции в координатах места (сцену собирает
 * `scripts/prepare-shop-outside.mjs`). Облик — тот, что уедет в игру: свой у
 * места или облик вида, колонки — общие на все станции; эмблемы и
 * надписи — наклейкой по стене (в игре — плашкой на том же месте). Камера —
 * общая мастерской: ЛКМ — вращение, щелчок ПКМ — полёт, колесо —
 * приближение. Щелчок по стене, навесу, площадке или вывеске выбирает её
 * часть (и подсвечивает штрихами, под курсором — бледнее), по колонке — колонки
 * (18.10.2026, `shops-aim.js`); с эмблемой в руке левая кнопка ставит её.
 * Свои модели (ТЗ 11.10.2026, вечер, задача 1) — в метрах сцены места: в
 * игре — своей картой у этого места.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OUTSIDE_EMBLEM_SIZE, OUTSIDE_PART_IDS, PUMP_PART_IDS, outsideEmblemDecals, shopOutsidePlace } from "@modovik/climb-contract/recolor/shops-outside";
import { EmblemPlacingBar, useEmblemPlacement } from "../emblem/emblem-placement.jsx";
import { emblemDecalLooks, useEmblemTextures } from "../emblem/emblem-items.js";
import { useFinishTexture } from "../finish/finish-textures.js";
import useWallOverlay from "../model-stage/useWallOverlay.js";
import { StageNote } from "../../../components/ui/StageOverlay.jsx";
import ModelStage from "../model-stage/ModelStage.jsx";
import { StageSheetsNote } from "../model-stage/StageControls.jsx";
import { outsideFrameLook, outsidePartLabel, outsidePlanText, placeLabel, placeLooks, pumpPartLabel } from "./shops-outside-text.js";
import { labelled } from "../model-stage/hover-label.js";
import { steadyScope } from "../model-stage/selection-highlight.js";
import { outsideAimTarget, outsidePartSpec } from "./shops-aim.js";
import { fill } from "./shops-text.js";
import { tr, useTr } from "../../../locales/ui.js";

/* Текстура отделки одной поверхности: хук на поверхность, ответ — наверх. */
const FinishProbe = memo(function FinishProbe({ id, settings, onTexture }) {
  const texture = useFinishTexture(settings);
  useEffect(() => onTexture(id, texture), [id, texture, onTexture]);
  return null;
});


export default function ShopsOutsideStage({
  outside,
  placeId,
  /* Окно «Студии»: выбранная там поверхность (`{ where }` — какие материалы) подсвечена в кадре поверх выбранного в редакторе. */
  focus: surfaceFocus = null,
  /* Стена, по которой щёлкнули в кадре (`wall-pick.js`): заливка и контур поверх неё. */
  wall = null,
  /* Выбор щелчком: `onAim(target, hit)` — часть места или колонки под курсором (`outsideAimTarget`,
     `null` — править нечего, но в `hit` может быть своя модель); `selected` — `{ tool, part }`
     открытого в панели (подсветка за состоянием редактора); `kind` — вид мест (колонки — только у
     заправок); `canAim` — выкл., пока в руке «Модели» или эмблема. */
  onAim = null,
  selected = null,
  kind = "",
  canAim = true,
  onCamera = null,
  placing = false,
  placingLabel = "",
  onPlace = null,
  onAdjust = null,
  onPlaced = null,
  /* Слова надписей прямо в кадре: `useEmblemEditor().stage` — двойной щелчок и поле ввода. */
  textStage = null,
  /* Свои модели (ТЗ 11.10.2026, вечер, задача 1): `usePlaceModels().stageProps` и плашка ручек. */
  stageRef: modelsStageRef = null,
  models = null,
  modelSelection = null,
  modelHandlers = null,
  onSceneBounds = null,
  overlay = null,
}) {
  useTr();
  const wallObjects = useWallOverlay(wall);
  const ownStageRef = useRef(null);
  const stageRef = modelsStageRef || ownStageRef;
  const [asset, setAsset] = useState(null);
  const place = shopOutsidePlace(placeId);
  const { placeLook, pumpLook } = useMemo(() => placeLooks(outside, placeId), [outside, placeId]);

  /* Отделка (узор, картинка, градиент) — текстурой кадра на каждую часть. */
  const [finishes, setFinishes] = useState({});
  const onTexture = useCallback((id, texture) => setFinishes((current) => (current[id] === texture ? current : { ...current, [id]: texture })), []);
  const probes = [
    ...OUTSIDE_PART_IDS.map((id) => ({ id: `part:${id}`, settings: placeLook.parts[id] })),
    ...PUMP_PART_IDS.map((id) => ({ id: `pump:${id}`, settings: pumpLook.parts[id] })),
  ]
    .filter((item) => ["pattern", "image", "gradient"].includes(item.settings?.mode))
    .map((item) => <FinishProbe key={item.id} id={item.id} settings={item.settings} onTexture={onTexture} />);

  /* Эмблемы и надписи этого места — наклейкой по миру сцены (та же рамка, что у плашки в игре). */
  const emblemTextures = useEmblemTextures(useMemo(() => [...outside.emblems, ...(outside.names || [])], [outside.emblems, outside.names]));
  const decals = useMemo(() => {
    const looks = emblemDecalLooks(outsideEmblemDecals(outside), emblemTextures, (decal) => decal.location === placeId);
    return looks.length ? looks : null;
  }, [outside, emblemTextures, placeId]);

  const look = useCallback(
    (index, info) => {
      const base = outsideFrameLook({ placeLook, pumpLook, info, finishes });
      return decals && !info.decal ? { ...base, decals } : base;
    },
    [placeLook, pumpLook, finishes, decals],
  );
  /* Рамка — само место (колонки и залы с запасом, `scene.focus` описи), а не вся сцена с хвостами квартала. */
  const focus = place?.scene?.focus || null;
  const frame = useCallback((loaded) => ({ bounds: focus || loaded.bounds, ground: true, view: { yaw: -0.65, pitch: 0.24, zoom: 1.15 } }), [focus]);

  /* Редактор эмблемы — общий у всех мест: ставит на место в кадре. */
  const placement = useEmblemPlacement({
    active: placing,
    onPlace: (spot) => onPlace?.({ ...spot, location: placeId }),
    onAdjust,
    sizeRange: OUTSIDE_EMBLEM_SIZE,
    onDone: onPlaced,
  });

  /* Что правится под курсором: часть места или колонки. Её же подсвечивает наведение. */
  const aimable = canAim && !placing && Boolean(asset);
  /* Подсвечено то, что правится (п. 7 `docs/3D-ELEMENTS-PICTURES.md`, владелец 31.10.2026: «я выделил одно это, а у меня покрасилось всё»): правка ложится на часть целиком — светится она вся. */
  /* Подпись у курсора — часть места или колонки. */
  const aimTarget = useCallback(
    (hit) => {
      const target = aimable ? outsideAimTarget(kind, asset, hit) : null;
      if (!target) return null;
      const name = target.tool === "pumps" ? (target.part ? tr(pumpPartLabel(target.part)) : tr("Колонка")) : tr(outsidePartLabel(target.part));
      return labelled(outsidePartSpec(target), name);
    },
    [aimable, kind, asset],
  );
  /* Редактору — всё попадание (в нём может быть своя модель) и цель под ним, если она есть. */
  const onHit = useCallback(
    (hit) => {
      const target = aimable ? outsideAimTarget(kind, asset, hit) : null;
      onAim?.(target, hit);
    },
    [onAim, aimable, kind, asset],
  );
  const highlight = useMemo(() => (aimable && selected ? steadyScope(outsidePartSpec(selected)) : null), [aimable, selected]);

  const label = fill(tr("{0} снаружи в облике работы: мышь — повернуть, колесо — приблизить, правая кнопка — полёт, щелчок по стене или колонке — выбрать её."), placeLabel(place));

  return (
    <div className="fx-stage recolor-stage is-studio shops-stage">
      {probes}
      {place?.scene ? (
        <ModelStage loadKit="building"
          ref={stageRef}
          scene={place.scene.url}
          look={look}
          frame={frame}
          frameKey={placeId}
          onScene={(loaded) => {
            setAsset(loaded);
            onSceneBounds?.(loaded.bounds);
          }}
          onAim={onAim ? onHit : null}
          aimTarget={aimTarget}
          objects={wallObjects}
          highlight={surfaceFocus || highlight}
          autoRotate={false}
          onCamera={onCamera}
          placing={placing}
          onPlace={placement.onPlace}
          onAdjust={placement.onAdjust}
          {...textStage}
          models={models}
          modelSelection={modelSelection}
          modelHandlers={modelHandlers}
          label={label}
        >
          {placing && <EmblemPlacingBar label={placingLabel || undefined} onDone={onPlaced} />}
          {overlay}
        </ModelStage>
      ) : (
        <p className="model-stage-note">{tr("Сцены этого места нет в этой версии Astral.")}</p>
      )}
      {/* Что уедет в игру — строка состояния работы; откуда модели и листы, кадру говорить незачем (обход кадров 29.10.2026). */}
      <StageNote>{outsidePlanText(outside)}</StageNote>
      <StageSheetsNote />
    </div>
  );
}
