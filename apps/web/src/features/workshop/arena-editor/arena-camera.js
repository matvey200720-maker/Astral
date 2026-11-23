/*
 * Камера к выбранному из меню (слово владельца 30.10.2026: «если я выбирал какой-то объект просто через менюшку, меня камера переводила на него, чтобы я смотрел, а не чтобы он
 * выделялся где-то далеко»). Выбор из списка и плитки инструмента — полотно у арки, экран, табличка, предмет, модель сервера — подводит камеру так, чтобы вещь была видна
 * целиком, спереди и не за стеной; щелчок по вещи в кадре камеру не трогает (он идёт другим путём студии — `onAim`).
 *
 * Куски, не писанные заново: изнутри — перелёт `itemFocus` («Найти в зале»: глаз вокруг вещи, линия взгляда не закрыта стеной) и `insideFocus` кадра («Вернуть камеру» у звезды),
 * снаружи — рамка кадра с центром и видом (`frame` у `ArenaStage`, камера летит к ней — `glide`). Здесь — только где стоять: у полотна — на его лицевой стороне на расстоянии,
 * с которого оно целиком в кадре. Чистые функции без React и three.
 */

import { arenaPanelFaces } from "@modovik/climb-contract/recolor/arena-panels";
import { arenaObjects } from "@modovik/climb-contract/recolor/arena-objects";
import { arenaReplaceable } from "@modovik/climb-contract/recolor/arena-replace";
import { ARENA_SECTIONS, arenaCovers, arenaPlaces, arenaSlotElements } from "@modovik/climb-contract/recolor/arenas";
import { entityBounds, eyeInRoom, itemFocus, lineIsClear } from "./arena-items.js";
import { arenaPortalFocus } from "./arena-text.js";

/* Угол обзора кадра: изнутри — как у «Найти в зале», снаружи — как у кадра (`orbit-stage.js`, `FOV`). */
const INSIDE_FOV = 62;
const OUTSIDE_FOV = 34;
const ASPECT = 1.5;

const sub = (a, b) => a.map((value, axis) => value - b[axis]);
const add = (a, b) => a.map((value, axis) => value + b[axis]);
const scale = (a, by) => a.map((value) => value * by);
const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);

/** В какой сцене стоит раздел: `"inside"` или `"outside"` (по колонке инструментов сервера). */
export const arenaSectionScene = (server, section) => (ARENA_SECTIONS[server]?.outside?.includes(section) ? "outside" : "inside");

/* Грани полотна элемента: лицом наружу, как плашки в кадре (`arenaPanelFaces`). */
const facesOf = (element) => (element?.panel ? arenaPanelFaces(element.panel, 0) : []);

/** Коробка по граням: `{ min, max }`. */
export function facesBox(faces) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const face of faces)
    for (const a of [-1, 1])
      for (const b of [-1, 1]) {
        const corner = add(add(face.point, scale(face.right, (a * face.width) / 2)), scale(face.up, (b * face.height) / 2));
        for (let axis = 0; axis < 3; axis += 1) {
          min[axis] = Math.min(min[axis], corner[axis]);
          max[axis] = Math.max(max[axis], corner[axis]);
        }
      }
  return { min, max };
}

/** Поза глаза `{ eye, yaw, pitch, fov }` на `eye`, взгляд в `target`. */
function poseAt(eye, target, fov) {
  const look = sub(target, eye);
  const span = Math.hypot(...look) || 1;
  return { eye, yaw: Math.atan2(look[0], look[1]), pitch: Math.asin(Math.max(-1, Math.min(1, look[2] / span))), fov };
}

/* Расстояние, с которого полотно `width × height` целиком в кадре с запасом. */
function fitDistance(width, height, fov, aspect = ASPECT) {
  const tan = Math.tan((fov * Math.PI) / 360);
  return Math.max(height / (2 * tan), width / (2 * tan * aspect)) * 1.25 + 0.5;
}

/**
 * Перелёт изнутри к полотну: глаз на его лицевой стороне, на расстоянии, с которого оно целиком в кадре, и там, откуда линию взгляда не закрывает стена. Лицо закрыто
 * со всех подходящих расстояний — как у предмета (`itemFocus`: глаз вокруг и первое свободное место). Несколько граней (место с полотнами, изогнутый экран) — вокруг общей коробки.
 */
