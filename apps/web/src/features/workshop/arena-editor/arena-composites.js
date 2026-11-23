/*
 * Составные листы кадра арены: своя картинка в местах (экраны, таблички,
 * логотипы, плакаты; снаружи у GTA5RP — надпись Maze Bank Arena, логотип и
 * баннеры фасада слоями одного листа) и знаки выхода своим цветом.
 *
 * Лист в кадре собирается той же функцией, что и в установщике
 * (`placeImageInIslands`, `recolourGreen` из `arena-slots.js`): основа —
 * штатный лист игры игрока (или лист сервера Majestic), сверху — картинка в
 * острова включённых мест с её размером, поворотом, сдвигом и фоном. Что
 * видно в кадре, то и уедет в игру.
 *
 * Основа листа читается один раз на окно (`loadSceneImage`, кэш окна) и
 * держится здесь пикселями: движение ползунка пересобирает только
 * составной лист (512² — доли секунды), а не читает игру заново.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  ARENA_CLOTH_TEXTURE,
  ARENA_SLOTS,
  MAJESTIC_CENTRE_EMBLEM,
  arenaClothJobs,
  arenaCoverPlates,
  arenaImageAssets,
  arenaOutsideLayers,
  arenaPanelPlates,
  arenaPanelsAnimated,
  arenaPictureText,
  arenaPlaceElements,
  arenaServerInventory,
  arenaSignFaces,
  arenaSignPicture,
  arenaSlotElements,
  arenaSlotSheetOp,
  activeArenaSigns,
} from "@modovik/climb-contract/recolor/arenas";
import { emblemTextFilled } from "@modovik/climb-contract/recolor/emblems";
import { placeModelAnimationDuration, placeModelAnimationFrameAt, placeModelAnimationShift } from "@modovik/climb-contract/recolor/place-models";
import { loadSceneImage, textureKey } from "../model-stage/scene-textures.js";
import { getWorkshopAsset } from "../../../components/desktop/workshop/workshop-assets.js";
import { imageBlobPixels } from "../hangar-editor/hangar-emblem.js";
import { ensureEmblemFont, renderEmblemText } from "../emblem/emblem-items.js";
import { plateObject, plateTexture } from "../model-stage/plate-object.js";
import { arenaCoverPicturesAsync, arenaPanelPicturesAsync } from "./arena-cover-client.js";
import { composeSheetsAsync } from "../model-stage/sheet-compose-client.js";

/* Картинке места хватает 1024 px по длинной стороне: листы — до 512 в кадре. */
const IMAGE_SIDE = 1024;
const SHEET_SIDE = 512;

function canvasOf(width, height) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas) {
  try {
    return canvas?.getContext("2d", { willReadFrequently: true }) || null;
  } catch {
    return null;
  }
}

