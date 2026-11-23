/*
 * Облик предмета зала в окне (ТЗ 27.10.2026, «Предметы»: «Своя модель», «Цвет», «Своя картинка», «В студию»): то, чего договору
 * (`arena-item-looks.js` climb-contract) знать нельзя, — сетка самого предмета из сцены кадра, лист одного цвета, холст студии.
 *
 * «Цвет» не правит файл штатной модели (он общий для всей карты): предмет получает копию той же формы одним цветом. Форма — сетка предмета из сцены
 * кадра в осях его же модели (обратный ход «сцена → запись зала»: `arenaItemPlace`; у кубков и шлемов — из сцены повторов), лист — картинка 4 × 4 нужного цвета. Дальше всё как у своей модели:
 * установщик вписывает копию в рамку прежней, и место, поворот и размер записи работают как раньше.
 *
 * Облик на часть модели (ТЗ 29.10.2026: один баннер из десяти) — `part: { box, label }` группы; рамку части даёт кадр (`{ index, box }` в осях модели).
 * Здесь — сетка части для превью «Цвета» (`clipToPart`) и холст студии по рамке части; саму часть установщик берёт из файла модели.
 */

import { arenaItemFrame, arenaItemModelKey, arenaItemPartKey, arenaItemPlace, arenaItemSource, arenaPartTriangles } from "@modovik/climb-contract/recolor/arena-item-looks";
import { arenaObjectOf, arenaObjectScope, arenaObjects } from "@modovik/climb-contract/recolor/arena-objects";
import { arenaRemovableKeys, arenaScene, arenaServerInventory } from "@modovik/climb-contract/recolor/arenas";
import { loadSceneAsset } from "../model-stage/scene-asset.js";
import { saveHangarEmblem } from "../hangar-editor/hangar-emblem.js";
import { savePlaceMesh } from "../models/model-assets.js";
import { GLASS_ALPHA_CAP } from "../model-stage/recolor-material.js";
import { tr } from "../../../locales/ui.js";
import { arenaCanvasSize } from "./arena-studio.js";
import { sceneElementIsland, sceneItemElements, sceneMainElement } from "../items-panel/item-elements.js";
import { itemElementWord } from "@modovik/climb-contract/recolor/item-elements";
import { colourOnEach, pictureOnMainElements } from "../items-panel/item-set-looks.js";

/* Поворот вектора кватернионом `[x, y, z, w]`; `inverse` — обратным. */
function turn([qx, qy, qz, w], [px, py, pz], inverse = false) {
  const [x, y, z] = inverse ? [-qx, -qy, -qz] : [qx, qy, qz];
  const tx = 2 * (y * pz - z * py);
  const ty = 2 * (z * px - x * pz);
  const tz = 2 * (x * py - y * px);
  return [px + w * tx + (y * tz - z * ty), py + w * ty + (z * tx - x * tz), pz + w * tz + (x * ty - y * tx)];
}

/*
 * Склейка сеток в одну: `place` — место предмета в сцене кадра (`arenaItemPlace`; `null` — сетки уже в осях модели, как в сцене повторов). Обход
 * граней приводится к записанным нормалям (лицевая грань игры — против часовой): у части сеток в сцене он обратный, и без этого куски предмета
 * «пропадали» бы. У двусторонних материалов (тонкие стенки: ручки, края) каждая грань есть и с обратной стороны — с обратными нормалями: модель копии
 * шейдера по умолчанию односторонняя, а у прежней эти места видны с обеих сторон. `blend` — по вершине, 1 у прозрачного материала (стекло):
 * «Цвет» оставляет его прозрачным (`colourLookOf`).
 */
