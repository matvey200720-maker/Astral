// Зона Z3: загрузка модели, записи материалов, поверхности и текстуры,
// вещи «на модельке», свечение слоёв покраски.

import { glowsWithColour, paintMaterial, restingEmissiveMap } from "./gun-paint-maps.js";
import { assignMeshParts, meshUvIslands, partUvTriangles } from "./gun-uv-mesh.js";
import { uvRepeat } from "./gun-uv.js";
import { orderInk } from "./ink-order.js";
import { hasItemBesideSkin, isSkinPartMaterial } from "./skin-materials.js";
import * as THREE from "three";
import {
  GLOW_BOOST,
  perfMarksOn,
  describeMaterial,
  materialName,
  materialSheetSource,
  opaqueColourAsync,
  perfMark,
  sheetTransform,
} from "./gun-scene-pure.js";

const materialsOf = (node) => [].concat(node.material);

// Все сетки дерева в порядке обхода; у пустого корня сеток нет.
const meshesIn = (root) => {
  const found = [];
  root?.traverse((node) => {
    if (node.isMesh) found.push(node);
  });
  return found;
};

// Матрица подгонки или подложки: ровно 16 чисел.
const isMatrix16 = (value) => Array.isArray(value) && value.length === 16;

// Запись материала без внутренних полей: хосту в ответе load они не уходят.
const publicEntry = (entry) => {
  const shown = { ...entry };
  for (const key of ["targets", "meshes", "sourceMap", "mapper", "repeat"]) delete shown[key];
  return shown;
};

// Холст как лист поверхности: цвет sRGB, без переворота, повтор по обеим осям,
// то же положение на развёртке, что и у `mapper`.
const canvasSheet = (canvas, mapper) => {
  const texture = Object.assign(new THREE.CanvasTexture(canvas), {
    colorSpace: THREE.SRGBColorSpace,
    flipY: false,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
  });
  texture.offset.copy(mapper.offset);
  texture.repeat.copy(mapper.repeat);
  texture.center.copy(mapper.center);
  texture.rotation = mapper.rotation;
  return texture;
};

const surfaceTexture = (ctx, entry, canvas) => {
  const texture = canvasSheet(canvas, entry.mapper);
  texture.anisotropy = ctx.renderer.capabilities.getMaxAnisotropy();
  texture.userData.astralPaintSurface = true;
  return texture;
};

// Запись материала: описание из Z0 плюс сведения о сетках.
const openEntry = (ctx, material, index) => {
  const entry = describeMaterial(material, index, ctx.renderer, { deferred: true });
  entry.targets = [];
  entry.meshes = [];
  entry.sourceMap = material.map || null;
  entry.mapper = sheetTransform(materialSheetSource(material));
  return entry;
};

// Кожа под тату и тело записей не дают; кожа внутри модели вещи (голова под бородой и причёской, рука под ногтями — `skin-materials.js`) — тоже: кисть и заливка её не красят.
// `skinParts` — в модели рядом с кожей есть сама вещь; если вся модель — `head`/`hand`, это обычный материал.
const isSkinOnly = (list, skinParts = false) =>
  list.every((material) => material?.userData.astralUnderlay || material?.userData.astralBody || (skinParts && isSkinPartMaterial(material)));

// Служебная сетка метится и становится двусторонней.
const markOverlay = (node, list) => {
  node.userData.astralOverlay = true;
  for (const material of list) {
    if (material) material.side = THREE.DoubleSide;
  }
};

// Группы сетки, относящиеся к одному материалу; у сетки с одним материалом групп нет.
const groupsOf = (node, index) => {
  if (!Array.isArray(node.material)) return null;
  return node.geometry.groups.filter((group) => group.materialIndex === index);
};

// Материал виден с обеих сторон, его карта читается как sRGB.
const prepareMaterial = (material) => {
  material.side = THREE.DoubleSide;
  if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
};

