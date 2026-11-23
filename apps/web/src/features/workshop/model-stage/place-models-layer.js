/*
 * Свои модели мест в 3D-кадре (ТЗ 11.10.2026, вечер, задача 1; ночь, задачи
 * 1–2: «облегчи … чтобы коннектилось с другими 3D-штучками … легче крутить»).
 *
 * Слой кадра (`orbit-stage.js`): модели работы — сетки в облике, который
 * уедет в игру (та же единичная сетка, что у установщика, поворот «Z·Y·X»,
 * размер, непрозрачность, свечение, движение и живая картинка), и ручки
 * выбранной (`model-gizmo.js`). Мышь:
 *   ЛКМ по модели   — выбрать и тянуть: модель идёт за курсором по плоскости,
 *                     обращённой к камере (влево, вправо, вверх, вниз 1:1,
 *                     дистанция та же; `object-hand-drag.js`), а W и S, пока
 *                     кнопка зажата, отводят её от камеры и приближают;
 *                     ниже пола она не уходит; с Ctrl — сеткой 0,25 м;
 *     с Shift       — по поверхностям сцены (пол, стены, потолок) и по другим
 *                     своим моделям, с поворотом по нормали (плашка ложится на
 *                     стену, предмет встаёт на пол или на другую модель);
 *                     магнит — к краям и серединам соседних моделей;
 *   ЛКМ по кольцу   — повернуть вокруг нормали поверхности, с Ctrl — по 15°;
 *   ЛКМ по ручке    — точные ручки G · R · S (стрелки, кольца осей, кубики);
 *   ЛКМ мимо        — камера, как во всех кадрах; в полёте — так же: подлетел
 *                     — тянешь;
 *   [ и ]           — повернуть на 15° (с Shift — на 90°), Delete — убрать.
 * Средняя кнопка — общего кадра (выбрать то, что под курсором): слой отвечает
 * только `modelAt` — какая модель под курсором.
 *
 * Модель меняет облик без пересборки сетки: размер, место и поворот — у
 * объекта, сетка пересобирается только сменой формы, картинки или толщины.
 */

import * as THREE from "three";
import {
  placeModelAnimationFrameAt,
  placeModelAnimationShift,
  placeModelFacing,
  placeModelLift,
  placeModelSpin,
  placeModelSurfaceKind,
  placeModelSurfaceRotation,
  placeModelTurnAround,
} from "@modovik/climb-contract/recolor/place-models";
import { createModelGizmo } from "./model-gizmo.js";
import { createHandDrag } from "./object-hand-drag.js";
import { pickSurface } from "./pick-surface.js";

const GUIDE = 0x7ad7ff;
const DEG = Math.PI / 180;
/* Зазор от стены и потолка: плашка не мерцает, слившись со стеной. */
const GAP = 0.02;
const GRID = 0.25;
/* Магнит к краям соседей — столько пикселей экрана. */
const MAGNET_PX = 10;
/* Протяжка по поверхностям — не чаще раза в 16 мс: луч по большой сцене дорог. */
const MOVE_EVERY = 16;
/* Сдвиг указателя дальше этого (px) — протяжка, а не щелчок «по стене». */
const PLACE_CLICK_PX = 4;
/* Клавиши глубины, пока модель в руке: W — от камеры, S — к камере. */
const DEPTH_KEYS = { KeyW: 1, KeyS: -1 };

const round2 = (value) => Math.round(value * 100) / 100 + 0;
const round3 = (value) => Math.round(value * 1000) / 1000 + 0;