function mergeMeshes(meshes, materials, place) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const blend = [];
  const turned = (vector, shift) => {
    if (!place) return vector;
    return turn(place.rotation, shift ? vector.map((value, axis) => value - place.position[axis]) : vector, true);
  };
  for (const mesh of meshes) {
    const base = positions.length / 3;
    const count = mesh.positions.length / 3;
    for (let index = 0; index < count; index += 1) {
      const local = turned([mesh.positions[index * 3], mesh.positions[index * 3 + 1], mesh.positions[index * 3 + 2]], true);
      positions.push(place ? local[0] / place.scale[0] : local[0], place ? local[1] / place.scale[0] : local[1], place ? local[2] / place.scale[1] : local[2]);
      normals.push(...turned([mesh.normals[index * 3], mesh.normals[index * 3 + 1], mesh.normals[index * 3 + 2]], false));
      uvs.push(mesh.uvs ? mesh.uvs[index * 2] : 0, mesh.uvs ? mesh.uvs[index * 2 + 1] : 0);
      blend.push(materials?.[mesh.material]?.alpha === "blend" ? 1 : 0);
    }
    const triangles = [];
    for (let from = 0; from + 2 < mesh.indices.length; from += 3) {
      let [a, b, c] = [base + mesh.indices[from], base + mesh.indices[from + 1], base + mesh.indices[from + 2]];
      const edge = (to, origin) => [0, 1, 2].map((axis) => positions[to * 3 + axis] - positions[origin * 3 + axis]);
      const u = edge(b, a);
      const v = edge(c, a);
      const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const facing = [0, 1, 2].reduce((sum, axis) => sum + cross[axis] * (normals[a * 3 + axis] + normals[b * 3 + axis] + normals[c * 3 + axis]), 0);
      if (facing < 0) [b, c] = [c, b];
      triangles.push(a, b, c);
    }
    indices.push(...triangles);
    if (materials?.[mesh.material]?.doubleSided) {
      const back = positions.length / 3;
      for (let index = 0; index < count; index += 1) {
        const at = (base + index) * 3;
        positions.push(positions[at], positions[at + 1], positions[at + 2]);
        normals.push(-normals[at], -normals[at + 1], -normals[at + 2]);
        uvs.push(uvs[(base + index) * 2], uvs[(base + index) * 2 + 1]);
        blend.push(blend[base + index]);
      }
      for (let from = 0; from < triangles.length; from += 3) indices.push(back + triangles[from] - base, back + triangles[from + 2] - base, back + triangles[from + 1] - base);
    }
  }
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), uvs: Float32Array.from(uvs), indices: Uint32Array.from(indices), blend: Uint8Array.from(blend) };
}

/**
 * Сетка предмета `key` в осях его модели: `{ positions, normals, uvs, indices }` или `null` (в сцене кадра предмета нет). Кубки и шлемы зала кадр рисует
 * из сцены повторов (`cups`: `{ asset, places }` — её сетки уже в осях модели, подробнее копий в сцене зала); остальное — из сцены зала обратным ходом
 * «сцена → запись зала». Развёртка — прежняя: ровный лист одного цвета её не замечает.
 */
export function itemSilhouette(scene, server, key, cups = null) {
  const copy = cups?.places?.find((place) => place[0] === key);
  const partIndex = copy ? cups.asset.parts.findIndex((part) => (part?.id ?? part) === copy[1]) : -1;
  if (partIndex >= 0) {
    const meshes = cups.asset.meshes.filter((mesh) => mesh.part === partIndex);
    if (meshes.length) return mergeMeshes(meshes, cups.asset.materials, null);
  }
  return silhouetteAt(scene, arenaItemPlace(server, key), key);
}

/** Сетка вещи `key` из сцены кадра в осях её модели по месту вещи `place` (`{ position, rotation, scale }`) или `null` (вещи в сцене нет). Общая у арен и мест. */
export function silhouetteAt(scene, place, key) {
  const meshes = (scene?.meshes || []).filter((mesh) => mesh.entity === key);
  if (!place || !meshes.length) return null;
  return mergeMeshes(meshes, scene.materials, place);
}