/** Пиксели своей картинки по адресу: `{ rgba, width, height }` или `null`. */
export function useImagePixels(url) {
  const [pixels, setPixels] = useState(null);
  useEffect(() => {
    if (!url) {
      setPixels(null);
      return undefined;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const scale = Math.min(1, IMAGE_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = canvasOf(width, height);
      const context = context2d(canvas);
      if (!context) return;
      context.drawImage(image, 0, 0, width, height);
      setPixels({ rgba: context.getImageData(0, 0, width, height).data, width, height });
    };
    image.onerror = () => !cancelled && setPixels(null);
    image.src = url;
    return () => {
      cancelled = true;
    };
  }, [url]);
  return pixels;
}

/* Основа листа пикселями (кэш окна): `{ rgba, width, height }` или пустой лист. */
const bases = new Map();
async function basePixels(entry) {
  const key = textureKey(entry, SHEET_SIDE) || "blank";
  if (bases.has(key)) return bases.get(key);
  const pending = (async () => {
    const image = entry ? await loadSceneImage(entry, SHEET_SIDE).catch(() => null) : null;
    const width = image?.width || 256;
    const height = image?.height || 256;
    const canvas = canvasOf(width, height);
    const context = context2d(canvas);
    if (!context) return null;
    if (image) context.drawImage(image, 0, 0, width, height);
    else {
      context.fillStyle = "#3a3a3a";
      context.fillRect(0, 0, width, height);
    }
    return { rgba: context.getImageData(0, 0, width, height).data, width, height, real: Boolean(image) };
  })();
  bases.set(key, pending);
  const value = await pending;
  if (!value?.real) bases.delete(key);
  return value;
}

export function textureOf(rgba, width, height) {
  const canvas = canvasOf(width, height);
  const context = context2d(canvas);
  if (!context) return null;
  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/*
 * Пиксели своей картинки из хранилища окна (как `useImagePixels`, без хука): разбор и чтение — в фоновом потоке (`imageBlobPixels`,
 * владелец 31.10.2026: фото с телефона — окно «ужасно пролагивало»), без потока — здесь через `<img>`, как раньше. Картинка лежит под
 * отпечатком (`hangar-emblem:<sha256>`) и не меняется — готовые пиксели помнятся: новая картинка места не разбирает заново все
 * остальные. Пиксели общие — их только читают (составной лист копирует основу, плашки — пиксели).
 */
const PIXELS_KEPT = 12;
const pixelsByAsset = new Map();
export function assetPixels(asset) {
  const kept = pixelsByAsset.get(asset);
  if (kept) {
    pixelsByAsset.delete(asset);
    pixelsByAsset.set(asset, kept);
    return kept;
  }
  const reading = readAssetPixels(asset);
  pixelsByAsset.set(asset, reading);
  if (pixelsByAsset.size > PIXELS_KEPT) pixelsByAsset.delete(pixelsByAsset.keys().next().value);
  reading.then((pixels) => pixels || pixelsByAsset.delete(asset));
  return reading;
}

async function readAssetPixels(asset) {
  const blob = await getWorkshopAsset(asset).catch(() => null);
  if (!blob) return null;
  const off = await imageBlobPixels(blob, IMAGE_SIDE);
  if (off) return off;
  if (typeof Image === "undefined") return null;
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = reject;
      element.src = url;
    });
    const scale = Math.min(1, IMAGE_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = context2d(canvasOf(width, height));
    if (!context) return null;
    context.drawImage(image, 0, 0, width, height);
    return { rgba: context.getImageData(0, 0, width, height).data, width, height };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* Нарисованный окном текст надписи пикселями (как `useTextPixels`). */
async function textPixels(text) {
  if (!emblemTextFilled(text)) return null;
  if (text.font === "custom") await ensureEmblemFont(text.fontAsset).catch(() => false);
  const drawn = renderEmblemText(text);
  const context = drawn ? context2d(drawn.canvas) : null;
  return context ? { rgba: context.getImageData(0, 0, drawn.canvas.width, drawn.canvas.height).data, width: drawn.canvas.width, height: drawn.canvas.height } : null;
}

/**
 * Картинки мест работы пикселями по ключам `arenaImageAssets` — раздела
 * (`screens`) и элемента (`posters:show.3`): своя картинка или нарисованный
 * окном текст надписи. Общие у составных листов и плашек мест над входом.
 */
export function useArenaPictures(project) {
  const wanted = useMemo(() => {
    const { emblems: _emblems, star: _star, ...pictures } = arenaImageAssets(project);
    const settings = project[project.server];
    /* Текст — словами (нарисует окно), картинка — ключом хранилища. */
    return Object.entries(pictures).map(([key, asset]) => ({ key, asset, text: asset === "text" ? arenaPictureText(settings, key) : null }));
  }, [project]);
  const signature = JSON.stringify(wanted);
  const [images, setImages] = useState(() => ({}));
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = {};
      for (const item of JSON.parse(signature)) next[item.key] = item.asset === "text" ? await textPixels(item.text) : await assetPixels(item.asset);
      if (!cancelled) setImages(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [signature]);
  return images;
}

/**
 * Составные листы кадра: `Map` имя листа → текстура. `asset` — сцена кадра
 * (`onScene` ModelStage), `project` и `server` — работа, `images` —
 * картинки мест (`useArenaPictures`).
 */
/* Слои с картинками по ключам: готовы, только если пришли все нужные картинки. */
function resolveLayers(layers, images) {
  const out = layers.map((layer) => ({ ...layer, image: layer.image ? images[layer.image] || null : null, wanted: Boolean(layer.image) }));
  return out.length && out.every((layer) => !layer.wanted || layer.image) ? out : null;
}

/** Ключ составного листа: лист, у полотна со своим видом — ещё и элемент. */
export const arenaCompositeKey = (info) => (info.element ? `${info.name}|${info.element}` : info.name);

/* Правки составного листа (`sheet-compose.js`) по задаче кадра: картинка места, слои фасада, знаки выхода своим цветом. */
function sheetOps(job) {
  if (job.kind === "image") return [{ op: "image", islands: job.islands, image: job.image, transform: job.transform }];
  if (job.kind === "layers")
    return job.layers.flatMap((layer) => [
      ...(layer.clear ? [{ op: "patch", islands: layer.islands, clear: layer.clear }] : []),
      { op: "image", islands: layer.islands, image: layer.image, transform: layer.transform },
    ]);
  return [{ op: "green", colour: job.colour }];
}

/* Те же правки: картинки — те же пиксели (по ссылке), остальное — по значению. */
const opText = ({ image: _image, ...rest }) => JSON.stringify(rest);
const sameOps = (a, b) => a.length === b.length && a.every((step, index) => step.image === b[index].image && opText(step) === opText(b[index]));

export function useArenaComposites({ asset, project, server, images }) {
  const settings = project[server];

  /* Что собрать: лист, его основа в сцене и правка — той же операцией листа,
     что у установщика (`arenaSlotSheetOp`, `arenaOutsideLayers`). */
  const jobs = useMemo(() => {
    if (!asset) return [];
    const records = new Map();
    const outside = new Map();
    for (const record of arenaServerInventory(server)?.textures || []) {
      if (record.group === "outside" && !outside.has(record.name)) outside.set(record.name, record);
      else if (record.islands?.length && ARENA_SLOTS.includes(record.group) && !records.has(`${record.group}|${record.name}`)) records.set(`${record.group}|${record.name}`, record);
    }
    /* Полотна у арок со своим видом: свой лист у своего материала сцены. */
    const cloths = new Map(arenaClothJobs(project, server).map((job) => [job.key, job]));
    const clothRegion = outside.get(ARENA_CLOTH_TEXTURE)?.regions?.find((region) => region.section === "outBanners" && region.place === "cloth");
    const out = new Map();
    for (const info of asset.materials || []) {
      const key = arenaCompositeKey(info);
      if (out.has(key)) continue;
      const entry = info.texture != null ? asset.textures?.[info.texture] || null : null;
      if (info.element) {
        const job = cloths.get(info.element);
        if ((job?.look.mode === "image" || job?.look.mode === "text") && clothRegion) {
          const image = images[job.image];
          if (image) out.set(key, { name: key, entry, kind: "image", image, islands: clothRegion.islands, transform: job.look.transform });
        }
        if (job) continue;
      }
      /* Лист фасада снаружи: места разных разделов — слоями (как у установщика). */
      if (info.group === "outside") {
        const layers = resolveLayers(arenaOutsideLayers(settings, outside.get(info.name), server), images);
        if (layers) out.set(key, { name: key, entry, kind: "layers", layers });
        continue;
      }
      /* Эмблема в центре зала Majestic — наклейка пола, но место «Эмблем зала». */
      const centre = server === "majestic" && info.name === MAJESTIC_CENTRE_EMBLEM.record.name;
      if (ARENA_SLOTS.includes(info.group) || centre) {
        const record = centre ? records.get(`${MAJESTIC_CENTRE_EMBLEM.section}|${info.name}`) : records.get(`${info.group}|${info.name}`);
        const op = record ? arenaSlotSheetOp(server, settings, record) : null;
        if (op?.image) {
          const image = images[op.image];
          if (image) out.set(key, { name: key, entry, kind: "image", image, islands: op.islands, transform: op.transform });
        } else if (op?.layers) {
          const layers = resolveLayers(op.layers, images);
          if (layers) out.set(key, { name: key, entry, kind: "layers", layers });
        }
      } else if (info.group === "exits" && settings.exits?.mode === "colour") {
        out.set(key, { name: key, entry, kind: "exit", colour: settings.exits.colour });
      }
    }
    return [...out.values()];
  }, [asset, project, server, settings, images]);

  /*
   * Листы собирает фоновый поток (`composeSheetsAsync`; 31.10.2026, вечер: после фриза своей картинки — картинка в острова листа на
   * главном потоке держала окно ~60 мс при ×4 на каждую правку). Лист с той же основой и теми же правками (те же пиксели картинок) не
   * собирается заново и сохраняет свою текстуру (`made`): новая картинка одного места не пересобирает все листы зала.
   */
  const [composites, setComposites] = useState(() => new Map());
  const made = useRef(new Map());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const plan = [];
      const work = [];
      /* Основы всех листов просятся разом (читатель склеивает их в пачки), а не по одному после ответа на прежний: поздние запросы держали заставку. */
      const bases = await Promise.all(jobs.map((job) => basePixels(job.entry)));
      if (cancelled) return;
      for (const [order, job] of jobs.entries()) {
        const base = bases[order];
        if (!base) continue;
        const ops = sheetOps(job);
        const kept = made.current.get(job.name);
        if (kept && kept.base === base && sameOps(kept.ops, ops)) plan.push({ name: job.name, kept });
        else {
          plan.push({ name: job.name, base, ops, at: work.length });
          work.push({ base, ops });
        }
      }
      const sheets = await composeSheetsAsync(work);
      if (cancelled) return;
      const next = new Map();
      for (const item of plan) {
        if (item.kept) {
          next.set(item.name, item.kept);
          continue;
        }
        const sheet = sheets[item.at];
        const texture = textureOf(sheet.rgba, sheet.width, sheet.height);
        if (texture) next.set(item.name, { texture, base: item.base, ops: item.ops });
      }
      const kept = new Set([...next.values()].map((entry) => entry.texture));
      for (const entry of made.current.values()) if (!kept.has(entry.texture)) entry.texture.dispose();
      made.current = next;
      setComposites(new Map([...next].map(([name, entry]) => [name, entry.texture])));
    })();
    return () => {
      cancelled = true;
    };
  }, [jobs]);
  useEffect(
    () => () => {
      for (const entry of made.current.values()) entry.texture.dispose();
      made.current = new Map();
    },
    [],
  );
  return composites;
}

