// Описания кадров сцен для обложек частей редукса: окно-съёмщик отдаёт их snapshotScene.
// Кадр модуль не снимает, он собирает { url, look, frame, objects?, release? }.
import { finishTextureNow } from "../../workshop/finish/finish-textures.js";
import { placeBounds } from "../../workshop/model-stage/ring-fade.js";

// ---------------------------------------------------------------- соседи

// тяжёлые соседи грузятся только когда сцена действительно нужна
const SOURCES = {
  buildingContract: () => import("@modovik/climb-contract/recolor/buildings"),
  buildingArt: () => import("../../workshop/building-editor/building-art.js"),
  buildingText: () => import("../../workshop/building-editor/building-text.js"),
  roadsScene: () => import("../../workshop/roads-editor/roads-scene.js"),
  roadsText: () => import("../../workshop/roads-editor/roads-text.js"),
  vegContract: () => import("@modovik/climb-contract/recolor/vegetation"),
  oakArt: () => import("../../workshop/vegetation-editor/oak-art.js"),
  bushArt: () => import("../../workshop/vegetation-editor/bush-art.js"),
  vegText: () => import("../../workshop/vegetation-editor/vegetation-text.js"),
  sandyScene: () => import("../../workshop/vegetation-editor/sandy-scene.js"),
  sceneTextures: () => import("../../workshop/model-stage/scene-textures.js"),
  sceneAsset: () => import("../../workshop/model-stage/scene-asset.js"),
  hangarContract: () => import("@modovik/climb-contract/recolor/hangar"),
  hangarText: () => import("../../workshop/hangar-editor/hangar-text.js"),
  three: () => import("three"),
};

// все модули стартуют сразу; ответ — объект «имя -> модуль»
const gather = (names) =>
  Promise.all(names.map((name) => SOURCES[name]())).then((mods) =>
    Object.fromEntries(names.map((name, i) => [name, mods[i]])),
  );

// функция (options) -> обещание: сначала подгружаются модули, потом build(модули, options)
const onDemand = (names, build) => (options) =>
  gather(names).then((mods) => build(mods, options));

// ---------------------------------------------------------------- помощники

const LEAF_SHEET_SIZE = 256;
const GROUND_ROUGHNESS = 0.94;
const GRASS_ANISOTROPY = 4;

// метка «этот ключ в объект не класть»
const OMIT = Symbol("omit");

const assemble = (pairs) => Object.fromEntries(pairs.filter(([, value]) => value !== OMIT));

function finiteOr(value, fallback) {
  if (Number.isFinite(value)) return value;
  return fallback;
}

const lookBy = (resolve) => (slot, info) => resolve(info);
const shotOf = (url, look, frame, tail = {}) => ({ url, look, frame, ...tail });

// отказ обещания превращается в null
const orNull = (thenable) =>
  Promise.resolve(thenable).then(
    (value) => value,
    () => null,
  );

// выполнить работу сразу, а любое исключение отдать как отказ обещания
const attempt = (job) => new Promise((resolve) => resolve(job()));

// шаги строго по очереди: следующий начинается после завершения предыдущего
const inSequence = (items, step) =>
  items.reduce((tail, item) => tail.then(() => step(item)), Promise.resolve());

// считает по ключу один раз; повтор (в том числе null) берёт из хранилища
const remember = async (store, key, produce) => {
  if (!store.has(key)) store.set(key, await produce());
  return store.get(key);
};

const finishEach = (pairs) =>
  pairs.reduce((done, [key, value]) => ({ ...done, [key]: finishTextureNow(value) }), {});

// рамка с границами сцены: bounds, ground, view и необязательные пары; `own` — свои границы (кадр у фасада), иначе — само место
const boundedFrame = (asset, ground, view, extras = [], own = null) =>
  assemble([["bounds", own || placeBounds(asset)], ["ground", ground], ["view", view], ...extras]);

// ---------------------------------------------------------------- рамки земли

const orbit = (zoom) =>
  Object.freeze(
    Object.fromEntries([
      ["yaw", 0.15],
      ["pitch", 0.7],
      ["zoom", zoom],
    ]),
  );
const anchor = (x, y) => Object.freeze([x, y, 10]);

export const TERRAIN_COVER_VIEW = orbit(0.17);
export const TERRAIN_COVER_CENTRE = anchor(80, -100);
export const TERRAIN_VARIANT_VIEW = orbit(0.1);
export const TERRAIN_VARIANT_CENTRE = anchor(150, -165);