function geometryOf(unit) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(unit.positions, 3),
  );
  geometry.setAttribute("normal", new THREE.BufferAttribute(unit.normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(unit.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(unit.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Слой: `{ set, setSelection, setHandlers, update, carry, moving, beforeRender,
 * grab, modelAt, meshOf, spotAhead, floorBelow, dispose }`. `parent` — группа сцены
 * кадра, `camera` — камера, `canvas` — холст, `surfaces()` — сетки сцены,
 * `invalidate()` — перерисовать, `kick()` — нужен цикл кадров.
 */
export function createPlaceModelsLayer({
  parent,
  camera,
  canvas,
  /* Высота холста в css-пикселях из кадра (запомнена в его `resize`): ручки одного размера на экране не читают раскладку внутри отрисовки. Нет — читается холст, как прежде. */
  viewHeight = null,
  surfaces = () => [],
  /* Прозрачность листа сцены в точке попадания (`createAlphaSampler`): щелчок в дырку листа идёт к модели за ней. */
  alphaAt = null,
  invalidate = () => {},
  kick = () => {},
  isFlying = () => false,
  onOutline = () => {},
  /* Модель взяли мышью и тянут (`true`) или отпустили (`false`): кадр показывает подсказку про W и S. */
  onHold = () => {},
}) {
  const group = new THREE.Group();
  group.name = "place-models";
  parent.add(group);
  const gizmo = createModelGizmo();
  parent.add(gizmo.object);
  /* Линии магнита: какая грань с какой совпала. */
  const guides = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      color: GUIDE,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    }),
  );
  guides.renderOrder = 998;
  guides.visible = false;
  guides.frustumCulled = false;
  parent.add(guides);

  /* id → { key, holder, mesh, material, item, sheet } */
  const entries = new Map();
  let selected = "";
  let editable = false;
  /* Режим «щелчком по стене» (11.11.2026): следующий щелчок по поверхности ставит выбранную модель на неё — `handlers.onPlace`. */
  let placing = false;
  let handlers = {};
  let drag = null;
  let clock = 0;
  const raycaster = new THREE.Raycaster();

  function disposeEntry(entry) {
    entry.mesh.geometry.dispose();
    entry.material.dispose();
    entry.sheet?.dispose();
    group.remove(entry.holder);
  }

  /* Лист модели: у живой картинки — своя копия (свой сдвиг кадра). */
  function sheetOf(entry, item) {
    if (!item.texture || !item.animation) {
      entry.sheet?.dispose();
      entry.sheet = null;
      entry.sheetOf = null;
      return item.texture || null;
    }
    if (entry.sheetOf !== item.texture) {
      entry.sheet?.dispose();
      entry.sheet = item.texture.clone();
      entry.sheet.needsUpdate = true;
      entry.sheetOf = item.texture;
    }
    return entry.sheet;
  }

  function lookOf(entry, item) {
    const material = entry.material;
    const opacity = (item.opacity ?? 100) / 100;
    const glow = (item.glow ?? 0) / 100;
    const sheet = sheetOf(entry, item);
    material.map = sheet;
    material.color.set(sheet ? "#ffffff" : item.colour || "#b8b8b8");
    material.opacity = opacity;
    material.transparent = opacity < 1 || Boolean(item.alpha);
    material.alphaTest = item.alpha ? 0.04 : 0;
    material.side = item.shape === "plate" ? THREE.DoubleSide : THREE.FrontSide;
    material.emissive.set(glow > 0 ? "#ffffff" : "#000000");
    material.emissiveMap = glow > 0 ? sheet : null;
    material.emissiveIntensity = glow * 1.6;
    material.depthWrite = opacity >= 1;
    material.needsUpdate = true;
    showFrame(entry, clock);
  }

  /* Кадр живой картинки к моменту `seconds`. */
  function showFrame(entry, seconds) {
    const animation = entry.item?.animation;
    if (!animation || !entry.sheet) return;
    const [du, dv] = placeModelAnimationShift(
      animation,
      placeModelAnimationFrameAt(animation, seconds),
    );
    if (entry.sheet.offset.x !== du || entry.sheet.offset.y !== dv) {
      entry.sheet.offset.set(du, dv);
      return true;
    }
    return false;
  }

  /* Место, поворот и размер — объекту; движение — держателю. */
  function placeOf(entry, item) {
    entry.mesh.rotation.set(
      item.rotation[0] * DEG,
      item.rotation[1] * DEG,
      item.rotation[2] * DEG,
      "ZYX",
    );
    entry.mesh.scale.setScalar(item.size);
    entry.base = new THREE.Vector3(...item.position);
    entry.holder.position.copy(entry.base);
    entry.holder.rotation.set(0, 0, 0);
  }

  /**
   * Модели кадра: `[{ id, key, unit, texture, colour, alpha, shape,
   * position, rotation, normal, size, opacity, glow, motion, animation }]` —
   * `unit` — единичная сетка (`placeModelUnitMesh`), `key` — что её задаёт
   * (сменился — сетка новая), `motion` — `placeModelMotion` договора,
   * `animation` — живая картинка (`normalizePlaceModelAnimation`).
   */
  function set(list) {
    const wanted = new Set();
    for (const item of list || []) {
      if (!item?.unit) continue;
      wanted.add(item.id);
      let entry = entries.get(item.id);
      if (entry && entry.key !== item.key) {
        disposeEntry(entry);
        entries.delete(item.id);
        entry = null;
      }
      if (!entry) {
        const material = new THREE.MeshStandardMaterial({
          roughness: 0.6,
          metalness: 0.05,
        });
        const mesh = new THREE.Mesh(geometryOf(item.unit), material);
        /* Тень модели не считается: карта теней кадра стоит, пока сцена не
           меняется, а модель двигают и крутят на каждом кадре. */
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.userData.placeModel = item.id;
        const holder = new THREE.Group();
        holder.add(mesh);
        group.add(holder);
        entry = { key: item.key, holder, mesh, material, sheet: null };
        entries.set(item.id, entry);
      }
      entry.item = item;
      lookOf(entry, item);
      if (!(drag && drag.id === item.id)) placeOf(entry, item);
    }
    for (const [id, entry] of entries)
      if (!wanted.has(id)) {
        disposeEntry(entry);
        entries.delete(id);
      }
    refreshSelection();
    invalidate();
    kick();
  }

  function refreshSelection() {
    const entry = entries.get(selected);
    const item = entry?.item;
    gizmo.setTarget(
      editable && item
        ? {
            position: item.position,
            rotation: item.rotation,
            size: item.size,
            normal: item.normal,
          }
        : null,
    );
    /* Выбранная модель — штрихами и контуром кадра, как всё выбранное. */
    onOutline(entry ? entry.mesh : null);
  }

  /** Выбранная модель (`""` — нет), можно ли её тянуть, род ручек. */
  function setSelection(id, { canEdit = true, mode = null, placing: place = false } = {}) {
    selected = id || "";
    editable = Boolean(canEdit);
    placing = Boolean(place) && editable && Boolean(selected);
    canvas.style.cursor = placing ? "crosshair" : "";
    if (mode) gizmo.setMode(mode);
    refreshSelection();
    invalidate();
  }

  /** `{ onSelect(id), onDeselect(), onTransform(id, values, phase), onMode(mode), onDelete(id) }`. */
  function setHandlers(next) {
    handlers = next || {};
  }

  /* --- Движение и живая картинка --- */

  function moving() {
    /* Модель в руке едет, пока зажата W или S. */
    if (drag?.kind === "body" && (drag.depth.KeyW || drag.depth.KeyS)) return true;
    for (const entry of entries.values())
      if (entry.item?.motion?.period || (entry.item?.animation && entry.sheet))
        return true;
    return false;
  }

  function update(seconds) {
    clock = seconds;
    for (const [id, entry] of entries) {
      showFrame(entry, seconds);
      const motion = entry.item?.motion;
      if (!motion?.period || (drag && drag.id === id)) continue;
      const { lift, angle } = motion.at(seconds);
      entry.holder.position.set(
        entry.base.x,
        entry.base.y,
        entry.base.z + lift,
      );
      entry.holder.rotation.z = angle;
    }
  }

  /** Перед кадром: ручки — одного размера на экране. */
  function beforeRender() {
    gizmo.update(
      camera,
      (viewHeight ? viewHeight() : canvas.getBoundingClientRect().height) || canvas.height,
    );
  }

  /* --- Лучи --- */

  function rayAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    camera.updateMatrixWorld();
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray.clone();
  }
  const rayOf = (event) => rayAt(event.clientX, event.clientY);

  function screenOf(point) {
    const rect = canvas.getBoundingClientRect();
    const projected = new THREE.Vector3(...point).project(camera);
    return [
      rect.left + ((projected.x + 1) / 2) * rect.width,
      rect.top + ((1 - projected.y) / 2) * rect.height,
    ];
  }

  const sceneMeshes = () =>
    surfaces().filter((mesh) => mesh.visible && mesh.material?.visible);

  /*
   * Модель под лучом, если она ближе поверхностей сцены. Поверхности — те же, что берёт щелчок по сцене (`pick-surface.js`): стекло, наклейка, тень и прозрачный край листа
   * луч пропускают, — иначе модель за стеклом или за сеткой нельзя взять, хотя её видно.
   */
  function modelHit(ray) {
    /* Места моделей — свежие и без кадра (протяжка, тесты): лучу нужны их матрицы. */
    group.updateMatrixWorld(true);
    raycaster.ray.copy(ray);
    const meshes = [...entries.values()].map((entry) => entry.mesh);
    const hit = meshes.length
      ? raycaster.intersectObjects(meshes, false)[0]
      : null;
    if (!hit) return null;
    const { hit: scene } = pickSurface(raycaster, surfaces(), { alphaAt });
    if (scene && scene.distance < hit.distance - 0.05) return null;
    return { id: hit.object.userData.placeModel, point: hit.point.clone() };
  }
  const modelUnder = (ray) => modelHit(ray)?.id || null;

  /**
   * Поверхность под лучом — сцена (без сквозных сеток) и свои модели, кроме
   * `except`: `{ point, normal, model }` или `null`. Нормаль — к лучу.
   */
  function surfaceUnder(ray, { except = "", models = true } = {}) {
    if (models) group.updateMatrixWorld(true);
    raycaster.ray.copy(ray);
    const targets = sceneMeshes().filter((mesh) => !mesh.userData.through);
    if (models)
      for (const [id, entry] of entries)
        if (id !== except) targets.push(entry.mesh);
    const hit = raycaster.intersectObjects(targets, false)[0];
    if (!hit) return null;
    const normal = hit.face
      ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
      : new THREE.Vector3(0, 0, 1);
    if (normal.dot(ray.direction) > 0) normal.negate();
    return {
      point: hit.point.clone(),
      normal,
      model: hit.object.userData.placeModel || "",
    };
  }

  /* Сколько метров — `px` пикселей экрана на расстоянии `point`. */
  function metresPerPixels(point, px) {
    const rect = canvas.getBoundingClientRect();
    const distance = camera.position.distanceTo(point);
    const fov = THREE.MathUtils.degToRad(camera.fov || 50);
    return (
      (2 * distance * Math.tan(fov / 2) * px) /
      Math.max(200, rect.height || 600)
    );
  }

  /* --- Прилипание --- */

  /*
   * Модель `entry` на поверхности: поворот по нормали (поворот вокруг неё
   * сохраняется, пока род поверхности тот же; на новом роде — лицом к
   * камере на полу и потолке, ровно на стене) и середина — на опорной
   * стороне над точкой.
   */
  function onSurface(entry, surface, keep) {
    const normal = surface.normal.toArray().map(round3);
    const kind = placeModelSurfaceKind(normal);
    const spin =
      keep && keep.kind === kind
        ? keep.spin
        : placeModelFacing(
            normal,
            surface.point.toArray(),
            camera.position.toArray(),
          );
    const rotation = placeModelSurfaceRotation(normal, spin);
    const item = { ...entry.item, rotation, normal };
    const lift =
      placeModelLift(item, entry.item.unit, normal) +
      (kind === "floor" ? 0 : GAP);
    const position = surface.point
      .clone()
      .addScaledVector(surface.normal, lift)
      .toArray();
    return { position, rotation, normal, kind, spin };
  }

  /* Рамка модели `entry` с местом и поворотом `values` (без движения клипа). */
  function boxWith(entry, values) {
    entry.mesh.rotation.set(
      values.rotation[0] * DEG,
      values.rotation[1] * DEG,
      values.rotation[2] * DEG,
      "ZYX",
    );
    entry.mesh.scale.setScalar(values.size ?? entry.item.size);
    entry.holder.position.set(...values.position);
    entry.holder.rotation.set(0, 0, 0);
    entry.holder.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(entry.mesh);
  }

  /*
   * Магнит: края и середины рамки модели — к краям и серединам соседей, по
   * осям вдоль поверхности (от поверхности модель не отрывается). Ответ —
   * сдвиг и линии совпадений.
   */
  function magnet(entry, values, normal) {
    const box = boxWith(entry, values);
    const centre = box.getCenter(new THREE.Vector3());
    const reach = metresPerPixels(centre, MAGNET_PX);
    const shift = [0, 0, 0];
    const lines = [];
    const others = [...entries.entries()]
      .filter(([id]) => id !== drag?.id)
      .map(([, other]) => {
        other.holder.updateMatrixWorld(true);
        return new THREE.Box3().setFromObject(other.mesh);
      })
      .filter((other) => !other.isEmpty());
    for (let axis = 0; axis < 3; axis += 1) {
      if (Math.abs(normal[axis]) > 0.5) continue;
      const own = [
        box.min.getComponent(axis),
        centre.getComponent(axis),
        box.max.getComponent(axis),
      ];
      let best = null;
      for (const other of others) {
        const middle = other.getCenter(new THREE.Vector3());
        const theirs = [
          other.min.getComponent(axis),
          middle.getComponent(axis),
          other.max.getComponent(axis),
        ];
        for (const a of own)
          for (const b of theirs) {
            const delta = b - a;
            if (
              Math.abs(delta) <= reach &&
              (!best || Math.abs(delta) < Math.abs(best.delta))
            )
              best = { delta, at: b, to: middle };
          }
      }
      if (!best) continue;
      shift[axis] = best.delta;
      const from = centre.clone();
      from.setComponent(axis, best.at);
      const to = best.to.clone();
      to.setComponent(axis, best.at);
      lines.push(from, to);
    }
    return { shift, lines };
  }

  function showGuides(lines) {
    guides.visible = lines.length > 0;
    if (!lines.length) return;
    guides.geometry.setFromPoints(lines);
    guides.geometry.computeBoundingSphere();
  }

  /* Сетка 0,25 м — по осям вдоль поверхности. */
  const onGrid = (position, normal) =>
    position.map((value, axis) =>
      Math.abs(normal[axis]) > 0.5 ? value : Math.round(value / GRID) * GRID,
    );

  const values = (entry, position, extra = {}) => ({
    position: position.map(round2),
    rotation: [...(extra.rotation || entry.item.rotation)],
    normal: [...(extra.normal || entry.item.normal || [0, 0, 1])],
    size: entry.item.size,
  });

  /*
   * Вещь в руке (`object-hand-drag.js`): по плоскости, обращённой к камере, 1:1 под курсором. Отсчёт — от того места, где курсор держит
   * модель сейчас (точка захвата `grip` на модели), поэтому она не прыгает ни при первом движении, ни когда отпустили Shift.
   */
  function handOf(entry, ray) {
    if (!drag.free) {
      const base = new THREE.Vector3(...entry.item.position);
      const hand = createHandDrag(camera, base.clone().add(drag.grip));
      /* Отсчёт — от прошлого места курсора (нажатие или прошлое движение), а не от нынешнего: сдвиг до первого шага не теряется. */
      const from = rayAt(drag.pointer[0], drag.pointer[1]) || ray;
      drag.free = { hand, hit0: (hand.follow(from) || hand.start).clone(), base };
    }
    return drag.free;
  }

  /*
   * Не ниже пола: рамка модели после сдвига, что вышла под поверхность под собой, поднимается на неё, а не уходит сквозь. Луч вниз — от
   * верха рамки до сдвига и после: быстрый рывок вниз не проскакивает пол. Нет поверхности под ней — ограничения нет.
   */
  function keepAboveFloor(entry, position) {
    entry.holder.updateMatrixWorld(true);
    const top = new THREE.Box3().setFromObject(entry.mesh).max.z;
    const box = boxWith(entry, {
      position,
      rotation: entry.item.rotation,
      size: entry.item.size,
    });
    const centre = box.getCenter(new THREE.Vector3());
    const floor = floorBelow([centre.x, centre.y, Math.max(top, box.max.z)]);
    placeOf(entry, entry.item);
    if (floor !== null && box.min.z < floor) position[2] += floor - box.min.z;
  }

  /* Протяжка тела модели: по умолчанию — вещь в руке, с Shift — по поверхностям. */
  function bodyMove(entry, event, ray) {
    if (!event.shiftKey) {
      showGuides([]);
      const free = handOf(entry, ray);
      const point = free.hand.follow(ray);
      if (!point) return null;
      const delta = point.clone().sub(free.hit0).toArray();
      if (event.ctrlKey)
        for (let axis = 0; axis < 3; axis += 1)
          delta[axis] = Math.round(delta[axis] / GRID) * GRID;
      const position = free.base.toArray().map((value, axis) => value + delta[axis]);
      keepAboveFloor(entry, position);
      return values(entry, position);
    }
    drag.free = null;
    /* Луч — из точки опоры модели, а не из-под пальца: модель не прыгает к курсору. */
    const aimed =
      rayAt(event.clientX + drag.offset[0], event.clientY + drag.offset[1]) ||
      ray;
    const surface = surfaceUnder(aimed, { except: drag.id });
    if (!surface) return null;
    const placed = onSurface(entry, surface, drag.keep);
    drag.keep = { kind: placed.kind, spin: placed.spin };
    let position = placed.position;
    if (event.ctrlKey) position = onGrid(position, placed.normal);
    const pulled = magnet(
      entry,
      { position, rotation: placed.rotation },
      placed.normal,
    );
    position = position.map((value, axis) => value + pulled.shift[axis]);
    showGuides(pulled.lines);
    return values(entry, position, {
      rotation: placed.rotation,
      normal: placed.normal,
    });
  }

  /* --- Мышь --- */

  /* Новое место модели в кадре и в редакторе: пока тянут — модель стоит на месте, без движения клипа. */
  function commitMove(entry, next) {
    entry.item = { ...entry.item, ...next };
    placeOf(entry, entry.item);
    refreshSelection();
    /* Подсказка про W и S — когда модель пошла за рукой, а не на простом щелчке. */
    if (!drag.started && drag.kind === "body") onHold(true);
    handlers.onTransform?.(drag.id, next, drag.started ? "move" : "start");
    drag.started = true;
    invalidate();
  }

  /*
   * Каждый кадр цикла: зажатые W и S ведут модель в руке по лучу курсора (глубина, `object-hand-drag.js`), хотя мышь стоит. Те же шаги
   * истории, что у мыши: отмена снимает протяжку целиком вместе с W и S внутри неё. С Shift (по поверхностям) глубины нет.
   */
  function carry(dt) {
    if (drag?.kind !== "body" || drag.event.shiftKey) return;
    const push = (drag.depth.KeyW ? 1 : 0) - (drag.depth.KeyS ? 1 : 0);
    if (!push) return;
    const entry = entries.get(drag.id);
    const ray = rayAt(drag.event.clientX, drag.event.clientY);
    if (!entry || !ray) return;
    handOf(entry, ray).hand.push(push, dt);
    const next = bodyMove(entry, drag.event, ray);
    if (next) commitMove(entry, next);
  }

  const grab = {
    test(event) {
      if (event.button !== 0) return false;
      const ray = rayOf(event);
      if (!ray) return false;
      const handle = editable && selected ? gizmo.hit(ray) : null;
      if (handle) {
        const entry = entries.get(selected);
        const view = new THREE.Vector3();
        camera.getWorldDirection(view);
        const centre = screenOf(entry.item.position);
        if (
          !gizmo.begin(handle, ray, {
            view,
            pointer: [event.clientX, event.clientY],
            centre,
          })
        )
          return false;
        /* Размер меняется от опоры: низ модели остаётся на поверхности. */
        const normal = entry.item.normal || [0, 0, 1];
        drag = {
          id: selected,
          kind: "gizmo",
          started: false,
          base: {
            position: [...entry.item.position],
            size: entry.item.size,
            normal,
          },
          lift: placeModelLift(entry.item, entry.item.unit, normal),
        };
        return true;
      }
      /*
       * «Щелчком по стене»: щелчок по поверхности в кадре ставит выбранную модель на неё (по нормали, отступ 2 см). Ручки модели — раньше (их тянут и в этом режиме);
       * протяжка мимо (камера, `ПКМ`) щелчком не считается: режим включён у только что добавленной модели, и первый же поворот кадра не должен её унести.
       */
      if (placing) {
        const surface = surfaceUnder(ray, { except: selected });
        if (surface) {
          drag = {
            id: selected,
            kind: "place",
            started: false,
            start: [event.clientX, event.clientY],
            moved: false,
            spot: {
              point: surface.point.toArray().map(round3),
              normal: surface.normal.toArray().map(round3),
              eye: camera.position.toArray().map(round3),
            },
          };
          return true;
        }
      }
      const found = modelHit(ray);
      if (!found) return false;
      const id = found.id;
      /* Выбранная, но без ручек (взят другой инструмент), тоже идёт редактору: щелчок должен открыть её, а не молчать. */
      if (id !== selected || !editable) handlers.onSelect?.(id);
      selected = id;
      refreshSelection();
      const entry = entries.get(id);
      if (!editable || !entry) {
        drag = { id, kind: "select", started: false };
        return true;
      }
      /* Точка опоры (середина опорной стороны) на экране — от неё ведётся луч. */
      const normal = new THREE.Vector3(...(entry.item.normal || [0, 0, 1]));
      const foot = new THREE.Vector3(...entry.item.position).addScaledVector(
        normal,
        -placeModelLift(
          entry.item,
          entry.item.unit,
          entry.item.normal || [0, 0, 1],
        ),
      );
      const [fx, fy] = screenOf(foot.toArray());
      drag = {
        id,
        kind: "body",
        offset: [fx - event.clientX, fy - event.clientY],
        pointer: [event.clientX, event.clientY],
        /* Где модель схвачена — вектор от её середины; последнее движение мыши и зажатые W и S (`carry`). */
        grip: found.point.clone().sub(new THREE.Vector3(...entry.item.position)),
        event: { clientX: event.clientX, clientY: event.clientY, shiftKey: false, ctrlKey: false },
        depth: { KeyW: false, KeyS: false },
        keep: {
          kind: placeModelSurfaceKind(entry.item.normal || [0, 0, 1]),
          spin: placeModelSpin(
            entry.item.rotation,
            entry.item.normal || [0, 0, 1],
          ),
        },
        free: null,
        started: false,
        last: 0,
        timer: 0,
      };
      return true;
    },
    onStart() {
      canvas.style.cursor = "grabbing";
    },
    onMove(event) {
      if (!drag || drag.kind === "select") return;
      if (drag.kind === "place") {
        if (Math.hypot(event.clientX - drag.start[0], event.clientY - drag.start[1]) > PLACE_CLICK_PX) drag.moved = true;
        return;
      }
      if (drag.kind === "body") {
        /* Луч по большой сцене дорог: не чаще раза в кадр, последнее движение — следом. */
        const now = performance.now();
        if (now - drag.last < MOVE_EVERY) {
          const pending = {
            clientX: event.clientX,
            clientY: event.clientY,
            shiftKey: event.shiftKey,
            ctrlKey: event.ctrlKey,
          };
          clearTimeout(drag.timer);
          drag.timer = setTimeout(() => grab.onMove(pending), MOVE_EVERY);
          return;
        }
        drag.last = now;
      }
      const entry = entries.get(drag.id);
      const ray = rayOf(event);
      if (!entry || !ray) return;
      let next = null;
      if (drag.kind === "gizmo") {
        next = gizmo.drag(ray, {
          snap: event.ctrlKey,
          pointer: [event.clientX, event.clientY],
        });
        if (next && gizmo.kind === "scale" && drag.base?.size) {
          const grow = next.size / drag.base.size - 1;
          next.position = drag.base.position.map((value, axis) =>
            round2(value + drag.base.normal[axis] * drag.lift * grow),
          );
        }
      } else next = bodyMove(entry, event, ray);
      if (!next) return;
      commitMove(entry, next);
      if (drag.kind === "body") {
        drag.pointer = [event.clientX, event.clientY];
        drag.event = {
          clientX: event.clientX,
          clientY: event.clientY,
          shiftKey: Boolean(event.shiftKey),
          ctrlKey: Boolean(event.ctrlKey),
        };
      }
    },
    /* W — от камеры, S — к камере, пока модель в руке; `true` — клавишу взяли (камера её не слышит, пока она зажата). */
    onKey(code, down) {
      if (drag?.kind !== "body" || !(code in DEPTH_KEYS)) return false;
      drag.depth[code] = down;
      if (down) kick();
      return true;
    },
    onEnd() {
      if (drag?.timer) clearTimeout(drag.timer);
      /* Щелчок, а не протяжка: модель встаёт на поверхность, режим снимается (протяжка — режим остаётся, курсор-прицел тоже). */
      const spot = drag?.kind === "place" && !drag.moved && placing ? drag.spot : null;
      if (spot) placing = false;
      if (drag?.kind === "gizmo") gizmo.end();
      if (drag?.started) handlers.onTransform?.(drag.id, null, "end");
      if (drag?.started && drag.kind === "body") onHold(false);
      drag = null;
      showGuides([]);
      canvas.style.cursor = placing ? "crosshair" : "";
      grabCursor = false;
      update(clock);
      invalidate();
      kick();
      if (spot) handlers.onPlace?.(spot);
    },
    onHover(event) {
      if (!entries.size) return;
      const ray = rayOf(event);
      const handle = ray && editable && selected ? gizmo.hit(ray) : null;
      if (handle !== hovered) {
        hovered = handle;
        gizmo.setHover(handle);
        invalidate();
      }
      const over = Boolean(handle || (ray && modelUnder(ray)));
      /* Курсор — только свой: чужой (эмблема в руке) слой не сбивает. */
      if (over !== grabCursor) {
        grabCursor = over;
        canvas.style.cursor = over ? "grab" : "";
      }
    },
  };
  let hovered = null;
  let grabCursor = false;

  /* Повернуть выбранную вокруг нормали её поверхности — одним шагом истории. */
  function turnSelected(degrees) {
    const entry = entries.get(selected);
    if (!entry || !editable) return;
    const next = {
      position: [...entry.item.position],
      rotation: placeModelTurnAround(
        entry.item.rotation,
        entry.item.normal || [0, 0, 1],
        degrees,
      ),
      normal: [...(entry.item.normal || [0, 0, 1])],
      size: entry.item.size,
    };
    entry.item = { ...entry.item, ...next };
    placeOf(entry, entry.item);
    refreshSelection();
    handlers.onTransform?.(selected, next, "start");
    handlers.onTransform?.(selected, null, "end");
    invalidate();
  }

  const onKeyDown = (event) => {
    if (event.altKey || event.metaKey || !selected) return;
    /* Esc в режиме «щелчком по стене» отменяет его, а не снимает выбор. */
    if (event.code === "Escape" && placing) {
      event.preventDefault();
      placing = false;
      canvas.style.cursor = "";
      handlers.onPlaceCancel?.();
      return;
    }
    /* Esc снимает выбор, как у вещей сцены; модель остаётся на месте. */
    if (event.code === "Escape" && editable) {
      event.preventDefault();
      handlers.onDeselect?.();
      return;
    }
    if ((event.code === "Delete" || event.code === "Backspace") && editable) {
      event.preventDefault();
      handlers.onDelete?.(selected);
      return;
    }
    if (
      (event.code === "BracketLeft" || event.code === "BracketRight") &&
      editable &&
      !event.ctrlKey
    ) {
      event.preventDefault();
      const step = event.shiftKey ? 90 : 15;
      turnSelected(event.code === "BracketLeft" ? step : -step);
      return;
    }
    /* Буквы в полёте — его (W A S D, Q и E, S — назад); размер — на T, чтобы
       S не уводила в масштаб, а летела назад (полёт включают сами W A S D). */
    if (isFlying() || event.ctrlKey) return;
    const modes = { KeyG: "move", KeyR: "rotate", KeyT: "scale" };
    if (modes[event.code]) {
      event.preventDefault();
      /* Та же клавиша второй раз — снова «Ставить». */
      const next =
        gizmo.mode === modes[event.code] ? "place" : modes[event.code];
      gizmo.setMode(next);
      handlers.onMode?.(next);
      invalidate();
    }
  };
  canvas.addEventListener("keydown", onKeyDown);

  /** Своя модель под точкой экрана (`id`) или `null` — для выбора колесом. */
  function modelAt(clientX, clientY) {
    if (!entries.size) return null;
    const ray = rayAt(clientX, clientY);
    return ray ? modelUnder(ray) || null : null;
  }

  /** Сетка своей модели `id` — подсветить её при наведении, как вещи сцены. */
  const meshOf = (id) => entries.get(id)?.mesh || null;

  /** Точка поверхности под серединой экрана (сцена и свои модели) или перед камерой — для новой модели. */
  function spotAhead(distance = 8) {
    camera.updateMatrixWorld();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const ray = raycaster.ray.clone();
    const surface = surfaceUnder(ray);
    const eye = camera.position.toArray();
    if (surface)
      return {
        point: surface.point.toArray(),
        normal: surface.normal.toArray(),
        eye,
      };
    return {
      point: ray.at(distance, new THREE.Vector3()).toArray(),
      normal: null,
      eye,
    };
  }

  /** Поверхность под точкой (луч вниз): высота или `null`. */
  function floorBelow(point) {
    const ray = new THREE.Ray(
      new THREE.Vector3(point[0], point[1], point[2] + 0.05),
      new THREE.Vector3(0, 0, -1),
    );
    const surface = surfaceUnder(ray, { models: false });
    return surface ? surface.point.z : null;
  }

  function dispose() {
    canvas.removeEventListener("keydown", onKeyDown);
    if (drag?.timer) clearTimeout(drag.timer);
    for (const entry of entries.values()) disposeEntry(entry);
    entries.clear();
    gizmo.dispose();
    guides.geometry.dispose();
    guides.material.dispose();
    onOutline(null);
    parent.remove(group, guides);
  }

  return {
    set,
    setSelection,
    setHandlers,
    update,
    carry,
    moving,
    beforeRender,
    grab,
    modelAt,
    meshOf,
    spotAhead,
    floorBelow,
    dispose,
    get size() {
      return entries.size;
    },
    get gizmoMode() {
      return gizmo.mode;
    },
    setMode(mode) {
      gizmo.setMode(mode);
      invalidate();
    },
  };
}
