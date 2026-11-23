/*
 * Кадр редактора «Билборды».
 *
 * Взятый щит — штатная модель района игры игрока у щита (сцену собирает
 * `scripts/prepare-billboards.mjs`: сам щит, его модель и каркасы рядом, в
 * осях щита). Листы — из вашей GTA V (Astral Desktop), на листе рекламы —
 * облик работы той же функцией, что у установщика (`billboards-art.js`).
 * Камера — общая на мастерскую: ЛКМ — вращение, колесо — приближение,
 * щелчок ПКМ — полёт.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { billboard } from "@modovik/climb-contract/recolor/billboards";
import ModelStage from "../model-stage/ModelStage.jsx";
import { StageSheetsNote } from "../model-stage/StageControls.jsx";
import { billboardAimTarget, billboardFaceSpec } from "./billboards-aim.js";
import { useBillboardSheets } from "./billboards-art.js";
import { boardLabelText, sceneUrlOf } from "./billboards-text.js";
import { tr, useTr } from "../../../locales/ui.js";
import { labelled } from "../model-stage/hover-label.js";

/**
 * Рамка кадра щита: полотно с запасом, взгляд спереди и чуть сбоку.
 * `thumb` — снимок плитки: ближе, без вращения.
 */
export function billboardFrame(board) {
  return (asset) => {
    const part = asset.parts[board?.scene?.part ?? -1];
    const face = part?.face || part?.bounds || asset.bounds;
    /* Запас — от большей стороны: у полотна во всю высоту дома тоже видно край. */
    const margin = Math.max(1, Math.max(face.max[0] - face.min[0], face.max[2] - face.min[2]) * 0.18);
    return {
      bounds: {
        min: [face.min[0] - margin, Math.min(face.min[1], -1.2), face.min[2] - margin * 0.6],
        max: [face.max[0] + margin, Math.max(face.max[1], 1.2), face.max[2] + margin * 0.6],
      },
      ground: false,
      person: false,
      view: { yaw: -0.18, pitch: 0.06, zoom: 0.92 },
    };
  };
}

/*
 * `onAim(aim)` — щелчок по лицу щита (`billboardAimTarget`); `highlight` — выбранный щит (`billboardFaceSpec`) или `null`;
 * `only(id)` — какие полотна кадр отдаёт под курсор и щелчок (по умолчанию все): «Билборды» — щиты, «Баннеры на зданиях» — полотна района.
 * `onSheets(real)` — прочитан ли лист рекламы игры: не прочитан — колонка говорит об этом по «?» у картинки, а не строкой на кадре
 * (`design-qa.md`, п. 14).
 */
export default function BillboardsStage({ project, boardId, onCamera = null, onAim = null, highlight = null, only = null, onSheets = null }) {
  useTr();
  const stageRef = useRef(null);
  const [asset, setAsset] = useState(null);
  const board = billboard(boardId);
  const url = sceneUrlOf(board);
  const parts = useMemo(() => (board?.scene ? [board.scene.part] : null), [board]);
  const frame = useMemo(() => billboardFrame(board), [board]);

  /* Листы рекламы сцены (щита и соседей) — составными текстурами. */
  const sheetIds = useMemo(() => {
    if (!asset || !board?.scene) return [];
    const ids = new Set();
    const visible = new Set(asset.meshes.filter((mesh) => mesh.part === board.scene.part).map((mesh) => mesh.material));
    asset.materials.forEach((material, index) => {
      if (material.ad && visible.has(index)) ids.add(material.ad);
    });
    return [...ids].sort();
  }, [asset, board]);
  const { textures, real, playing, tick } = useBillboardSheets(sheetIds, project, boardId);
  useEffect(() => {
    onSheets?.(real);
  }, [onSheets, real]);
  /* Гифка на живом щите играет в кадре: пустой объект сцены только даёт кадру ход часов (`update`), листы меняет `tick`. */
  const clock = useMemo(() => new THREE.Group(), []);
  const objects = useMemo(() => (playing ? [{ object: clock, update: tick }] : null), [playing, clock, tick]);
  const look = useCallback((index, info) => (info.ad && textures[info.ad] ? { colour: "#ffffff", texture: textures[info.ad] } : { colour: info.colour }), [textures]);

  /* Под курсором подсвечивается лицо щита, что откроется по щелчку (взятого или соседнего); каркас — нет. */
  const aimTarget = useCallback(
    (hit) => {
      const aim = billboardAimTarget(hit, boardId);
      /* Подпись у курсора — имя щита. */
      return aim && (!only || only(aim.board)) ? labelled(billboardFaceSpec(aim.board, aim.sheet), boardLabelText(billboard(aim.board))) : null;
    },
    [boardId, only],
  );
  const aim = useCallback(
    (hit) => {
      const found = billboardAimTarget(hit, boardId);
      if (found && (!only || only(found.board))) onAim(found);
    },
    [boardId, onAim, only],
  );

  const label = `${board?.label || tr("Щит")} в облике работы. Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.`;

  return (
    <div className="fx-stage recolor-stage is-studio billboards-stage">
      {url ? (
        <ModelStage loadKit="signs"
          ref={stageRef}
          scene={url}
          look={look}
          parts={parts}
          frame={frame}
          frameKey={boardId}
          objects={objects}
          onCamera={onCamera}
          onScene={setAsset}
          onAim={onAim ? aim : null}
          aimTarget={aimTarget}
          highlight={highlight}
          label={label}
        />
      ) : (
        <p className="model-stage-note">{tr("У этого щита нет сцены кадра — правка всё равно уедет в игру.")}</p>
      )}
      <StageSheetsNote />
    </div>
  );
}
