/*
 * «Дирижабли» в 3D-кадре и на обложке (ТЗ 11.10.2026: «на предпросмотре
 * просто покажи 3D этот дирижабль и на превью тоже»).
 *
 * Дирижабль — сцена из модели игры игрока (`prepare-airship-scene.mjs`):
 * оболочка с листом надписи, гондола с моторами, окна. Своя надпись — лист,
 * нарисованный окном той же функцией, что у установки (`airships-sign.js`);
 * «как в игре» — лист игры (его читает Astral Desktop, в браузере —
 * средний цвет листа). Драконы, фениксы, шары, фонарики, НЛО, киты,
 * медузы и самолёт с баннером — модели Astral (`airshipModel`): тело —
 * освещённый материал с нарисованным листом модели (чешуя, перья, кожа,
 * ткань), свечение — тот же лист своим светом, как `emissive` в игре; крылья машут, хвост ходит, огонь мерцает
 * той же формулой, что у второй кости модели в игре.
 */

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { airshipFlight, airshipKind, normalizeAirshipsProject } from "@modovik/climb-contract/recolor/airships";
import { AIRSHIP_PREVIEW_ATLAS, airshipModel, airshipMotionPose } from "@modovik/climb-contract/recolor/airship-models";
import { createSelectionHighlight } from "../model-stage/selection-highlight.js";
import { airshipPick } from "./airships-aim.js";
import { airshipSignKey, airshipSignSheet } from "./airships-sign.js";
import { airshipSkinKey, airshipSkinSheet } from "./airships-skin.js";
import { kindColours } from "./airships-text.js";

/* Сцена кадра и обложки: дирижабль игры, начало — его середина, нос — +Y. */
export const AIRSHIPS_SCENE = "/assets/workshop/airships/scene.bin";