// Один материал обычной сетки: имя, сторона, цвет карты, запись.
const enlistMaterial = (ctx, node, bag, material, index) => {
  if (!material) return;
  const name = materialName(material, index);
  material.name = name;
  prepareMaterial(material);
  if (node.userData.astralAttachment) bag.attachmentMaterials.add(name);
  material.userData.astralColourGlow ??= glowsWithColour(material);

  let entry = bag.entries.get(name);
  if (!entry) {
    entry = openEntry(ctx, material, index);
    bag.entries.set(name, entry);
  }
  // светящийся материал делает светящейся и запись
  entry.targets.push(material);
  entry.meshes.push({ mesh: node, groups: groupsOf(node, index) });
  entry.glows ||= Boolean(material.emissiveMap);
};

// Разбирает одну сетку: служебные отбрасывает, остальные вносит в записи и считает вершины.
const collectMesh = (ctx, node, bag) => {
  node.frustumCulled = false;
  bag.vertices += node.geometry.attributes.position.count || 0;
  const list = materialsOf(node);
  if (isSkinOnly(list, bag.skinParts)) {
    markOverlay(node, list);
    // Кожа из модели вещи закрывает всё за ней: луч, попавший в неё первой, мазка не даёт (`describeHit`); у подложек тела прежнее — луч идёт дальше.
    if (bag.skinParts && list.every(isSkinPartMaterial)) node.userData.astralSkinPart = true;
    return;
  }
  node.userData.astralUvIslands = meshUvIslands(node.geometry);
  list.forEach((material, index) => enlistMaterial(ctx, node, bag, material, index));
};

// Цвет без альфы читается с видеочипа сразу для всех записей.
const settleOpaque = async (ctx, entry, serial) => {
  const job = entry.opaqueJob;
  delete entry.opaqueJob;
  if (!job) return;
  // без видеочипа картинка остаётся исходной
  const image = await opaqueColourAsync(ctx.renderer, job.texture, job.width, job.height).catch(() => null);
  if (!image || serial !== ctx.loadSerial) return;
  entry.image = image;
  entry.width = image.width || entry.width;
  entry.height = image.height || entry.height;
};

// Своя модель: все прежние дети корня переезжают в группу с матрицей подгонки.
const wrapOwnFit = (ctx, fit) => {
  const group = new THREE.Group();
  group.name = "astral-own-fit";
  group.matrixAutoUpdate = false;
  group.matrix.fromArray(fit);
  group.add(...ctx.root.children);
  ctx.root.add(group);
  ctx.fitGroup = group;
};

const addAttachments = (ctx, layer) => {
  for (const child of layer.scene.children.slice()) {
    child.traverse((node) => {
      node.userData.astralAttachment = true;
    });
    ctx.root.add(child);
  }
};

// Кисть, в которой стоит ствол: положение, поворот и масштаб берутся из матрицы подложки.
const handHolding = (gun, matrix) => {
  const hand = new THREE.Group();
  const placement = new THREE.Matrix4().fromArray(matrix);
  placement.decompose(hand.position, hand.quaternion, hand.scale);
  hand.add(gun);
  return hand;
};

// Подложка «в руках»: тело и кисть со стволом под одной группой.
const mountUnderlay = (ctx, underlay, body) => {
  const bodyScene = body.scene;
  ctx.underlay = bodyScene;
  for (const mesh of meshesIn(bodyScene)) {
    mesh.frustumCulled = false;
    mesh.userData.astralOverlay = true;
    for (const material of materialsOf(mesh)) {
      if (material) prepareMaterial(material);
    }
  }
  ctx.hand = handHolding(ctx.root, underlay.matrix);
  ctx.mounted = new THREE.Group();
  ctx.mounted.add(bodyScene, ctx.hand);
};

const applyPose = (ctx, pose) => {
  const { root, ops } = ctx;
  pose.apply(root, 0);
  perfMark("gun-settle-start");
  ops.settleSkeletons(root);
  perfMark("gun-settle-end");
  if (!pose.animated) return;
  ctx.pose = pose;
  ctx.poseStartedAt = performance.now();
  ctx.poseTempo.reset();
  ctx.canvas.dataset.posing = "1";
};

