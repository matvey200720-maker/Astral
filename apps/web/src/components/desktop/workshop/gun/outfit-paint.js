/*
 * «На модельке» мастерской одежды (фикс 3 ТЗ 07.10.2026; прежде «Полный
 * комплект»).
 *
 * По умолчанию в кадре — только вещь, которую правят. «На модельке»
 * показывает на персонаже ровно то, что человек сделал: эту вещь, вещи
 * других категорий, которые он правда правил (черновик с правками, а не
 * просто открытая вещь), и тату — на теле в белье, без одежды «для вида».
 * Модель собирает Astral Desktop (`clothing-character.js`, `others`,
 * `onModel`), а покраску каждой вещи окно собирает здесь из её черновика тем
 * же холстом, что и в мастерской (`createSurface`), поверх её картинки из
 * игры.
 *
 * Вещи — из игры игрока и тату (черновик «Тела» — зонами тату на видимой
 * коже, прозрачными чернилами); вещь каталога другой категории мастерская
 * открывает в своей категории — у этой полки её пакета нет. Наклейки (05.11.2026)
 * ложатся запечёнными в витрине (`sticker-prints.js`): по геометрии персонажа их
 * не напечатать, а развёртка у вещи одна. Не запеклись (вещь не открывали в
 * этом окне) — на модельке наклейки нет.
 */

import { projectIsEmpty } from "@modovik/gun-studio";
import { BERD_RIVAL } from "./wear/wear-slots.js";
import { variantGender } from "@modovik/clothing/gender";
import { draftSlot } from "./wear/wear-outfit.js";
import {
  CLOTHING_DRAFTS_KEY,
  readGunDraftEntries,
} from "../../../../features/workshop/works/gun-draft-store.js";
import { createSurface, maskKey } from "./gun-canvas.js";
import { resolveGunImage } from "./gun-images.js";
import { outfitStickerLayers } from "./sticker-prints.js";

const GAME_MODEL = /^game:([a-z-]+)-(\d+)$/;

/* Черновик без единой правки (или битый) — не «сделанное». */
const untouched = (project) => {
  try {
    return projectIsEmpty(project);
  } catch {
    return true;
  }
};

/** Вещи «На модельке»: черновики других категорий с правками — на вещах из игры. */
export function outfitDrafts(slotId, storage = globalThis.localStorage) {
  let drafts = {};
  try {
    drafts = readGunDraftEntries(storage, CLOTHING_DRAFTS_KEY);
  } catch {
    drafts = {};
  }
  const out = [];
  for (const [slot, entry] of Object.entries(drafts)) {
    if (slot === slotId) continue;
    /* Открытая, но не тронутая вещь — не «сделанное»: на модельку не идёт. */
    if (untouched(entry?.project)) continue;
    /* Тату — если на теле что-то нарисовано. */
    if (slot === "tattoos") {
      if ((entry?.project?.materials || []).some((material) => material.layers?.length))
        out.push({ slot, variant: null, project: entry.project });
      continue;
    }
    const match = GAME_MODEL.exec(String(entry?.project?.modelId || ""));
    if (!match || match[1] !== slot) continue;
    /* Это путь «На модельке» без «одеть»: у него фигура мужская, женская вещь на ней не стоит. Женская фигура собирается из реестра надетого (`outfitWorn`, `gender`). */
    if (variantGender(Number(match[2])) === "female") continue;
    out.push({ slot, variant: Number(match[2]), project: entry.project });
  }
  return out.sort((left, right) => left.slot.localeCompare(right.slot));
}

/**
 * Ключ готового персонажа в памяти окна: категория, вещь, её расцветка, комплект и облик. Расцветка (буква пакета у вещи каталога) — часть ключа: без неё другой цвет той же
 * вещи отдавал прежнего персонажа из памяти и на модели цвет «не менялся» (30.10.2026, у вещей с несколькими цветами; у витрины ключ с буквой уже был).
 */
export const characterCacheKey = ({ slotId, modelId, colour = "", texture = null, outfit = "", look = "" }) =>
  `${slotId}:${modelId}${colour ? `|c:${colour}` : ""}${Number.isInteger(texture) ? `|t:${texture}` : ""}:${outfit}:${look}`;

