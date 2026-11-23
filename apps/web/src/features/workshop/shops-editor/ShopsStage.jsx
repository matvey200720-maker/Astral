/*
 * Кадр редактора «Интерьеры».
 *
 * Помещение взятого вида — целиком из файлов игры игрока: сцену собирает
 * Astral Desktop по плану описи (`shop-scene-source.js`, задача 5 ТЗ
 * 11.10.2026) — все модели без ужатия, листы с тех же мест, откуда их берёт
 * игра, прозрачность стёкол и наклеек, тени-наклейки и палитры тинта как у
 * игры. Глаз стоит в зале и оглядывается, щелчок ПКМ — полёт по залу
 * (W A S D), сквозь стены он не проходит. Стены, пол, потолок и вещи — в
 * облике работы (цвет и блеск) тем же расчётом, что у установщика
 * (`shops-text.js`). Щелчок по стене, полу, потолку или вещи открывает её
 * поверхность и подсвечивает штрихами (под курсором — бледнее; 18.10.2026,
 * `shops-aim.js`); наклейки и стёкла щелчок пропускает.
 *
 * Свои модели (ТЗ 11.10.2026, вечер, задача 1) — в осях помещения, как и
 * сцена: в игре они встают в само помещение, во все его экземпляры на карте.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { shownPlaceModels } from "@modovik/climb-contract/recolor/place-models";
import { shopInterior, shopLookOf } from "@modovik/climb-contract/recolor/shops";
import { StageNote } from "../../../components/ui/StageOverlay.jsx";
import ModelStage from "../model-stage/ModelStage.jsx";
import { StageSheetsNote } from "../model-stage/StageControls.jsx";
import { useShopScene } from "./shop-scene-source.js";
import { shopAimTarget, shopSurfaceSpec } from "./shops-aim.js";
import { fill, shopFrameLook, shopModelsText, shopsPlanText, surfaceLabel } from "./shops-text.js";
import { tr, useTr } from "../../../locales/ui.js";
import { labelled } from "../model-stage/hover-label.js";
import { steadyScope } from "../model-stage/selection-highlight.js";

/* Почему кадра нет — словами для человека. */
function missingText(source) {
  if (!source.desktop) return tr("Кадр помещения собирается из файлов вашей GTA V — откройте редактор в Astral Desktop.");
  return source.reason || tr("Помещение не собралось из файлов игры — проверьте GTA V.");
}

export default function ShopsStage({
  project,
  interiorId,
  /* Выбор щелчком: `onAim(target, hit)` — что правится под курсором (`shopAimTarget`, `null` —
     править нечего, но в `hit` может быть своя модель); `selected` — поверхность, открытая в
     панели (подсветка идёт за состоянием редактора); `canAim` — выкл., пока в руке «Модели»:
     поверхности не выбираются и не подсвечиваются. */
  onAim = null,
  selected = null,
  canAim = true,
  onCamera = null,
  /* Свои модели: `usePlaceModels().stageProps` и плашка ручек. */
  stageRef: modelsStageRef = null,
  models = null,
  modelSelection = null,
  modelHandlers = null,
  onSceneBounds = null,
  overlay = null,
}) {
  useTr();
  const ownStageRef = useRef(null);
  const stageRef = modelsStageRef || ownStageRef;
  const [asset, setAsset] = useState(null);
  const interior = shopInterior(interiorId);
  const source = useShopScene(interior?.scene ? interiorId : null);
  const look = useMemo(() => shopLookOf(project, interiorId), [project, interiorId]);

  /* Цвет и блеск поверхностей (ТЗ 12.10.2026, задача 2): отделки текстурой у помещений больше нет. */
  const lookOf = useCallback((index, info) => shopFrameLook(look, info), [look]);

  const frame = useCallback(
    (loaded) => ({
      bounds: loaded.bounds,
      ground: false,
      inside: { ...(interior?.eye || { eye: [0, 0, 1.65], yaw: 0, pitch: 0 }), fov: 72 },
      lighting: "interior",
    }),
    [interior],
  );

  /* Что правится под курсором: поверхность «Цвета и блеска» (вещь — по сущности, оболочка — по листу).
     Её же подсвечивает наведение. */
  /* Подсвечено то, что правится (п. 7 `docs/3D-ELEMENTS-PICTURES.md`, владелец 31.10.2026: «я выделил одно это, а у меня покрасилось всё»): правка ложится на всю поверхность — светится она вся. */
  const aimTarget = useCallback(
    (hit) => {
      const target = canAim && asset ? shopAimTarget(interiorId, asset, hit) : null;
      /* Подпись у курсора — поверхность помещения. */
      return target ? labelled(shopSurfaceSpec(interiorId, asset, target.surface), tr(surfaceLabel(target.surface))) : null;
    },
    [canAim, asset, interiorId],
  );
  /* Редактору — всё попадание (в нём может быть своя модель) и цель под ним, если она есть. */
  const onHit = useCallback(
    (hit) => {
      const target = canAim && asset ? shopAimTarget(interiorId, asset, hit) : null;
      onAim?.(target, hit);
    },
    [onAim, canAim, asset, interiorId],
  );
  /* Выбранное — поверхность, что открыта в панели: подсветка за состоянием, а не за щелчком. */
  const highlight = useMemo(
    () => (canAim && asset ? steadyScope(shopSurfaceSpec(interiorId, asset, selected)) : null),
    [canAim, asset, interiorId, selected],
  );

  const name = tr(interior?.label || "Помещение");
  const label = fill(tr("{0} изнутри в облике работы: мышь или стрелки — оглядеться, щелчок по вещи — выбрать её, правая кнопка — полёт по залу."), name);
  const ownModels = shownPlaceModels(project.models).filter((item) => item.scene === interiorId).length;

  return (
    <div className="fx-stage recolor-stage is-studio shops-stage">
      {!interior?.scene ? (
        <p className="model-stage-note">{tr("Сцены этого помещения нет в этой версии Astral.")}</p>
      ) : source.state === "loading" ? (
        <p className="model-stage-note">{tr("Собираем помещение из файлов вашей игры…")}</p>
      ) : source.state === "missing" ? (
        <p className="model-stage-note">{missingText(source)}</p>
      ) : (
        <ModelStage loadKit="interiors"
          ref={stageRef}
          scene={source.url}
          look={lookOf}
          frame={frame}
          frameKey={interiorId}
          onScene={(loaded) => {
            setAsset(loaded);
            onSceneBounds?.(loaded.bounds);
          }}
          onAim={onAim ? onHit : null}
          aimTarget={aimTarget}
          highlight={highlight}
          autoRotate={false}
          onCamera={onCamera}
          models={models}
          modelSelection={modelSelection}
          modelHandlers={modelHandlers}
          label={label}
        >
          {overlay}
        </ModelStage>
      )}
      <StageNote>
        {shopsPlanText(project)}
        {ownModels ? ` ${shopModelsText(interior, ownModels)}` : ""}
      </StageNote>
      <StageSheetsNote />
    </div>
  );
}