// Файл по адресу, если адрес есть; нестрогие источники (обвесы) сбой превращают в «нет файла».
const pullFile = (loader, source, forgiving = false) => {
  if (!source) return null;
  const pending = loader.loadAsync(source);
  return forgiving ? pending.catch(() => null) : pending;
};

// Одна загрузка: её номер, токены текстур и файлы, пока она не принята или не отброшена.
class ModelLoad {
  constructor(ctx, options = {}) {
    // разбор параметров идёт раньше любых изменений: плохой аргумент не трогает состояние
    const { underlay = null, fit = null, attachments = null, pose = null } = options;
    this.ctx = ctx;
    this.underlay = underlay;
    this.fit = fit;
    this.attachments = attachments;
    this.pose = pose;
    this.files = null;
    this.serial = ++ctx.loadSerial;
    ctx.ops.cancelFlight();
    perfMark("gun-load-start");
    this.previousToken = this.dropTexturesBeforeLoad();
    this.token = ctx.textureCache.begin();
    this.loader = ctx.makeLoader(this.token);
  }

  // Прежняя сцена очищается без отпуска текстур; её токен вернётся, когда новый разбор закончится.
  dropTexturesBeforeLoad() {
    const { ctx } = this;
    const previous = ctx.textureToken;
    ctx.textureToken = null;
    ctx.windowLease?.keepPrograms();
    ctx.ops.clearModel(false);
    return previous;
  }

  get stale() {
    return this.serial !== this.ctx.loadSerial;
  }

  async fetch(url) {
    const { ctx, loader, underlay, attachments, token, previousToken } = this;
    try {
      this.files = await Promise.all([
        loader.loadAsync(url),
        pullFile(loader, underlay?.url),
        pullFile(loader, attachments, true),
      ]);
    } catch (error) {
      ctx.textureCache.release(token);
      ctx.textureCache.release(previousToken);
      throw error;
    }
    perfMark("gun-load-parsed");
    ctx.textureCache.release(previousToken);
  }

  // Загрузка устарела: свои деревья и текстурные ссылки освобождаются.
  discard() {
    const { ctx, files, token } = this;
    for (const file of files) {
      if (file) ctx.ops.releaseTree(file.scene);
    }
    ctx.textureCache.release(token);
    return null;
  }

  // Принятая загрузка встаёт в сцену: токен, корень, подгонка, обвесы.
  adopt() {
    const { ctx, files, fit } = this;
    const [file, , layer] = files;
    ctx.textureToken = this.token;
    ctx.root = file.scene;
    if (isMatrix16(fit)) wrapOwnFit(ctx, fit);
    if (layer) addAttachments(ctx, layer);
  }

  // Обходит дерево: записи материалов, служебные сетки, число вершин.
  gather() {
    const { ctx } = this;
    const bag = { entries: new Map(), attachmentMaterials: new Set(), vertices: 0, skinParts: false };
    orderInk(ctx.root);
    const meshes = meshesIn(ctx.root);
    bag.skinParts = hasItemBesideSkin(meshes.map(materialsOf));
    for (const mesh of meshes) collectMesh(ctx, mesh, bag);
    return bag;
  }

  // Подложка встаёт «в руки», если у неё есть матрица из 16 чисел; иначе освобождается.
  mountBody() {
    const { ctx, underlay, files } = this;
    const body = files[1];
    if (!body) return;
    if (isMatrix16(underlay.matrix)) mountUnderlay(ctx, underlay, body);
    else ctx.ops.releaseTree(body.scene);
  }
}