export function panelPoseInside(faces, { home = null, asset = null, fov = INSIDE_FOV } = {}) {
  if (!faces.length) return null;
  const box = facesBox(faces);
  const front = faces.length === 1 || faces.every((face) => dot(face.normal, faces[0].normal) > 0.9) ? faces[0] : null;
  if (front) {
    const width = faces.length === 1 ? front.width : box.max.map((value, axis) => value - box.min[axis]).reduce((best, value) => Math.max(best, value), 0);
    const distance = Math.min(60, Math.max(2.2, fitDistance(Math.max(width, front.width), Math.max(front.height, 0.2), fov)));
    const centre = faces.length === 1 ? front.point : box.min.map((value, axis) => (value + box.max[axis]) / 2);
    /* Глаз зала стоит в помещении — и глаз у полотна обязан: за стену или над потолком нормаль полотна не выводит. */
    const room = Boolean(asset && eyeInRoom(asset, home || [0, 0, 1.7]));
    for (const share of [1, 0.75, 0.55]) {
      const eye = add(centre, scale(front.normal, distance * share));
      if (!asset || (lineIsClear(asset, eye, centre, null) && (!room || eyeInRoom(asset, eye)))) return poseAt(eye, centre, fov);
    }
  }
  return itemFocus(home, box, { asset, key: null, fov });
}

/**
 * Рамка снаружи у полотна: `{ centre, yaw, pitch, distance }` — середина, сторона (куда смотрит лицо), лёгкий взгляд сверху и расстояние в метрах; кадр переводит метры в
 * приближение своей рамки (`ArenaStage.frame`).
 */
export function panelViewOutside(faces) {
  if (!faces.length) return null;
  const box = facesBox(faces);
  const main = faces.reduce((best, face) => (face.width * face.height > best.width * best.height ? face : best));
  const centre = box.min.map((value, axis) => (value + box.max[axis]) / 2);
  const size = box.max.map((value, axis) => value - box.min[axis]);
  const width = faces.length > 1 ? Math.hypot(size[0], size[1]) : main.width;
  const height = Math.max(size[2], main.height);
  const [nx, ny] = main.normal;
  return { centre, yaw: Math.atan2(nx, -ny), pitch: 0.12, distance: Math.min(120, Math.max(8, fitDistance(width, height, OUTSIDE_FOV))) };
}

/*
 * Снаружи у полотен нет описи плашек: полотно у арки — сетка в сцене со своим материалом (`splitArenaCloths`: `material.element` — ключ элемента), а объёмные места над входом
 * (буквы, щит, знак) — `arenaCovers` с точкой, стороной и размером. Сторона полотна — от середины фасада наружу: у ткани нормаль двусторонняя.
 */
function outsideViewOfSheets(server, elements, asset) {
  const covers = arenaCovers(server);
  for (const element of elements) {
    const cover = covers.find((entry) => entry.place === element.place)?.cover;
    if (!cover) continue;
    const [nx, ny] = cover.normal;
    return { centre: cover.point, yaw: Math.atan2(nx, -ny), pitch: 0.12, distance: Math.min(120, Math.max(10, fitDistance(cover.width, cover.height, OUTSIDE_FOV))) };
  }
  const keys = new Set(elements.filter((item) => item.cloth).map((item) => item.key));
  /* Белый логотип под надписью — на той же стеле, что и надпись над входом: камера — к главному входу, как у кнопок «Камера». */
  if (!keys.size && elements.some((item) => item.place === "panic")) {
    const portal = arenaPortalFocus(server);
    return portal ? { centre: portal.centre, yaw: portal.yaw, pitch: 0.12, distance: 45 } : null;
  }
  if (!keys.size || !asset?.meshes) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const normal = [0, 0];
  for (const mesh of asset.meshes) {
    if (!keys.has(asset.materials?.[mesh.material]?.element)) continue;
    for (let at = 0; at < mesh.positions.length; at += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], mesh.positions[at + axis]);
        max[axis] = Math.max(max[axis], mesh.positions[at + axis]);
      }
      if (mesh.normals) {
        normal[0] += mesh.normals[at];
        normal[1] += mesh.normals[at + 1];
      }
    }
  }
  if (!Number.isFinite(min[0])) return null;
  const centre = min.map((value, axis) => (value + max[axis]) / 2);
  const size = max.map((value, axis) => value - min[axis]);
  /* Ткань двусторонняя: лицо — то, что смотрит от середины фасада; у арки, стоящей у самой середины, — как нормаль сетки. */
  const facade = asset.parts?.find((part) => (part?.id ?? part) === "facade")?.bounds || asset.bounds;
  const middle = facade ? [0, 1].map((axis) => (facade.min[axis] + facade.max[axis]) / 2) : [centre[0], centre[1]];
  const out = [centre[0] - middle[0], centre[1] - middle[1]];
  const along = Math.hypot(...normal) > 1e-6 ? normal : out;
  const face = dot(along, out) >= 0 ? along : [-along[0], -along[1]];
  const width = Math.hypot(size[0], size[1]);
  return { centre, yaw: Math.atan2(face[0], -face[1]), pitch: 0.12, distance: Math.min(120, Math.max(10, fitDistance(width, Math.max(size[2], 1), OUTSIDE_FOV))) };
}

