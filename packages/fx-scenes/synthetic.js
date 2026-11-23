/*
 * Синтетическая сцена того же формата (`docs/fx-scenes.md`, §7): пока настоящих кадров нет, на ней проверяются разбор, декодирование глубины,
 * проекция и наложение эффекта. Кадр РИСОВАННЫЙ — земля, стена, колонна и фигура из простых тел; это не кадр GTA V, и в окне такая сцена
 * подписывается «нарисовано» (правило CLAUDE.md).
 *
 * Согласованность — по построению: картинку и глубину считает один и тот же луч камеры, а `screen` и `depthMeters` опор берутся проекцией их
 * `world` той же камерой, поэтому `checkAnchors` на ней чист.
 */
import { encodeDepth } from "./depth.js";
import { SCHEMA, frameFileNames } from "./format.js";
import { cameraAxes, projectPoint } from "./camera.js";

/* Кости стоящей фигуры относительно её основания (метры, X вправо от зрителя). */
const STANDING = Object.freeze({
  head: [0, 0, 1.7],
  neck: [0, 0, 1.55],
  spine: [0, 0, 1.2],
  chest: [0, 0, 1.35],
  pelvis: [0, 0, 0.95],
  larm: [0.28, 0, 1.3],
  rarm: [-0.28, 0, 1.3],
  lthigh: [0.1, 0, 0.7],
  rthigh: [-0.1, 0, 0.7],
  lcalf: [0.1, 0, 0.35],
});
/* Падающая фигура: тело ниже и вперёд. */
const FALLING = Object.freeze(Object.fromEntries(Object.entries(STANDING).map(([name, [x, y, z]]) => [name, [x, y - 0.25, z * 0.65]])));
/* Лежащая: вдоль X на земле. */
const LYING = Object.freeze({
  head: [-0.75, 0, 0.14],
  neck: [-0.6, 0, 0.14],
  spine: [-0.1, 0, 0.14],
  chest: [-0.3, 0, 0.14],
  pelvis: [0.15, 0, 0.14],
  larm: [-0.3, 0.3, 0.1],
  rarm: [-0.3, -0.3, 0.1],
  lthigh: [0.45, 0.1, 0.1],
  rthigh: [0.45, -0.1, 0.1],
  lcalf: [0.85, 0.1, 0.1],
});

/* Серия килла: до, смерть, падает, лежит — смещения, как у стенда (docs/fx-scenes.md, §1). */
const KILL_FRAMES = Object.freeze([
  { offsetMs: 0, pose: "standing" },
  { offsetMs: 120, pose: "standing" },
  { offsetMs: 450, pose: "falling" },
  { offsetMs: 2500, pose: "lying" },
]);
const POSES = Object.freeze({ standing: STANDING, falling: FALLING, lying: LYING });

const sky = (v) => [128 + 70 * (1 - v), 170 + 55 * (1 - v), 214 + 28 * (1 - v)];

function hitCylinder(origin, dir, body) {
  const ox = origin[0] - body.cx;
  const oy = origin[1] - body.cy;
  const a = dir[0] * dir[0] + dir[1] * dir[1];
  if (a < 1e-12) return null;
  const b = 2 * (ox * dir[0] + oy * dir[1]);
  const c = ox * ox + oy * oy - body.r * body.r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t <= 0) return null;
  const z = origin[2] + dir[2] * t;
  if (z < body.z0 || z > body.z1) return null;
  const nx = (ox + dir[0] * t) / body.r;
  return { t, shade: 0.55 + 0.45 * Math.max(0, -nx * 0.5 + 0.5), colour: body.colour };
}

function hitBox(origin, dir, body) {
  let near = 0;
  let far = Infinity;
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(dir[axis]) < 1e-12) {
      if (origin[axis] < body.min[axis] || origin[axis] > body.max[axis]) return null;
      continue;
    }
    let t0 = (body.min[axis] - origin[axis]) / dir[axis];
    let t1 = (body.max[axis] - origin[axis]) / dir[axis];
    if (t0 > t1) [t0, t1] = [t1, t0];
    near = Math.max(near, t0);
    far = Math.min(far, t1);
    if (near > far) return null;
  }
  return near > 0 ? { t: near, shade: 0.8, colour: body.colour } : null;
}