// Обмер собранной модели: записи, куски деталей, поза, матрицы, повторы развёртки.
const measureLoaded = (ctx, bag, pose) => {
  ctx.entries = Array.from(bag.entries.values());
  assignMeshParts(ctx.root, { skip: (node) => node.userData.astralOverlay });
  if (pose) applyPose(ctx, pose);
  ctx.root.updateMatrixWorld(true);
  ctx.ops.measureModel();
  for (const entry of ctx.entries) {
    entry.repeat = uvRepeat(partUvTriangles(entry.meshes, entry.mapper));
  }
};

const load = async (ctx, url, options) => {
  const job = new ModelLoad(ctx, options);
  await job.fetch(url);
  if (job.stale) return job.discard();

  job.adopt();
  const bag = job.gather();
  await Promise.all([...bag.entries.values()].map((entry) => settleOpaque(ctx, entry, job.serial)));
  if (job.stale) return job.discard();

  measureLoaded(ctx, bag, job.pose);
  ctx.mounted = ctx.root;
  if (import.meta.env?.DEV) window.__astralGunModel = { root: ctx.root, materials: ctx.entries };
  job.mountBody();

  const { holder, ops, decorations, warmup } = ctx;
  holder.add(ctx.mounted);
  ops.frameModel();
  ops.applyFinish();
  ops.applyShape();
  decorations.attach(ctx.root);
  warmup.warm();
  perfMark("gun-load-built");
  ctx.markFirstFrame = perfMarksOn();

  return {
    vertices: bag.vertices,
    length: ctx.span,
    attachmentMaterials: [...bag.attachmentMaterials],
    materials: ctx.entries.map(publicEntry),
  };
};

// Материалы вещей прочих категорий, надетых на персонажа.
const outfitTargets = (ctx) =>
  meshesIn(ctx.root)
    .flatMap(materialsOf)
    .filter((material) => material?.userData.astralOutfit && material.name);

// Строка списка вещей: слот, имя и картинка до первой покраски.
const describeOutfit = (material) => {
  // до первой покраски это исходная картинка игры: черновик строится от неё
  const image = material.userData.astralOutfitBase || material.map?.image || null;
  return {
    slot: material.userData.astralOutfit,
    name: material.name,
    image,
    width: image?.width || 0,
    height: image?.height || 0,
  };
};

// Вещь с одним слотом и именем перечисляется один раз, первым материалом.
const outfitMaterials = (ctx) => {
  const firsts = new Map();
  for (const material of outfitTargets(ctx)) {
    const key = `${material.userData.astralOutfit}\n${material.name}`;
    if (!firsts.has(key)) firsts.set(key, material);
  }
  return Array.from(firsts.values(), describeOutfit);
};

// Кладёт холст вещи в материал: прежняя карта освобождается, цвет сбрасывается в белый.
const repaintOutfit = (material, outfitCanvas) => {
  const texture = canvasSheet(outfitCanvas, sheetTransform(materialSheetSource(material)));
  const previous = material.map;
  material.userData.astralOutfitBase ||= previous?.image || null;
  previous?.dispose?.();
  material.map = texture;
  material.color?.set(0xffffff);
  material.needsUpdate = true;
};

const paintOutfit = (ctx, slot, name, outfitCanvas) => {
  const hits = outfitTargets(ctx).filter(
    (material) => material.userData.astralOutfit === slot && material.name === name,
  );
  for (const material of hits) repaintOutfit(material, outfitCanvas);
  if (hits.length) ctx.requestRender();
  return hits.length > 0;
};

const entryNamed = (ctx, name) => ctx.entries.find((entry) => entry.name === name);

// Текстура свечения записи под лист: прежняя обновляется, если лист тот же, иначе строится новая.
const glowTextureFor = (ctx, entry, sheet) => {
  const current = entry.glowTexture;
  if (current?.image === sheet) {
    current.needsUpdate = true;
    return current;
  }
  current?.dispose();
  entry.glowTexture = surfaceTexture(ctx, entry, sheet);
  return entry.glowTexture;
};

