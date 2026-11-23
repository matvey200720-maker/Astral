/*
 * Стенд наложения эффекта на кадр игры (`features/workshop/fx-frame/`): синтетическая сцена формата `docs/fx-scenes.md`, правила
 * частиц — из базы игрока, которую запёк `scripts/bake-impact-base.mjs` (или записало приложение). Кадр РИСОВАННЫЙ, не снимок игры.
 * Для сверки наложения и отладки; в продуктовую сборку не входит.
 */
import { decodeDepth } from "@modovik/fx-scenes/depth.js";
import { syntheticScene } from "@modovik/fx-scenes/synthetic.js";
import { projectPoint } from "@modovik/fx-scenes/camera.js";
import { parseScene } from "@modovik/fx-scenes/format.js";
import { defaultImpactLayer, defaultImpactZone } from "@modovik/ptfx-studio";
import { createFrameStage } from "../../src/features/workshop/fx-frame/frame-stage.js";
import { createFrameSource } from "../../src/features/workshop/fx-frame/frame-loader.js";

const canvas = document.getElementById("canvas");
const frameBox = document.getElementById("frame");
const stageBox = document.getElementById("stage");
const caption = document.getElementById("caption");
const info = document.getElementById("info");
const select = document.getElementById("scene");
const widthSelect = document.getElementById("width");
const fanSelect = document.getElementById("fan");
const loopBox = document.getElementById("loop");
const occlusionBox = document.getElementById("occlusion");

/* База из кэша приложения хранит байты как { "$bytes": base64 } (apps/desktop/src/ptfx-base-cache.js): в окне приложения их возвращает главный процесс. */
function reviveBytes(value) {
  if (Array.isArray(value)) return value.map(reviveBytes);
  if (value && typeof value === "object") {
    if (typeof value.$bytes === "string") return Uint8Array.from(atob(value.$bytes), (char) => char.charCodeAt(0));
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, reviveBytes(item)]));
  }
  return value;
}

const baked = await (await fetch("/__astral/qa/impact-base")).json().catch(() => null);
const stage = createFrameStage({ canvas, share: false });
stage.setBase(baked?.base ? reviveBytes(baked.base) : null);
stage.setLoop(false);

/* Зоны автора для стенда: кровь и искры в голову, кровь в тело — чтобы попадание в точке было видно. */
const zones = {
  head: { ...defaultImpactZone("head"), enabled: true, layers: [defaultImpactLayer("head", "blood"), defaultImpactLayer("head", "template")] },
  body: { ...defaultImpactZone("body"), enabled: true, layers: [defaultImpactLayer("body", "blood")] },
};
stage.setZones(zones, ["head", "body"]);

const OPTIONS = {
  tracer: { mode: "tracer" },
  "hit-chest": { mode: "hit", bone: "chest" },
  "hit-head": { mode: "hit", bone: "head" },
  kill: { mode: "kill" },
  "screen-hit-third": { mode: "screen-hit", view: "third" },
  "screen-hit-first": { mode: "screen-hit", view: "first" },
};

/* Настоящий набор сцен: `?set=<адрес>` — сервер, что отдаёт `/manifest` и `/file/<режим>/<класс>/<id>/<имя>` (тот же вид, что у локального API приложения;
   для сверки нового набора до выкладки: `node tools/ingame-qa/fx-set-server.mjs <папка набора>`). Кадр тогда настоящий, а не нарисованный. */
const setBase = new URLSearchParams(location.search).get("set");
const source = setBase ? createFrameSource({ base: setBase.replace(/\/$/, "") }) : null;
const realEntries = source ? (await source.readManifest())?.scenes || [] : [];
if (source) {
  select.innerHTML = "";
  for (const entry of realEntries) select.add(new Option(`${entry.id}`, entry.id));
}

let current = null;

function layout() {
  if (!current) return;
  const box = stageBox.getBoundingClientRect();
  const aspect = current.scene.resolution.width / current.scene.resolution.height;
  const width = Math.max(1, Math.min(box.width, box.height * aspect));
  frameBox.style.width = `${Math.round(width)}px`;
  frameBox.style.height = `${Math.round(width / aspect)}px`;
  stage.resize(Math.round(width), Math.round(width / aspect), Math.min(2, window.devicePixelRatio || 1));
}

/* Картинка кадра и его глубина — как их читает мастерская: глубина из закодированных байт, а не из метров до кодирования. */
function pair(scene, images, cleanName, depthName, width, height) {
  const image = document.createElement("canvas");
  image.width = width;
  image.height = height;
  image.getContext("2d").putImageData(new ImageData(images[cleanName].data, width, height), 0, 0);
  const data = decodeDepth(images[depthName].data, width, height, scene.depth.far);
  const far = scene.depth.far;
  return { image, depth: { width, height, data: occlusionBox.checked ? data : data.map(() => far) } };
}

async function loadReal() {
  const entry = realEntries.find((item) => item.id === select.value);
  if (!entry) return;
  current = await source.load(entry);
  stage.setFrame(current);
  layout();
  caption.textContent = "кадр GTA V с картой глубины — эффект рисует Astral";
  report();
}

function load() {
  if (source) return loadReal();
  const width = Number(widthSelect.value);
  const height = Math.round((width * 9) / 16);
  const made = syntheticScene({ ...OPTIONS[select.value], width, height, impacts: Number(fanSelect.value) });
  const scene = parseScene(made.scene);
  let frames = null;
  let first;
  if (scene.mode === "kill") {
    frames = scene.frames.map((frame) => ({ index: frame.index, offsetMs: frame.offsetMs, bones: frame.bones, ...pair(scene, made.images, frame.clean, frame.depth, width, height) }));
    first = frames[0];
  } else first = pair(scene, made.images, "clean.png", "depth.png", width, height);
  current = { scene, image: first.image, depth: first.depth, frames };
  stage.setFrame(current);
  layout();
  caption.textContent = "нарисовано · синтетическая сцена, не кадр GTA V";
  report();
}

function report() {
  const plan = stage.plan;
  const live = stage.inspect();
  info.textContent = [
    `сцена: ${current.scene.id}`,
    `правила ядра: ${stage.ready ? "есть" : "нет (нужна база игры)"}`,
    stage.failure ? `сбой: ${stage.failure}` : "",
    stage.zoneFailures.length ? `клон зоны не собрался: ${stage.zoneFailures[0]}` : "",
    `очередь: ${plan?.burst ? `${plan.burst.points.length} точек, ${Math.round(60 / plan.burst.interval)} выстр/мин` : "—"}, зона: ${plan?.zone ?? "—"}`,
    `шагов: ${plan?.steps.length ?? 0}, экран: ${plan?.screen ? plan.screen.kind + (plan.screen.side ? `/${plan.screen.side}` : "") : "—"}`,
    `выстрелов: ${live.shots}, кадр серии: ${live.frame}, живых: ${live.live}, попаданий: ${live.hits}`,
  ]
    .filter(Boolean)
    .join("\n");
}

select.addEventListener("change", load);
widthSelect.addEventListener("change", load);
fanSelect.addEventListener("change", load);
occlusionBox.addEventListener("change", load);
loopBox.addEventListener("change", () => stage.setLoop(loopBox.checked));
document.getElementById("shoot").addEventListener("click", () => stage.shoot());
new ResizeObserver(layout).observe(stageBox);

stage.start();
load();
window.__fxLab = { stage, zones, load, report, get current() { return current; }, project: (world) => projectPoint(current.scene.camera, world, current.scene.resolution) };
