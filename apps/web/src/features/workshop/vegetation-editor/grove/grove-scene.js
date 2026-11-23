/*
 * Роща «В разнобой» в кадре: настоящие растения куска карты, нарисованные копиями (задача 22 ТЗ 19.10.2026).
 *
 * Модели деревьев и кустов — из игры игрока (`models.bin`), по три уровня детализации; растения — на
 * своих местах из файла места (`grove-plan.js`). Рисуются `InstancedMesh`: одна сетка модели на
 * уровень и место палитры — один вызов отрисовки на все такие деревья. Листва каждого места палитры —
 * свой лист: тот же лист игры, перекрашенный той же функцией, что красит копии моделей при установке
 * (`recolourLeafLevel`, ровный цвет места); у растений вне разнобоя — облик работы (`previewLeaf`).
 *
 * Лёгкость — по правилам мастерской: кадр рисуется только на изменение (стоящий кадр ничего не стоит),
 * а при движении камеры уровень детализации и видимость растений пересчитываются заново, только если
 * глаз сдвинулся или повернулся (`beforeDraw`, зовёт кадр перед каждой отрисовкой): растения вне
 * обзора не рисуются, дальние — прореженными моделями, дальние кусты — никак.
 *
 * Сборка не стоит окну (ТЗ 22.10.2026, п. 6): сетки и программы, которых кадр ещё не видел, уходят на видеокарту не одним
 * махом, а частями — по нескольку сеток за кадр (`WARM_TRIANGLES`, `WARM_BUCKETS`); пока идёт сборка или считаются листы
 * в потоке, роща говорит `onBusy(true)`, и кадр держит «Обновляю…».
 */

import * as THREE from "three";
import { compileVegetationEffect, compileVegetationLooks, normalizeVariety, normalizeVegetationProject, varietyPainted, vegetationProjectSignature } from "@modovik/climb-contract/recolor/vegetation";
import { leafPixels } from "../../../../components/desktop/workshop/vegetation/vegetation-textures.js";
import { loadSceneImage } from "../../model-stage/scene-textures.js";
import { bitmapPixels } from "../oak-art.js";
import { leafRecolourer } from "../leaf-recolour.js";
import { bushLeafParams, leafParams } from "../vegetation-text.js";
import { indexGroveModels } from "./grove-models.js";
import { GROVE_PLAIN, groveLod, groveSlots } from "./grove-plan.js";

/* Сторона листов: листве и стволу вдали хватает 256, а память видеочипа не бесконечна. */
const SHEET_SIZE = 256;
const ALPHA_CUT = 0.38;
/* Глаз сдвинулся меньше (м) и повернулся меньше (косинус угла) — растения не пересчитываются. */
const MOVE_EPS = 0.35;
const TURN_EPS = 0.9998;
/* Прогрев — частями: за кадр не больше стольких треугольников и сеток (первая сетка кадра идёт всегда). Весь набор
   (три уровня всех моделей на каждое место палитры) одним кадром стоил окну секунды. */
export const WARM_TRIANGLES = 60000;
export const WARM_BUCKETS = 24;

const solid = (colour) => ({ mode: "solid", colour, colour2: "#ffffff", direction: "along", width: 2, shift: 0 });
/* Номер рощи: задания перекраски в общей очереди окна подписаны им, и снять можно свои. */
let groveCounter = 0;
const effects = new Map();
function solidEffect(colour) {
  if (!effects.has(colour)) effects.set(colour, compileVegetationEffect(solid(colour)));
  return effects.get(colour);
}

/* Пиксели листов — модульным кэшем по адресу, а не в состоянии (React в разработке расписывал бы буферы). */
const pixelCache = new Map();

let drawnLeaf = null;
/* Нарисованный лист — пока лист игры не пришёл или игры нет. */
function drawn() {
  if (!drawnLeaf) {
    const leaf = leafPixels({ size: 256, seed: 11 });
    drawnLeaf = { rgba: leaf.data, width: leaf.width, height: leaf.height };
  }
  return drawnLeaf;
}

function geometryOf(mesh) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  if (mesh.uvs) geometry.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  let any = false;
  for (let index = 0; index < mesh.normals.length && !any; index += 1) any = mesh.normals[index] !== 0;
  if (!any) geometry.computeVertexNormals();
  return geometry;
}

