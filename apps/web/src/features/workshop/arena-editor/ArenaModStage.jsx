/*
 * Кадр зала арены мода (Хелпер 7, 25.10.2026): готовый зал самого мода — его модели и листы поверх зала игры — на той же матовой
 * плашке, что у остальных редакторов (`ModelStage`). Глаз стоит там же, где у штатной сцены зала (оси общие), оглядывается;
 * правая кнопка — полёт, нажатие колеса — взять лист под курсором (`onSelect`). Правки листов — тем же расчётом, что у
 * установщика (`arenaModFrameLook`): свой цвет — тоном по светотени листа (у плашки — заливкой), своя картинка — листом целиком
 * (`arena-mod-textures.js`), «Убрать» — листа нет. Зал Majestic — из папки сервера (оси интерьера, не штатной сцены): глаз на краю круга.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { arenaServerInventory } from "@modovik/climb-contract/recolor/arenas";
import { arenaModFrameLook } from "@modovik/climb-contract/recolor/arena-mod";
import ModelStage from "../model-stage/ModelStage.jsx";
import { StageSheetsNote } from "../model-stage/StageControls.jsx";
import { ARENA_AMBIENT, arenaLamps } from "./arena-lamps.js";
import { glowEmission } from "./arena-text.js";
import { tr, useTr } from "../../../locales/ui.js";

/* Начальный взгляд: вдоль зала от окон — тот же ракурс, что у обложки каталога (`ARENA_HALL_TURNS`): потолок, баннеры, ряды, дальний конец. */
const START_TURN = Object.freeze({ yaw: 1.2, pitch: 0.1 });
/* Зал Majestic из папки: оси интерьера, центр круга (−9,5; 0; −6). Глаз — 1,7 м над полом круга, на краю, взгляд в круг: как обложка каталога
   (`apps/desktop/src/arena-majestic-frames.js: majesticCoverPool`). */
const MAJESTIC_VIEW = Object.freeze({ eye: Object.freeze([-9.5, 11, -4.3]), yaw: Math.PI, pitch: -0.02 });

/* Свечение материала (экраны, подсветка): как в кадре зала мода каталога. */
const glow = (info) => (info.emissive ? { emission: info.glow > 0 ? glowEmission(info.glow) : 0.75 } : {});

/**
 * Облик материала зала: правка листа мода (цвет, картинка, убрано) или как у мода, со свечением. `textures` — `Map` лист → текстура своей картинки
 * (`useArenaModTextures`): пока картинка не прочитана, лист остаётся как у мода.
 */
export function arenaModLook(mod, info, textures = null) {
  const look = mod?.sheets?.[String(info?.sheet || "")];
  if (look?.mode === "image") {
    const texture = textures?.get?.(info.sheet) || null;
    return texture ? { colour: "#ffffff", texture, ...glow(info) } : { colour: info.colour, ...glow(info) };
  }
  const own = arenaModFrameLook(mod, info);
  return own ? { ...own, ...(own.visible === false ? {} : glow(info)) } : { colour: info.colour, ...glow(info) };
}

export default function ArenaModStage({ mod, hall, sheet = "", textures = null, stageRef: outerRef = null, onSelect = null, onAsset = null, onCamera = null, overlay = null }) {
  useTr();
  const ownRef = useRef(null);
  const stageRef = outerRef || ownRef;
  const majestic = hall.server === "majestic";
  const view = useMemo(
    () => (majestic ? MAJESTIC_VIEW : arenaServerInventory(hall.server || "gta5rp")?.view?.inside || { eye: [0, 0, 1.7], yaw: 0, pitch: 0 }),
    [hall.server, majestic],
  );
  const look = useCallback((_index, info) => arenaModLook(mod, info, textures), [mod, textures]);
  const frame = useCallback(
    (loaded) => ({
      bounds: loaded.bounds,
      ground: false,
      inside: majestic
        ? { ...view, fov: 80 }
        : { ...view, yaw: view.yaw + START_TURN.yaw, pitch: (view.pitch || 0) + START_TURN.pitch, fov: 72 },
      lighting: "interior",
      ambient: loaded.lamps?.length ? ARENA_AMBIENT : 1,
    }),
    [view, majestic],
  );
  /* Взятый лист обведён во всех местах, где он стоит. */
  const highlight = useMemo(() => (sheet ? { where: (info) => info?.sheet === sheet } : null), [sheet]);
  /* Свет зала — лампы моделей игры из сцены (у сцены без ламп — пусто). */
  const [asset, setAsset] = useState(null);
  const lamps = useMemo(() => arenaLamps(asset), [asset]);
  const onScene = useCallback(
    (loaded) => {
      setAsset(loaded);
      onAsset?.(loaded);
    },
    [onAsset],
  );
  return (
    <div className="fx-stage recolor-stage is-studio" data-backdrop="daylight">
      <ModelStage
        loadKit="hall"
        ref={stageRef}
        loadTitle={tr("Открываю арену мода")}
        scene={hall.url}
        look={look}
        frame={frame}
        frameKey={`mod:${hall.url}`}
        onScene={onScene}
        lamps={lamps}
        highlight={highlight}
        onAim={onSelect ? (hit) => onSelect(hit?.info?.sheet || "") : null}
        onCamera={onCamera}
        label={tr("Зал арены мода изнутри: мышь или стрелки — оглядеться, правая кнопка — полёт по залу, нажатие колеса — взять лист под курсором.")}
      >
        {overlay}
      </ModelStage>
      <StageSheetsNote />
    </div>
  );
}
