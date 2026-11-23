// Небо с облаками для обложки части «Облака» (13.11.2026): настоящий кадр шейдера неба мастерской — купол под таймциклом соседней части редукса и облачные шапки игры, камера
// смотрит в небо так, чтобы облака занимали кадр (город не нужен). Шапки берутся из игры игрока, когда файлы автора с игровыми совпадают байт в байт (это решает печь, `cloud-cover.js`):
// тогда кадр честен — на нём те же шапки, что лежат у автора. Шапки автора, что отличаются от игры, этот кадр не рисует (их сборка из `.ydr`/`.ytd` — отдельная работа).
import { parseProject } from "@modovik/timecycle";
import {
  blockSkyAt,
  readBlockSkyBase,
} from "../../workshop/timecycle-block/block-capture.js";
import {
  loadCloudHatSheet,
  loadCloudHats,
  sheetsForLayers,
} from "../../../components/desktop/workshop/sky/cloud-hat-data.js";
import { createSkyRendererAsync } from "../../../components/desktop/workshop/sky-renderer.js";
import { SKY_STILLS } from "./sky-clip-plan.js";
import { cloudShare, skyProjectOf } from "./cloud-sky-project.js";

/** Взгляды кандидатов: на восток, на запад и на север (на юг в полдень — солнце, оно выбеливает кадр), подъём — не ниже, чтобы горизонт не съедал небо. */
const YAWS = Object.freeze([Math.PI / 2, (Math.PI * 3) / 2, 0]);
const PITCHES = Object.freeze([0.42, 0.62]);
const FOV = 1.0;
/** Мелкий кадр пробы: по нему считается, где облаков больше. */
const PROBE = Object.freeze({ width: 192, height: 108 });

const bytesOfCanvas = (canvas) =>
  new Promise((resolve) => canvas.toBlob(resolve, "image/png"))
    .then((blob) => blob.arrayBuffer())
    .then((buffer) => new Uint8Array(buffer));

/**
 * Кадры неба с облаками: день — обложка, утро и вечер — галерея. `{ frames: [{ id, hour, caption, bytes }], camera, share, fromGame, cloud }` или `{ reason }`.
 * `files` — файлы таймцикла соседней части (`{ name, bytes }`).
 */
export async function cloudSkyFrames({
  gameRoot,
  files = [],
  name = "",
  size,
}) {
  if (!gameRoot) return { reason: "no-game" };
  const { project: raw, sky, clouds } = skyProjectOf(files, name);
  let parsed = null;
  try {
    parsed = raw ? parseProject(raw) : null;
  } catch {
    return { reason: "project" };
  }
  const base = await readBlockSkyBase(gameRoot);
  /* Небо игрока не прочитано — штатное за небо автора не выдаём. */
  if (!base.fromGame) return { reason: "no-sky-base" };
  const canvas = Object.assign(document.createElement("canvas"), {
    width: size.width,
    height: size.height,
  });
  const renderer = await createSkyRendererAsync(canvas).catch(() => null);
  if (!renderer) return { reason: "no-webgl" };
  try {
    const hats = await loadCloudHats(gameRoot).catch(() => null);
    if (!hats) return { reason: "no-hats" };
    renderer.setCloudHats(hats);
    const frameAt = (hour) => blockSkyAt(base, { project: parsed, hour });
    const layers = new Set();
    for (const still of SKY_STILLS)
      for (const sheet of sheetsForLayers(
        hats,
        frameAt(still.hour).clouds?.layerFiles,
      ))
        layers.add(sheet);
    for (const sheet of layers) {
      const image = await loadCloudHatSheet(gameRoot, sheet).catch(() => null);
      if (image) renderer.setCloudHatSheet(sheet, image);
    }
    const day = SKY_STILLS.find((still) => still.id === "day") || SKY_STILLS[0];
    const dayState = frameAt(day.hour);
    if (!dayState.clouds) return { reason: "no-clouds" };
    /* Куда смотреть: пробный мелкий кадр с каждого взгляда, берётся тот, где облаков больше всего. */
    renderer.resize(PROBE.width, PROBE.height, 1);
    const probe = document.createElement("canvas");
    probe.width = PROBE.width;
    probe.height = PROBE.height;
    const paint = probe.getContext("2d", { willReadFrequently: true });
    let best = { share: -1, camera: null };
    for (const yaw of YAWS)
      for (const pitch of PITCHES) {
        const camera = { yaw, pitch, fov: FOV, time: 0, showGround: false };
        renderer.render(dayState.state, camera, null, dayState.clouds);
        paint.drawImage(canvas, 0, 0);
        const share = cloudShare(
          paint.getImageData(0, 0, PROBE.width, PROBE.height).data,
        );
        if (share > best.share) best = { share, camera };
      }
    renderer.resize(size.width, size.height, 1);
    const frames = [];
    for (const still of SKY_STILLS) {
      const at = frameAt(still.hour);
      renderer.render(at.state, best.camera, null, at.clouds);
      frames.push({
        id: still.id,
        hour: still.hour,
        caption: still.caption,
        bytes: await bytesOfCanvas(canvas),
      });
    }
    return {
      frames,
      camera: best.camera,
      share: best.share,
      fromGame: base.fromGame,
      project: { sky, clouds },
    };
  } finally {
    renderer.dispose?.();
  }
}
