// Зона Z2: жизнь загруженной модели — очистка, обмер, посадка своей модели, призрак,
// вписывание в кадр, кадр «в руках» и перелёт камеры к части тела.

import {
  FLIGHT_SECONDS,
  cameraAt,
  cameraPose,
  cameraState,
  nearbyCentre,
  sideDirection,
  viewRadius,
} from "./part-view.js";
import { perfMarksOn, perfMark } from "./gun-scene-pure.js";
import { longAxis, measureFit } from "./gun-fit.js";
import { measureZones } from "./gun-zones.js";
import * as THREE from "three";

// Синус половины вертикального угла камеры: на таком отношении радиус виден целиком.
const halfFov = ({ fov }) => Math.sin((fov * Math.PI) / 360);

const boxSize = (box) => box.getSize(new THREE.Vector3());
const boxCentre = (box) => box.getCenter(new THREE.Vector3());

// Длиннейшая сторона габарита, не меньше одной тысячной.
const longestSide = ({ x, y, z }) => Math.max(x, y, z, 1e-3);

// Всё, что запись материала держит на видеокарте.
const disposeEntry = (ctx, entry) => {
  ctx.textureCache.disposeTexture(entry.sourceMap);
  entry.bakeGeometry?.dispose?.();
  entry.glowTexture?.dispose?.();
  entry.xray?.texture.dispose();
};

// Что стоит на модели сверху: наклейка, призрак, поза, подгонка, украшения.
const dropOverlays = (ctx) => {
  ctx.ops.dropStickerPreview();
  // призрак, который ещё грузится, к этому моменту устарел; готовый уходит вместе с корнем
  ctx.ghostSerial += 1;
  ctx.ghost = null;
  ctx.pose = null;
  ctx.fitGroup = null;
  ctx.poseTempo.reset();
  delete ctx.canvas.dataset.posing;
  ctx.decorations.detach();
};

// Деревья модели и подложки уходят из держателя, записи и кэши освобождаются.
const dropModelTree = (ctx) => {
  const { holder, ops } = ctx;
  holder.remove(ctx.mounted || ctx.root);
  ops.releaseTree(ctx.root);
  if (ctx.underlay) ops.releaseTree(ctx.underlay);
  ctx.underlay = null;
  ctx.hand = null;
  ctx.mounted = null;

  for (const entry of ctx.entries) disposeEntry(ctx, entry);
  ops.stopXrayTimer();
  ctx.clipCache.clear();
  ctx.layouts.clear();
  ctx.detached.clear();
  ctx.detachedVertices.clear();
  ctx.root = null;
  ctx.entries = [];
  ctx.zoneFrame = null;
};

// Убрать модель и всё, что на ней держится. Текстурные ссылки отпускаются по умолчанию;
// load передаёт false и отпускает их позже сам.
const clearModel = (ctx, release = true) => {
  dropOverlays(ctx);
  if (ctx.root) dropModelTree(ctx);
  if (!release) return;
  ctx.textureCache.release(ctx.textureToken);
  ctx.textureToken = null;
};

const cancelFlight = (ctx) => {
  if (ctx.flightFrame) cancelAnimationFrame(ctx.flightFrame);
  ctx.flightFrame = 0;
};

// Ось, каркас зон и плотность развёртки каждой записи; корень стоит в начале осей.
const measureModel = (ctx) => {
  const axis = longAxis(ctx.root);
  ctx.zoneFrame = measureZones(ctx.root, ctx.entries, axis);
  for (const entry of ctx.entries) {
    entry.fit = measureFit(entry.meshes, { mapper: entry.mapper, width: entry.width, height: entry.height, axis });
  }
  return axis;
};

// Корень уходит в начало осей без родителя, призрак снимается. Ответ — функция,
// которая возвращает их на прежние места.
const stepOut = (root, ghost) => {
  const place = root.position.clone();
  const { parent } = root;
  const ghostParent = ghost?.parent;
  root.position.set(0, 0, 0);
  ghost?.removeFromParent();
  parent?.remove(root);
  root.updateMatrixWorld(true);
  return () => {
    root.position.copy(place);
    parent?.add(root);
    ghostParent?.add(ghost);
    root.updateMatrixWorld(true);
  };
};

