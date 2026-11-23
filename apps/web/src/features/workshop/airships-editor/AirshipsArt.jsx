/*
 * «Дирижабли» картинкой: 3D-снимки для обложки полки, плиток шаблонов и
 * выбора модели (ТЗ 11.10.2026, вечер: «на превью показывай не стандарт,
 * а то, что человек применил … где человек выбирает модель — чтобы при
 * выборе сразу рисовался дирижабль, дракон, воздушный шар, НЛО, небесные
 * фонарики, небесный кит»).
 *
 *   • `AirshipKindThumb` — одна модель вида в облике работы: дирижабль игры
 *     со своей надписью или своя модель Astral своими цветами, лого и
 *     текстурой; ракурс — откуда лучше видно лого вида;
 *   • `AirshipsSkyArt` — небо работы одним кадром: главный летающий крупно
 *     (дирижабль, если он есть в работе, иначе самый крупный из выбранных),
 *     остальные выбранные — меньше, над ним; у кого их несколько — до трёх
 *     копий (фонариков — стайка). Пусто — дирижабль как в игре.
 *
 * Снимки — общим невидимым кадром и из хранилища обложек (`SceneThumb`):
 * ключ снимка называет всё, что меняет картинку; листы надписи и картинок
 * моделей рисуются, только когда снимка ещё нет. Без пола и человека: на
 * плитке под моделью — матовая плашка карточки.
 */

import { useMemo } from "react";
import { AIRSHIP_KINDS, airshipDecorated, airshipGameRepainted, normalizeAirshipsProject } from "@modovik/climb-contract/recolor/airships";
import { desktopHost } from "../../../api.js";
import { loadSceneAsset } from "../model-stage/scene-asset.js";
import { loadSceneImage } from "../model-stage/scene-textures.js";
import SceneThumb from "../model-stage/SceneThumb.jsx";
import { AIRSHIPS_SCENE, airshipFrame, airshipModelInThread, airshipObject, airshipSceneLook, signTexture, skinTexture } from "./airships-art.js";
import { airshipSignKey, airshipSignSheet } from "./airships-sign.js";
import { airshipSkinKey, airshipSkinSheet } from "./airships-skin.js";

/* Версия снимков: поменялись модели, рамка или композиция — старые снимки не находятся (8 — модели «как настоящие», 11.10.2026). */
const ART_VERSION = 8;
/* Дирижабль сцены, пока она не прочитана (замер модели игры, 11.10.2026). */
const BLIMP_BOUNDS = Object.freeze({ min: [-7.63, -29.05, -8.59], max: [7.63, 29.05, 8.59] });
const NO_PARTS = Object.freeze([]);
const gameLook = airshipSceneLook({ sign: "game", body: "" }, null);

/* Ракурс модели вида: откуда видно её лого (крылья дракона и тарелку — сверху). */
export const AIRSHIP_KIND_VIEWS = Object.freeze({
  blimp: Object.freeze({ yaw: -1.35, pitch: 0.06, zoom: 0.62 }),
  dragon: Object.freeze({ yaw: -0.75, pitch: 0.55, zoom: 0.72 }),
  phoenix: Object.freeze({ yaw: -0.75, pitch: 0.55, zoom: 0.72 }),
  balloon: Object.freeze({ yaw: -1.5708, pitch: 0.08, zoom: 0.74 }),
  lantern: Object.freeze({ yaw: -1.5708, pitch: 0.1, zoom: 0.74 }),
  ufo: Object.freeze({ yaw: -0.9, pitch: 0.5, zoom: 0.72 }),
  whale: Object.freeze({ yaw: -1.35, pitch: 0.12, zoom: 0.66 }),
  jellyfish: Object.freeze({ yaw: -1.5708, pitch: 0.08, zoom: 0.74 }),
  banner: Object.freeze({ yaw: -1.5708, pitch: 0.1, zoom: 0.62 }),
  eastern_dragon: Object.freeze({ yaw: -0.2, pitch: 0.18, zoom: 0.66 }),
  griffin: Object.freeze({ yaw: -0.75, pitch: 0.5, zoom: 0.72 }),
});

/* Облик вида на снимке: всё, что меняет его картинку (размер работы — нет: рамка по модели). */
function kindLookKey(kindId, project) {
  if (kindId === "blimp") return airshipSignKey(project);
  const { count: _count, size: _size, decal: _decal, skin: _skin, ...colours } = project.fleet[kindId];
  return JSON.stringify([colours, airshipSkinKey(kindId, project)]);
}

/*
 * Что на борту дирижабля сейчас — для рамки «Своя картинка» колонки (`useSurfaceStock`): «как в игре» — лист игры (`null` без Astral
 * Desktop), иначе — лист работы 512 × 256 пикселями.
 */