/** Подпись комплекта для кэша окна: какие вещи на персонаже (у вещи каталога — её id и расцветка, у вещи игры — номер выбранной расцветки). */
export const outfitSignature = (others) =>
  others
    .map((item) =>
      item.slot === "tattoos"
        ? "tattoos"
        : item.itemId
          ? `${item.slot}-c:${item.itemId}${item.colour ? `|${item.colour}` : ""}`
          : `${item.slot}-${item.variant}${Number.isInteger(item.texture) ? `-t${item.texture}` : ""}`,
    )
    .join("+");

/**
 * Вещи комплекта на персонаже из того, что надето (ТЗ 30.10.2026): вещь игры — `{ slot, variant, project }`, вещь каталога — `{ slot, itemId, colour, project }` (мужские; женской вещи
 * на персонаже нет). Проект — черновик слота: покраска вещи на персонаже. Тату — если на теле что-то нарисовано (как у `outfitDrafts`). `colours` — выбранные расцветки вещей каталога, `textures` — номера выбранных расцветок вещей игры (`id вещи → номер`).
 */
export function outfitWorn(slotId, { worn = {}, colours = {}, textures = {}, gender = null, storage = globalThis.localStorage } = {}) {
  let drafts = {};
  try {
    drafts = readGunDraftEntries(storage, CLOTHING_DRAFTS_KEY);
  } catch {
    drafts = {};
  }
  /* Черновики — по слоту и полу фигуры (ревью п. 4): женская покраска лежит под `слот.f`. */
  const sex = gender === "female" ? "female" : "male";
  const out = [];
  for (const [slot, id] of Object.entries(worn)) {
    if (slot === slotId || slot === "tattoos") continue;
    /* Маска ↔ борода — одно место `berd`: открытая сейчас вещь вытесняет соперника из запроса к Desktop, где бы он ни лежал (14.11.2026, ревью №3). */
    if (slot === BERD_RIVAL[slotId]) continue;
    const project = drafts[draftSlot(slot, sex)]?.project && String(drafts[draftSlot(slot, sex)].project.modelId) === id ? drafts[draftSlot(slot, sex)].project : null;
    const game = GAME_MODEL.exec(id);
    if (game) {
      /* Реестр надетого — по полу (14.11.2026): на женской фигуре стоят женские вещи, на мужской — мужские; вещь не своего слота и (при `gender`) чужого пола пропускается. */
      if (game[1] !== slot || (gender && variantGender(Number(game[2])) !== gender)) continue;
      out.push({ slot, variant: Number(game[2]), ...(Number.isInteger(textures[id]) ? { texture: textures[id] } : {}), project });
    } else if (id.startsWith("catalog:")) {
      const itemId = id.slice("catalog:".length);
      out.push({ slot, variant: null, itemId, colour: colours[itemId] || "", project });
    }
  }
  const tattoo = drafts[draftSlot("tattoos", sex)]?.project;
  if (slotId !== "tattoos" && tattoo && !untouched(tattoo) && (tattoo.materials || []).some((material) => material.layers?.length))
    out.push({ slot: "tattoos", variant: null, project: tattoo });
  return out.sort((left, right) => left.slot.localeCompare(right.slot));
}

/**
 * Запрос комплекта к Astral Desktop: вещи игры, вещи каталога (пакет — из `packages`: `id вещи → { manifest, baseUrl }`, вещь без пакета в комплект не идёт) и тату.
 */
export const outfitRequest = (others, packages = new Map()) => {
  const items = others
    .filter((item) => item.slot !== "tattoos")
    .flatMap((item) => {
      if (!item.itemId) return [{ slot: item.slot, variant: item.variant, ...(Number.isInteger(item.texture) ? { texture: item.texture } : {}) }];
      const pack = packages.get(item.itemId);
      return pack?.manifest ? [{ slot: item.slot, manifest: pack.manifest, baseUrl: pack.baseUrl, ...(item.colour ? { colour: item.colour } : {}) }] : [];
    });
  return {
    ...(items.length ? { others: items } : {}),
    ...(others.some((item) => item.slot === "tattoos") ? { tattoos: true } : {}),
  };
};

/**
 * Каких вещей каталога из запроса комплекта нет на собранном персонаже (03.11.2026, владелец: «перчатки из каталога не показываются — руки голые»). Desktop надевает вещь каталога, только если
 * скачал и разобрал её пакет; не вышло — собирает персонажа без неё и называет в ответе (`outfit`) то, что правда надето. `requested` — `others` запроса (`outfitRequest`), `answer` — ответ Desktop.
 * Возвращает манифесты вещей, которых в ответе нет. Ответ без списка `outfit` (не Desktop или старая сборка) не судится: о надетом он ничего не говорит.
 */
