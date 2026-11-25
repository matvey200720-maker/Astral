import { colourlessReason, crudeModelReason, meshTriangles } from "@modovik/gunpack/crude-model";
import { expectedLuma, untexturedReason } from "@modovik/gunpack/white-gate";
import { parseWeaponModel } from "./gunpack-model-parse.js";
import { CATALOG_BACKGROUND, composeCollage, isBlankFrame } from "./collage.js";
import { createGunpackScene } from "./gunpack-scene.js";
import { measureFrame, settleLight } from "./frame-light.js";

const IDLE_MS = 15000;
const RETRY_MS = 1500;
const FRAME_SIZE = [640, 360];
// Ступени съёмки: каждая легче предыдущей по качеству и по размеру текстур (2048, 1024, 512).
const RUNGS = Object.freeze(
  ["high", "medium", "low"].map((quality, rung) => ({ quality, maxTexture: 2048 >> rung })),
);
const ALL_BLANK =
  "Рендер ствола дал пустой кадр (потерян контекст WebGL) на всех трёх ступенях качества.";

function pause(ms) {
  return new Promise((done) => {
    setTimeout(done, ms);
  });
}

const withBackground = (backgroundId) => ({ backgroundId });

// Ствол, который не стоит снимать: первая непустая причина останавливает проверки.
const REFUSALS = [
  (parsed) => crudeModelReason(meshTriangles(parsed.meshes)),
  (parsed) => colourlessReason(parsed),
  /* Часть поверхности без листа цвета (по площади, порог ниже, чем у «цвета потеряно»): кадр выходил «белый корпус + декор» (MASK GUNPACK, 18.11.2026). */
  (parsed) => untexturedReason(parsed),
];

// Единственная живая сцена на страницу вместе с холстом и таймером простоя.
class StageRig {
  #scene = null;
  #quality = "";
  #canvas = null;
  #timer = 0;

  get live() {
    return Boolean(this.#scene);
  }

  stopTimer() {
    clearTimeout(this.#timer);
    this.#timer = 0;
  }

  drop = () => {
    this.stopTimer();
    if (!this.#scene) return;
    // Холст уходит со страницы первым: контекст отпускается только у отсоединённого.
    this.#canvas?.remove();
    this.#scene.dispose();
    [this.#scene, this.#quality, this.#canvas] = [null, "", null];
  };

  acquire(wanted = "high") {
    if (this.#scene && this.#quality === wanted) return this.#scene;
    this.drop();
    const canvas = document.createElement("canvas");
    const [width, height] = FRAME_SIZE;
    Object.assign(canvas, { width, height });
    document.body.append(canvas);
    const scene = createGunpackScene(canvas, { stage: true, quality: wanted });
    this.#canvas = canvas;
    this.#quality = wanted;
    this.#scene = scene;
    return scene;
  }

  // Просьб больше нет: ствол из видеопамяти сразу, сцена уйдёт через паузу.
  park() {
    if (!this.#scene) return;
    this.#scene.clear();
    this.#timer = setTimeout(this.drop, IDLE_MS);
  }
}

function loadModel(files, maxTexture) {
  const parsed = parseWeaponModel({ files, maxTexture });
  const reason = REFUSALS.reduce((found, probe) => found || probe(parsed), "");
  if (reason) throw new Error(reason);
  return parsed;
}

const takeCut = (current) => () => current.snapshot(withBackground("transparent"));

/* Светлый ствол снимается со сдержанным светом (`frame-light.js`): белое под ключом иначе уходит в потолок и теряет форму. `look` в просьбе — свет задан
   вручную (замер на стенде, `scripts/gunpack-light-sweep-electron.js`): автоматика не работает, кадр снимается как просили. */
async function captureFrame(current, parsed, look = null) {
  const { length } = current.setModel(parsed);
  /* Средняя светлота листов цвета: главный процесс сверяет с ней белизну кадра (white-gate.js) и отличает брак рендера от светлого ствола по замыслу автора. */
  const expected = expectedLuma(parsed);
  current.setAngle("profile");
  const shoot = takeCut(current);
  let cut = shoot();
  if (await isBlankFrame(cut)) return null;
  if (look) {
    current.setLook(look);
    cut = shoot();
    return (await isBlankFrame(cut)) ? null : { cut, length, light: await measureFrame(cut), expected };
  }
  const settled = await settleLight({ scene: current, cut, shoot });
  return { cut: settled.cut, length, light: settled.light && { ...settled.light, level: settled.level }, expected };
}

// Пустой кадр значит потерянный контекст GPU: сцену пересоздаём и снимаем ступенью легче.
async function shootFrom(rig, files, look, rung = 0) {
  if (rung >= RUNGS.length) throw new Error(ALL_BLANK);
  if (rung > 0) {
    rig.drop();
    await pause(RETRY_MS * rung);
  }
  const { quality, maxTexture } = RUNGS[rung];
  const current = rig.acquire(quality);
  const frame = await captureFrame(current, loadModel(files, maxTexture), look);
  return frame ?? shootFrom(rig, files, look, rung + 1);
}

const coverShot = async (request) => ({
  cover: await composeCollage(request.shots || [], withBackground(CATALOG_BACKGROUND)),
});

async function weaponShot(request, rig, ledger) {
  const { cut, length, light, expected } = await shootFrom(rig, request?.files || [], request?.look || null);
  const card = await composeCollage([{ bytes: cut, length }], withBackground(CATALOG_BACKGROUND));
  ledger.shots += 1;
  return { cut, card, length, light, expected };
}

// Любой op, кроме «cover», снимает ствол.
const SHOTS = new Map([["cover", coverShot]]);

export function serveGunpackShots(bridge) {
  const rig = new StageRig();
  const ledger = { shots: 0, waiting: 0 };
  let tail = Promise.resolve();

  const serve = async (id, request) => {
    try {
      const shoot = SHOTS.get(request?.op) ?? weaponShot;
      bridge.reply(id, await shoot(request, rig, ledger));
    } catch (error) {
      bridge.reply(id, { error: String(error?.message || error) });
    } finally {
      ledger.waiting -= 1;
      if (ledger.waiting === 0) rig.park();
    }
  };

  const accept = (id, request) => {
    ledger.waiting += 1;
    rig.stopTimer();
    tail = tail.then(() => serve(id, request));
  };

  globalThis.__astralGunpackShooterInfo = () => ({
    contexts: rig.live ? 1 : 0,
    shots: ledger.shots,
  });
  globalThis.addEventListener?.("pagehide", rig.drop);
  bridge.onShoot(accept);
  bridge.ready();
}