export async function blimpSheetNow(project) {
  if (airshipSignKey(project) !== "game") return airshipSignSheet(project).catch(() => null);
  const asset = await loadSceneAsset(AIRSHIPS_SCENE).catch(() => null);
  const info = asset?.materials.find((item) => item.id === "sign");
  const entry = info && info.texture != null ? asset.textures[info.texture] : null;
  return entry ? loadSceneImage(entry, 512).catch(() => null) : null;
}

/* Облик дирижабля по листу работы: `{ look, release, cache }`. */
async function blimpLook(project) {
  if (airshipSignKey(project) === "game") {
    /* Лист игры не прочитан (Desktop без подключённой игры) — снимок не
       запоминается: подключат игру — снимется с листом. */
    const asset = await loadSceneAsset(AIRSHIPS_SCENE).catch(() => null);
    const info = asset?.materials.find((item) => item.id === "sign");
    const entry = info && info.texture != null ? asset.textures[info.texture] : null;
    const real = entry ? Boolean(await loadSceneImage(entry, 512).catch(() => null)) : false;
    return { look: gameLook, cache: real || !desktopHost() };
  }
  const sheet = await airshipSignSheet(project).catch(() => null);
  const texture = sheet ? signTexture(sheet) : null;
  return { look: airshipSceneLook(project.blimp, texture), release: () => texture?.dispose() };
}

/* Листы картинок своих моделей: `Map(вид → текстура)`. */
async function skinTextures(kinds, project) {
  const out = new Map();
  for (const kindId of kinds) {
    if (!airshipDecorated(kindId, project)) continue;
    const sheet = await airshipSkinSheet(kindId, project).catch(() => null);
    if (sheet) out.set(kindId, skinTexture(sheet));
  }
  return out;
}

/*
 * Рамка снимка: модель (или небо) целиком, без пола и человека. Приближение
 * по ширине и высоте рамки против настоящей плитки подбирает сам снимок —
 * по восьми углам коробки (`fittedFrame`, `scene-snapshot.js`): плитка вдвое
 * шире высоты, и длинное (дирижабль, небо в ряд) в шаре терялось на середине.
 */
function thumbFrame(bounds, view) {
  return { ...airshipFrame(bounds, { ...view, zoom: 1 }), bounds, ground: false, person: false };
}

/**
 * Снимок модели вида — опции `SceneThumb`/`sceneThumbUrl`: `{ scene, look,
 * lookKey, frame, parts, prepare }`.
 */
export function airshipKindThumbOptions(kindId, input) {
  const project = normalizeAirshipsProject(input);
  const view = AIRSHIP_KIND_VIEWS[kindId] || AIRSHIP_KIND_VIEWS.blimp;
  return {
    scene: AIRSHIPS_SCENE,
    look: gameLook,
    lookKey: JSON.stringify([ART_VERSION, "kind", kindId, kindLookKey(kindId, project)]),
    frame: (asset) => thumbFrame(asset?.bounds || BLIMP_BOUNDS, view),
    parts: kindId === "blimp" ? null : NO_PARTS,
    prepare: async () => {
      if (kindId === "blimp") return blimpLook(project);
      const skins = await skinTextures([kindId], project);
      /* Модель — один раз, в потоке моделей: её же рамка у снимка (освобождает `release`). */
      const model = await airshipModelInThread(kindId, project);
      const item = airshipObject(kindId, project, { skin: skins.get(kindId) || null, model });
      const bounds = item?.bounds || BLIMP_BOUNDS;
      return {
        parts: NO_PARTS,
        frame: () => thumbFrame(bounds, view),
        objects: () => (item ? [{ object: item.object }] : []),
        release: () => {
          item?.dispose();
          skins.forEach((texture) => texture.dispose());
        },
      };
    },
  };
}

/** Модель вида в облике работы — снимок для выбора модели. */
export function AirshipKindThumb({ kindId, project, className = "" }) {
  const options = useMemo(() => airshipKindThumbOptions(kindId, project), [kindId, project]);
  return <SceneThumb className={className} scene={options.scene} look={options.look} lookKey={options.lookKey} frame={options.frame} parts={options.parts} prepare={options.prepare} />;
}

/* ------------------------------------------------------------------ *
 * Небо одним кадром
 * ------------------------------------------------------------------ */