// Мерка без украшений: на время обмера корень стоит в начале осей, призрака нет.
const measureAtOrigin = (ctx) => {
  const putBack = stepOut(ctx.root, ctx.ghost);
  try {
    measureModel(ctx);
  } finally {
    putBack();
  }
};

const setOwnFit = (ctx, fit) => {
  if (!ctx.fitGroup || !ctx.root || !Array.isArray(fit) || fit.length !== 16) return false;
  ctx.fitGroup.matrix.fromArray(fit);
  measureAtOrigin(ctx);
  ctx.requestRender();
  return true;
};

// Прежние материалы сетки уходят вместе с картами.
const disposeMaterials = (mesh) => {
  for (const material of [].concat(mesh.material)) {
    material?.map?.dispose?.();
    material?.dispose?.();
  }
};

// Дерево призрака невидимо для луча, кисти и наклеек и рисуется поверх модели, на пятой очереди.
const dressGhost = (tree) => {
  const material = new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide,
    depthWrite: false,
    opacity: 0.2,
    transparent: true,
    color: 0x7fdfff,
  });
  const meshes = [];
  tree.traverse((node) => {
    node.userData.astralOverlay = true;
    node.raycast = () => {};
    if (node.isMesh) meshes.push(node);
  });
  for (const mesh of meshes) {
    disposeMaterials(mesh);
    mesh.material = material;
    mesh.renderOrder = 5;
    mesh.frustumCulled = false;
  }
};

// Рамка дерева для хоста; у пустого дерева её нет.
const boundsOf = (tree) => {
  const box = new THREE.Box3().setFromObject(tree);
  if (box.isEmpty()) return null;
  return { min: box.min.toArray(), max: box.max.toArray() };
};

// Прежний призрак уходит из корня и освобождается.
const dropGhost = (ctx) => {
  if (!ctx.ghost) return;
  ctx.ghost.removeFromParent();
  ctx.ops.releaseTree(ctx.ghost);
  ctx.ghost = null;
};

// Загруженное дерево становится призраком в корне модели; ответ — его рамка.
const adoptGhost = (ctx, tree) => {
  dressGhost(tree);
  tree.name = "astral-ghost";
  tree.visible = ctx.ghostShown;
  const bounds = boundsOf(tree);
  ctx.root.add(tree);
  ctx.ghost = tree;
  ctx.requestRender();
  return bounds;
};

const setGhost = async (ctx, url) => {
  const generation = ++ctx.ghostSerial;
  dropGhost(ctx);
  if (!url || !ctx.root) {
    ctx.requestRender();
    return null;
  }
  const { scene: tree } = await ctx.glbLoader.loadAsync(url);
  // пока грузился, призрак заказали заново или модель убрали
  if (generation !== ctx.ghostSerial || !ctx.root) {
    ctx.ops.releaseTree(tree);
    return null;
  }
  return adoptGhost(ctx, tree);
};

const showGhost = (ctx, flag) => {
  ctx.ghostShown = Boolean(flag);
  if (ctx.ghost) ctx.ghost.visible = ctx.ghostShown;
  ctx.requestRender();
};

// Пределы приближения от радиуса вписанной модели.
const limitZoom = (controls, radius, nearest, farthest) => {
  controls.minDistance = radius * nearest;
  controls.maxDistance = radius * farthest;
  controls.update();
};

// Ось ствола в мире без вертикальной составляющей. Ствол торчит вверх или вниз —
// берётся запасная ось вдоль x.
const flatBarrelAxis = (root) => {
  const turn = root.getWorldQuaternion(new THREE.Quaternion());
  const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(turn);
  axis.y = 0;
  if (axis.lengthSq() < 1e-6) return axis.set(1, 0, 0);
  return axis.normalize();
};

// Куда смотрит камера «в руках»: сбоку от ствола на стороне +z, чуть вперёд по стволу и сверху.
const handViewDirection = ({ x, z }) => {
  const side = x < 0 ? -1 : 1;
  return new THREE.Vector3(-z * side * 0.9 + x * 0.35, 0.3, x * side * 0.9 + z * 0.35).normalize();
};

