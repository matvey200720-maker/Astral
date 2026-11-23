/*
 * Кадр редактора «Баннеры на зданиях» (задача 7 ТЗ 18.10.2026).
 *
 * Здание целиком и квартал вокруг него — штатные модели вашей GTA V (сцена
 * места собрана `scripts/prepare-banner-sites.mjs`: все сущности карт в радиусе —
 * здания, крыши, земля, дороги, соседние дома). Край куска города не дыра: цвет
 * уходит к краю мягко (`edgeFade`), а камера не уезжает дальше, чем виден весь кусок
 * (`BANNER_ZOOM_RANGE`). На полотнах — листы рекламы игры и облик
 * работы, той же функцией, что у установщика (`billboards-art.js`). Камера —
 * общая на мастерскую: WASD над кадром — полёт, протяжка мышью — осмотр,
 * щелчок по полотну — выбор; готовые ракурсы и «Тени» — на полосе над кадром.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Buildings, Sun } from "../../../components/ui/icons.jsx";
import { bannerSite, bannerSiteOfBoard } from "@modovik/climb-contract/recolor/banner-sites";
import Button from "../../../components/ui/Button.jsx";
import { StageBar } from "../../../components/ui/StageOverlay.jsx";
import { useRememberedState } from "../../../section-memory.js";
import { billboardAimTarget, billboardFaceSpec } from "../billboards-editor/billboards-aim.js";
import { useBillboardSheets } from "../billboards-editor/billboards-art.js";
import { boardLabelText, trFill } from "../billboards-editor/billboards-text.js";
import { billboard } from "@modovik/climb-contract/recolor/billboards";
import ModelStage from "../model-stage/ModelStage.jsx";
import { StageSheetsNote } from "../model-stage/StageControls.jsx";
import { BANNER_ZOOM_RANGE, SITE_ANGLES, bannerShot, darkLift, siteShot } from "./banners-views.js";
import { tr, useTr } from "../../../locales/ui.js";
import { labelled } from "../model-stage/hover-label.js";

/* Ракурсы на место и на взятое полотно: подписи и подсказки — в месте отрисовки. */
const ANGLE_LABELS = Object.freeze({
  all: ["Здание", "Здание целиком, чуть сверху"],
  street: ["С улицы", "Снизу, как с тротуара"],
  top: ["Сверху", "Сверху на крыши и фасады"],
  banner: ["Полотно", "Крупно на взятое полотно"],
});

/**
 * Рамка кадра места: вся сцена в рамке (пол, тени), а точка орбиты и глаз — по
 * ракурсу (`banners-views.js`). Без ракурса (полотна нет в сцене) — вид по умолчанию.
 * Вход в редактор и выбор полотна — ракурс «Полотно» (камера на взятое полотно, 01.11.2026).
 */
export function bannerFrame(siteId, boardId, angle) {
  return (loaded) => {
    const shot = angle === "banner" ? bannerShot(boardId, loaded.bounds) : siteShot(siteId, angle, loaded.bounds);
    /* У полотна — ещё и фокус (`focus-frame.js`): кадр сам проверит линию взгляда и встанет ближе или выше, если полотно закрыто. */
    return { bounds: loaded.bounds, ground: true, person: false, zoomRange: BANNER_ZOOM_RANGE, ...(shot || {}) };
  };
}

