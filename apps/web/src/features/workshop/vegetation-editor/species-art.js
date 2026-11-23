/*
 * Дерево породы в кадре «Листвы» и на плитках «Цвета пород» (ТЗ 22.10.2026, п. 6).
 *
 * Кадр «Листвы» всегда показывал дуб, и свой цвет породы, кроме «Дубов», в нём ничего не менял: пальмам
 * красили листья, а в окне стоял дуб без пальм. Теперь кадр показывает дерево выбранной породы, а плитка
 * породы — её же снимок вместо значка.
 *
 * Модели деревьев — из сцены рощ (`groves/models.bin`, сетки игры игрока, `scripts/prepare-vegetation-groves.mjs`):
 * у каждой модели по три уровня детализации подряд, часть нулевого уровня — `номер в оглавлении × 3`. Листы
 * читаются у игры игрока по адресам сцены и перекрашиваются той же арифметикой, что у установщика
 * (`previewLeaf`, порода — ключ `bySpecies`). Игры нет — лист нарисован, и подпись кадра говорит это.
 *
 * Дуб остаётся прежним (`oak-art.js`: сцена дуба, в том числе «Реалистичных деревьев»). Породы без модели в сцене
 * рощ (клёны, мескиты, оливы, «растения») в списке «Виды деревьев» не показываются (ТЗ 24.10.2026, п. 1), пока у
 * них нет своего цвета в работе: такая работа ещё открывается, у породы значок, а в кадре дуб в её цвете.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VEGETATION_WORLD, compileVegetationLooks, normalizeVegetationProject } from "@modovik/climb-contract/recolor/vegetation";
import { groveModels } from "@modovik/climb-contract/recolor/vegetation-groves";
import { leafPixels } from "../../../components/desktop/workshop/vegetation/vegetation-textures.js";
import { loadSceneAsset } from "../model-stage/scene-asset.js";
import { loadSceneImage, textureKey } from "../model-stage/scene-textures.js";
import { bitmapPixels, leafTexture } from "./oak-art.js";
import { leafRecolourer } from "./leaf-recolour.js";
import { leafParams } from "./vegetation-text.js";

/**
 * Какая модель сцены рощ показывает породу (id породы из описи растительности). Оливы, мескиты и клёны — настоящие
 * деревья игры, но в трёх рощах их нет, и в `models.bin` они попадают только после прогона
 * `scripts/prepare-vegetation-groves.mjs` (`EXTRA_TREES`) на ПК с игрой. Пока имени нет в сцене, `speciesModel`
 * даёт `null` и вид в списке «Виды деревьев» не показывается.
 */
export const SPECIES_MODELS = Object.freeze({
  birch: "prop_tree_birch_04",
  cypress: "prop_tree_cypress_01",
  ficus: "prop_tree_lficus_05",
  joshua: "prop_joshua_tree_01b",
  maple: "prop_tree_maple_02",
  mesquite: "prop_tree_mquite_01",
  olive: "prop_tree_olive_01",
  palm: "prop_palm_fan_03_b",
  pine: "prop_tree_pine_02",
  tree: "prop_tree_jacada_02",
});

const LEAF_SIZE = 512;
const LODS = 3;

/** Название породы по-русски (ключ словаря — переводится там, где выводится). Ёлки и кедры игры лежат у сосен. */
export const speciesLabel = (id) =>
  id === "pine" ? "Сосны, ели и кедры" : (VEGETATION_WORLD.species || []).find((item) => item.id === id)?.label || "";

/**
 * Модель породы: `{ name, url, part, height, radius }` — адрес сцены, номер части нулевого уровня и габариты
 * (метры; `radius` — как далеко крона уходит от оси). `null`, если у породы своей модели нет (в том числе у дуба).
 */
export function speciesModel(species) {
  const name = SPECIES_MODELS[species];
  const inventory = groveModels();
  if (!name || !inventory) return null;
  const at = inventory.names.indexOf(name);
  const entry = inventory.list?.[at];
  if (at < 0 || entry?.name !== name) return null;
  return { name, url: inventory.url, part: at * LODS, height: entry.height, radius: entry.radius };
}