/* Коробка листов места (элементы без полотна: лист целиком, остров листа): сетки сцены с этими листами. */
function sheetBox(asset, textures) {
  const wanted = new Set(textures);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of asset?.meshes || []) {
    if (!wanted.has(asset.materials?.[mesh.material]?.name)) continue;
    for (let at = 0; at < mesh.positions.length; at += 3)
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], mesh.positions[at + axis]);
        max[axis] = Math.max(max[axis], mesh.positions[at + axis]);
      }
  }
  return Number.isFinite(min[0]) ? { min, max } : null;
}

/* Элементы, о которых говорит выбор: `{ section, key }` — один, `{ section, place }` — все полотна места. */
function elementsOf(server, { section, key, place }) {
  const all = arenaSlotElements(server, section);
  if (key) return all.filter((item) => item.key === key);
  if (place) return all.filter((item) => item.place === place);
  return [];
}

/**
 * Куда подвести камеру по выбору из меню: `{ scene, inside? | outside? }` или `null` (нечего показать: места нет в сцене, листа нет в кадре).
 *   `{ section, key | place }` — полотно, экран, табличка, эмблема, место (все полотна места разом);
 *   `{ section: "replace", key }` — модель сервера (все её места в зале);
 *   `{ item }` — предмет зала по номеру сущности;
 *   `{ box, scene?, normal? }` — своя вещь кадра по её рамке `{ min, max }` (своя модель): снаружи — рамка кадра, иначе — перелёт, как у предмета.
 * `asset` — сцена кадра нужной стороны (для изнутри: линия взгляда и коробки листов), `home` — глаз зала по умолчанию.
 */
export function arenaMenuFocus(server, target, { asset = null, home = null } = {}) {
  if (!target) return null;
  if (target.box) {
    if (target.scene === "outside") return { scene: "outside", outside: boxViewOutside(target.box, target.normal) };
    const inside = itemFocus(home, target.box, { asset, key: null });
    return inside ? { scene: "inside", inside } : null;
  }
  if (Number.isInteger(target.item)) {
    const box = entityBounds(asset).get(target.item);
    const inside = box ? itemFocus(home, box, { asset, key: target.item }) : null;
    return inside ? { scene: "inside", inside } : null;
  }
  const { section } = target;
  const scene = arenaSectionScene(server, section);
  if (section === "replace") {
    const replacement = arenaReplaceable(server, target.key);
    const keys = new Set(arenaObjects(server)?.models.find((model) => model.name === replacement?.model)?.keys || []);
    const boxes = [...keys].map((key) => entityBounds(asset).get(key)).filter(Boolean);
    if (!boxes.length) return null;
    const box = {
      min: [0, 1, 2].map((axis) => Math.min(...boxes.map((item) => item.min[axis]))),
      max: [0, 1, 2].map((axis) => Math.max(...boxes.map((item) => item.max[axis]))),
    };
    const inside = itemFocus(home, box, { asset, key: boxes.length === 1 ? [...keys][0] : null });
    return inside ? { scene: "inside", inside } : null;
  }
  const elements = elementsOf(server, target);
  const faces = elements.flatMap(facesOf);
  if (scene === "outside") {
    const outside = faces.length ? panelViewOutside(faces) : outsideViewOfSheets(server, elements, asset);
    return outside ? { scene, outside } : null;
  }
  if (faces.length) {
    const inside = panelPoseInside(faces, { home, asset });
    return inside ? { scene, inside } : null;
  }
  /* Место без своих полотен (лист зала, остров листа): коробка его листов в кадре. */
  const textures = elements.flatMap((item) => (item.texture ? [item.texture] : arenaPlaces(server, section).find((place) => place.id === item.place)?.textures || []));
  const box = textures.length ? sheetBox(asset, textures) : null;
  const inside = box ? itemFocus(home, box, { asset, key: null }) : null;
  return inside ? { scene, inside } : null;
}