/* `onAim({ board, sheet })` — щелчок по полотну места; `highlight` — выбранное полотно (`billboardFaceSpec`) или `null`. */
/* `focusId` — полотно, на которое смотрит камера в ракурсе «Полотно» (по умолчанию — взятое): щелчок по другому полотну в кадре берёт его, но камеру не двигает. */
export default function BannersStage({ siteId, project, boardId, focusId = null, angle = "all", onAngle = null, onCamera = null, onAim = null, highlight = null, onSheets = null }) {
  useTr();
  const stageRef = useRef(null);
  const [shadows, setShadows] = useRememberedState("banners:shadows", true);
  const [asset, setAsset] = useState(null);
  const site = bannerSite(siteId);
  const url = site?.scene?.url || null;
  const lookAt = focusId || boardId;
  const frame = useMemo(() => bannerFrame(siteId, lookAt, angle), [siteId, lookAt, angle]);

  /* Листы рекламы места: каждый — составной картинкой работы (все полотна места, а не только взятое). */
  const sheetIds = useMemo(() => {
    if (!asset) return [];
    return [...new Set(asset.materials.map((material) => material.ad).filter(Boolean))].sort();
  }, [asset]);
  const { textures, real, playing, tick } = useBillboardSheets(sheetIds, project, boardId);
  /* Лист игры не прочитан — по «?» у картинки в колонке, не строкой на кадре (`design-qa.md`, п. 14). */
  useEffect(() => {
    onSheets?.(real);
  }, [onSheets, real]);
  /* Гифка на живом полотне играет в кадре: пустой объект сцены даёт кадру ход часов, листы меняет `tick`. */
  const clock = useMemo(() => new THREE.Group(), []);
  const objects = useMemo(() => (playing ? [{ object: clock, update: tick }] : null), [playing, clock, tick]);
  const look = useCallback(
    (index, info) => {
      if (info.ad && textures[info.ad]) return { colour: "#ffffff", texture: textures[info.ad] };
      /* Почти чёрный лист (металл Mile High) без отражений неба — чёрная плита: подтягиваем до тёмно-серого. */
      const lift = darkLift(info.colour);
      return lift > 1 ? { colour: info.colour, clean: { amount: 0, lift } } : { colour: info.colour };
    },
    [textures],
  );

  /* Под курсором и по щелчку — только полотна этого места: чужой щит на том же листе правится в «Билбордах». */
  const found = useCallback(
    (hit) => {
      const aim = billboardAimTarget(hit, boardId);
      return aim && bannerSiteOfBoard(aim.board)?.id === siteId ? aim : null;
    },
    [boardId, siteId],
  );
  const aimTarget = useCallback(
    (hit) => {
      const aim = found(hit);
      /* Подпись у курсора — имя полотна. */
      return aim ? labelled(billboardFaceSpec(aim.board, aim.sheet), boardLabelText(billboard(aim.board))) : null;
    },
    [found],
  );
  const aim = useCallback(
    (hit) => {
      const target = found(hit);
      if (target) onAim?.(target);
    },
    [found, onAim],
  );

  const label = trFill("{0}. Полотна в облике работы. Стрелки — повернуть, плюс и минус — приблизить, WASD над кадром — полёт.", tr(site?.label || "Здание"));
  const angles = [...SITE_ANGLES, "banner"];

  return (
    <div className="fx-stage recolor-stage is-studio banners-stage">
      {url ? (
        <ModelStage loadKit="signs"
          ref={stageRef}
          scene={url}
          look={look}
          frame={frame}
          frameKey={`${siteId}:${angle}${angle === "banner" ? `:${lookAt}` : ""}`}
          objects={objects}
          shadows={shadows}
          edgeFade
          onCamera={onCamera}
          onScene={setAsset}
          onAim={onAim ? aim : null}
          aimTarget={aimTarget}
          highlight={highlight}
          label={label}
        />
      ) : (
        <p className="model-stage-note">{tr("У этого места нет сцены кадра — правка всё равно уедет в игру.")}</p>
      )}
      <StageBar>
        {angles.map((id) => (
          <Button
            key={id}
            size="sm"
            variant={angle === id ? "secondary" : "ghost"}
            icon={id === "all" ? <Buildings /> : undefined}
            aria-pressed={angle === id}
            title={tr(ANGLE_LABELS[id][1])}
            onClick={() => onAngle?.(id)}
          >
            {tr(ANGLE_LABELS[id][0])}
          </Button>
        ))}
        <Button size="sm" variant={shadows ? "secondary" : "ghost"} icon={<Sun />} aria-pressed={shadows} title={tr("Тени от солнца на здании и на земле")} onClick={() => setShadows(!shadows)}>
          {tr("Тени")}
        </Button>
      </StageBar>
      <StageSheetsNote />
    </div>
  );
}
