import { useEffect, useMemo, useState } from "react";
import {
  createKillEffectProject,
  instantiateKillEffectTemplate,
  killMarkerPeakMoment,
} from "@modovik/kill-effects";
import {
  killEffectPeakFrame,
  paintKillEffect,
} from "../../../components/desktop/workshop/kill-effect-painter.js";
import { paintKillMarker } from "../../../components/desktop/workshop/kill-marker-painter.js";
import { parseCoverState } from "./cover-data.js";
import { stockCover } from "./stock-covers.js";
import { useCoverCanvas } from "./useCoverCanvas.js";

/*
 * Обложка килл-эффекта — вспышка так, как она ляжет на экран.
 *
 * Здесь стояло свечение с бликом и отметкой убийства посередине плитки
 * (владелец, 25.09.2026: «убери эту вспышку»): по нему не понять, что делает
 * эффект, — в бою посреди экрана ничего не загорается. Килл-эффект окрашивает
 * экран, и плотнее всего это видно по краям, поэтому обложка — матовая
 * плашка с полупрозрачной каймой цвета эффекта. Рисует её тот же проход, что
 * сцену редактора и плитки шаблонов (`kill-effect-painter.js`): обложка
 * показывает ровно то, что человек видел, когда ставил эффект.
 *
 * Стандартная обложка — ванильная вспышка игры, холодная синяя: пока своего
 * эффекта нет, раздел показывает то, что человек видит в бою сейчас
 * (владелец, 25.09.2026: «изначально не красное, а синенькое — стандартное,
 * пока ты не менял»). Красная кайма здесь была знаком раздела, а не игрой.
 * Своя работа — своим эффектом, на пике.
 *
 * Знак на килле — если он есть — стоит поверх в точке прицела, в том
 * положении, в каком он держится после появления: в бою посреди экрана
 * загорается именно он. Его кадры (эмодзи, значок, своя гифка) грузятся
 * отдельным куском и только у обложки, где знак включён: обложки живут в
 * стартовом куске приложения.
 */
const STOCK_COVER = instantiateKillEffectTemplate("vanilla");

function coverProject(state) {
  const stored = parseCoverState(state);
  /* Память раздела хранит историю правок, «Мои работы» — саму правку. */
  const own = stored?.present || stored;
  if (!own?.channels) return STOCK_COVER;
  try {
    return createKillEffectProject(own);
  } catch {
    return STOCK_COVER;
  }
}

function useMarkerSequence(marker) {
  const key = marker?.enabled ? JSON.stringify(marker.source) : "";
  const [sequence, setSequence] = useState(null);
  useEffect(() => {
    if (!key) {
      setSequence(null);
      return undefined;
    }
    let cancelled = false;
    import("../../../components/desktop/workshop/kill-marker-frames.js")
      .then(({ killMarkerSequence }) => killMarkerSequence(JSON.parse(key)))
      .then((next) => {
        if (!cancelled) setSequence(next || false);
      })
      .catch(() => {
        /* Кадры знака не прочитались — обложка без знака, но готовая. */
        if (!cancelled) setSequence(false);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return sequence;
}

/* Эффект совпадает с тем, что в игре (шаблон «Как в игре» и его копии): показывать на нём нечего — кайма на матовой плашке читалась пустым чёрным кадром. */
const sameAsGame = (project) =>
  !project.marker?.enabled && JSON.stringify(project.channels) === JSON.stringify(STOCK_COVER.channels);

/* Настоящий кадр под эффектом — штатная картинка вида: на матовой стене своя работа без снимка выходила тёмной плашкой. */
function useStockScene() {
  const [scene, setScene] = useState(null);
  useEffect(() => {
    const stock = stockCover("kill-effect");
    if (!stock || typeof Image !== "function") return undefined;
    let alive = true;
    const image = new Image();
    image.onload = () => {
      if (alive) setScene(image);
    };
    image.src = stock.url;
    return () => {
      alive = false;
    };
  }, []);
  return scene;
}

export default function KillEffectCover({ state = null }) {
  const project = useMemo(() => coverProject(state), [state]);
  const stock = useMemo(() => (sameAsGame(project) ? stockCover("kill-effect") : null), [project]);
  const frame = useMemo(() => killEffectPeakFrame(project), [project]);
  const sequence = useMarkerSequence(project.marker);
  const scene = useStockScene();

  const canvasRef = useCoverCanvas(
    (context, { width, height }) => {
      paintKillEffect({ context, width, height, frame, grain: false, scene });
      if (project.marker?.enabled && sequence)
        paintKillMarker({
          context,
          width,
          height,
          marker: project.marker,
          sequence,
          elapsed: killMarkerPeakMoment(project.marker),
        });
      /* Знак включён, а его кадры ещё едут — кадр неокончательный. */
      return !(project.marker?.enabled && sequence === null);
    },
    [frame, project, sequence, scene],
  );

  if (stock) return <img className="workshop-cover-image workshop-cover-stock" data-photo="" src={stock.url} alt="" draggable="false" decoding="async" />;
  return <canvas ref={canvasRef} className="workshop-cover-canvas" />;
}