export function missingCatalogItems(requested = [], answer = null) {
  if (!Array.isArray(answer?.outfit)) return [];
  const worn = new Set(answer.outfit.filter((item) => item?.catalog).map((item) => `${item.slot}|${item.catalog}`));
  return requested.filter((item) => item?.manifest && !worn.has(`${item.slot}|${item.manifest.id}`));
}

const safeImage = async (source) => {
  try {
    return await resolveGunImage(source);
  } catch {
    return null;
  }
};

/**
 * Покраска одной вещи комплекта: `Map<материал, холст>`. `bases` —
 * `Map<материал, { image, width, height }>` (картинка из игры в кадре),
 * `cache` — кэш узоров мастерской (`patternCache()`).
 */
export async function bakeOutfitDraft(project, bases, cache, { drawing = false, cutout = false } = {}) {
  const out = new Map();
  /* Материалы вещи: из проекта (слои) и те, что задела наклейка, — у вещи с одной наклейкой слоёв нет, но материал красить надо. */
  const named = new Map((project?.materials || []).map((material) => [material.name, material]));
  if (!drawing) for (const name of bases.keys()) if (!named.has(name) && outfitStickerLayers(project, name).length) named.set(name, { name, layers: [] });
  for (const material of named.values()) {
    const base = bases.get(material.name);
    const stickers = drawing ? [] : outfitStickerLayers(project, material.name);
    if (!base?.image || (!material.layers?.length && !stickers.length)) continue;
    const width = material.width || base.width;
    const height = material.height || base.height;
    if (!width || !height) continue;
    /* Зона тату — прозрачный рисунок поверх кожи (`drawing`), вещь — краска
       поверх своей картинки из игры. */
    const surface = createSurface({
      name: material.name,
      width,
      height,
      image: base.image,
      /* Причёска и борода — вырез по альфе листа (14.11.2026): холст сохраняет альфу исходного листа, обрезка прядей не пропадает (иначе «белые плашки»). */
      opaque: cutout ? undefined : !drawing,
      drawing,
    });
    const images = new Map();
    const exact = new Map();
    for (const layer of material.layers || []) {
      if (layer.kind === "paint" && layer.data) {
        const image = await safeImage(layer.data);
        if (image) surface.restoreRasterImage(layer.id, image);
      }
      if (layer.mask) {
        const image = await safeImage(layer.mask);
        if (image) surface.restoreRasterImage(maskKey(layer.id), image);
      }
      if (layer.kind === "image" && layer.source) {
        const image = await safeImage(layer.source);
        if (image) images.set(layer.id, image);
      }
      if (layer.kind === "pattern" && layer.visible !== false && cache)
        exact.set(
          layer.id,
          await cache.exact(
            "pattern",
            {
              pattern: layer.pattern,
              colours: layer.colours,
              scale: layer.scale,
              rotation: layer.rotation,
              seed: layer.seed,
              contrast: layer.contrast ?? 100,
            },
            width,
            height,
          ),
        );
    }
    const wear = project.wear?.amount > 0 ? project.wear : null;
    const exactWear =
      wear && cache
        ? await cache.exact("wear", { amount: wear.amount, seed: wear.seed }, width, height)
        : null;
    surface.render(material.layers || [], {
      name: material.name,
      images,
      patterns: {
        pattern: (layer) => exact.get(layer.id) || null,
        wear: () => exactWear,
      },
      stickers,
      wear,
      skinOff: Boolean(project.skinOff),
      bare: drawing,
    });
    out.set(material.name, surface.canvas);
  }
  return out;
}

/**
 * Красит вещи комплекта в кадре: по каждой вещи — её черновик поверх её
 * картинки из игры. Возвращает, сколько деталей покрашено.
 */
export async function paintOutfit(scene, others, cache) {
  const materials = scene?.outfitMaterials?.() || [];
  let painted = 0;
  for (const other of others) {
    const bases = new Map(
      materials
        .filter((item) => item.slot === other.slot)
        .map((item) => [item.name, item]),
    );
    if (!bases.size) continue;
    const canvases = await bakeOutfitDraft(other.project, bases, cache, {
      drawing: other.slot === "tattoos",
      cutout: other.slot === "hair" || other.slot === "beards",
    });
    for (const [name, canvas] of canvases)
      if (scene.paintOutfit(other.slot, name, canvas)) painted += 1;
  }
  return painted;
}
