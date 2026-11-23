/*
 * Формат FX-сцен v1 (`docs/fx-scenes.md`, согласован Хелпером 4 и Хелпером 3): кадры GTA V с картой глубины для предпросмотра трассеров,
 * попаданий, килл-эффектов и экранных попаданий. Здесь — договор в коде: разбор и проверка `scene.json` и манифеста набора. Одним и тем же
 * кодом пользуются мастерская (разбирает) и стенд съёмки (проверяет свой вывод до выкладки), поэтому ошибка названа путём к полю и словами.
 *
 * Пакет чистый: ни DOM, ни Node — только данные.
 */

export const FORMAT_VERSION = "v1";
export const SCHEMA = 1;

/* `tracer` — очередь по вееру точек сбоку; `hit` — попадание в тело или голову; `kill` — серия кадров у тела жертвы; `screen-hit` — попали в нас. */
export const MODES = Object.freeze(["tracer", "hit", "kill", "screen-hit"]);
export const WEAPON_CLASSES = Object.freeze(["pistol", "smg", "rifle", "shotgun", "sniper", "mg"]);
/* Кости жертвы (`bones`, `target.bone`): привязка крови и точки попадания. */
export const BONES = Object.freeze(["head", "neck", "spine", "chest", "pelvis", "larm", "rarm", "lthigh", "rthigh", "lcalf"]);
/* У `hit` две сцены на оружие: «в тело» (`chest`) и «в голову» (`head`). */
export const HIT_BONES = Object.freeze(["chest", "head"]);
/* Кости, без которых кровь килла некуда привязать. */
export const KILL_BONES = Object.freeze(["head", "chest"]);
/* Ракурс сцены (24.10 вечером, правки владельца): `side` — вид сбоку, `third` — камера игры от третьего лица (за спиной стрелка; у `screen-hit` — камера
   игрока), `first` — первое лицо, только у `screen-hit`. `victim` (25.10) — от лица жертвы: камера игры от третьего лица за спиной того, в кого стреляют;
   стрелок впереди, очередь летит в жертву, только у `hit`. */
export const VIEWS = Object.freeze(["side", "third", "victim", "first"]);
/* Какие ракурсы бывают у какого режима. */
export const MODE_VIEWS = Object.freeze({
  tracer: Object.freeze(["side", "third"]),
  hit: Object.freeze(["side", "third", "victim"]),
  kill: Object.freeze(["side", "third"]),
  "screen-hit": Object.freeze(["third", "first"]),
});
/* Расстояние до цели у `hit` от третьего лица и от лица жертвы: вблизи (≈3–4 м) и вдали (≈25–40 м). */
export const DISTANCES = Object.freeze(["close", "far"]);
/* Ракурсы `hit`, у которых расстояние обязательно: камера игры (за стрелком или за жертвой); сбоку расстояние не выбирают. */
const DISTANCE_VIEWS = Object.freeze(["third", "victim"]);
export const DEPTH_ENCODINGS = Object.freeze(["rgb24-linear-z"]);
export const TARGET_KINDS = Object.freeze(["ped", "surface"]);
/* Сколько точек в веере трассера: Хелпер 3 даёт 8–12, потолок — с запасом. */
export const IMPACTS_MAX = 32;
/* Серия килла: до выстрела, смерть, падение, лежит — но не только: сколько снято, столько и играет. */
export const FRAMES_MAX = 12;

export const SCENE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const RESOLUTION_MAX = 8192;
const FRAME_FILE = /^frames\/(\d{2})-(clean|depth)\.png$/;
const ROOT_FILES = Object.freeze(["clean.png", "depth.png", "scene.json", "stencil.png"]);