/**
 * Сетка части: треугольники сетки `mesh` (в осях модели) части в рамке `box` (`[[min], [max]]`) — по тому же правилу, по которому установщик вырежет
 * её из модели (`arenaPartTriangles`). `null` — части в сетке нет.
 */
export function clipToPart(mesh, box) {
  if (!mesh || !box) return null;
  const mask = arenaPartTriangles(mesh.positions, mesh.indices, box);
  const remap = new Map();
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const vertex = (index) => {
    if (!remap.has(index)) {
      remap.set(index, positions.length / 3);
      positions.push(mesh.positions[index * 3], mesh.positions[index * 3 + 1], mesh.positions[index * 3 + 2]);
      normals.push(mesh.normals[index * 3], mesh.normals[index * 3 + 1], mesh.normals[index * 3 + 2]);
      uvs.push(mesh.uvs[index * 2], mesh.uvs[index * 2 + 1]);
    }
    return remap.get(index);
  };
  for (let at = 0; at + 2 < mesh.indices.length; at += 3) if (mask[at / 3]) indices.push(vertex(mesh.indices[at]), vertex(mesh.indices[at + 1]), vertex(mesh.indices[at + 2]));
  if (!indices.length) return null;
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), uvs: Float32Array.from(uvs), indices: Uint32Array.from(indices) };
}

/** Сцена повторов предмета (кубки и шлемы матрицами) или `null`, если он не из них или сцены нет. */
async function cupsOf(server, key) {
  const places = arenaServerInventory(server)?.cups?.places;
  const info = arenaScene(server, "cups");
  if (!places?.some((place) => place[0] === key) || !info) return null;
  const asset = await loadSceneAsset(info.url).catch(() => null);
  return asset ? { asset, places } : null;
}

/** Рамка модели предмета `key` и её ключ в описи: `{ bounds, modelKey }` или `null`. */
export function itemFrameOf(server, key) {
  const objects = arenaObjects(server);
  const item = arenaObjectOf(server, key);
  if (!objects || !item) return null;
  const modelKey = arenaItemModelKey(server, key, objects.models[item.model].name);
  const bounds = arenaItemFrame(server, modelKey);
  return bounds ? { bounds, modelKey } : null;
}

/*
 * Лист цвета: одна клетка плотного цвета, а у вещи со стеклом (`glass`) рядом вторая — тот же цвет прозрачностью стекла кадра (`GLASS_ALPHA_CAP`):
 * стекло сетки ложится в неё (`colourLookOf`), и установщик с прозрачным листом сам берёт шейдер `alpha` (`placeModelShader`). Клетки по 16 точек —
 * уменьшенные ступени листа их не смешивают.
 */
const COLOUR_CELL = 16;