// Ствол «в руках»: камера сбоку, повёрнута к лицу и слегка приподнята.
// Формулы и порядок вычислений не менять: от них зависят последние знаки чисел.
const frameInHand = (ctx) => {
  const { root, camera, controls } = ctx;
  const box = new THREE.Box3().setFromObject(root);
  ctx.bounds = box.clone();
  ctx.span = longestSide(boxSize(box));
  const target = boxCentre(box);

  const direction = handViewDirection(flatBarrelAxis(root));
  const radius = Math.max(ctx.span * 0.5, 0.05) * 2.4;
  camera.position.copy(target).addScaledVector(direction, radius / halfFov(camera));
  controls.target.copy(target);
  limitZoom(controls, radius, 0.2, 10);
  ctx.requestRender();
};

const markFrame = (ctx, size, centre) => {
  perfMark("gun-frame", {
    size: size.toArray(),
    centre: centre.toArray(),
    length: ctx.span,
    camera: ctx.camera.position.toArray(),
    bounds: [ctx.bounds.min.toArray(), ctx.bounds.max.toArray()],
  });
};

// Свободная модель: камера на трёхчетвертном ракурсе, пределы приближения от радиуса.
const frameFree = (ctx, size, centre) => {
  const { camera, controls } = ctx;
  const radius = Math.max(size.length() * 0.5, 0.001);
  const distance = radius / halfFov(camera);
  camera.position.set(distance * 0.35, distance * 0.22, distance * 1.05);
  ctx.fitDistance = camera.position.length();
  controls.target.set(0, 0, 0);
  limitZoom(controls, radius, 0.35, 12);
  if (perfMarksOn()) markFrame(ctx, size, centre);
  ctx.viewMemory.restore();
  ctx.requestRender();
};

// Узел переезжает центром габарита в начало осей; ответ — габарит и прежний центр.
const recentre = (node) => {
  const box = new THREE.Box3().setFromObject(node);
  const size = boxSize(box);
  const centre = boxCentre(box);
  node.position.sub(centre);
  node.updateMatrixWorld(true);
  return { size, centre };
};

const fitModel = (ctx) => {
  const { holder, root } = ctx;
  if (!root) return;
  holder.rotation.set(0, 0, 0);
  holder.scale.setScalar(1);
  holder.updateMatrixWorld(true);

  const { size, centre } = recentre(ctx.mounted || root);
  ctx.bounds = new THREE.Box3().setFromObject(root);
  ctx.span = longestSide(size);

  if (!ctx.hand) {
    frameFree(ctx, size, centre);
    return;
  }
  frameInHand(ctx);
  ctx.viewMemory.restore();
};

// Камера и цель встают в позу, управление и кадр обновляются.
const settleCamera = (ctx, { position, target }) => {
  ctx.camera.position.fromArray(position);
  ctx.controls.target.fromArray(target);
  ctx.controls.update();
  ctx.requestRender();
};

// Пока идут кадры анимации, камера едет из нынешней позы к цели; время идёт от первого заказа.
const animateFlight = (ctx, goal) => {
  const began = performance.now();
  const from = cameraState(ctx.controls.target.toArray(), ctx.camera.position.toArray());
  const step = (now) => {
    ctx.flightFrame = 0;
    const elapsed = Math.max(0, (now - began) / 1000);
    settleCamera(ctx, cameraAt(from, goal, elapsed));
    if (elapsed < FLIGHT_SECONDS) ctx.flightFrame = requestAnimationFrame(step);
  };
  ctx.flightFrame = requestAnimationFrame(step);
};

// Перелёт или мгновенная постановка, если анимации нет или человек просил без неё.
const flyCamera = (ctx, goal, instant) => {
  cancelFlight(ctx);
  if (instant || typeof requestAnimationFrame !== "function") {
    settleCamera(ctx, cameraPose(goal));
    return;
  }
  animateFlight(ctx, goal);
};

// Перелёт на расстояние радиуса от цели, против направления взгляда.
const flyToward = (ctx, { target, direction, radius }, instant) => {
  const reach = radius / halfFov(ctx.camera);
  const position = target.map((value, axis) => value + direction[axis] * reach);
  flyCamera(ctx, cameraState(target, position), instant);
};

// Имя материала в нижнем регистре; безымянный даёт пустую строку.
const lowerName = (material) => String(material?.name || "").toLowerCase();