/** Ошибка формата: `problems` — список `{ path, message }`. */
export class FxSceneError extends Error {
  constructor(what, problems) {
    super(`${what}: ${problems.map((item) => `${item.path} — ${item.message}`).join("; ")}`);
    this.name = "FxSceneError";
    this.problems = problems;
  }
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const isVector = (value, length) => Array.isArray(value) && value.length === length && value.every(finite);

/**
 * Ракурс записи манифеста или сцены. Наборы до 24.10 вечера поля `view` у `tracer` / `hit` / `kill` не несут — это вид сбоку; у `screen-hit`
 * ракурс обязателен (`null`, если его нет).
 */
export function viewOf(item) {
  if (item?.view && VIEWS.includes(item.view)) return item.view;
  return item && item.mode !== "screen-hit" ? "side" : null;
}

/** Папка сцены внутри набора: `<mode>/<weaponClass>/<id>`. Набор лежит на CDN в папке пакета `sha256/<SET>/` (SET — хэш его `manifest.json`). */
export function scenePath({ mode, weaponClass, id }) {
  return `${mode}/${weaponClass}/${id}`;
}

/** Допустимое имя файла сцены (то, что может стоять в манифесте и в адресе API). */
export const isSceneFileName = (name) => ROOT_FILES.includes(name) || FRAME_FILE.test(String(name));

/** Имена файлов кадров серии: `frames/00-clean.png`, `frames/00-depth.png`. */
export const frameFileNames = (index) => {
  const number = String(index).padStart(2, "0");
  return { clean: `frames/${number}-clean.png`, depth: `frames/${number}-depth.png` };
};

/** Какие файлы обязана нести сцена (без `stencil.png`, он необязателен): у килла — кадры серии, у остальных — `clean.png` и `depth.png`. */
export function requiredSceneFiles(scene) {
  if (scene.mode === "kill") return ["scene.json", ...(scene.frames || []).flatMap((frame) => [frame.clean, frame.depth])];
  return ["scene.json", "clean.png", "depth.png"];
}

/* ---------------------------------------------------------- опорные точки -- */

function checkAnchor(value, path, problems, { dir = false, kind = false, bone = null } = {}) {
  if (!isObject(value)) return problems.push({ path, message: "нужен объект { world, screen, depthMeters }" });
  if (!isVector(value.world, 3)) problems.push({ path: `${path}.world`, message: "три числа [x, y, z] — метры мира GTA, Z вверх" });
  if (!isVector(value.screen, 2)) problems.push({ path: `${path}.screen`, message: "два числа [u, v] — экран от верхнего левого угла, [0,1]" });
  if (!finite(value.depthMeters) || !(value.depthMeters > 0)) problems.push({ path: `${path}.depthMeters`, message: "положительное число — расстояние вдоль оси взгляда, метры" });
  if (dir && value.dir !== undefined && !(isVector(value.dir, 3) && Math.abs(Math.hypot(...value.dir) - 1) < 0.02)) problems.push({ path: `${path}.dir`, message: "единичный вектор [x, y, z] — направление ствола в мире" });
  if (kind && value.kind !== undefined && !TARGET_KINDS.includes(value.kind)) problems.push({ path: `${path}.kind`, message: `одно из ${TARGET_KINDS.join(", ")}` });
  if (bone && value.bone !== undefined && !bone.includes(value.bone)) problems.push({ path: `${path}.bone`, message: `одна из ${bone.join(", ")}` });
}

function checkBones(value, path, problems, { required = [] } = {}) {
  if (!isObject(value)) return problems.push({ path, message: "нужен объект { имя кости: { world, screen, depthMeters } }" });
  for (const [name, bone] of Object.entries(value)) {
    if (!BONES.includes(name)) problems.push({ path: `${path}.${name}`, message: `кость из ${BONES.join(", ")}` });
    else checkAnchor(bone, `${path}.${name}`, problems);
  }
  for (const name of required) if (value[name] === undefined) problems.push({ path, message: `нет кости «${name}»` });
}

/* ----------------------------------------------------------------- сцена -- */

/**
 * Проверка `scene.json`. Возвращает `{ ok, problems, scene }`; `scene` — тот же объект с дополненными умолчаниями (`camera.aspect`,
 * `camera.near`, `time`, `lighting`, `fog`, `bones`, `impacts`, `frames` — `null` или пусто), если замечаний нет.
 */
export function validateScene(raw) {
  const problems = [];
  const add = (path, message) => problems.push({ path, message });
  if (!isObject(raw)) return { ok: false, problems: [{ path: "$", message: "нужен объект" }], scene: null };

  if (raw.schema !== SCHEMA) add("schema", `должно быть ${SCHEMA}`);
  if (typeof raw.id !== "string" || !SCENE_ID.test(raw.id)) add("id", "латиница, цифры, _ и -, до 64 знаков");
  if (!MODES.includes(raw.mode)) add("mode", `один из ${MODES.join(", ")}`);
  if (raw.view !== undefined && raw.view !== null && !VIEWS.includes(raw.view)) add("view", `один из ${VIEWS.join(", ")}`);
  else if (MODES.includes(raw.mode)) {
    const allowed = MODE_VIEWS[raw.mode];
    if (raw.view != null && !allowed.includes(raw.view)) add("view", `для режима ${raw.mode}: ${allowed.join(" | ")}`);
    if (raw.mode === "screen-hit" && !allowed.includes(raw.view)) add("view", `для режима screen-hit: ${allowed.join(" | ")}`);
  }
  if (raw.distance !== undefined && raw.distance !== null && !DISTANCES.includes(raw.distance)) add("distance", `один из ${DISTANCES.join(", ")}`);
  else if (raw.distance != null && raw.mode !== "hit") add("distance", "расстояние — только у режима hit");
  else if (raw.mode === "hit" && DISTANCE_VIEWS.includes(raw.view) && raw.distance == null) add("distance", `для hit от третьего лица и от лица жертвы: ${DISTANCES.join(" | ")} — вблизи или вдали`);
  if (raw.sequence !== undefined && raw.sequence !== null && !(isObject(raw.sequence) && typeof raw.sequence.group === "string" && Number.isInteger(raw.sequence.index))) add("sequence", "null или { group, index }");

  const weapon = raw.weapon;
  if (!isObject(weapon)) add("weapon", "нужен объект { class, model }");
  else {
    if (!WEAPON_CLASSES.includes(weapon.class)) add("weapon.class", `один из ${WEAPON_CLASSES.join(", ")}`);
    if (typeof weapon.model !== "string" || !weapon.model) add("weapon.model", "имя модели игры");
    if (weapon.rpm !== undefined && !(finite(weapon.rpm) && weapon.rpm > 0 && weapon.rpm < 3000)) add("weapon.rpm", "выстрелов в минуту, число от 1 до 3000");
  }

  const resolution = raw.resolution;
  if (!isObject(resolution) || ![resolution.width, resolution.height].every((side) => Number.isInteger(side) && side >= 16 && side <= RESOLUTION_MAX)) add("resolution", `{ width, height } — целые от 16 до ${RESOLUTION_MAX}`);

  const camera = raw.camera;
  if (!isObject(camera)) add("camera", "нужен объект { position, rot, fovV, far }");
  else {
    if (!isVector(camera.position, 3)) add("camera.position", "три числа — позиция в мире, метры");
    const rot = camera.rot;
    if (!isObject(rot) || ![rot.pitch, rot.roll, rot.yaw].every(finite) || (rot.order !== undefined && rot.order !== "ZXY")) add("camera.rot", "{ pitch, roll, yaw } — градусы, порядок ZXY");
    if (!finite(camera.fovV) || !(camera.fovV > 1) || !(camera.fovV < 170)) add("camera.fovV", "вертикальный угол обзора, градусы, от 1 до 170");
    if (!finite(camera.far) || !(camera.far > 0)) add("camera.far", "положительное число, метры");
    for (const key of ["near", "aspect"]) if (camera[key] !== undefined && !(finite(camera[key]) && camera[key] > 0)) add(`camera.${key}`, "положительное число");
  }

  const depth = raw.depth;
  if (!isObject(depth) || !DEPTH_ENCODINGS.includes(depth.encoding) || !finite(depth.far) || !(depth.far > 0)) add("depth", `{ encoding: ${DEPTH_ENCODINGS.join("|")}, far > 0 }`);

  if (raw.time !== undefined && raw.time !== null && !(isObject(raw.time) && finite(raw.time.hour) && (raw.time.minute === undefined || finite(raw.time.minute)))) add("time", "{ hour, minute, weather }");
  const lighting = raw.lighting;
  if (lighting !== undefined && lighting !== null) {
    if (!isObject(lighting)) add("lighting", "объект");
    else {
      const sun = lighting.sun;
      if (!isObject(sun) || !isVector(sun.direction, 3) || !isVector(sun.color, 3) || !finite(sun.intensity)) add("lighting.sun", "{ direction[3], color[3], intensity }");
      if (lighting.ambient !== undefined && !isVector(lighting.ambient, 3)) add("lighting.ambient", "три числа");
      if (lighting.exposure !== undefined && !(finite(lighting.exposure) && lighting.exposure > 0)) add("lighting.exposure", "положительное число");
    }
  }
  const fog = raw.fog;
  if (fog !== undefined && fog !== null && (!isObject(fog) || !isVector(fog.color, 3) || !finite(fog.near) || !finite(fog.far) || !(fog.far > fog.near) || !finite(fog.density) || fog.density < 0 || fog.density > 1)) add("fog", "{ color[3], near, far > near, density от 0 до 1 }");

  /* Опоры. */
  for (const key of ["muzzle", "target"]) if (raw[key] !== undefined && raw[key] !== null) checkAnchor(raw[key], key, problems, key === "muzzle" ? { dir: true } : { kind: true, bone: BONES });
  if (raw.bullet !== undefined && raw.bullet !== null && !(isObject(raw.bullet) && raw.bullet.from === "muzzle" && raw.bullet.to === "target" && (raw.bullet.rangeM === undefined || finite(raw.bullet.rangeM)))) add("bullet", "{ from: \"muzzle\", to: \"target\", rangeM }");
  if (raw.bones !== undefined && raw.bones !== null) checkBones(raw.bones, "bones", problems);
  if (raw.impacts !== undefined && raw.impacts !== null) {
    if (!Array.isArray(raw.impacts) || !raw.impacts.length || raw.impacts.length > IMPACTS_MAX) add("impacts", `список точек попадания, от 1 до ${IMPACTS_MAX} (Хелпер 3 даёт 8–12)`);
    else raw.impacts.forEach((point, index) => checkAnchor(point, `impacts[${index}]`, problems));
  }

  /* Серия кадров килла. */
  if (raw.frames !== undefined && raw.frames !== null) {
    if (!Array.isArray(raw.frames) || !raw.frames.length || raw.frames.length > FRAMES_MAX) add("frames", `серия кадров, от 1 до ${FRAMES_MAX}`);
    else {
      const seen = new Set();
      raw.frames.forEach((frame, index) => {
        const here = `frames[${index}]`;
        if (!isObject(frame)) return add(here, "объект { index, offsetMs, clean, depth, bones }");
        if (!Number.isInteger(frame.index) || frame.index < 0 || frame.index > 99 || seen.has(frame.index)) add(`${here}.index`, "целое от 0 до 99 без повторов");
        else {
          seen.add(frame.index);
          const names = frameFileNames(frame.index);
          if (frame.clean !== names.clean) add(`${here}.clean`, `должно быть ${names.clean}`);
          if (frame.depth !== names.depth) add(`${here}.depth`, `должно быть ${names.depth}`);
        }
        if (!finite(frame.offsetMs) || frame.offsetMs < 0) add(`${here}.offsetMs`, "миллисекунды от выстрела, не меньше нуля");
        checkBones(frame.bones, `${here}.bones`, problems, { required: KILL_BONES });
      });
    }
  }

  /* Что обязательно по режиму. */
  const need = (key, message) => {
    if (raw[key] === undefined || raw[key] === null) add(key, message);
  };
  switch (raw.mode) {
    case "tracer":
      need("muzzle", "обязательна для режима tracer: дуло");
      if (!Array.isArray(raw.impacts) && (raw.target === undefined || raw.target === null)) add("impacts", "обязательны для режима tracer: веер точек попадания (или хотя бы target)");
      break;
    case "hit":
      need("muzzle", "обязательна для режима hit: дуло");
      need("target", "обязательна для режима hit: точка попадания в тело или голову");
      if (isObject(raw.target) && !HIT_BONES.includes(raw.target.bone)) add("target.bone", `для режима hit: ${HIT_BONES.join(" | ")} — «в тело» или «в голову»`);
      break;
    case "kill":
      need("target", "обязательна для режима kill: место попадания");
      if (!Array.isArray(raw.frames)) add("frames", "обязательны для режима kill: серия кадров");
      break;
    default:
  }
  if (raw.mode !== "kill" && Array.isArray(raw.frames)) add("frames", "серия кадров — только у режима kill");
  if (raw.mode !== "tracer" && Array.isArray(raw.impacts)) add("impacts", "веер точек — только у режима tracer");

  if (problems.length) return { ok: false, problems, scene: null };
  const scene = {
    ...raw,
    view: raw.view ?? null,
    distance: raw.distance ?? null,
    sequence: raw.sequence ?? null,
    camera: { aspect: resolution.width / resolution.height, near: 0.15, ...camera, rot: { ...camera.rot, order: "ZXY" } },
    time: raw.time ?? null,
    lighting: raw.lighting ?? null,
    fog: raw.fog ?? null,
    muzzle: raw.muzzle ?? null,
    target: raw.target ?? null,
    bullet: raw.bullet ?? null,
    bones: raw.bones ?? {},
    impacts: raw.impacts ?? null,
    frames: raw.frames ? [...raw.frames].sort((a, b) => a.index - b.index) : null,
  };
  return { ok: true, problems: [], scene };
}

/** Разбор `scene.json` (текст или объект). Бросает `FxSceneError`. */
export function parseScene(source) {
  let raw = source;
  if (typeof source === "string") {
    try {
      raw = JSON.parse(source);
    } catch (error) {
      throw new FxSceneError("scene.json", [{ path: "$", message: `не JSON: ${error.message}` }]);
    }
  }
  const { ok, problems, scene } = validateScene(raw);
  if (!ok) throw new FxSceneError("scene.json", problems);
  return scene;
}

/* -------------------------------------------------------------- манифест -- */

/** Проверка `manifest.json` набора. Возвращает `{ ok, problems, manifest }`. */
export function validateManifest(raw) {
  const problems = [];
  const add = (path, message) => problems.push({ path, message });
  if (!isObject(raw)) return { ok: false, problems: [{ path: "$", message: "нужен объект" }], manifest: null };
  if (raw.schema !== SCHEMA) add("schema", `должно быть ${SCHEMA}`);
  if (raw.version !== FORMAT_VERSION) add("version", `должно быть ${FORMAT_VERSION}`);
  if (!Array.isArray(raw.scenes)) add("scenes", "нужен список сцен");
  else {
    const seen = new Set();
    raw.scenes.forEach((entry, index) => {
      const path = `scenes[${index}]`;
      if (!isObject(entry)) return add(path, "объект");
      if (typeof entry.id !== "string" || !SCENE_ID.test(entry.id)) add(`${path}.id`, "латиница, цифры, _ и -");
      if (!MODES.includes(entry.mode)) add(`${path}.mode`, `один из ${MODES.join(", ")}`);
      if (!WEAPON_CLASSES.includes(entry.weaponClass)) add(`${path}.weaponClass`, `один из ${WEAPON_CLASSES.join(", ")}`);
      if (typeof entry.weapon !== "string" || !entry.weapon) add(`${path}.weapon`, "имя модели игры");
      const key = `${entry.mode}/${entry.weaponClass}/${entry.id}`;
      if (seen.has(key)) add(`${path}.id`, `сцена ${key} повторена`);
      seen.add(key);
      if (MODES.includes(entry.mode) && WEAPON_CLASSES.includes(entry.weaponClass) && entry.path !== scenePath(entry)) add(`${path}.path`, `должно быть ${scenePath(entry)}`);
      /* Чем сцены отличаются внутри режима — в манифесте, чтобы выбрать сцену, не скачивая её. */
      if (entry.mode === "hit" && !HIT_BONES.includes(entry.bone)) add(`${path}.bone`, HIT_BONES.join(" | "));
      if (entry.view !== undefined && !VIEWS.includes(entry.view)) add(`${path}.view`, VIEWS.join(" | "));
      else if (MODES.includes(entry.mode)) {
        const allowed = MODE_VIEWS[entry.mode];
        if (entry.view !== undefined && !allowed.includes(entry.view)) add(`${path}.view`, `для режима ${entry.mode}: ${allowed.join(" | ")}`);
        if (entry.mode === "screen-hit" && !allowed.includes(entry.view)) add(`${path}.view`, allowed.join(" | "));
      }
      if (entry.distance !== undefined && !DISTANCES.includes(entry.distance)) add(`${path}.distance`, DISTANCES.join(" | "));
      else if (entry.distance !== undefined && entry.mode !== "hit") add(`${path}.distance`, "расстояние — только у записей hit");
      else if (entry.mode === "hit" && DISTANCE_VIEWS.includes(entry.view) && entry.distance === undefined) add(`${path}.distance`, `у hit от третьего лица и от лица жертвы: ${DISTANCES.join(" | ")}`);
      if (!isObject(entry.files)) return add(`${path}.files`, "нужен объект файлов { имя: { sha256, bytes } }");
      for (const [name, file] of Object.entries(entry.files)) {
        const here = `${path}.files["${name}"]`;
        if (!isSceneFileName(name)) add(here, "неизвестный файл сцены");
        else if (!isObject(file) || typeof file.sha256 !== "string" || !SHA256.test(file.sha256) || !Number.isInteger(file.bytes) || file.bytes <= 0) add(here, "{ sha256: 64 знака hex строчными, bytes: целое больше нуля }");
      }
      if (entry.files["scene.json"] === undefined) add(`${path}.files`, "нет scene.json");
      if (entry.mode === "kill") {
        const frames = Object.keys(entry.files).filter((name) => FRAME_FILE.test(name));
        if (!frames.length) add(`${path}.files`, "у килла нужна серия frames/NN-clean.png + frames/NN-depth.png");
        for (const name of frames) {
          const [, number, kind] = FRAME_FILE.exec(name);
          const pair = frameFileNames(Number(number))[kind === "clean" ? "depth" : "clean"];
          if (entry.files[pair] === undefined) add(`${path}.files`, `у кадра ${number} нет пары ${pair}`);
        }
      } else for (const name of ["clean.png", "depth.png"]) if (entry.files[name] === undefined) add(`${path}.files`, `нет ${name}`);
    });
  }
  return problems.length ? { ok: false, problems, manifest: null } : { ok: true, problems: [], manifest: raw };
}

/** Разбор манифеста (текст или объект). Бросает `FxSceneError`. */
export function parseManifest(source) {
  let raw = source;
  if (typeof source === "string") {
    try {
      raw = JSON.parse(source);
    } catch (error) {
      throw new FxSceneError("manifest.json", [{ path: "$", message: `не JSON: ${error.message}` }]);
    }
  }
  const { ok, problems, manifest } = validateManifest(raw);
  if (!ok) throw new FxSceneError("manifest.json", problems);
  return manifest;
}

/**
 * Сцены набора под выбор: `{ mode, weaponClass?, bone?, view?, distance? }` → записи манифеста в порядке манифеста. `bone` — для `hit` («в тело» —
 * `chest`, «в голову» — `head`), `view` — ракурс (у записи без `view` — вид сбоку, `viewOf`), `distance` — «вблизи / вдали» у `hit`. Класс оружия
 * по умолчанию не важен: все сцены сняты с карабином, и трассер любого ствола показывается на сцене карабина.
 */
export function pickScenes(manifest, { mode, weaponClass, bone, view, distance } = {}) {
  return manifest.scenes.filter(
    (entry) =>
      entry.mode === mode &&
      (!weaponClass || entry.weaponClass === weaponClass) &&
      (!bone || entry.bone === bone) &&
      (!view || viewOf(entry) === view) &&
      (!distance || entry.distance === distance),
  );
}

/**
 * Что в наборе можно переключить у режима: ракурсы и расстояния записей `entries` (результат `pickScenes` без `view` и `distance`) в порядке
 * `VIEWS` / `DISTANCES`. Ключ `distances` — расстояния записей выбранного ракурса, если он задан.
 */
export function sceneChoices(entries, { view } = {}) {
  const views = VIEWS.filter((name) => entries.some((entry) => viewOf(entry) === name));
  const distances = DISTANCES.filter((name) => entries.some((entry) => entry.distance === name && (!view || viewOf(entry) === view)));
  return { views, distances };
}

/**
 * Файлы сцены с проверкой sha256. `bytesOf(name)` отдаёт содержимое файла (`Uint8Array`) или `null`; `sha256(bytes)` — hex строчными
 * (в окне — `crypto.subtle`, в Node — `crypto`). Возвращает список расхождений словами, пустой — набор цел.
 */
export async function verifySceneFiles(entry, { bytesOf, sha256 }) {
  const problems = [];
  for (const [name, file] of Object.entries(entry.files)) {
    const bytes = await bytesOf(name);
    if (!bytes) problems.push(`${entry.id}/${name}: файла нет`);
    else if (bytes.byteLength !== file.bytes) problems.push(`${entry.id}/${name}: размер ${bytes.byteLength}, в манифесте ${file.bytes}`);
    else if ((await sha256(bytes)) !== file.sha256) problems.push(`${entry.id}/${name}: sha256 другой`);
  }
  return problems;
}
