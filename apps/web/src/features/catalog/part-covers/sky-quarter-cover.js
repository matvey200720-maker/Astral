/*
 * Обложка таймцикла части редукса на настоящем квартале из игры (владелец, 12.11.2026: «не стандартное превью: накладываем таймцикл из редукса и снимаем,
 * как выглядит именно он»).
 *
 * Плитка таймцикла в мастерской — квартал Davis из установленной GTA V под небом и светом работы (`timecycle-block/block-capture.js`). Печь обложек до сих
 * пор рисовала небо части над процедурным городом («коробки»): моста к игре у окна-съёмщика не было. Мост с тех пор появился ради кадра моря
 * (`sea-kit-bridge.js`: небо игрока, облачные шапки, секция карты) — этот же мост отдаёт и квартал, поэтому таймцикл редукса снимается тем же кадром, что
 * плитка мастерской: тот же квартал, та же камера, небо и свет — из файлов автора (`w_*.xml` → проект неба, `importSkyFromMod`).
 *
 * Нет игры или квартал не собрался — возвращается причина; печь тогда рисует прежний кадр неба над нарисованным городом.
 */
import { parseProject } from "@modovik/timecycle";
import { captureBlockFrame } from "../../workshop/timecycle-block/block-capture.js";
import { SKY_STILLS } from "./sky-clip-plan.js";

/** Час обложки: яркий день — тот же, что у плитки мастерской. */
export const QUARTER_COVER_HOUR = 14;

const parsedOf = (project) => {
  try {
    return project ? parseProject(project) : null;
  } catch {
    return null;
  }
};

/**
 * Кадр квартала под небом проекта: `{ url }` (`data:` WebP) или `{ reason }`.
 * @param {{ gameRoot: string, project: object|null, hour?: number, size: { width: number, height: number } }} input
 */
export async function skyQuarterFrame({ gameRoot, project, hour = QUARTER_COVER_HOUR, size }) {
  if (!gameRoot) return { reason: "no-game" };
  const parsed = parsedOf(project);
  /* Проект части не разобрался — штатное небо игры за небо автора не выдаём: печь нарисует прежний кадр. */
  if (project && !parsed) return { reason: "project" };
  /* Печь: нет архива неба или облаков в папке игры — отказ с именем архива (печь не выпускает кадр без облаков игры), а не квартал с эталонным небом. */
  const frame = await captureBlockFrame({ gameRoot, project: parsed, hour, size, strictSources: true });
  return frame?.url ? { url: frame.url, fromGame: frame.fromGame === true } : { reason: frame?.reason || "unavailable" };
}

const bytesOfDataUrl = async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer());

/**
 * Кадры галереи (утро, день, вечер — `SKY_STILLS`) на том же квартале. Любой несостоявшийся час — весь набор `null`: галерея либо вся с квартала, либо
 * прежняя, смешанной она быть не должна.
 * Не снялся час — `{ reason }` (причина первого сорвавшегося кадра, с именем архива игры, если дело в нём), а не молчаливый `null`: печь не подменяет галерею нарисованным городом.
 * @returns {Promise<{ id: string, hour: number, caption: string, bytes: Uint8Array }[] | { reason: string }>}
 */
export async function skyQuarterStills({ gameRoot, project, size }) {
  const out = [];
  for (const still of SKY_STILLS) {
    const frame = await skyQuarterFrame({ gameRoot, project, hour: still.hour, size });
    if (!frame.url) return { reason: frame.reason || "unavailable" };
    out.push({ ...still, bytes: await bytesOfDataUrl(frame.url) });
  }
  return out;
}