/* Главный — дирижабль, если он в работе; иначе самый крупный из выбранных. */
const MAIN_ORDER = Object.freeze(["whale", "eastern_dragon", "dragon", "banner", "phoenix", "griffin", "ufo", "jellyfish", "balloon", "lantern"]);
/* Сколько копий вида показать (фонариков — стайка). */
const COPIES = Object.freeze({ lantern: 7, other: 3 });
/* Поворот своей модели на снимке: дракон — вполоборота (видны крылья), фонарик — углом. */
const ART_YAW = Object.freeze({ dragon: 0.5, phoenix: 0.5, whale: 0, ufo: 0, balloon: 0, lantern: 0.6, jellyfish: 0, banner: 0, eastern_dragon: 0, griffin: 0.5 });
/* Ракурс неба: сбоку и чуть сверху, как с крыши. Камера — с −X: вправо по кадру — к −Y. */
const SKY_VIEW = Object.freeze({ yaw: -1.35, pitch: 0.2, zoom: 0.72 });

/**
 * Состав снимка неба: `{ blimp, main, sides: [{ kind, copies }] }` —
 * `blimp` — дирижабль сцены (в небе или в облике работы у штатного),
 * `main` — главный вид, `sides` — остальные выбранные.
 */
export function airshipsSkyCast(input) {
  const project = normalizeAirshipsProject(input);
  const own = AIRSHIP_KINDS.filter((kind) => kind.id !== "blimp" && project.fleet[kind.id].count > 0).map((kind) => kind.id);
  const blimp = project.fleet.blimp.count > 0 || airshipGameRepainted(project) || !own.length;
  const ordered = MAIN_ORDER.filter((id) => own.includes(id));
  const main = blimp ? "blimp" : ordered[0];
  const copiesOf = (kind) => Math.min(project.fleet[kind].count, kind === "lantern" ? COPIES.lantern : COPIES.other);
  const sides = ordered
    .filter((id) => id !== main)
    .slice(0, 4)
    .map((kind) => ({ kind, copies: copiesOf(kind) }));
  return { blimp, main, mainCopies: main === "blimp" ? 1 : copiesOf(main), sides };
}

/* Углы рамки модели, повёрнутой на `yaw`, в масштабе `k` и со сдвигом `at`. */
function placedBounds(bounds, k, yaw, at) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
  for (const x of [bounds.min[0], bounds.max[0]])
    for (const y of [bounds.min[1], bounds.max[1]])
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const point = [at[0] + k * (x * c - y * s), at[1] + k * (x * s + y * c), at[2] + k * z];
        point.forEach((value, axis) => {
          min[axis] = Math.min(min[axis], value);
          max[axis] = Math.max(max[axis], value);
        });
      }
  return { min, max };
}

const extentOf = (bounds) => Math.max(...bounds.max.map((value, axis) => value - bounds.min[axis]));

/*
 * Раскладка неба: главный в начале координат; остальные виды — рядом над
 * ним, каждый в своей доле ширины кадра (камера с −X, вправо по кадру — к
 * −Y), копии вида — уступом вправо, выше и дальше. У высокого главного
 * (шар, фонарик) места — по бокам. Длины — от длины главного `L`.
 */
/* Стайка фонариков: места копий в длинах стайки `[вглубь, вбок, вверх]`. */
const SWARM = Object.freeze([
  [0, 0, 0],
  [0.4, 1.1, 0.5],
  [0.8, -1.2, 0.3],
  [0.3, 0.6, -0.8],
  [1.2, -0.5, 0.9],
  [0.6, 1.9, -0.2],
  [0.9, -2.0, -0.5],
]);

function skyLayout(cast, sizes) {
  const mainBounds = sizes[cast.main];
  const length = extentOf(mainBounds);
  const span = mainBounds.max[1] - mainBounds.min[1];
  const tall = mainBounds.max[2] - mainBounds.min[2] > span * 0.8;
  const placed = [];
  /* Главный — свой вид: несколько в небе — ещё две копии за ним по бокам (фонарики — стайкой). */
  if (cast.main !== "blimp") {
    const yaw = ART_YAW[cast.main] || 0;
    for (let copy = 0; copy < cast.mainCopies; copy += 1) {
      if (cast.main === "lantern") {
        const [dx, dy, dz] = SWARM[copy];
        placed.push({ kind: cast.main, k: 1 - 0.06 * (copy % 3), yaw: yaw + copy * 0.35, at: [dx * length, dy * length, dz * length] });
      } else placed.push({ kind: cast.main, k: copy ? 0.72 : 1, yaw, at: copy ? [length * 0.55, (copy % 2 ? -1 : 1) * span * 0.62, length * 0.1] : [0, 0, 0] });
    }
  }
  const count = cast.sides.length;
  const size = count === 1 ? 0.48 : count === 2 ? 0.38 : 0.3;
  cast.sides.forEach(({ kind, copies }, index) => {
    const lantern = kind === "lantern";
    const k = (length * (lantern ? size * 0.3 : size)) / extentOf(sizes[kind]);
    const half = (k * (sizes[kind].max[2] - sizes[kind].min[2])) / 2;
    const share = count === 1 ? 0.5 : index / (count - 1);
    /* Место вида: над широким главным — своя доля ширины кадра; у высокого — слева и справа от него. */
    const anchor = tall
      ? [length * 0.2, (index % 2 ? -1 : 1) * (span / 2 + length * (0.3 + 0.32 * Math.floor(index / 2))), length * (0.12 - 0.3 * Math.floor(index / 2))]
      : [length * 0.3, (0.5 - share) * length * 0.86, mainBounds.max[2] + half + length * 0.04];
    /* Копии одного вида: одни над главным — во всю его длину; рядом с другими — уступом в своей доле. */
    const reach = count === 1 && !tall ? length * 0.4 : length * size * 0.4;
    for (let copy = 0; copy < copies; copy += 1) {
      const t = copies === 1 ? 0 : copy / (copies - 1) - 0.5;
      const offset = lantern
        ? SWARM[copy].map((value, axis) => value * length * size * (axis === 0 ? 0.3 : 0.32))
        : [length * 0.1 * copy, -reach * t * 2, length * 0.04 * (copy % 2)];
      placed.push({ kind, k: lantern ? k * (1 - 0.06 * (copy % 3)) : k * (copy ? 0.9 : 1), yaw: (ART_YAW[kind] || 0) + (lantern ? copy * 0.35 : 0), at: anchor.map((value, axis) => value + offset[axis]) });
    }
  });
  return placed;
}