const GROUND_AIM = {
  land: { view: TERRAIN_VARIANT_VIEW, centre: TERRAIN_VARIANT_CENTRE },
  cover: { view: TERRAIN_COVER_VIEW, centre: TERRAIN_COVER_CENTRE },
};

// ---------------------------------------------------------------- рамки сцен из моделей мода

const crown = (pitch) => () => (asset) => boundedFrame(asset, false, { yaw: -0.65, pitch });

const hangarShowcase =
  ({ hangarText }) =>
  (asset) =>
    Object.assign({}, hangarText.hangarShowcaseFrame(asset), { lighting: "interior" });

const hangarInterior =
  ({ hangarText }) =>
  (asset) =>
    hangarText.hangarInsideFrame(asset);

const orbitOf = (view) =>
  assemble([
    ["yaw", finiteOr(view?.yaw, -0.62)],
    ["pitch", finiteOr(view?.pitch, 0.4)],
    ["zoom", finiteOr(view?.zoom, OMIT)],
  ]);

// необязательные ключи рамки models: ключ -> как достать значение из описания вида
const MODEL_EXTRAS = [
  ["lighting", (view) => (view?.lighting === "interior" ? "interior" : OMIT)],
  ["ambient", (view) => finiteOr(view?.ambient, OMIT)],
  ["crop", (view) => (view?.crop === true ? true : OMIT)],
  /* Светлая студия под прозрачные объёмы автора (`mod-model-scene.js`: `GHOST_SHARE`): пол светлее, матовое поле кадра — тоже (`shooter-service.js`). */
  ["backdrop", (view) => (view?.backdrop === "light" ? "light" : OMIT)],
  /* Середина кадра (у здания — середина фасада): без неё камера смотрит в середину коробки, а та смещена вперёд, на пустую полосу перед стеной. */
  ["centre", (view) => (Array.isArray(view?.centre) && view.centre.length === 3 && view.centre.every(Number.isFinite) ? view.centre : OMIT)],
];

// коробка кадра из плана (`view.bounds`, оси сцены): у здания — его главный фасад с полосой перед ним; нет её — всё место
const ownBounds = (view) => {
  const { min, max } = view?.bounds || {};
  const fits = (list) => Array.isArray(list) && list.length === 3 && list.every(Number.isFinite);
  return fits(min) && fits(max) ? { min, max } : null;
};

const modelsFrame =
  (mods, { view = null } = {}) =>
  (asset) =>
    boundedFrame(
      asset,
      true,
      orbitOf(view),
      MODEL_EXTRAS.map(([key, pick]) => [key, pick(view)]),
      ownBounds(view),
    );

/* Объекты в небе (северное сияние, редукс Barbie): камера на земле смотрит вверх-вдаль на объекты на их настоящих местах; пола, тени и человека-мерки нет — небо пишет рисовальщик
   (`shooter-service.js`: ночной градиент и свечение). Рамка — по границам самих объектов (`view.bounds`), взгляд — из плана (`view`). */
const skyFrame =
  (mods, { view = null } = {}) =>
  (asset) =>
    boundedFrame(asset, false, orbitOf(view), [["ambient", finiteOr(view?.ambient, OMIT)]], ownBounds(view));

export const MOD_SCENE_FRAMES = Object.freeze({
  sky: onDemand([], skyFrame),
  tree: onDemand([], crown(0.05)),
  plant: onDemand([], crown(0.6)),
  hangar: onDemand(["hangarText"], hangarShowcase),
  "hangar-inside": onDemand(["hangarText"], hangarInterior),
  models: onDemand([], modelsFrame),
});

// ---------------------------------------------------------------- листы листвы

const leafFromPixels = (art, pixels, bake) => {
  const { width, height } = pixels;
  return art.leafTexture({ rgba: new Uint8ClampedArray(bake(pixels)), width, height });
};

// лист: картинка -> пиксели -> перекрашенные байты (bake) -> текстура; нет листа -> null
const bakeLeaf = (art, textures, entry, bake) =>
  orNull(textures.loadSceneImage(entry, LEAF_SHEET_SIZE)).then((image) => {
    const pixels = image && art.bitmapPixels(image);
    return pixels ? leafFromPixels(art, pixels, bake) : null;
  });

// ---------------------------------------------------------------- трава Сэнди-Шорс

const sheetUrl = (id) => `/assets/workshop/vegetation/green/${id}.webp`;

const rasterOf = (bitmap) => {
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
};

// картинка листа склада травы или null (404, сбой сети, битый файл)
const readGrassSheet = (id) =>
  attempt(() => fetch(sheetUrl(id)))
    .then((response) => (response.ok ? response.blob() : null))
    .then((blob) => (blob ? createImageBitmap(blob).then(rasterOf) : null))
    .catch(() => null);

