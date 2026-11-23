/*
 * Дуб кадра, обложки и плиток «Растительности» — одно дерево в воздухе на
 * матовой плашке, без земли.
 *
 * Модель — `prop_tree_oak_01` из игры игрока (сцена `oak.bin`: сетки и
 * адреса листов, `scripts/prepare-oak-scene.mjs`), а при включённых
 * «Моделях» — тот же дуб «Реалистичных деревьев» из поставки Astral
 * (`oak-improved.bin`): его и поставит установщик. Листва — лист сцены,
 * перекрашенный той же арифметикой, что у установщика (`previewLeaf`,
 * порода «Дубы»): цвет, эффект и густота. Без игры лист дуба игры не
 * прочесть — тогда он нарисован (та же альфа формы), и подпись кадра
 * говорит это.
 */

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { normalizeVegetationProject, vegetationProjectSignature } from "@modovik/climb-contract/recolor/vegetation";
import { leafPixels } from "../../../components/desktop/workshop/vegetation/vegetation-textures.js";
import { loadSceneImage } from "../model-stage/scene-textures.js";
import { leafRecolourer } from "./leaf-recolour.js";
import { compileVegetationLooks, leafParams } from "./vegetation-text.js";

export const OAK_SCENES = Object.freeze({
  stock: "/assets/workshop/vegetation/oak.bin",
  improved: "/assets/workshop/vegetation/oak-improved.bin",
});

/*
 * Лист листвы каждой сцены — та же запись, что в сцене: дуб игры читает его
 * у игры игрока (словарь породы «Дубы» описи растительности), дуб мода —
 * уменьшенная копия из поставки.
 */
export const OAK_LEAVES = Object.freeze({
  stock: Object.freeze({
    game: "update/x64/dlcpacks/patchday2ng/dlc.rpf:x64/levels/gta5/props/vegetation/v_trees.rpf/z_prop_tree_oak1.ytd",
    texture: "nxg_im_branches_27c",
  }),
  improved: Object.freeze({ file: "/assets/workshop/vegetation/oak-improved/leaves.webp" }),
});

const LEAF_SIZE = 512;
const kindOf = (project) => (project.improved.enabled ? "improved" : "stock");

/** Сцена дуба по работе: игры или «Реалистичных деревьев». */
export const oakSceneUrl = (project) => OAK_SCENES[kindOf(normalizeVegetationProject(project))];

/** Рамка кадра: дерево целиком, чуть снизу — крона над головой, земли нет. */
export function oakFrame(asset) {
  return { bounds: asset.bounds, ground: false, view: { yaw: -0.65, pitch: 0.08, zoom: 0.74 } };
}

/** Рамка снимка (обложка, плитки): то же дерево, крупнее — карточка шире кадра. */
export function oakThumbFrame(asset) {
  return { bounds: asset.bounds, ground: false, view: { yaw: -0.65, pitch: 0.05 } };
}

/* Картинка листа → пиксели RGBA (строки сверху вниз). */
export function bitmapPixels(image) {
  const canvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(image.width, image.height) : document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0);
  return { rgba: new Uint8ClampedArray(context.getImageData(0, 0, image.width, image.height).data), width: image.width, height: image.height };
}

let drawnLeaf = null;
/* Нарисованный лист — пока лист игры не пришёл или игры нет. */
function drawn() {
  if (!drawnLeaf) {
    const leaf = leafPixels({ size: 256, seed: 11 });
    drawnLeaf = { rgba: leaf.data, width: leaf.width, height: leaf.height, real: false };
  }
  return drawnLeaf;
}

/*
 * Лист как текстура сцены: развёртка моделей игры — как у DirectX (первая
 * строка картинки — верх листа), цвет — как у листов сцены (`orbit-stage`).
 */
export function leafTexture({ rgba, width, height }) {
  const texture = new THREE.DataTexture(rgba, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.NoColorSpace;
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
 * Листва дуба в облике работы: `{ texture, real, key }` — текстура для
 * облика, настоящий ли лист и отпечаток (ключ снимков).
 */
export function useOakLeaf(input, species = "oak") {
  const project = useMemo(() => normalizeVegetationProject(input), [input]);
  const kind = kindOf(project);
  const [base, setBase] = useState(() => ({ kind, leaf: drawn(), settled: false }));
  useEffect(() => {
    let cancelled = false;
    loadSceneImage(OAK_LEAVES[kind], LEAF_SIZE)
      .catch(() => null)
      .then((image) => {
        const pixels = image ? bitmapPixels(image) : null;
        if (!cancelled) setBase({ kind, leaf: pixels ? { ...pixels, real: true } : drawn(), settled: true });
      });
    return () => {
      cancelled = true;
    };
  }, [kind]);
  const leaf = base.kind === kind ? base.leaf : drawn();
  const signature = vegetationProjectSignature(project);
  const origin = `${kind}|${leaf.real ? "game" : "drawn"}`;
  const wanted = `${origin}|${species === "oak" ? "" : `${species}|`}${signature}`;
  /* Перекрашенный лист считает поток (`leaf-recolour-worker.js`): лист 512² — ~27 мс на главном потоке, а на ПК слабее
     и ×4 — больше ста на каждый шаг палитры. Пока он считается, в кадре прежний лист (первый раз — исходный лист
     игры): ползунок и цвет не ждут пикселей. */
  const placeholder = useMemo(() => leafTexture({ rgba: leaf.rgba, width: leaf.width, height: leaf.height }), [leaf]);
  useEffect(() => () => placeholder.dispose(), [placeholder]);
  const [shown, setShown] = useState({ key: "", texture: null });
  useEffect(() => () => shown.texture?.dispose(), [shown.texture]);
  useEffect(() => {
    let cancelled = false;
    const params = leafParams(compileVegetationLooks(project), species);
    const put = (rgba) => {
      if (!cancelled) setShown({ key: wanted, texture: leafTexture({ rgba, width: leaf.width, height: leaf.height }) });
    };
    /* Цвет игры и густота 100 — лист не меняется. */
    if (!params.compiled && params.foliage >= 100) put(leaf.rgba);
    else
      leafRecolourer()
        .recolour(`oak|${species}`, `oak|${origin}`, leaf, params)
        .then((rgba) => rgba && put(rgba));
    return () => {
      cancelled = true;
    };
    // Лист пересобирается по смыслу работы (`wanted`), а не по новому объекту.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaf, wanted]);
  /* `settled` — лист игры прочитан (или его нет) и перекрашенный готов: обложке больше нечего ждать. Ключ — у того
     листа, что в кадре: снимок не ляжет в хранилище под ключом листа, которого ещё нет. */
  return {
    texture: shown.texture || placeholder,
    real: leaf.real,
    settled: base.kind === kind && base.settled && shown.key === wanted,
    key: shown.texture ? shown.key : `${origin}|base`,
  };
}

/** Облик материалов дуба: листва — своим листом, кора и ветки — листами сцены. */
export function oakLook(texture) {
  return (index, info) => (info.group === "leaves" && texture ? { colour: info.colour, texture } : { colour: info.colour });
}