/**
 * Есть ли у породы дерево для кадра и плитки: у дуба — своя сцена (`oak-art.js`), у остальных — модель в сцене рощ.
 * Порода без дерева в списке «Виды деревьев» не показывается: плитка со значком и чужой дуб в кадре — обман.
 */
export const hasSpeciesTree = (species) => species === "oak" || speciesModel(species) !== null;

/** Рамка кадра: дерево целиком, чуть снизу, земли нет — как у дуба. */
export function speciesFrame(model) {
  return () => ({
    bounds: { min: [-model.radius, -model.radius, 0], max: [model.radius, model.radius, model.height] },
    ground: false,
    fit: true,
    view: { yaw: -0.65, pitch: 0.08 },
  });
}

/** Рамка снимка плитки: то же дерево, ближе — плитка шире кадра. */
export function speciesThumbFrame(model) {
  return () => ({
    bounds: { min: [-model.radius, -model.radius, 0], max: [model.radius, model.radius, model.height] },
    ground: false,
    fit: true,
    view: { yaw: -0.65, pitch: 0.05 },
  });
}

/* Пиксели листов — модульным кэшем по адресу, а не в состоянии: React в разработке расписывал бы буферы. */
const pixelCache = new Map();
let drawnLeaf = null;
function drawn() {
  if (!drawnLeaf) {
    const leaf = leafPixels({ size: 256, seed: 11 });
    drawnLeaf = { rgba: leaf.data, width: leaf.width, height: leaf.height };
  }
  return drawnLeaf;
}

/**
 * Работа для плитки породы: только свой цвет породы (`own`, пусто — «как в игре»), общая листва не тронута.
 * Ёлки и кедры красятся одной строкой (`pine` и `cedar`), поэтому цвет кладётся обеим.
 */
export function tileProject(species, own) {
  const ids = species === "pine" ? ["pine", "cedar"] : [species];
  return normalizeVegetationProject({ trees: { species: own ? Object.fromEntries(ids.map((id) => [id, own])) : {} } });
}

/** Что в работе красит листву породы: цвет, эффект, густота и свой цвет самой породы — ключ снимков и листов. */
export function speciesLookKey(input, species) {
  const trees = normalizeVegetationProject(input).trees;
  return JSON.stringify({ species, tint: trees.tint, look: trees.tint ? trees.look : null, foliage: trees.foliage, own: trees.species?.[species] || null });
}

/**
 * Листва дерева `model` породы `species` в облике работы `input`:
 * `{ look, lookKey, parts, real, settled }` — облик материалов для кадра или снимка, ключ снимков, видимая часть сцены,
 * прочитался ли лист игры и закончено ли чтение (обложке больше нечего ждать). Без модели (`null`) — пусто.
 */