const paintedCanvas = (base, rgba) => {
  const { width, height } = base;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return canvas;
};

const grassTexture = (THREE, canvas) => {
  const texture = new THREE.CanvasTexture(canvas);
  const settings = [
    ["colorSpace", THREE.NoColorSpace],
    ["flipY", false],
    ["wrapS", THREE.RepeatWrapping],
    ["wrapT", THREE.RepeatWrapping],
    ["anisotropy", GRASS_ANISOTROPY],
    ["needsUpdate", true],
  ];
  settings.forEach(([key, value]) => {
    texture[key] = value;
  });
  return texture;
};

// пары [лист, красить ли], которые понадобятся материалам сцены
const grassRequests = (asset) =>
  (asset.materials || []).flatMap((info) => {
    const greens = (info.green || []).filter(Boolean).map((entry) => [entry[0], entry[1]]);
    const maskId = info.terrain?.maskGreen;
    return maskId != null ? [...greens, [maskId, false]] : greens;
  });

// склад текстур травы: ключ «лист|цвет», null тоже запоминается
function grassLibrary(contract, THREE, colour) {
  const store = new Map();
  const keyOf = (id, tinted) => id + "|" + (tinted && colour ? colour : "");

  const produce = async (id, tinted) => {
    const base = await readGrassSheet(id);
    if (!base) return null;
    const rgba = tinted && colour ? contract.recolourGrass(base.data, colour) : base.data;
    return grassTexture(THREE, paintedCanvas(base, rgba));
  };

  return {
    load: (id, tinted) => remember(store, keyOf(id, tinted), () => produce(id, tinted)),
    byEntry: (entry) => (entry ? store.get(keyOf(entry[0], entry[1])) || null : null),
    plain: (id) => store.get(id + "|") || null,
    release: () => store.forEach((texture) => texture?.dispose()),
  };
}

const grassLookOf = (library) => (info) => {
  const { green, terrain } = info;
  const maskId = terrain?.maskGreen;
  return assemble([
    ["texture", library.byEntry(green[0]) ?? OMIT],
    ["layers", terrain ? [null, ...[1, 2, 3].map((n) => library.byEntry(green[n]))] : OMIT],
    ["mask", maskId != null ? library.plain(maskId) : OMIT],
  ]);
};

const countryGrassOn = (looks) => Boolean(looks.sandy?.zones?.country?.enabled);

// обещание { look(info), release() } или null, когда трава за городом у работы выключена
async function grassVariant(project, sceneUrl) {
  const kit = await gather(["vegContract", "vegText", "three"]);
  const work = kit.vegContract.normalizeVegetationProject(project);
  const looks = kit.vegContract.compileVegetationLooks(work);
  if (!countryGrassOn(looks)) return null;

  const colour = kit.vegText.grassPreviewColour(work, "country");
  const library = grassLibrary(kit.vegContract, kit.three, colour);
  const { sceneAsset } = await gather(["sceneAsset"]);
  const asset = await sceneAsset.loadSceneAsset(sceneUrl);
  await inSequence(grassRequests(asset), ([id, tinted]) => library.load(id, tinted));
  return { look: grassLookOf(library), release: library.release };
}

// ---------------------------------------------------------------- здания и дороги

const MALL = "megamall";

const megamallShot = onDemand(
  ["buildingContract", "buildingArt", "buildingText"],
  ({ buildingContract: contract, buildingArt: art, buildingText: text }) => {
    const draft = contract.createBuildingProject(MALL);
    const project = contract.normalizeBuildingProject(MALL, draft);
    const finishes = finishEach([["building", project.building], ...Object.entries(project.parts)]);
    const scene = contract.buildingInventory(MALL)?.scenes?.[0];
    return scene
      ? shotOf(
          scene.url,
          lookBy((info) => text.buildingFrameLook(project, MALL, info, { finishes })),
          text.buildingShowcaseFrame(MALL),
          { objects: () => art.buildingPlateObjectsNow(project, MALL) },
        )
      : null;
  },
);

const roadsShot = onDemand(["roadsScene", "roadsText"], ({ roadsScene, roadsText }) =>
  shotOf(
    roadsText.ROADS_SCENE_URL,
    roadsScene.nativeRoadLook,
    roadsText.roadsFrame("near", { thumb: true }),
  ),
);