/**
 * Снимок неба работы — опции `SceneThumb`/`sceneThumbUrl`: `{ scene, look,
 * lookKey, frame, parts, prepare }`.
 */
export function airshipsSkyThumbOptions(input) {
  const project = normalizeAirshipsProject(input);
  const cast = airshipsSkyCast(project);
  return {
    scene: AIRSHIPS_SCENE,
    look: gameLook,
    lookKey: JSON.stringify([
      ART_VERSION,
      "sky",
      cast.blimp ? airshipSignKey(project) : null,
      cast.main,
      cast.mainCopies,
      cast.main !== "blimp" ? kindLookKey(cast.main, project) : null,
      cast.sides.map((side) => [side.kind, side.copies, kindLookKey(side.kind, project)]),
    ]),
    frame: (asset) => thumbFrame(asset?.bounds || BLIMP_BOUNDS, SKY_VIEW),
    parts: cast.blimp ? null : NO_PARTS,
    prepare: async () => {
      /* Модели неба — в потоке моделей, по одной на вид: рамка и объекты берут их же. */
      const kinds = [...new Set([cast.main, ...cast.sides.map((side) => side.kind)])];
      const models = new Map();
      for (const kindId of kinds) models.set(kindId, await airshipModelInThread(kindId, project));
      const blimp = cast.blimp ? await blimpLook(project) : { look: gameLook };
      const skins = await skinTextures(kinds.filter((id) => id !== "blimp"), project);
      const asset = cast.blimp ? await loadSceneAsset(AIRSHIPS_SCENE).catch(() => null) : null;
      const sizes = { blimp: asset?.bounds || BLIMP_BOUNDS };
      for (const kindId of kinds) if (kindId !== "blimp") sizes[kindId] = models.get(kindId)?.bounds || BLIMP_BOUNDS;
      const placed = skyLayout(cast, sizes);
      /* Рамка — всё небо: дирижабль сцены и поставленные модели. */
      const all = [...(cast.blimp ? [sizes.blimp] : []), ...placed.map((item) => placedBounds(sizes[item.kind], item.k, item.yaw, item.at))];
      const bounds = {
        min: [0, 1, 2].map((axis) => Math.min(...all.map((item) => item.min[axis]))),
        max: [0, 1, 2].map((axis) => Math.max(...all.map((item) => item.max[axis]))),
      };
      return {
        look: blimp.look,
        cache: blimp.cache,
        parts: cast.blimp ? null : NO_PARTS,
        frame: () => thumbFrame(bounds, SKY_VIEW),
        objects: () =>
          placed.flatMap((item) => {
            const made = airshipObject(item.kind, project, { skin: skins.get(item.kind) || null, model: models.get(item.kind) });
            if (!made) return [];
            made.object.position.set(...item.at);
            made.object.scale.setScalar(item.k);
            made.object.rotation.z = item.yaw;
            return [{ object: made.object, dispose: made.dispose }];
          }),
        release: () => {
          blimp.release?.();
          skins.forEach((texture) => texture.dispose());
        },
      };
    },
  };
}

/** Небо работы одним снимком — обложка полки и плитка шаблона. */
export function AirshipsSkyArt({ project, className = "" }) {
  const options = useMemo(() => airshipsSkyThumbOptions(project), [project]);
  return <SceneThumb className={className} scene={options.scene} look={options.look} lookKey={options.lookKey} frame={options.frame} parts={options.parts} prepare={options.prepare} />;
}