/** Кадр и глубина сцены камерой `camera`: `{ rgba, viewZ }`. Глубина — по лучу, `t` совпадает с view-space Z (ось взгляда = 1). */
function render({ camera, width, height, bodies, wallY, far }) {
  const axes = cameraAxes(camera);
  const half = Math.tan((camera.fovV * Math.PI) / 360);
  const aspect = width / height;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const viewZ = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const ndcY = 1 - ((y + 0.5) / height) * 2;
    for (let x = 0; x < width; x += 1) {
      const ndcX = ((x + 0.5) / width) * 2 - 1;
      const dir = [0, 1, 2].map((i) => axes.forward[i] + axes.right[i] * ndcX * half * aspect + axes.up[i] * ndcY * half);
      let best = { t: Infinity, colour: sky((y + 0.5) / height), shade: 1 };
      if (dir[2] < -1e-9) {
        const t = -camera.position[2] / dir[2];
        if (t > 0 && t < best.t) {
          const gx = camera.position[0] + dir[0] * t;
          const gy = camera.position[1] + dir[1] * t;
          const checker = (Math.floor(gx) + Math.floor(gy)) & 1;
          best = { t, colour: checker ? [92, 112, 84] : [74, 94, 68], shade: 1 };
        }
      }
      if (dir[1] > 1e-9) {
        const t = (wallY - camera.position[1]) / dir[1];
        if (t > 0 && t < best.t) {
          const wx = camera.position[0] + dir[0] * t;
          const wz = camera.position[2] + dir[2] * t;
          const grid = Math.abs((wx * 2) % 1) < 0.04 || Math.abs((wz * 2) % 1) < 0.04;
          best = { t, colour: grid ? [168, 150, 128] : [196, 178, 154], shade: 1 };
        }
      }
      for (const body of bodies) {
        const hit = body.type === "cyl" ? hitCylinder(camera.position, dir, body) : hitBox(camera.position, dir, body);
        if (hit && hit.t < best.t) best = hit;
      }
      const at = (y * width + x) * 4;
      rgba[at] = best.colour[0] * best.shade;
      rgba[at + 1] = best.colour[1] * best.shade;
      rgba[at + 2] = best.colour[2] * best.shade;
      rgba[at + 3] = 255;
      viewZ[y * width + x] = Number.isFinite(best.t) ? Math.min(best.t, far) : far;
    }
  }
  return { rgba, viewZ };
}

const normalise = (v) => {
  const length = Math.hypot(...v);
  return v.map((value) => value / length);
};
const place = (offset, bone) => bone.map((value, index) => value + offset[index]);

/* Веер точек очереди на стене: спираль «золотого угла» вокруг центра, чтобы пули не ложились в одну точку. */
function fan(count, centre, spreadX, spreadZ) {
  return Array.from({ length: count }, (_, i) => {
    const radius = Math.sqrt((i + 0.5) / count);
    const angle = i * 2.399963;
    return [centre[0] + Math.cos(angle) * radius * spreadX, centre[1], centre[2] + Math.sin(angle) * radius * spreadZ];
  });
}

/**
 * @param {object} [options]
 * @param {"tracer"|"hit"|"kill"|"screen-hit"} [options.mode]
 * @param {"chest"|"head"} [options.bone] — для `hit`: «в тело» или «в голову»
 * @param {"side"|"third"|"victim"|"first"} [options.view] — ракурс: у `screen-hit` — `third` | `first` (по умолчанию `third`); у остальных режимов, если задан, пишется в
 *   сцену (камера та же — сцена нарисована, в ней нет «за спиной стрелка»); `victim` у `hit` — камера за спиной жертвы
 * @param {"close"|"far"} [options.distance] — для `hit` от третьего лица и от лица жертвы
 * @param {number} [options.width]
 * @param {number} [options.height]
 * @param {number} [options.impacts] — сколько точек в веере трассера
 * @returns {{ scene: object, images: Record<string, {width, height, data}>, viewZ: Float32Array }}
 *   `scene` — как `scene.json` (проходит `validateScene` и `checkAnchors`); `images` — RGBA по именам файлов (`clean.png`, `depth.png` или
 *   `frames/NN-…png` у килла); `viewZ` — глубина в метрах до кодирования (у килла — первого кадра).
 */