export function useSpeciesLeaves(model, species, input) {
  const project = useMemo(() => normalizeVegetationProject(input), [input]);
  const key = speciesLookKey(project, species);
  const url = model?.url || "";
  const part = model?.part ?? -1;
  const [loaded, setLoaded] = useState({ url: "", part: -1, leaves: [], settled: false });
  useEffect(() => {
    if (!url) return undefined;
    let cancelled = false;
    (async () => {
      const asset = await loadSceneAsset(url).catch(() => null);
      if (!asset) return { leaves: [] };
      /* Листва только этой части: у сцены рощ 87 листов, а дереву нужны один–три. */
      const used = [...new Set(asset.meshes.filter((mesh) => mesh.part === part).map((mesh) => mesh.material))];
      const leaves = await Promise.all(
        used
          .filter((index) => asset.materials[index]?.group === "leaves" && asset.materials[index].texture != null)
          .map(async (index) => {
            const entry = asset.textures?.[asset.materials[index].texture];
            const cacheKey = textureKey(entry, LEAF_SIZE);
            if (cacheKey && !pixelCache.has(cacheKey)) {
              const image = await loadSceneImage(entry, LEAF_SIZE).catch(() => null);
              const pixels = image ? bitmapPixels(image) : null;
              if (pixels) pixelCache.set(cacheKey, pixels);
            }
            return { index, cacheKey };
          }),
      );
      return { leaves };
    })().then(({ leaves }) => {
      if (!cancelled) setLoaded({ url, part, leaves, settled: true });
    });
    return () => {
      cancelled = true;
    };
  }, [url, part]);
  const current = loaded.url === url && loaded.part === part;
  /* Исходные листы игры — пока перекрашенные считает поток (`leaf-recolour-worker.js`): лист 512² — ~27 мс главного
     потока, а у пальмы их три; ползунок и цвет не ждут пикселей, в кадре прежний лист. */
  const placeholders = useMemo(() => {
    const out = new Map();
    if (!model || !current) return out;
    for (const { index, cacheKey } of loaded.leaves) {
      const base = (cacheKey && pixelCache.get(cacheKey)) || drawn();
      out.set(index, leafTexture({ rgba: base.rgba, width: base.width, height: base.height }));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, url, part]);
  useEffect(
    () => () => {
      for (const texture of placeholders.values()) texture.dispose();
    },
    [placeholders],
  );
  /* Перекрашенные листы по номеру материала: прежний живёт, пока новый не посчитан. */
  const store = useRef(new Map());
  const [version, setVersion] = useState(0);
  const releaseStore = () => {
    for (const entry of store.current.values()) entry.texture.dispose();
    store.current.clear();
  };
  /* Другая модель — другие номера материалов: листы прежней уходят. */
  useEffect(() => {
    releaseStore();
    setVersion((value) => value + 1);
    return releaseStore;
  }, [url, part]);
  useEffect(() => {
    if (!model || !current) return undefined;
    let cancelled = false;
    const params = leafParams(compileVegetationLooks(project), species);
    for (const { index, cacheKey } of loaded.leaves) {
      const base = (cacheKey && pixelCache.get(cacheKey)) || drawn();
      const wantedKey = `${key}|${cacheKey || "drawn"}`;
      if (store.current.get(index)?.key === wantedKey) continue;
      const put = (rgba) => {
        if (cancelled) return;
        const old = store.current.get(index);
        store.current.set(index, { key: wantedKey, texture: leafTexture({ rgba, width: base.width, height: base.height }) });
        old?.texture.dispose();
        setVersion((value) => value + 1);
      };
      /* Цвет игры и густота 100 — лист не меняется. */
      if (!params.compiled && params.foliage >= 100) put(base.rgba);
      else
        leafRecolourer()
          .recolour(`species|${url}|${part}|${index}`, cacheKey || "drawn", base, params)
          .then((rgba) => rgba && put(rgba));
    }
    return () => {
      cancelled = true;
    };
    // Листва пересобирается по смыслу работы (`key`), а не по новому объекту.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, key]);
  const look = useCallback(
    (index, info) => {
      const texture = store.current.get(index)?.texture || placeholders.get(index);
      return texture ? { colour: info.colour, texture } : { colour: info.colour };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, placeholders],
  );
  const real = current && loaded.leaves.some((leaf) => leaf.cacheKey && pixelCache.has(leaf.cacheKey));
  /* Все листы посчитаны для нынешней работы: снимок плитки можно складывать в хранилище под этим ключом. */
  const done = Boolean(model) && current && loaded.settled && loaded.leaves.every(({ index, cacheKey }) => store.current.get(index)?.key === `${key}|${cacheKey || "drawn"}`);
  /* Пока листы считаются, ключ снимка прежний: плитка не снимается с недокрашенной листвой и не кладёт её в хранилище. */
  const lastKey = useRef("");
  const lookKey = done ? `${key}|${real ? "game" : "drawn"}` : lastKey.current || `base|${url}|${part}`;
  if (done) lastKey.current = lookKey;
  const parts = useMemo(() => (model ? [model.part] : null), [model?.part]); // eslint-disable-line react-hooks/exhaustive-deps
  return { look, lookKey, parts, real, settled: !model || done };
}