/** Лист цвета в хранилище окна: `{ asset }` (`hangar-emblem:…`); `glass` — с клеткой стекла справа (u 0,5…1). */
export async function saveColourSheet(colour, { glass = false } = {}) {
  const canvas = Object.assign(document.createElement("canvas"), { width: COLOUR_CELL * (glass ? 2 : 1), height: COLOUR_CELL });
  const context = canvas.getContext("2d");
  context.fillStyle = colour;
  context.fillRect(0, 0, COLOUR_CELL, COLOUR_CELL);
  if (glass) {
    context.globalAlpha = GLASS_ALPHA_CAP;
    context.fillRect(COLOUR_CELL, 0, COLOUR_CELL, COLOUR_CELL);
    context.globalAlpha = 1;
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error(tr("Цвет не сохранился — попробуйте ещё раз."));
  const file = typeof File === "function" ? new File([blob], "item-colour.png", { type: "image/png" }) : Object.assign(blob, { name: "item-colour.png" });
  return saveHangarEmblem(file);
}

/**
 * Облик «Цвет»: сетка предмета из сцены кадра и лист цвета — как своя модель (`kind: "colour"`). Бросает понятной ошибкой: предмета нет в сцене
 * кадра или у него слишком подробная сетка. `part` (`{ box, label }`) — цвет на часть: сетка — только её треугольники, часть едет в облике.
 */
export async function colourLook(scene, server, key, colour, part = null) {
  const mesh = itemSilhouette(scene, server, key, await cupsOf(server, key));
  if (!part) return colourLookOf(mesh, colour);
  const piece = clipToPart(mesh, part.box);
  if (mesh && !piece) throw new Error(tr("Этой части нет в кадре — цвет ей не задать."));
  return { ...(await colourLookOf(piece, colour)), part };
}

/**
 * Облик «Цвет» по готовой сетке предмета (`null` — предмета нет в кадре): сетка и лист цвета в хранилище окна. Общий у арен и мест. Стекло вещи
 * (`mesh.blend`: прозрачные материалы) остаётся прозрачным — его развёртка в клетку стекла листа (владелец 01.11.2026: «меняешь цвет — стекло
 * перестаёт просвечиваться»); остальное — в плотную.
 */
export async function colourLookOf(mesh, colour) {
  if (!mesh) throw new Error(tr("Этого предмета нет в кадре — цвет ему не задать."));
  if (mesh.positions.length / 3 > 60000) throw new Error(tr("У предмета слишком подробная сетка для цвета."));
  const glass = Boolean(mesh.blend?.some(Boolean));
  const painted = glass ? { ...mesh, uvs: colourSheetUvs(mesh.blend) } : mesh;
  const [asset, sheet] = await Promise.all([savePlaceMesh(painted), saveColourSheet(colour, { glass })]);
  return { kind: "colour", colour, model: { asset, shape: "mesh", texture: sheet.asset, vertices: mesh.positions.length / 3 } };
}

/** Развёртка по листу цвета со стеклом: стекло (`blend` вершины — 1) — в середину правой клетки, остальное — левой. */
export function colourSheetUvs(blend) {
  const uvs = new Float32Array(blend.length * 2);
  for (let index = 0; index < blend.length; index += 1) {
    uvs[index * 2] = blend[index] ? 0.75 : 0.25;
    uvs[index * 2 + 1] = 0.5;
  }
  return uvs;
}

/* Короткий отпечаток рамки части для имени холста (djb2). */
const partTag = (part) => {
  let hash = 5381;
  for (const char of arenaItemPartKey(part)) hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0;
  return hash.toString(36);
};

/**
 * Холст студии для предмета: пропорция рамки его модели (вид сбоку), основа — серая. `bounds` — рамка (`{ min, max }`), `scope` — чей предмет (сервер арены, набор места).
 * `part` (`{ box, label }`) — холст на часть: пропорция её рамки (ширина — по плоскости XY, у полотнища, что стоит наискось, тоже), свой холст на часть.
 */
export function itemStudioSurface({ server, key, title, bounds = null, part = null }) {
  const frame = part ? { bounds: { min: part.box[0], max: part.box[1] } } : bounds ? { bounds } : itemFrameOf(server, key);
  const across = frame ? (part ? Math.hypot(frame.bounds.max[0] - frame.bounds.min[0], frame.bounds.max[1] - frame.bounds.min[1]) : frame.bounds.max[0] - frame.bounds.min[0]) : 1;
  const width = Math.max(0.05, across);
  const height = frame ? Math.max(0.05, frame.bounds.max[2] - frame.bounds.min[2]) : 1;
  const size = arenaCanvasSize(width / height);
  const tag = part ? `:part-${partTag(part)}` : "";
  return {
    id: `arena-item:${server}:${key}${tag}`,
    slug: `arena-item-${server}-${key}${tag.replace(":", "-")}`,
    title: part?.label ? `${tr("Предмет")} · ${title} · ${part.label}` : `${tr("Предмет")} · ${title}`,
    ...size,
    baseColour: "#8a8a8a",
    placeLabel: tr("Поставить на предмет"),
  };
}

/**
 * Холст студии на элемент вещи (`kind: "elements"`): пропорция острова развёртки элемента (`island`, метры на вещи), свой холст на элемент.
 * Итог студии ложится на элемент подгонкой «Растянуть» — холст уже в пропорции острова.
 */
export function itemElementStudioSurface({ server, key, title, texture, label, island = null }) {
  const size = arenaCanvasSize(island?.aspect > 0 ? island.aspect : 1);
  const tag = String(texture).replace(/[^a-z0-9_-]+/gi, "-");
  return {
    id: `arena-item:${server}:${key}:element-${tag}`,
    slug: `arena-item-${server}-${key}-element-${tag}`,
    title: `${tr("Предмет")} · ${title} · ${label}`,
    ...size,
    baseColour: "#8a8a8a",
    placeLabel: tr("Поставить на предмет"),
  };
}

/**
 * Адаптер «Облика предмета» для арены (`arena-item-look.jsx`): охват — вещи той же модели по выбору над страницей, убираемые вещи сервера; цвет и студия —
 * из сцены кадра. `scene` — сцена кадра (для сетки «Цвета»).
 */
export function arenaItemLookAdapter(server, scene) {
  const removable = arenaRemovableKeys(server);
  const modelKey = (key) => itemFrameOf(server, key)?.modelKey || "";
  const paintable = (item) => {
    const frame = itemFrameOf(server, item.key);
    return Boolean(frame && arenaItemSource(server, frame.modelKey));
  };
  return {
    copyHint: "Общий файл модели в игре не меняется: предмет получает свою копию в этом зале, остальная карта остаётся прежней.",
    keys: (item, scope) => [...arenaObjectScope(server, item.key, scope)].filter((key) => removable?.has(key)),
    paintable,
    canReplace: () => true,
    /* `part` — облик на часть модели (`{ box, label }` из кадра); без неё — на всю модель. */
    paint: (item, colour, part = null) => colourLook(scene, server, item.key, colour, part),
    studio: (item, title, part = null) => itemStudioSurface({ server, key: item.key, title, part }),
    /* Элементы вещи — листы её модели (`kind: "elements"`): `[{ texture, label, colour, area }]`; пусто — вещи нет в кадре. Картинку на элемент
       ставят только модели с файлом в описи (`paintable`): копию с переписанным листом установщик строит из него. */
    elements: (item) => sceneItemElements(scene, item.key),
    /* Холст студии на элемент `{ texture, label }`: пропорция его острова развёртки; итог — элемент с подгонкой «Растянуть». */
    elementStudio: (item, title, element) =>
      itemElementStudioSurface({ server, key: item.key, title, texture: element.texture, label: element.label, island: sceneElementIsland(scene, item.key, element.texture, arenaItemPlace(server, item.key)) }),
    /*
     * Набор вещей (Shift, `docs/3D-ELEMENTS-PICTURES.md`, п. 7): облик по модели для `setArenaItemLooks` одним шагом. `modelKey(ключ)` — модель
     * группы; `mainElement(вещь)` — её «Корпус»; `pictureMany(картинка)` — картинка на «Корпус» каждой (`{ look, skipped }`); `paintMany(ключи,
     * цвет)` — «Цвет» каждой модели (`{ look, failed }`).
     */
    modelKey,
    mainElement: (item) => sceneMainElement(scene, item.key),
    pictureMany: (picture) =>
      pictureOnMainElements({ picture, mainOf: (key) => sceneMainElement(scene, key), canElements: (key) => paintable({ key }), coverOf: (key) => sceneItemElements(scene, key).filter((entry) => itemElementWord(entry.texture, entry.colour) !== "Экран").map((entry) => entry.texture) }),
    paintMany: (keys, colour) => colourOnEach({ keys, modelOf: modelKey, paint: (key) => colourLook(scene, server, key, colour) }),
  };
}