export function syntheticScene({ mode = "tracer", bone = "chest", view, distance, weaponClass = "rifle", width = 640, height = 360, impacts = 10 } = {}) {
  const far = 300;
  /* Ракурс: у `screen-hit` он есть всегда (по умолчанию — третье лицо), у остальных режимов — только если его просили. */
  const shownView = mode === "screen-hit" ? view ?? "third" : view ?? null;
  const behind = shownView === "third" && mode !== "screen-hit";
  /* От лица жертвы (`hit`, 25.10): камера за спиной того, в кого стреляют, взгляд на стрелка. */
  const fromVictim = shownView === "victim" && mode === "hit";
  /* `hit` от третьего лица и от лица жертвы: вблизи цель в 3–4 м от стрелка, вдали — за тридцать; стена уходит за цель. */
  const hitFar = mode === "hit" && (behind || fromVictim) && distance === "far";
  const hitClose = mode === "hit" && (behind || fromVictim) && distance === "close";
  const wallY = hitFar ? 44 : 14;
  const base = { position: [0, -9, 1.6], rot: { pitch: -2, roll: 0, yaw: 0, order: "ZXY" }, fovV: 50, near: 0.15, far, aspect: width / height };
  let camera = base;
  const resolution = { width, height };
  const anchor = (world) => {
    const projected = projectPoint(camera, world, resolution);
    return { world, screen: projected.screen, depthMeters: projected.depthMeters };
  };
  const bonesAt = (table, offset, names = Object.keys(table)) => Object.fromEntries(names.map((name) => [name, anchor(place(offset, table[name]))]));
  const column = { type: "cyl", cx: 0, cy: 5.5, r: 0.4, z0: 0, z1: 3.2, colour: [112, 116, 124], name: "column" };
  const victim = { type: "cyl", r: 0.25, z0: 0, z1: 1.8, colour: [76, 92, 140], name: "victim" };
  const extra = {};
  const images = {};
  let bodies = [column];
  let primary = null;

  if (mode === "tracer") {
    if (behind) camera = { ...base, position: [-1.6, -9.5, 2.05], rot: { pitch: -3, roll: 0, yaw: 0, order: "ZXY" }, fovV: 44 };
    const muzzle = [-1.2, -6, 1.45];
    const points = fan(Math.max(1, impacts), [0.6, wallY, 1.55], 2.2, 0.7);
    extra.muzzle = { ...anchor(muzzle), dir: normalise([points[0][0] - muzzle[0], points[0][1] - muzzle[1], points[0][2] - muzzle[2]]) };
    extra.impacts = points.map(anchor);
    extra.target = { kind: "surface", ...extra.impacts[0] };
    extra.bullet = { from: "muzzle", to: "target", rangeM: Math.hypot(points[0][0] - muzzle[0], points[0][1] - muzzle[1], points[0][2] - muzzle[2]) };
  } else if (mode === "hit") {
    /* Расстояние цели: прежнее (15 м, вид сбоку), вблизи (≈3,6 м) и вдали (≈31 м); камера от третьего лица стоит за стрелком. */
    const muzzleY = hitClose ? -3.4 : -6;
    const victimY = hitClose ? 0.4 : hitFar ? 25 : 9;
    if (behind) camera = { ...base, position: [-1.0, muzzleY - 2.4, 2.0], rot: { pitch: -4, roll: 0, yaw: 0, order: "ZXY" }, fovV: hitFar ? 36 : 50 };
    /* За спиной жертвы: позади неё, чуть правее, на уровне глаз, взгляд (рыскание 180°) на стрелка. */
    if (fromVictim) camera = { ...base, position: [1.5, victimY + 2.6, 2.0], rot: { pitch: -3, roll: 0, yaw: 180, order: "ZXY" }, fovV: hitFar ? 36 : 50 };
    const muzzle = [-0.6, muzzleY, 1.45];
    const hit = bone === "head" ? [0.8, victimY - 0.25, 1.7] : [0.8, victimY - 0.25, 1.35];
    bodies = fromVictim ? [{ ...victim, cx: 0.8, cy: victimY }] : [column, { ...victim, cx: 0.8, cy: victimY }];
    extra.muzzle = { ...anchor(muzzle), dir: normalise([hit[0] - muzzle[0], hit[1] - muzzle[1], hit[2] - muzzle[2]]) };
    extra.target = { kind: "ped", bone, ...anchor(hit) };
    extra.bullet = { from: "muzzle", to: "target", rangeM: Math.hypot(hit[0] - muzzle[0], hit[1] - muzzle[1], hit[2] - muzzle[2]) };
    extra.bones = bonesAt(STANDING, [0.8, victimY, 0]);
  } else if (mode === "kill") {
    camera = behind
      ? { ...base, position: [0.9, -4.3, 1.75], rot: { pitch: -6, roll: 0, yaw: 6, order: "ZXY" }, fovV: 45 }
      : { ...base, position: [0, -2.6, 1.15], rot: { pitch: -4, roll: 0, yaw: 0, order: "ZXY" }, fovV: 45 };
    extra.target = { kind: "ped", bone: "chest", ...anchor([0, 0.55, 1.35]) };
    extra.frames = KILL_FRAMES.map((frame, index) => {
      const body =
        frame.pose === "lying"
          ? { type: "box", min: [-1.05, 0.5, 0], max: [1.05, 1.0, 0.28], colour: [76, 92, 140], name: "victim" }
          : frame.pose === "falling"
            ? { type: "cyl", cx: 0, cy: 0.95, r: 0.32, z0: 0, z1: 1.2, colour: [76, 92, 140], name: "victim" }
            : { ...victim, cx: 0, cy: 0.8 };
      return { index, offsetMs: frame.offsetMs, ...frameFileNames(index), bones: bonesAt(POSES[frame.pose], [0, 0.75, 0], ["head", "chest", "pelvis", "larm", "rarm", "lthigh", "rthigh", "lcalf"]), body };
    });
  } else if (mode === "screen-hit") {
    const third = shownView === "third";
    camera = { ...base, position: third ? [0, -3.4, 1.9] : [0, -1.2, 1.6], rot: { pitch: third ? -6 : -1, roll: 0, yaw: 0, order: "ZXY" }, fovV: third ? 60 : 75 };
    bodies = [{ type: "cyl", cx: 5, cy: 12, r: 0.25, z0: 0, z1: 1.8, colour: [140, 76, 76], name: "attacker" }];
    if (third) bodies.push({ ...victim, cx: 0, cy: -1.2 });
  } else throw new RangeError(`Неизвестный режим ${mode}`);

  if (mode === "kill") {
    for (const frame of extra.frames) {
      const drawn = render({ camera, width, height, bodies: [column, frame.body], wallY, far });
      images[frame.clean] = { width, height, data: drawn.rgba };
      images[frame.depth] = { width, height, data: encodeDepth(drawn.viewZ, far) };
      primary ??= drawn.viewZ;
      delete frame.body;
    }
  } else {
    const drawn = render({ camera, width, height, bodies, wallY, far });
    images["clean.png"] = { width, height, data: drawn.rgba };
    images["depth.png"] = { width, height, data: encodeDepth(drawn.viewZ, far) };
    primary = drawn.viewZ;
  }

  const shownDistance = mode === "hit" && (behind || fromVictim) ? distance ?? "close" : null;
  const id = `synthetic_${mode.replace("-", "_")}${mode === "hit" ? `_${bone}` : ""}${shownView ? `_${shownView}` : ""}${shownDistance ? `_${shownDistance}` : ""}_01`;
  const scene = {
    schema: SCHEMA,
    id,
    mode,
    view: shownView,
    ...(shownDistance ? { distance: shownDistance } : {}),
    sequence: null,
    createdAt: "2026-10-24T12:00:00Z",
    stand: "synthetic",
    weapon: { class: weaponClass, model: "WEAPON_CARBINERIFLE", name: "Карабин", rpm: 444 },
    resolution,
    camera,
    depth: { encoding: "rgb24-linear-z", far },
    time: { hour: 14, minute: 0, weather: "EXTRASUNNY" },
    lighting: { sun: { direction: [0.3, 0.5, -0.8], color: [1, 0.96, 0.88], intensity: 1 }, ambient: [0.35, 0.38, 0.42], exposure: 1 },
    fog: { color: [0.72, 0.78, 0.86], near: 8, far: 160, density: 0.6 },
    ...extra,
    frames: extra.frames || null,
  };
  return { scene, images, viewZ: primary };
}