/* Рамка кадра снаружи у вещи по её коробке: сторона — куда смотрит её поверхность (`normal`), на полу — с юга; взгляд чуть сверху. */
function boxViewOutside(box, normal = null) {
  const size = box.max.map((value, axis) => value - box.min[axis]);
  const centre = box.min.map((value, axis) => (value + box.max[axis]) / 2);
  const yaw = normal && Math.hypot(normal[0], normal[1]) > 0.5 ? Math.atan2(normal[0], -normal[1]) : 0;
  return { centre, yaw, pitch: 0.18, distance: Math.min(120, Math.max(8, fitDistance(Math.hypot(size[0], size[1]), Math.max(size[2], 0.2), OUTSIDE_FOV))) };
}

/* Части сцены, что правит инструмент колонки: к ним подводит камеру плитка инструмента (кресла, автоматы, знаки выхода, подсветка). */
const TOOL_PARTS = Object.freeze({ seats: ["seats"], objects: ["vending", "atms", "parking"], exits: ["exits"], lights: ["lights"] });
/* Пол, стены, потолок (владелец 31.10.2026: «камеру меняло, когда тыкаешь»): глаз — вид зала по умолчанию, взгляд ниже, прямо или выше (радианы к его наклону). */
const LOOK_TILT = Object.freeze({ floor: -0.5, walls: 0, ceiling: 0.7 });
/* Коробка инструмента больше этого (метры по диагонали) — на весь зал: к ней не подойти. */
const WHOLE_HALL = 45;

/**
 * Камера к тому, что правит инструмент (плитка «Кресла», «Автоматы», «Знаки выхода», «Подсветка»): коробка его частей сцены целиком, глаз — как у «Найти в зале».
 * «Пол», «Стены», «Потолок» — вид зала по умолчанию (`view` — `{ eye, yaw, pitch }` описи), взгляд вниз, прямо или вверх.
 * `{ scene: "inside", inside }` или `null` (у сервера нет такой части).
 */
export function arenaToolFocus(server, tool, { asset = null, home = null, view = null } = {}) {
  if (Object.hasOwn(LOOK_TILT, tool)) return view?.eye ? { scene: "inside", inside: { eye: view.eye, yaw: view.yaw ?? 0, pitch: (view.pitch ?? 0) + LOOK_TILT[tool], fov: 72 } } : null;
  const ids = TOOL_PARTS[tool];
  const boxes = ids && asset?.parts ? asset.parts.filter((part) => ids.includes(part?.id ?? part) && part?.bounds).map((part) => part.bounds) : [];
  if (!boxes.length) return null;
  const box = {
    min: [0, 1, 2].map((axis) => Math.min(...boxes.map((item) => item.min[axis]))),
    max: [0, 1, 2].map((axis) => Math.max(...boxes.map((item) => item.max[axis]))),
  };
  /* Коробка на весь зал (весь свет Majestic, все знаки выхода): подойти не к чему, глаз «вокруг» встал бы в чужой комнате лицом к стене — взгляд из зала на её середину. */
  const centre = box.min.map((value, axis) => (value + box.max[axis]) / 2);
  const whole = poseAt(home || [0, 0, 1.7], centre, INSIDE_FOV);
  if (Math.hypot(...box.max.map((value, axis) => value - box.min[axis])) > WHOLE_HALL) return { scene: "inside", inside: whole };
  const inside = itemFocus(home, box, { asset, key: null });
  if (!inside) return null;
  /* Рамки сцены мало: у Majestic в неё входит всё здание с улицы. */
  const bounds = asset.bounds;
  const outside = (bounds && inside.eye.some((value, axis) => value < bounds.min[axis] || value > bounds.max[axis])) || (eyeInRoom(asset, home || [0, 0, 1.7]) && !eyeInRoom(asset, inside.eye));
  return { scene: "inside", inside: outside ? whole : inside };
}