/*
 * Своё на месте объёмных букв, щита и знака над главным входом — плашками
 * кадра, как в игре: та же картинка (`arenaCoverPicture`) и то же место
 * (`arenaCoverPlates`), что уедут нативному хосту. Прежние буквы и щит кадр
 * прячет (`cover:<место>` сцены). `[{ object, dispose }]`.
 */
export function useArenaCoverObjects({ project, server, images }) {
  const plates = useMemo(() => arenaCoverPlates(project, server), [project, server]);
  const key = JSON.stringify(plates.map((plate) => [plate.key, plate.image, plate.decal, plate.look?.transform]));
  const [objects, setObjects] = useState([]);
  useEffect(() => {
    let cancelled = false;
    /* Пиксели плашек считает фоновый поток; прежние плашки кадр держит, пока новые не готовы. */
    const picked = plates.filter((plate) => images[plate.image]);
    const jobs = picked.map((plate) => ({ look: plate.look, picture: images[plate.image], decal: plate.decal }));
    arenaCoverPicturesAsync(jobs).then((pictures) => {
      if (cancelled) return;
      setObjects(pictures.map((pixels, index) => plateObject(picked[index].decal, plateTexture(pixels.rgba, pixels.width, pixels.height), { offset: 0.02 })));
    });
    return () => {
      cancelled = true;
    };
    // Плашки пересобираются по местам работы и их картинкам, а не по новому объекту работы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, images]);
  useEffect(() => () => objects.forEach((item) => item.dispose()), [objects]);
  return objects;
}

/*
 * Полотна у арок своими материалами (задача 10): в сцене у всех 18 полотен
 * один материал листа `xj_v_fameorshamebanner`, и своё полотно нельзя было
 * показать отдельно. Здесь сетка каждого полотна получает свой материал —
 * копию общего с ключом элемента (`element`): полотно — ближайшая к середине
 * сетки модель полотна описи (места моделей — мир, сетки — сцена от её
 * начала `origin`). Новый объект сцены; кэш загрузки не трогается.
 */
export function splitArenaCloths(asset, server, origin = [0, 0, 0]) {
  const elements = arenaPlaceElements(server, "outBanners", "cloth").filter((item) => item.cloth && item.position);
  const shared = (asset?.materials || []).findIndex((material) => material.group === "outside" && material.name === ARENA_CLOTH_TEXTURE);
  if (!elements.length || shared < 0) return asset;
  const materials = [...asset.materials];
  const byElement = new Map();
  const meshes = asset.meshes.map((mesh) => {
    if (mesh.material !== shared) return mesh;
    const count = mesh.positions.length / 3;
    let x = 0;
    let y = 0;
    for (let index = 0; index < mesh.positions.length; index += 3) {
      x += mesh.positions[index];
      y += mesh.positions[index + 1];
    }
    const centre = [x / count + origin[0], y / count + origin[1]];
    let best = null;
    let distance = Infinity;
    for (const element of elements) {
      const away = Math.hypot(element.position[0] - centre[0], element.position[1] - centre[1]);
      if (away < distance) {
        best = element;
        distance = away;
      }
    }
    /* Полотна стоят у арок метрах в двадцати друг от друга: дальше 12 м — не его. */
    if (!best || distance > 12) return mesh;
    if (!byElement.has(best.key)) {
      byElement.set(best.key, materials.length);
      materials.push({ ...asset.materials[shared], id: `${asset.materials[shared].id}|${best.key}`, element: best.key });
    }
    return { ...mesh, material: byElement.get(best.key) };
  });
  return byElement.size ? { ...asset, materials, meshes } : asset;
}

/*
 * Полотна по одному (ТЗ 11.10.2026, ночь, задача 2): свой вид полотна —
 * плашкой ровно по полотну, по стороне на каждую сторону ткани (`arenaPanelPlates`,
 * та же картинка `arenaPanelPicture`, что уедет в игру). Лист соседей не
 * трогается. `pick` — ключ элемента: колесо мыши по плашке выбирает его же.
 * `[{ object, dispose }]`.
 */
export function useArenaPanelObjects({ project, server, images, active = true }) {
  /* Сверх предела сторон плашки не встают и в игре — их нет и в кадре. */
  const plates = useMemo(() => (active ? arenaPanelPlates(project, server).filter((plate) => !plate.over) : []), [project, server, active]);
  const key = JSON.stringify(plates.map((plate) => [plate.key, plate.image, plate.look]));
  /*
   * Пиксели плашек — в фоновом потоке (`arenaPanelPicturesAsync`; владелец 31.10.2026: своя картинка «Табло турнира» — окно «ужасно
   * пролагивало»: картинка в рамку каждого полотна считалась прямо в отрисовке, у второй картинки — дважды по 200 мс при ×4). Полотно
   * с тем же видом и той же картинкой не считается заново (`made`); прежние плашки стоят в кадре, пока не готовы новые.
   */
  const [objects, setObjects] = useState([]);
  const made = useRef(new Map());
  useEffect(() => {
    let cancelled = false;
    const plan = [];
    const jobs = [];
    for (const plate of plates) {
      const picture = plate.image ? images[plate.image] : null;
      if (plate.image && !picture) continue;
      const sign = JSON.stringify([plate.key, plate.look]);
      const kept = made.current.get(sign);
      if (kept && kept.picture === picture) {
        plan.push({ plate, sign, picture, result: kept.result });
        continue;
      }
      /* Гифка — лист кадров той же функцией, что у установщика, кадры сменяются по её задержкам
         (у Majestic плашки вшиты в модель зала без клипов — первым кадром, как в игре). */
      const live = Boolean(arenaPanelsAnimated(server) && plate.look.mode === "image" && plate.look.image?.animation);
      plan.push({ plate, sign, picture, job: jobs.length });
      jobs.push({ look: plate.look, picture, panel: plate.panel, faces: plate.faces, live });
    }
    arenaPanelPicturesAsync(jobs).then((results) => {
      if (cancelled) return;
      const next = new Map();
      const out = [];
      for (const { plate, sign, picture, result: kept, job } of plan) {
        const result = kept || results[job];
        next.set(sign, { picture, result });
        plate.faces.forEach((face, index) => {
          /* Грань изогнутого экрана — своя доля картинки, как у установщика. */
          const part = result.atlas || result.faces[index];
          out.push(panelFaceObject(face, plateTexture(part.rgba, part.width, part.height), { section: plate.section, key: plate.key }, result.atlas?.animation || null));
        });
      }
      made.current = next;
      setObjects(out);
    });
    return () => {
      cancelled = true;
    };
    // Плашки пересобираются по своим видам полотен и их картинкам, а не по новому объекту работы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, images, server]);
  useEffect(() => () => objects.forEach((item) => item.dispose()), [objects]);
  return objects;
}

/* Сторона полотна плашкой: оси — те же, что у плашки в игре (`panelAxes`); `animation` — сетка кадров гифки. */
function panelFaceObject(face, texture, pick, animation = null) {
  if (animation) {
    texture.repeat.set(1 / animation.columns, 1 / animation.rows);
    texture.needsUpdate = true;
  }
  /* Клетка кадра: строки листа — сверху вниз, у текстуры холста v растёт вверх. */
  const showFrame = (frame) => {
    const [u, v] = placeModelAnimationShift(animation, frame);
    texture.offset.set(u, 1 - v - 1 / animation.rows);
  };
  if (animation) showFrame(0);
  const duration = animation ? placeModelAnimationDuration(animation) : 0;
  const geometry = new THREE.PlaneGeometry(face.width, face.height);
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.02,
    roughness: 0.8,
    metalness: 0,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const mesh = new THREE.Mesh(geometry, material);
  const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(...face.right), new THREE.Vector3(...face.up), new THREE.Vector3(...face.normal));
  mesh.quaternion.setFromRotationMatrix(basis);
  mesh.position.set(...face.point);
  mesh.receiveShadow = true;
  mesh.userData.pick = { kind: "panel", ...pick, point: [...face.point] };
  return {
    object: mesh,
    ...(animation && duration > 0 ? { update: (seconds) => showFrame(placeModelAnimationFrameAt(animation, ((seconds % duration) + duration) % duration)) } : {}),
    dispose() {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}

/*
 * Своя надпись на домике (Majestic, ТЗ 12.10.2026): грани надписи в осях
 * модели домика (`arenaSignFaces`: плашки строк стенда или брусок домика
 * Cube World) с той же картинкой, что уедет в игру (`arenaSignPicture`), —
 * во всех местах домика (его расстановки в описи замен). Буквы стенда кадр
 * прячет (`arenaReplacedFiles`), буквы Cube World остаются внутри бруска, как
 * в игре. Кромки бруска — цветом фона. Колесо по надписи берёт сам домик.
 * `[{ object, dispose }]`.
 */
export function useArenaSignObjects({ project, server, images, active = true }) {
  const signs = useMemo(
    () => (active ? activeArenaSigns(server, project[server]?.replace).filter((item) => item.sign.mode === "text") : []),
    [project, server, active],
  );
  const key = JSON.stringify(signs.map((item) => [item.id, item.sign]));
  const objects = useMemo(() => {
    const out = [];
    for (const { id, sign, spec, replacement } of signs) {
      const picture = images[`sign:${id}`];
      if (!picture) continue;
      const faces = arenaSignFaces(spec, sign);
      const background = spec.kind === "board" ? sign.background : null;
      const pixels = arenaSignPicture(picture, faces[0], background);
      const texture = plateTexture(pixels.rgba, pixels.width, pixels.height);
      const material = new THREE.MeshStandardMaterial({
        map: texture,
        transparent: !background,
        alphaTest: background ? 0 : 0.02,
        roughness: 0.6,
        metalness: 0,
        side: THREE.FrontSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        ...(sign.glow > 0 ? { emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: sign.glow / 100 } : {}),
      });
      /* Кромки бруска — ровным цветом фона (в игре — угол того же листа). */
      const edge = background ? new THREE.MeshStandardMaterial({ color: background, roughness: 0.6, metalness: 0 }) : null;
      const geometries = faces.map((face) => new THREE.PlaneGeometry(face.width, face.height));
      const group = new THREE.Group();
      for (const placement of replacement.placements) {
        const holder = new THREE.Group();
        holder.quaternion.set(...placement.rotation);
        holder.position.set(...placement.position);
        faces.forEach((face, index) => {
          const mesh = new THREE.Mesh(geometries[index], face.edge && edge ? edge : material);
          const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(...face.right), new THREE.Vector3(...face.up), new THREE.Vector3(...face.normal));
          mesh.quaternion.setFromRotationMatrix(basis);
          mesh.position.set(...face.point);
          mesh.userData.pick = { kind: "replace", key: id, point: [...placement.position] };
          holder.add(mesh);
        });
        group.add(holder);
      }
      out.push({
        object: group,
        dispose() {
          geometries.forEach((geometry) => geometry.dispose());
          material.dispose();
          edge?.dispose();
          texture.dispose();
        },
      });
    }
    return out;
    // Плашки пересобираются по надписям и их картинкам, а не по новому объекту работы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, images]);
  useEffect(() => () => objects.forEach((item) => item.dispose()), [objects]);
  return objects;
}

/*
 * Ткань с двух сторон — в кадре только лицом (ТЗ 11.10.2026, ночь: «вторые
 * поломались»).
 * У баннеров фойе, полотен с игроками и баннеров шоу лицо и изнанка — два
 * слоя в одной точке с разными кусками листа; двусторонний материал кадра
 * рисовал оба, и они мерцали один сквозь другой. В игре каждую сторону
 * видно только спереди: здесь материал таких листов — односторонний, а
 * обход треугольников приводится к их нормалям. Новый объект сцены.
 */
export function cullArenaPanelSides(asset, server) {
  const textures = new Set();
  for (const section of ARENA_SLOTS)
    for (const element of arenaSlotElements(server, section)) if (element.panel?.sides === 2) textures.add(`${section}|${element.panel.texture}`);
  if (!textures.size || !asset?.materials) return asset;
  const single = new Set();
  const materials = asset.materials.map((material, index) => {
    if (!textures.has(`${material.group}|${material.name}`)) return material;
    single.add(index);
    return { ...material, doubleSided: false };
  });
  if (!single.size) return asset;
  const meshes = asset.meshes.map((mesh) => {
    if (!single.has(mesh.material) || !mesh.normals) return mesh;
    const indices = mesh.indices.slice();
    const p = mesh.positions;
    for (let at = 0; at + 2 < indices.length; at += 3) {
      const [a, b, c] = [indices[at], indices[at + 1], indices[at + 2]];
      const e1 = [p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]];
      const e2 = [p[c * 3] - p[a * 3], p[c * 3 + 1] - p[a * 3 + 1], p[c * 3 + 2] - p[a * 3 + 2]];
      const facing = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const normal = [0, 1, 2].map((axis) => mesh.normals[a * 3 + axis] + mesh.normals[b * 3 + axis] + mesh.normals[c * 3 + axis]);
      if (facing[0] * normal[0] + facing[1] * normal[1] + facing[2] * normal[2] < 0) {
        indices[at + 1] = c;
        indices[at + 2] = b;
      }
    }
    return { ...mesh, indices };
  });
  return { ...asset, materials, meshes };
}