// Материал светится картой слоёв; прежние цвет и яркость свечения запоминаются один раз.
const glowOn = (material, glowTexture) => {
  const { userData, emissive } = material;
  userData.astralEmissive ??= emissive.getHex();
  userData.astralEmissiveIntensity ??= material.emissiveIntensity;
  emissive.set(0xffffff);
  material.emissiveMap = glowTexture;
  material.emissiveIntensity = GLOW_BOOST;
  material.needsUpdate = true;
};

// Материал возвращает свечение, каким оно было до показа: карту покоя, цвет и яркость.
const glowOff = (material, baseTexture) => {
  const { userData } = material;
  material.emissiveMap = restingEmissiveMap(material, baseTexture);
  material.emissive.setHex(userData?.astralEmissive ?? 0);
  material.emissiveIntensity = userData?.astralEmissiveIntensity ?? 1;
  material.needsUpdate = true;
};

// Свечение включено: текстура свечения следует за листом, материалы получают её и повышенную яркость.
const lightUp = (ctx, entry, sheet) => {
  const glowTexture = glowTextureFor(ctx, entry, sheet);
  for (const material of new Set(entry.targets)) {
    if (material.emissive && material.emissiveMap !== glowTexture) glowOn(material, glowTexture);
  }
};

// Свечение выключено: материалы получают прежнее, текстура свечения освобождается.
const dimDown = (entry) => {
  const { glowTexture } = entry;
  if (!glowTexture) return;
  for (const material of new Set(entry.targets)) {
    if (material.emissiveMap === glowTexture) glowOff(material, entry.texture);
  }
  glowTexture.dispose();
  entry.glowTexture = null;
};

// Карта свечения слоёв покраски ложится на материалы записи, пока показ включён.
const applyEntryGlow = (ctx, entry) => {
  if (ctx.shape.material === "xray") return;
  const sheet = ctx.glowShown ? entry.glowSource?.() || null : null;
  if (sheet) lightUp(ctx, entry, sheet);
  else dimDown(entry);
};

const bindSurface = (ctx, name, surfaceCanvas, glowSource = null) => {
  const entry = entryNamed(ctx, name);
  if (!entry) return null;
  const texture = surfaceTexture(ctx, entry, surfaceCanvas);
  for (const material of entry.targets) paintMaterial(material, texture);
  entry.texture = texture;
  entry.glowSource = glowSource;
  applyEntryGlow(ctx, entry);
  if (ctx.shape.material !== "standard") ctx.ops.applyShape();
  ctx.requestRender();
  return texture;
};

const refreshSurface = (ctx, name) => {
  const entry = entryNamed(ctx, name);
  if (!entry?.texture) return;
  const { shape, ops } = ctx;
  entry.texture.needsUpdate = true;
  applyEntryGlow(ctx, entry);
  if (entry.xray) {
    entry.xray.stale = true;
    if (shape.material === "xray") ops.scheduleXray();
  }
  ctx.requestRender();
};

const setGlowShown = (ctx, on) => {
  const next = Boolean(on);
  if (next === ctx.glowShown) return;
  ctx.glowShown = next;
  for (const entry of ctx.entries) applyEntryGlow(ctx, entry);
  ctx.requestRender();
};

export const attachLoadZone = (ctx) => {
  ctx.loadSerial = 0;
  ctx.glowShown = false;
  Object.assign(ctx.ops, {
    load: (url, options = {}) => load(ctx, url, options),
    surfaceTexture: (entry, canvas) => surfaceTexture(ctx, entry, canvas),
    applyEntryGlow: (entry) => applyEntryGlow(ctx, entry),
    outfitMaterials: () => outfitMaterials(ctx),
    paintOutfit: (slot, name, outfitCanvas) => paintOutfit(ctx, slot, name, outfitCanvas),
    bindSurface: (name, surfaceCanvas, glowSource = null) => bindSurface(ctx, name, surfaceCanvas, glowSource),
    refreshSurface: (name) => refreshSurface(ctx, name),
    setGlowShown: (on) => setGlowShown(ctx, on),
  });
  return ctx.ops;
};