// Сетки, у которых хотя бы один материал назван из списка.
const meshesNamed = (root, wanted) => {
  const found = [];
  root.traverse((node) => {
    if (!node.isMesh) return;
    const materials = [].concat(node.material);
    if (materials.some((material) => wanted.has(lowerName(material)))) found.push(node);
  });
  return found;
};

// Положение вершины в мире; у скинованных сеток — с учётом костей.
const worldPoint = (mesh, index) => {
  const point = new THREE.Vector3();
  if (mesh.getVertexPosition) mesh.getVertexPosition(index, point);
  else point.fromBufferAttribute(mesh.geometry.attributes.position, index);
  return point.applyMatrix4(mesh.matrixWorld);
};

// Нормаль вершины в мире; у сетки без нормалей — нулевой вектор.
const worldNormal = (normals, index, normalMatrix) => {
  const direction = new THREE.Vector3();
  if (!normals) return direction;
  return direction.fromBufferAttribute(normals, index).applyMatrix3(normalMatrix).normalize();
};

// Образцы вершин одной сетки: место на листе, точка и нормаль в мире.
const sampleMesh = (mesh) => {
  const { position, uv, normal } = mesh.geometry.attributes;
  if (!position || !uv) return [];
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  // у тяжёлых сеток берётся каждая вторая вершина
  const stride = position.count > 12000 ? 2 : 1;
  const samples = [];
  for (let index = 0; index < position.count; index += stride) {
    samples.push({
      u: uv.getX(index),
      v: uv.getY(index),
      position: worldPoint(mesh, index).toArray(),
      normal: worldNormal(normal, index, normalMatrix).toArray(),
    });
  }
  return samples;
};

const boxAround = (nodes) => {
  const box = new THREE.Box3();
  for (const node of nodes) box.expandByObject(node);
  return box;
};

// Точка листа, к которой летим: центр ближайших к (u; v) образцов. Нет места на листе — нет точки.
const spotAt = (meshes, at) => {
  if (!at || !Number.isFinite(at.u) || !Number.isFinite(at.v)) return null;
  return nearbyCentre(meshes.flatMap(sampleMesh), at);
};

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// Цель, направление взгляда и радиус кадра для части: зона вокруг сеток и, если задано, точка на листе.
const partView = (root, meshes, { side, at, fraction }) => {
  const zone = boxAround(meshes);
  const zoneCentre = boxCentre(zone);
  const spot = spotAt(meshes, at);
  // зона правее середины всей модели смотрит наружу вправо, левее — влево
  const outsideSign = zoneCentre.x - boxCentre(new THREE.Box3().setFromObject(root)).x;
  const { x, y, z } = boxSize(zone);
  return {
    target: spot ? spot.centre : zoneCentre.toArray(),
    direction: sideDirection({ outsideSign, side, normal: spot?.normal || null }),
    radius: viewRadius(Math.max(x, y, z), spot ? fraction : 1),
  };
};

const focusPart = (ctx, part) => {
  const { materials: names = [], side = "front", at = null, fraction = 1 } = part;
  if (!ctx.root) return false;
  const wanted = new Set(names.map((name) => `${name}`.toLowerCase()));
  ctx.holder.rotation.set(0, 0, 0);
  ctx.holder.updateMatrixWorld(true);
  ctx.root.updateMatrixWorld(true);

  const meshes = meshesNamed(ctx.root, wanted);
  if (!meshes.length) return false;
  flyToward(ctx, partView(ctx.root, meshes, { side, at, fraction }), reducedMotion());
  return true;
};

export const attachModelZone = (ctx) => {
  ctx.controls.addEventListener("start", () => cancelFlight(ctx));
  ctx.flightFrame = 0;
  // frameModel и focusPart меряют по самой модели, без слоя украшений
  Object.assign(ctx.ops, {
    clearModel: (release = true) => clearModel(ctx, release),
    cancelFlight: () => cancelFlight(ctx),
    measureModel: () => measureModel(ctx),
    setOwnFit: (fit) => setOwnFit(ctx, fit),
    setGhost: (url) => setGhost(ctx, url),
    showGhost: (flag) => showGhost(ctx, flag),
    frameModel: () => ctx.ops.withoutDecorations(() => fitModel(ctx)),
    fitModel: () => fitModel(ctx),
    focusPart: (part = {}) => ctx.ops.withoutDecorations(() => focusPart(ctx, part)),
  });
  return ctx.ops;
};