/** Лист надписи для материала сцены: байты листа как есть (sRGB считает шейдер кадра). */
export function signTexture(sheet) {
  const texture = new THREE.DataTexture(new Uint8Array(sheet.rgba.buffer, sheet.rgba.byteOffset, sheet.rgba.byteLength), sheet.width, sheet.height, THREE.RGBAFormat);
  texture.colorSpace = THREE.NoColorSpace;
  /* Развёртка игры — v сверху вниз: первая строка листа — верх. */
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

/** Лист надписи работы для кадра: текстура или `null` («как в игре» или ещё рисуется). */
export function useAirshipSignTexture(project) {
  const normal = normalizeAirshipsProject(project);
  const key = airshipSignKey(normal);
  const [made, setMade] = useState(null);
  useEffect(() => {
    if (key === "game") {
      setMade(null);
      return undefined;
    }
    let cancelled = false;
    airshipSignSheet(normal)
      .then((sheet) => {
        if (!cancelled && sheet) setMade({ key, texture: signTexture(sheet) });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Лист перерисовывается по его отпечатку (`key`), а не по новому объекту работы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => () => made?.texture.dispose(), [made]);
  /* Пока новый лист рисуется — прежний: надпись не мигает цветом оболочки на каждой букве. */
  return key === "game" ? null : made?.texture || null;
}

/**
 * Облик сцены дирижабля по надписи работы (`sign`, `body` — из `blimp`):
 * оболочка — лист работы (`texture`), пока его нет — цвет оболочки; «как в
 * игре» — лист игры, в браузере средним цветом листа.
 */
export function airshipSceneLook({ sign, body }, texture) {
  return (index, info) => {
    if (info?.id === "sign") {
      if (sign === "game") return { colour: info.colour, roughness: 0.6 };
      return texture ? { colour: "#ffffff", texture, roughness: 0.6 } : { colour: body, map: false, roughness: 0.6 };
    }
    if (info?.id === "glass") return { colour: info.colour || "#08100e", roughness: 0.12, metalness: 0.1 };
    return { colour: info?.colour || "#8a8a8a", roughness: 0.5, metalness: 0.25 };
  };
}

/** Рамка кадра: модель и земля под ней с просветом — летающее висит над полом. */
export function airshipFrame(bounds, view = null) {
  const { min, max } = bounds;
  const gap = Math.max(1.5, (max[2] - min[2]) * 0.35);
  return {
    bounds: { min: [min[0], min[1], min[2] - gap], max: [...max] },
    centre: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    ground: true,
    person: true,
    view: view || { yaw: -0.95, pitch: 0.1, zoom: 1.05 },
  };
}

/*
 * Покачивание всей модели в кадре (как бы в полёте): период, размах подъёма
 * (доля размера), крен и рысканье, °. НЛО вертится, как в игре: столько
 * оборотов за круг полёта, сколько у его клипа.
 */
const SWAY = Object.freeze({
  dragon: { period: 4.5, lift: 0.05, roll: 9, yaw: 6 },
  phoenix: { period: 3.6, lift: 0.05, roll: 10, yaw: 6 },
  balloon: { period: 7, lift: 0.03, roll: 2, yaw: 10 },
  lantern: { period: 5, lift: 0.08, roll: 4, yaw: 14 },
  ufo: { period: 3.5, lift: 0.04, roll: 4, yaw: 0, spin: true },
  whale: { period: 8, lift: 0.04, roll: 5, yaw: 4 },
  jellyfish: { period: 9, lift: 0.04, roll: 3, yaw: 6 },
  banner: { period: 5, lift: 0.03, roll: 6, yaw: 3 },
  eastern_dragon: { period: 6, lift: 0.04, roll: 5, yaw: 4 },
  griffin: { period: 3.4, lift: 0.05, roll: 9, yaw: 6 },
});

/*
 * «Местное» движение частей — та же формула, что у второй кости модели в
 * игре: вершина v с долей w идёт в (1 − w)·v + w·(q·v + f), поза — по
 * времени (`airshipMotionPose`). Крылья машут, хвост ходит, огонь мерцает,
 * огни НЛО бегут. Возвращает функцию кадра или `null` (у части доли нет).
 */
function partMotion(geometry, flex) {
  const moving = [];
  for (let index = 0; index < flex.length; index += 1) if (flex[index] > 1e-4) moving.push(index);
  if (!moving.length) return null;
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const rest = Float32Array.from(position.array);
  const restNormals = Float32Array.from(normal.array);
  const turn = new THREE.Quaternion();
  const vector = new THREE.Vector3();
  return ({ q, f }) => {
    turn.set(q[0], q[1], q[2], q[3]);
    const turned = Math.abs(q[3]) < 1 - 1e-9;
    for (const index of moving) {
      const w = flex[index];
      const at = index * 3;
      vector.set(rest[at], rest[at + 1], rest[at + 2]);
      if (turned) vector.applyQuaternion(turn);
      position.array[at] = rest[at] + w * (vector.x + f[0] - rest[at]);
      position.array[at + 1] = rest[at + 1] + w * (vector.y + f[1] - rest[at + 1]);
      position.array[at + 2] = rest[at + 2] + w * (vector.z + f[2] - rest[at + 2]);
      if (turned) {
        vector.set(restNormals[at], restNormals[at + 1], restNormals[at + 2]).applyQuaternion(turn);
        vector.set(restNormals[at] + w * (vector.x - restNormals[at]), restNormals[at + 1] + w * (vector.y - restNormals[at + 1]), restNormals[at + 2] + w * (vector.z - restNormals[at + 2])).normalize();
        normal.array[at] = vector.x;
        normal.array[at + 1] = vector.y;
        normal.array[at + 2] = vector.z;
      }
    }
    position.needsUpdate = true;
    if (turned) normal.needsUpdate = true;
  };
}

function atlasTexture(atlas) {
  const texture = new THREE.DataTexture(new Uint8Array(atlas.rgba.buffer, atlas.rgba.byteOffset, atlas.rgba.byteLength), atlas.width, atlas.height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  /* Развёртка договора — v сверху вниз, как у листа игры. Лист нарисован
     (чешуя, перья, ткань) — сглаживание, как у текстуры в игре. */
  texture.flipY = false;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** Лист картинки модели (лого и своя текстура) для материала: те же байты, что уедут в игру. */
export function skinTexture(sheet) {
  const texture = new THREE.DataTexture(new Uint8Array(sheet.rgba.buffer, sheet.rgba.byteOffset, sheet.rgba.byteLength), sheet.width, sheet.height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  /* Оболочка шара замкнута по кругу: шов развёртки берёт соседний край листа. */
  texture.wrapS = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** Лист картинки вида для кадра: текстура или `null` (у вида нет лого и текстуры, или лист ещё рисуется). */
export function useAirshipSkinTexture(kindId, project) {
  const key = kindId === "blimp" ? "" : airshipSkinKey(kindId, project);
  const [made, setMade] = useState(null);
  useEffect(() => {
    if (!key) {
      setMade(null);
      return undefined;
    }
    let cancelled = false;
    airshipSkinSheet(kindId, project)
      .then((sheet) => {
        if (!cancelled && sheet) setMade({ key, kindId, texture: skinTexture(sheet) });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Лист перерисовывается по его отпечатку (`key`), а не по новому объекту работы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => () => made?.texture.dispose(), [made]);
  /* Пока новый лист рисуется — прежний того же вида: лого не мигает. */
  return key && made?.kindId === kindId ? made.texture : null;
}

/**
 * Своя модель вида объектом кадра: `{ object, update, select, dispose, bounds }`
 * или `null` (у дирижабля модель — сцена игры). Тело — освещённое, части
 * `glow` — ещё и своим светом; крылья, хвост, огонь и огни движутся своим
 * «местным» движением, как в игре (`partMotion`). `skin` — текстура
 * листа картинки (`skinTexture`): пока её нет, тело с картинкой — главным
 * цветом вида. Текстуру листа освобождает тот, кто её дал.
 *
 * Модель можно выбирать щелчком (18.10.2026): корень и каждая часть называют
 * себя правимыми (`userData.pick`, `airships-aim.js`), а `select(roles)` кладёт
 * штрихи выбора (тот же слой, что у сеток сцены) на части с этими ролями.
 * Штрихи — копии геометрии частей внутри того же качающегося узла, поэтому
 * идут за покачиванием и за взмахами крыльев.
 */
export function airshipObject(kindId, input, { skin = null, model: ready = null } = {}) {
  const project = normalizeAirshipsProject(input);
  /* Лист модели — тем же рисунком, что уйдёт в игру, вдвое меньше: смена цвета перерисовывает его быстро.
     `model` — та же модель, уже собранная в потоке (`useAirshipObjectsState`). */
  const model = ready || airshipModel(kindId, project, { atlasSize: AIRSHIP_PREVIEW_ATLAS });
  if (!model?.parts.length) return null;
  const map = atlasTexture(model.atlas);
  const plainColour = kindColours(kindId, project)[0];
  const group = new THREE.Group();
  group.name = `airship-${kindId}`;
  /* Щелчок по модели (корень и части): вид и часть, что под курсором. */
  group.userData.pick = airshipPick(kindId);
  const pivot = new THREE.Group();
  group.add(pivot);
  const geometries = [];
  const materials = [];
  const motions = [];
  /* Геометрия частей по ролям — для штрихов выбора: слою нужна только геометрия и мировая матрица. */
  const byRole = new Map();
  for (const part of model.parts) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(part.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(part.normals, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(part.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(part.indices, 1));
    geometry.computeBoundingSphere();
    let material;
    /* Часть с картинкой — своим листом; пока его нет — главным цветом вида. */
    const sheet = part.texture === "skin" ? skin : map;
    const colourOnly = part.texture === "skin" && !skin;
    const surface = colourOnly ? { color: new THREE.Color(plainColour) } : { map: sheet };
    if (part.role === "flame") {
      /* Огонь и яркие огни — только своим светом: цвет листа как есть, без
         освещённой подложки (иначе огонь выгорает в бледный). */
      material = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: sheet, emissiveIntensity: 1.1, roughness: 1, metalness: 0 });
    } else if (part.shader === "emissive") {
      /* Свечение — своим светом поверх освещённого: форма видна, а цвет
         светится сам, как `emissive` в игре (множитель 1,2…6 → 0,4…0,9:
         притушенные огни НЛО — едва). */
      const level = Math.min(1.1, 0.35 * Math.sqrt(part.emissive));
      const glowing = colourOnly ? { emissive: new THREE.Color(plainColour) } : { emissive: 0xffffff, emissiveMap: sheet };
      material = new THREE.MeshStandardMaterial({ ...surface, ...glowing, emissiveIntensity: level, roughness: 0.6, metalness: 0 });
    } else material = new THREE.MeshStandardMaterial({ ...surface, roughness: 0.72, metalness: 0.04 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = part.shader !== "emissive";
    mesh.receiveShadow = part.shader !== "emissive";
    const motion = part.flex ? partMotion(geometry, part.flex) : null;
    if (motion) {
      motions.push(motion);
      /* Движущаяся часть выходит за рамку покоя: не отсекать её по рамке. */
      mesh.frustumCulled = false;
    }
    mesh.userData.pick = airshipPick(kindId, part.role);
    pivot.add(mesh);
    geometries.push(geometry);
    materials.push(material);
    if (!byRole.has(part.role)) byRole.set(part.role, []);
    /* Штрихи сидят в том же узле, что и часть: её матрица в узле — единичная. */
    byRole.get(part.role).push({ geometry, matrixWorld: new THREE.Matrix4(), updateWorldMatrix() {} });
  }
  let selection = null;
  const sway = SWAY[kindId] || SWAY.whale;
  const size = Math.max(...model.bounds.max.map((value, axis) => value - model.bounds.min[axis]));
  const toRad = Math.PI / 180;
  const info = airshipKind(kindId);
  const spin = sway.spin && info?.spin ? info.spin / airshipFlight(kindId, project).duration : 0;
  return {
    object: group,
    bounds: model.bounds,
    update(seconds = 0) {
      const phase = (seconds * Math.PI * 2) / sway.period;
      pivot.position.z = size * sway.lift * Math.sin(phase);
      /* Крен — вокруг продольной оси (Y, нос), рысканье — вокруг вертикали. */
      pivot.rotation.y = sway.roll * toRad * Math.sin(phase * 0.5);
      pivot.rotation.z = spin ? seconds * spin * Math.PI * 2 : sway.yaw * toRad * Math.sin(phase * 0.37);
      pivot.rotation.x = (info?.heading ? 2 : 1) * toRad * Math.cos(phase);
      if (motions.length) {
        const pose = airshipMotionPose(kindId, project, seconds);
        if (pose) for (const motion of motions) motion(pose);
      }
    },
    /* Штрихи выбора на частях с этими ролями (`[]` — снять). Кадр модели и так перерисовывается каждый кадр. */
    select(roles = []) {
      const meshes = roles.flatMap((role) => byRole.get(role) || []);
      if (!meshes.length && !selection) return;
      selection ||= createSelectionHighlight({ parent: pivot, invalidate: () => {} });
      selection.set("select", meshes);
    },
    dispose() {
      selection?.dispose();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      map.dispose();
    },
  };
}

/*
 * Модель в потоке (`airships-model-worker.js`): один поток на окно, одна модель в работе; пока она строится,
 * новые шаги палитры только сменяют следующую — до потока доходит последняя.
 */
const modelWorker = { worker: null, dead: typeof Worker !== "function", busy: null, next: null, id: 1 };

function sendModelJob(job) {
  if (!modelWorker.worker) {
    modelWorker.worker = new Worker(new URL("./airships-model-worker.js", import.meta.url), { type: "module" });
    modelWorker.worker.onmessage = (event) => {
      const { id, model, error } = event.data || {};
      const done = modelWorker.busy;
      if (!done || done.id !== id) return;
      modelWorker.busy = null;
      if (error) done.reject(new Error(error));
      else done.resolve(model);
      if (modelWorker.next) {
        const queued = modelWorker.next;
        modelWorker.next = null;
        sendModelJob(queued);
      }
    };
    modelWorker.worker.onerror = () => {
      modelWorker.dead = true;
      modelWorker.worker?.terminate?.();
      modelWorker.worker = null;
      for (const job of [modelWorker.busy, modelWorker.next]) job?.reject(new Error("worker"));
      modelWorker.busy = modelWorker.next = null;
    };
  }
  modelWorker.busy = job;
  modelWorker.worker.postMessage({ id: job.id, kindId: job.kindId, project: job.project, atlasSize: AIRSHIP_PREVIEW_ATLAS });
}

/** Модель вида в потоке; `null` — её сменил более новый запрос. Потока нет — модель строится здесь. */
function buildAirshipModel(kindId, project) {
  if (modelWorker.dead) return Promise.resolve(airshipModel(kindId, project, { atlasSize: AIRSHIP_PREVIEW_ATLAS }));
  return new Promise((resolve, reject) => {
    const job = { id: modelWorker.id++, kindId, project, resolve, reject };
    if (!modelWorker.busy) {
      try {
        sendModelJob(job);
      } catch {
        modelWorker.dead = true;
        resolve(airshipModel(kindId, project, { atlasSize: AIRSHIP_PREVIEW_ATLAS }));
      }
      return;
    }
    modelWorker.next?.resolve(null);
    modelWorker.next = job;
  });
}

/*
 * Модель вида для снимка — в потоке моделей, тем же способом, что у кадра; вернул поток `null` (его сменил
 * более новый запрос) — строится здесь, как прежде.
 */
export async function airshipModelInThread(kindId, project) {
  return (await buildAirshipModel(kindId, project)) || airshipModel(kindId, project, { atlasSize: AIRSHIP_PREVIEW_ATLAS });
}

/**
 * Объекты кадра для вида: `{ item, pending }` — своя модель (пересобирается по её облику и листу картинки) и
 * строится ли новая. Всё — в потоке: правка того же вида (цвет, размер, узор) — кадр до её конца показывает прежнюю
 * модель, палитра и ползунки руку не ждут (19.10.2026); новый вид в кадре — тоже: пока его первая модель строится,
 * на кадре «Обновляю…» (`pending`), рамка и камера встают по модели, когда она готова. Первую модель вида строил
 * главный поток — ~180 мс на смену вида при процессоре ×4 (Mac, 22.10: роспись листа модели, `paint`/`noise`/`blend`).
 */
export function useAirshipObjectsState(kindId, project) {
  const normal = normalizeAirshipsProject(project);
  const item = normal.fleet[kindId];
  const skin = useAirshipSkinTexture(kindId, normal);
  /* «Сколько в небе» модели не меняет (`airshipModel` его не читает): ползунок числа пересобирал модель
     на каждый шаг. */
  const { count: _count, ...shape } = item || {};
  const key = JSON.stringify([kindId, item ? shape : null]);
  const own = kindId !== "blimp";
  const [built, setBuilt] = useState(null);
  /* Потока нет (тесты, старый браузер) — модель строится здесь, на каждую правку, как до 19.10. */
  const local = modelWorker.dead;
  const here = useMemo(
    () => (own && local ? { key, kindId, project: normal, model: airshipModel(kindId, normal, { atlasSize: AIRSHIP_PREVIEW_ATLAS }) } : null),
    // Модель пересобирается по смыслу (`key`), а не по новому объекту работы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [own, local, key],
  );
  const warm = !local && built && built.kindId === kindId ? built : null;
  const shown = here || warm;
  useEffect(() => {
    if (!own || local || (shown && shown.key === key)) return undefined;
    let cancelled = false;
    buildAirshipModel(kindId, normal)
      .then((model) => {
        if (!cancelled && model) setBuilt({ key, kindId, project: normal, model });
      })
      .catch(() => {
        if (!cancelled) setBuilt({ key, kindId, project: normal, model: airshipModel(kindId, normal, { atlasSize: AIRSHIP_PREVIEW_ATLAS }) });
      });
    return () => {
      cancelled = true;
    };
    // Модель строится по смыслу (`key`), а не по новому объекту работы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, own, local, shown?.key]);
  const made = useMemo(
    () => (shown?.model ? airshipObject(kindId, shown.project, { skin, model: shown.model }) : null),
    // Объект — по готовой модели и листу картинки.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown?.model, skin],
  );
  useEffect(() => () => made?.dispose(), [made]);
  return { item: made, pending: Boolean(own && (!shown || shown.key !== key)) };
}

/** Объекты кадра для вида: своя модель или `null`. */
export function useAirshipObjects(kindId, project) {
  return useAirshipObjectsState(kindId, project).item;
}