/* Лист-картинка игры → текстура (развёртка DirectX: первая строка — верх листа, цвет — sRGB). */
function sheetTexture(image) {
  const texture = new THREE.Texture(image);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function pixelsTexture({ rgba, width, height }) {
  const texture = new THREE.DataTexture(rgba, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Роща места: `asset` — разобранный `models.bin`, `plan` — расстановка (`parseGrovePlants`).
 * `{ object, beforeDraw(camera), prepare(), configure(project), stats(), dispose() }`:
 * `prepare()` читает листы игры (обещание: прочитался ли хоть один лист листвы), `configure(project)`
 * раздаёт растениям места палитры и облик работы — можно звать сколько угодно, листы пересобираются
 * только если изменился смысл палитры.
 */
export function createGrove({ asset, plan, onChange = null, onBusy = null }) {
  const models = indexGroveModels(asset);
  const modelList = plan.models.map((name) => models.get(name) || null);
  const kinds = modelList.map((model) => model?.kind || null);
  const group = new THREE.Group();
  group.name = "grove";

  /*
   * Разные программы материалов (карточка с листом, ствол с листом, ствол без) собираются до первого
   * взгляда на дерево: по одной невидимой копии на вид программы — их собирает кадр при `setObjects`.
   */
  const warmTexture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  warmTexture.colorSpace = THREE.SRGBColorSpace;
  warmTexture.needsUpdate = true;
  const warm = [];
  for (const [map, cutout] of [[true, true], [true, false], [false, false]]) {
    const material = new THREE.MeshLambertMaterial({ map: map ? warmTexture : null, alphaTest: cutout ? ALPHA_CUT : 0, side: cutout ? THREE.DoubleSide : THREE.FrontSide });
    const triangle = new THREE.BufferGeometry();
    triangle.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    triangle.setAttribute("normal", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    triangle.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2));
    const mesh = new THREE.InstancedMesh(triangle, material, 1);
    mesh.setMatrixAt(0, new THREE.Matrix4().makeScale(0, 0, 0));
    mesh.frustumCulled = false;
    group.add(mesh);
    warm.push({ mesh, material, triangle });
  }

  /* Матрица каждого растения — один раз: `T · R · S`, как ставит сущность карты. */
  const matrices = new Float32Array(plan.count * 16);
  {
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (let index = 0; index < plan.count; index += 1) {
      position.fromArray(plan.position, index * 3);
      rotation.fromArray(plan.rotation, index * 4);
      scale.set(plan.scale[index * 2], plan.scale[index * 2], plan.scale[index * 2 + 1]);
      matrix.compose(position, rotation, scale).toArray(matrices, index * 16);
    }
  }
  /* Копий каждой модели — вместимость её сеток. */
  const capacity = new Uint32Array(plan.models.length);
  for (let index = 0; index < plan.count; index += 1) capacity[plan.model[index]] += 1;

  const geometries = new Map();
  const geometry = (index) => {
    if (!geometries.has(index)) geometries.set(index, geometryOf(asset.meshes[index]));
    return geometries.get(index);
  };

  /* Листы: картинки игры по номеру листа сцены, пиксели листвы, текстуры стволов. */
  const images = new Map();
  const sheets = new Map();
  let real = false;
  let ready = false;
  let disposed = false;
  /* Занятость: роща не готова, грунтуется очередью сеток или ждёт листы из потока — кадр держит «Обновляю…». */
  let busy = true;
  function emitBusy() {
    if (disposed) return;
    const next = !ready || needsWarm || warming || requested.size > 0;
    if (next === busy) return;
    busy = next;
    onBusy?.(busy);
  }

  const used = new Set();
  for (let index = 0; index < modelList.length; index += 1) if (capacity[index] && modelList[index]) used.add(index);

  async function prepare() {
    const wanted = new Set();
    for (const index of used)
      for (const lod of modelList[index].lods) for (const mesh of lod.meshes) {
        const texture = asset.materials[mesh.material]?.texture;
        if (texture != null) wanted.add(texture);
      }
    await Promise.all(
      [...wanted].map(async (texture) => {
        const image = await loadSceneImage(asset.textures[texture], SHEET_SIZE).catch(() => null);
        images.set(texture, image);
      }),
    );
    if (disposed) return false;
    for (const [texture, image] of images) {
      if (!image) continue;
      const entry = asset.textures[texture];
      const key = `${entry.game}/${entry.texture}`;
      if (!pixelCache.has(key)) {
        const pixels = bitmapPixels(image);
        if (pixels) pixelCache.set(key, pixels);
      }
    }
    real = asset.materials.some((info) => info.group === "leaves" && info.texture != null && images.get(info.texture));
    ready = true;
    dirty = true;
    needsWarm = true;
    onChange?.();
    emitBusy();
    return real;
  }

  const basePixels = (texture) => {
    const image = images.get(texture);
    const entry = asset.textures[texture];
    return (image && pixelCache.get(`${entry.game}/${entry.texture}`)) || drawn();
  };

  /* --- Облик --- */
  const uid = ++groveCounter;
  const recolourer = leafRecolourer();
  let slots = [];
  let assigned = new Uint8Array(plan.count).fill(GROVE_PLAIN);
  let looks = compileVegetationLooks({});
  let foliage = 100;
  /* Отпечаток общего облика работы (то, что красит растения вне разнобоя) и цветов мест палитры: что изменилось — то и пересчитывается. */
  let plainKey = "";
  let coloursKey = "";
  /* Готовые листы по ключу (неизменяемые, делятся между держателями) и по одному держателю на пару «материал листа × место палитры». */
  const leafRgba = new Map();
  const holders = new Map();
  /* Ключи, чьё задание уже стоит в очереди перекраски. */
  const requested = new Set();
  const materials = new Map();
  const buckets = new Map();

  /* Ключ листа места палитры: `slot` — номер места или `GROVE_PLAIN` (облик работы). Цвет и густота — в ключе, поэтому лист
     прежнего цвета остаётся годным, а новый считается только для того места, чьё значение сменилось. */
  function leafKeyOf(materialIndex, slot) {
    const info = asset.materials[materialIndex];
    const colour = slot === GROVE_PLAIN ? null : (slots[slot]?.colour ?? null);
    const tag = slot === GROVE_PLAIN ? `plain|${info.species}|${plainKey}` : `${colour || "game"}|${foliage}`;
    return { info, key: `${info.texture}|${info.kind}|${tag}` };
  }

  /* Что сделать с листом игры, чтобы вышел лист этого места; `null` — лист не меняется (цвет игры, густота 100). */
  function leafJob(materialIndex, slot) {
    const info = asset.materials[materialIndex];
    const params =
      slot === GROVE_PLAIN
        ? info.kind === "bush"
          ? bushLeafParams(looks, info.name)
          : leafParams(looks, info.species)
        : { compiled: slots[slot]?.colour ? solidEffect(slots[slot].colour) : null, foliage, species: 0.5, salt: 977 };
    return !params || (!params.compiled && params.foliage >= 100) ? null : params;
  }

  /* Ключ исходного листа для потока: у листа игры — его адрес, у нарисованного — общий. */
  const baseKeyOf = (texture) => {
    const entry = asset.textures[texture];
    return images.get(texture) && pixelCache.has(`${entry.game}/${entry.texture}`) ? `${entry.game}/${entry.texture}` : "drawn";
  };

  function holderOf(materialIndex, slot) {
    const id = `${materialIndex}|${slot}`;
    if (!holders.has(id)) holders.set(id, { id, materialIndex, slot, texture: null, shown: "", wanted: "", material: null });
    return holders.get(id);
  }

  /* Лист встал: новая текстура, материал берёт её, прежняя уходит. Пиксели общие — копий нет. */
  function show(holder, key, pixels) {
    const texture = pixelsTexture(pixels);
    const old = holder.texture;
    holder.texture = texture;
    holder.shown = key;
    if (holder.material) holder.material.map = texture;
    old?.dispose();
  }

  /*
   * Лист пары «материал × место» в облике работы. Готовый (посчитан раньше, или цвет игры) — сразу; нет —
   * кадр показывает прежний (или исходный лист игры, если прежнего нет), а новый считает поток и ставит, когда
   * посчитает: ползунок и цвет не ждут пикселей.
   */
  function refresh(holder) {
    const { key } = leafKeyOf(holder.materialIndex, holder.slot);
    holder.wanted = key;
    if (holder.shown === key) return;
    const info = asset.materials[holder.materialIndex];
    const params = leafJob(holder.materialIndex, holder.slot);
    const ready = leafRgba.get(key) || (params ? null : basePixels(info.texture));
    if (ready) {
      show(holder, key, ready);
      return;
    }
    if (!holder.texture) show(holder, "", basePixels(info.texture));
    if (requested.has(key)) return;
    requested.add(key);
    const base = basePixels(info.texture);
    recolourer.recolour(`${uid}|${key}`, baseKeyOf(info.texture), base, params).then((rgba) => {
      requested.delete(key);
      emitBusy();
      if (!rgba || disposed) return;
      const pixels = { rgba, width: base.width, height: base.height };
      leafRgba.set(key, pixels);
      let shown = false;
      for (const waiting of holders.values())
        if (waiting.wanted === key && waiting.shown !== key) {
          show(waiting, key, pixels);
          shown = true;
        }
      if (shown) onChange?.();
    });
  }

  function leafTexture(materialIndex, slot) {
    const holder = holderOf(materialIndex, slot);
    refresh(holder);
    return holder.texture;
  }

  /* Листы мест палитры — заранее, одним махом: задания уходят в поток, первый взгляд на дерево нового цвета не ждёт. */
  function schedulePrecompute() {
    if (!ready || disposed) return;
    const leafMaterials = new Set();
    for (const index of used)
      for (const lod of modelList[index].lods) for (const mesh of lod.meshes) if (asset.materials[mesh.material]?.group === "leaves") leafMaterials.add(mesh.material);
    for (const slot of new Set(assigned)) for (const material of leafMaterials) refresh(holderOf(material, slot));
  }

  function sheetOf(texture) {
    if (texture == null || !images.get(texture)) return null;
    if (!sheets.has(texture)) sheets.set(texture, sheetTexture(images.get(texture)));
    return sheets.get(texture);
  }

  function materialFor(materialIndex, slot) {
    const key = `${materialIndex}|${slot}`;
    if (materials.has(key)) return materials.get(key);
    const info = asset.materials[materialIndex];
    const leaf = info.group === "leaves";
    const map = leaf ? leafTexture(materialIndex, slot) : sheetOf(info.texture);
    const cutout = info.alpha === "cutout";
    /* Ствол без листа — средний цвет; карточка без листа — не рисуется. */
    const material = cutout && !map ? null : new THREE.MeshLambertMaterial({ map, color: map ? 0xffffff : info.colour, alphaTest: cutout ? ALPHA_CUT : 0, side: info.doubleSided ? THREE.DoubleSide : THREE.FrontSide });
    materials.set(key, material);
    if (leaf && material) holderOf(materialIndex, slot).material = material;
    return material;
  }

  function bucketFor(modelIndex, lod, mesh, slot) {
    const leaf = asset.materials[mesh.material]?.group === "leaves";
    const key = `${modelIndex}|${lod}|${mesh.index}|${leaf ? slot : -1}`;
    if (buckets.has(key)) return buckets.get(key);
    const material = materialFor(mesh.material, leaf ? slot : -1);
    let bucket = null;
    if (material) {
      const instanced = new THREE.InstancedMesh(geometry(mesh.index), material, Math.max(1, capacity[modelIndex]));
      instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      instanced.frustumCulled = false;
      instanced.castShadow = false;
      instanced.receiveShadow = false;
      instanced.count = 0;
      instanced.visible = false;
      group.add(instanced);
      bucket = { mesh: instanced, count: 0, tris: (asset.meshes[mesh.index].indices.length / 3) | 0 };
    }
    buckets.set(key, bucket);
    return bucket;
  }

  /* Места палитры, которых больше нет, уходят: сетки, материалы и листы по номеру места (последнее число в ключе). */
  function retireSlots(wanted) {
    for (const [key, bucket] of buckets) {
      const slot = Number(key.slice(key.lastIndexOf("|") + 1));
      if (slot === -1 || wanted.has(slot)) continue;
      if (bucket) {
        group.remove(bucket.mesh);
        bucket.mesh.dispose();
      }
      buckets.delete(key);
    }
    for (const [key, material] of materials) {
      const slot = Number(key.slice(key.lastIndexOf("|") + 1));
      if (slot === -1 || wanted.has(slot)) continue;
      material?.dispose();
      materials.delete(key);
    }
    for (const [id, holder] of holders) {
      if (wanted.has(holder.slot)) continue;
      holder.texture?.dispose();
      holders.delete(id);
    }
  }

  /* Листы, что никому не нужны (прежние цвета): память держит десятки, а не всю историю правок. */
  function trimLeaves() {
    if (leafRgba.size <= 160) return;
    const keep = new Set();
    for (const holder of holders.values()) keep.add(holder.shown).add(holder.wanted);
    for (const key of leafRgba.keys()) if (!keep.has(key) && leafRgba.size > 160) leafRgba.delete(key);
  }

  /**
   * Облик работы: места палитры растениям и листва по ним. Звать после `prepare()` и при каждой правке
   * работы. Возвращает, поменялось ли что-то в кадре. Правка одного цвета пересчитывает листы только этого
   * места (и не в окне, а в потоке); доли и «Перемешать» листов не трогают вовсе.
   */
  function configure(input) {
    const project = normalizeVegetationProject(input);
    const variety = normalizeVariety(project.variety);
    /* Вид со своим цветом палитру побеждает: его деревья остаются вне разнобоя и красятся цветом вида. */
    const painted = varietyPainted(project);
    const placed = groveSlots(
      plan,
      kinds,
      variety,
      plan.models.map((name, index) => painted({ name, group: kinds[index] === "bush" ? "bush" : "tree" })),
    );
    const plainProject = { ...project, variety: { ...variety, enabled: false } };
    const nextPlain = vegetationProjectSignature(plainProject);
    const nextColours = `${JSON.stringify(placed.slots.map((slot) => slot.colour))}|${project.trees.foliage}`;
    const changed = nextPlain !== plainKey || nextColours !== coloursKey || placed.assigned.some((value, index) => value !== assigned[index]);
    const before = new Set(assigned);
    slots = placed.slots;
    assigned = placed.assigned;
    foliage = project.trees.foliage ?? 100;
    if (nextPlain !== plainKey) {
      plainKey = nextPlain;
      looks = compileVegetationLooks(plainProject);
    }
    coloursKey = nextColours;
    const wanted = new Set(assigned);
    retireSlots(wanted);
    /* Место палитры, которого не было, — новые сетки: первый кадр рисует их заранее. */
    if (ready && ([...wanted].some((slot) => !before.has(slot)) || warming)) {
      needsWarm = true;
      /* Места палитры поменялись, пока шла очередь: список собирается заново (ушедших мест в нём нет), готовые сетки пропускаются. */
      warmQueue = null;
      warming = false;
    }
    dirty = true;
    emitBusy();
    schedulePrecompute();
    /* Задания прежних цветов, что ещё не начались, снимаются: считается нынешнее. */
    const current = new Set([...holders.values()].map((holder) => `${uid}|${holder.wanted}`));
    recolourer.cancel((tag) => !tag.startsWith(`${uid}|`) || current.has(tag));
    trimLeaves();
    return changed;
  }

  /* --- Рисование по глазу --- */
  const frustum = new THREE.Frustum();
  const projection = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  const eye = new THREE.Vector3();
  const look = new THREE.Vector3();
  let lastEye = new THREE.Vector3(Infinity, 0, 0);
  let lastLook = new THREE.Vector3(1, 0, 0);
  let dirty = true;
  /* Первый кадр рощи рисует все сетки нулевого размера: геометрия и листы уходят на видеокарту сразу, а не рывками в полёте. */
  let needsWarm = false;
  const counts = [0, 0, 0];

  /*
   * Все сетки всех уровней и мест палитры, что встретятся, — по одной копии нулевого размера: рисуются, не видны, и
   * геометрия с программами уходят на видеокарту заранее. Частями (`WARM_TRIANGLES`, `WARM_BUCKETS` за кадр): сетка,
   * что не видна, на видеокарту не едет, а следующий кадр снимает нулевые копии и ставит следующую часть.
   */
  let warming = false;
  let warmQueue = null;
  let warmAt = 0;
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0).toArray();

  /* Что ещё не грунтовалось: описания сеток по растениям палитры (дёшево), сами сетки заводятся по мере части. */
  function planWarm() {
    const queue = [];
    const seen = new Set();
    for (let index = 0; index < plan.count; index += 1) {
      const modelIndex = plan.model[index];
      const model = modelList[modelIndex];
      if (!model) continue;
      const slot = assigned[index];
      if (seen.has(modelIndex * 256 + slot)) continue;
      seen.add(modelIndex * 256 + slot);
      for (let lod = 0; lod < 3; lod += 1) for (const mesh of model.lods[lod].meshes) queue.push({ modelIndex, lod, mesh, slot });
    }
    return queue;
  }

  function warmUpload(touched) {
    if (!warmQueue) {
      warmQueue = planWarm();
      warmAt = 0;
      warming = true;
      needsWarm = false;
    }
    let triangles = 0;
    let buckets = 0;
    while (warmAt < warmQueue.length && buckets < WARM_BUCKETS) {
      const { modelIndex, lod, mesh, slot } = warmQueue[warmAt];
      const bucket = bucketFor(modelIndex, lod, mesh, slot);
      warmAt += 1;
      if (!bucket || bucket.warmed || touched.has(bucket)) continue;
      /* Первая сетка части идёт всегда, остальные — пока влезают в бюджет треугольников. */
      if (buckets && triangles + bucket.tris > WARM_TRIANGLES) {
        warmAt -= 1;
        break;
      }
      bucket.warmed = true;
      triangles += bucket.tris;
      buckets += 1;
      bucket.mesh.instanceMatrix.array.set(ZERO, 0);
      bucket.mesh.instanceMatrix.needsUpdate = true;
      bucket.count = 1;
      bucket.mesh.count = 1;
      bucket.mesh.visible = true;
    }
    if (warmAt >= warmQueue.length) {
      warmQueue = null;
      warming = false;
    }
    dirty = true;
    /* Следующий кадр снимает нулевые копии этой части и ставит следующую. */
    setTimeout(() => {
      if (disposed) return;
      emitBusy();
      onChange?.();
    }, 0);
  }

  function beforeDraw(camera) {
    if (disposed || !ready || !plan.count) return;
    camera.updateMatrixWorld();
    camera.getWorldPosition(eye);
    camera.getWorldDirection(look);
    if (!dirty && eye.distanceToSquared(lastEye) < MOVE_EPS * MOVE_EPS && look.dot(lastLook) > TURN_EPS) return;
    dirty = false;
    lastEye.copy(eye);
    lastLook.copy(look);
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projection);
    for (const bucket of buckets.values()) {
      if (!bucket?.count) continue;
      bucket.count = 0;
      bucket.mesh.count = 0;
      bucket.mesh.visible = false;
    }
    counts[0] = 0;
    counts[1] = 0;
    counts[2] = 0;
    const touched = new Set();
    for (let index = 0; index < plan.count; index += 1) {
      const modelIndex = plan.model[index];
      const model = modelList[modelIndex];
      if (!model) continue;
      const sxy = plan.scale[index * 2];
      const sz = plan.scale[index * 2 + 1];
      const px = plan.position[index * 3];
      const py = plan.position[index * 3 + 1];
      const pz = plan.position[index * 3 + 2];
      const height = model.height * sz;
      sphere.center.set(px, py, pz + height * 0.5);
      sphere.radius = Math.max(model.radius * sxy, height * 0.5);
      if (!frustum.intersectsSphere(sphere)) continue;
      const lod = groveLod(model.kind, height, Math.hypot(px - eye.x, py - eye.y, pz + height * 0.5 - eye.z));
      if (lod < 0) continue;
      counts[lod] += 1;
      const slot = assigned[index];
      for (const mesh of model.lods[lod].meshes) {
        const bucket = bucketFor(modelIndex, lod, mesh, slot);
        if (!bucket) continue;
        touched.add(bucket);
        bucket.mesh.instanceMatrix.array.set(matrices.subarray(index * 16, index * 16 + 16), bucket.count * 16);
        bucket.count += 1;
      }
    }
    for (const bucket of touched) {
      bucket.warmed = true;
      bucket.mesh.count = bucket.count;
      bucket.mesh.visible = bucket.count > 0;
      const attribute = bucket.mesh.instanceMatrix;
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, bucket.count * 16);
      attribute.needsUpdate = true;
    }
    if (needsWarm || warming) warmUpload(touched);
  }

  function stats() {
    let calls = 0;
    let triangles = 0;
    for (const bucket of buckets.values()) {
      if (!bucket?.count) continue;
      calls += 1;
      triangles += bucket.count * bucket.tris;
    }
    return { plants: plan.count, drawn: [...counts], calls, triangles, buckets: buckets.size, real, busy, warming: needsWarm || warming };
  }

  function dispose() {
    disposed = true;
    recolourer.cancel((tag) => !tag.startsWith(`${uid}|`));
    for (const bucket of buckets.values()) bucket?.mesh.dispose();
    for (const material of materials.values()) material?.dispose();
    for (const holder of holders.values()) holder.texture?.dispose();
    for (const texture of sheets.values()) texture.dispose();
    for (const item of geometries.values()) item.dispose();
    for (const item of warm) {
      item.mesh.dispose();
      item.material.dispose();
      item.triangle.dispose();
    }
    warmTexture.dispose();
    group.clear();
    buckets.clear();
    materials.clear();
    holders.clear();
    leafRgba.clear();
    sheets.clear();
    geometries.clear();
  }

  return {
    object: group,
    beforeDraw,
    prepare,
    configure,
    stats,
    dispose,
    get ready() {
      return ready;
    },
    get real() {
      return real;
    },
    plan,
    kinds,
  };
}
