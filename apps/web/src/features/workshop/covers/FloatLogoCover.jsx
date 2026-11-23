import { useCallback, useMemo } from "react";
import {
  FLOAT_LOGO_LIMITS,
  FLOAT_LOGO_STATUE,
  createFloatLogoProject,
  floatLogoSignature,
  normalizeFloatLogoProject,
} from "@modovik/climb-contract/recolor/float-logo";
import { getWorkshopAsset } from "../../../components/desktop/workshop/workshop-assets.js";
import { ensureEmblemFont, renderEmblemText } from "../emblem/emblem-items.js";
import { FLOAT_LOGO_SCENE, canvasPixels, floatLogoObject, floatLogoSceneLook } from "../float-logo-editor/float-logo-art.js";
import SceneThumb from "../model-stage/SceneThumb.jsx";
import { parseCoverState } from "./cover-data.js";

/*
 * Обложка «Летающего лого» (задача 3 ТЗ 11.10.2026, утро: «поставь вот ту
 * статую, а над ней — „Без лого“ … если человек впишет своё лого, оно
 * будет меняться») — 3D-снимок сцены редактора: статуя орла посреди
 * площади, как в игре под лого (модель площади из игры игрока), а над ней
 * — лого работы той же объёмной фигурой, что уедет в игру (своя картинка из
 * хранилища окна или надпись). Пока лого нет — над статуей надпись «Без
 * лого». Снимок — общим невидимым кадром и из хранилища обложек, как у
 * зданий (`SceneThumb`); новое лого — новый снимок.
 *
 * Обложка — композиция, а не замер: лого стоит чуть выше крыльев и одного
 * размера с обложки на обложку, высоту и размер работы показывает кадр
 * редактора.
 */

/** Надпись над статуей, пока своего лого нет. */
export const FLOAT_LOGO_EMPTY_TEXT = "Без лого";
/* Версия снимка: поменялась рамка или композиция — старые снимки не находятся. */
const COVER_FRAME = 3;
/* Лого на обложке — над крыльями орла, по длинной стороне не меньше и не больше. */
const COVER_LIFT = 1.4;
const COVER_SIZE = Object.freeze([13, 16]);

const clamp = (value, [low, high]) => Math.min(high, Math.max(low, value));

/**
 * Лого обложки: работа без движения (снимок — один кадр, лицом к камере),
 * над статуей; без своего лого — светлая надпись «Без лого» в полную яркость.
 */
export function floatLogoCoverProject(input) {
  const normal = normalizeFloatLogoProject(input);
  const placed = {
    ...normal,
    motion: "none",
    height: FLOAT_LOGO_STATUE.top + COVER_LIFT,
    size: clamp(normal.size, COVER_SIZE),
    depth: clamp(normal.depth, [FLOAT_LOGO_LIMITS.depth[0], 40]),
  };
  if (normal.mode !== "none") return normalizeFloatLogoProject(placed);
  return normalizeFloatLogoProject({
    ...placed,
    mode: "text",
    text: { value: FLOAT_LOGO_EMPTY_TEXT, font: "wide", colour: "#ffffff", outline: "none" },
    ownColour: false,
    /* Яркость фигуры без свечения — 55 %: светлая надпись темнела до серой. */
    glow: FLOAT_LOGO_LIMITS.glow[1] / 3,
    opacity: 100,
  });
}

/* Пиксели лого обложки: своя картинка — из хранилища окна, надпись — общей системой надписей. */
async function coverPixels(project) {
  if (project.mode === "image") {
    const blob = await getWorkshopAsset(project.image?.asset || "").catch(() => null);
    if (!blob || typeof createImageBitmap !== "function") return null;
    const bitmap = await createImageBitmap(blob).catch(() => null);
    if (!bitmap) return null;
    const pixels = canvasPixels(bitmap, bitmap.width, bitmap.height);
    bitmap.close?.();
    return pixels;
  }
  if (project.text.font === "custom") await ensureEmblemFont(project.text.fontAsset).catch(() => {});
  const drawn = renderEmblemText(project.text);
  return drawn ? canvasPixels(drawn.canvas, drawn.canvas.width, drawn.canvas.height) : null;
}

/* Рамка снимка: статуя и лого над ней, спереди и чуть снизу — как с площади. */
function coverFrame(top) {
  const side = FLOAT_LOGO_STATUE.radius;
  return () => ({
    bounds: { min: [-side, -side, 0], max: [side, side, top] },
    ground: true,
    person: false,
    view: { yaw: -0.3, pitch: 0.1 },
  });
}

/* Статуя без нарисованной площадки: на обложке под ней — плашка карточки. */
const STATUE_PARTS = Object.freeze([1]);

export default function FloatLogoCover({ state = null }) {
  const project = useMemo(() => {
    const stored = parseCoverState(state);
    return floatLogoCoverProject(stored ? normalizeFloatLogoProject(stored) : createFloatLogoProject());
  }, [state]);
  const lookKey = useMemo(() => JSON.stringify([COVER_FRAME, floatLogoSignature(project)]), [project]);
  const fallbackFrame = useMemo(() => coverFrame(FLOAT_LOGO_STATUE.top + COVER_LIFT + project.size * 0.5), [project]);

  /* Фигура лого — только когда снимка ещё нет: картинку читать и сетку строить дорого. */
  const prepare = useCallback(async () => {
    const pixels = await coverPixels(project);
    const item = pixels ? floatLogoObject(pixels, project) : null;
    return {
      frame: coverFrame(item?.reach.top || FLOAT_LOGO_STATUE.top + COVER_LIFT + project.size * 0.5),
      objects: () => (item ? [item] : []),
      release: () => item?.dispose(),
    };
  }, [project]);

  return (
    <span className="workshop-cover-canvas">
      <SceneThumb scene={FLOAT_LOGO_SCENE} look={floatLogoSceneLook} lookKey={lookKey} frame={fallbackFrame} parts={STATUE_PARTS} prepare={prepare} />
    </span>
  );
}