const hangarShot = onDemand(
  ["hangarContract", "hangarText"],
  ({ hangarContract: contract, hangarText: text }) => {
    const draft = contract.createHangarProject();
    const project = contract.normalizeHangarProject(draft);
    const parts = ["outside", "inside", "floor"];
    const textures = finishEach(parts.map((part) => [part, project[part]]));
    return shotOf(
      contract.HANGAR_INVENTORY.scene.url,
      lookBy((info) => text.hangarFrameLook(project, info, { textures })),
      text.hangarShowcaseFrame,
    );
  },
);

// ---------------------------------------------------------------- растительность

const workOf = (contract, project) => {
  if (!project) return contract.createVegetationProject();
  return contract.normalizeVegetationProject(project);
};

const oakShot = onDemand(
  ["vegContract", "oakArt", "vegText", "sceneTextures"],
  async (
    { vegContract: contract, oakArt: art, vegText: text, sceneTextures: textures },
    { project } = {},
  ) => {
    const work = workOf(contract, project);
    const sheet = art.OAK_LEAVES[work.improved?.enabled ? "improved" : "stock"];
    const leaf = await bakeLeaf(art, textures, sheet, ({ rgba, width, height }) => {
      const looks = text.compileVegetationLooks(work);
      return text.previewLeaf(rgba, width, height, looks, "oak");
    });
    return shotOf(art.oakSceneUrl(work), art.oakLook(leaf), art.oakThumbFrame, {
      release: () => {
        leaf?.dispose();
      },
    });
  },
);

// облики работы, если кусты красятся, иначе null
const paintedBushLooks = (contract, project) => {
  const looks = contract.compileVegetationLooks(contract.normalizeVegetationProject(project));
  return looks.bushes ? looks : null;
};

// материалы-листва с записью листа в сцене: пары [материал, запись]
const leafSlots = (asset) =>
  (asset.materials || []).flatMap((material) => {
    if (material.group !== "leaves" || material.texture == null) return [];
    const entry = asset.textures?.[material.texture];
    return entry ? [[material, entry]] : [];
  });

// текстуры листьев куста по имени материала; листы грузятся по очереди
async function bushLeaves(kit, url, looks, hedge) {
  const asset = await kit.sceneAsset.loadSceneAsset(url);
  const leaves = new Map();
  await inSequence(leafSlots(asset), async ([material, entry]) => {
    const bake = ({ rgba, width, height }) =>
      kit.vegText.previewBushLeaf(rgba, width, height, looks, material.name, { opaque: hedge });
    const texture = await bakeLeaf(kit.oakArt, kit.sceneTextures, entry, bake);
    if (texture) leaves.set(material.name, texture);
  });
  return leaves;
}

const bushShot = (id) =>
  onDemand(["bushArt"], async ({ bushArt }, { project } = {}) => {
    const hedge = id === "hedge";
    const url = bushArt.BUSH_SCENES[id];
    const frame = hedge ? bushArt.hedgeFrame : bushArt.bushFrame;
    const plain = shotOf(url, lookBy((info) => ({ colour: info.colour })), frame);
    if (!project) return plain;

    const kit = await gather(["vegContract", "vegText", "oakArt", "sceneTextures", "sceneAsset"]);
    const looks = paintedBushLooks(kit.vegContract, project);
    if (!looks) return plain;

    const leaves = await bushLeaves(kit, url, looks, hedge);
    return shotOf(url, bushArt.bushLook(leaves), frame, {
      release: () => leaves.forEach((texture) => texture.dispose()),
    });
  });

// ---------------------------------------------------------------- земля

const groundLookOf = (grass) => (info) =>
  Object.assign(
    { colour: info.colour, roughness: GROUND_ROUGHNESS },
    grass && info.green && grass.look(info),
  );

const terrainShot = onDemand(
  ["sandyScene"],
  async ({ sandyScene: sandy }, { project, frame } = {}) => {
    const grass = project ? await grassVariant(project, sandy.SANDY_SCENE_URL) : null;
    const aim = GROUND_AIM[Boolean(project) || frame === "land" ? "land" : "cover"];
    const fixed = { view: aim.view, centre: aim.centre, fit: false };
    return assemble([
      ["url", sandy.SANDY_SCENE_URL],
      ["look", lookBy(groundLookOf(grass))],
      ["release", grass ? grass.release : OMIT],
      ["frame", (asset) => Object.assign({}, sandy.sandyFlightFrame(asset), fixed)],
    ]);
  },
);

export const SCENE_SHOTS = Object.freeze({
  megamall: megamallShot,
  roads: roadsShot,
  oak: oakShot,
  terrain: terrainShot,
  bush: bushShot("bush"),
  hedge: bushShot("hedge"),
  hangar: hangarShot,
});
