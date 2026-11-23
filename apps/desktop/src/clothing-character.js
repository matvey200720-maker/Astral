/*
 * «Посмотреть на персонаже» (ТЗ 04.10.2026, задача 6) — вещь надетой на
 * свободного персонажа из игры самого игрока.
 *
 * Мастерская одежды показывает вещь отдельно и развёрнутой для покраски
 * (`showcaseDrawable`: кепка верхом вверх, перчатки парой). Здесь та же вещь
 * стоит «как в файле» — в позе привязки педа, как её надевает игра, — а
 * вокруг неё тело из частей того же персонажа: голова, причёска, руки,
 * футболка, джинсы, кеды. Части педа лежат в одном пространстве, поэтому
 * садятся друг на друга без подгонки; пропы головы (кепка, очки) живут в
 * пространстве кости головы и ставятся на неё по скелету
 * `mp_m_freemode_01.yft`.
 *
 * Своих моделей Astral не возит — всё читается из архивов игры игрока. Лицо
 * свободного персонажа игра смешивает из «родителей»: их головы и текстуры —
 * в `mp_headtargets` (у «белых» там заглушки, у прочих — настоящие кадры).
 *
 * Персонаж мужской или женский (ТЗ 29.10.2026-e, `gender`): `mp_m_freemode_01` и
 * `mp_f_freemode_01` из той же игры, со своими частями тела, скелетом и клипом
 * покоя. Лицо — основа головы плюс поправка родителя (`ped-styles.js`), причёска
 * и лицо — на выбор из подборки. Поза — не Т: по умолчанию персонаж стоит в кадре
 * клипа покоя игры (`move_m@generic` / `move_f@generic`, `idle`), вершины тела и
 * вещи переносятся скинингом один раз при сборке (`pose.js`), так что в окне
 * это обычный неподвижный GLB: покраска, выбор и выделение работают как прежде.
 *
 * Живой персонаж (`animated`, ТЗ 31.10.2026, слово владельца: «стоит и легонько пошатывается, как персонаж в игре»): вершины тела и вещей не запекаются в позу, а едут в GLB
 * с весами костей и скелетом пола (`animations/ped-skeleton.js`), а в ответе — дорожка клипа покоя игры (`animations/idle-track.js`). Кости ставит окно перед каждым кадром,
 * скининг считает видеокарта. Проп головы (кепка, очки) вяжется к кости головы целиком, чтобы идти за ней. Нет дорожки (клип не снялся) — персонаж запечён, как до этого, и
 * `animated` в ответе ложь: в позе привязки (Т) его никогда не показывают.
 *
 * Тело — подложка, не деталь: материалы с меткой `astralBody` мастерская не
 * красит и в них не целится. Материал вещи зовётся так же, как в GLB самой
 * вещи, и покраска остаётся на нём, когда показ переключают.
 *
 * «На модельке» (фикс 3 ТЗ 07.10.2026; прежде «Полный комплект»): к вещи
 * мастерской надеваются и вещи других категорий, которые человек правил
 * (`others`, вещи игры из его черновиков с правками). Каждая — со своими
 * именами материалов и меткой `astralOutfit` (категория): окно кладёт на неё
 * покраску её черновика. С `onModel` основа — тело в белье
 * (`onModelOutfit`), без одежды «для вида»; часть тела, которую вещь
 * закрывает, не надевается. Тату (`tattoos`) — зонами тату на видимой коже
 * (`zoneBody` по тем же частям тела), прозрачными: окно кладёт на них
 * рисунок черновика «Тела».
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  clothingDrawable,
  clothingModelGlb,
  colourPicture,
  combinedDrawable,
  isHeadProp,
  onBone,
  tattooShowcase,
} from "@modovik/clothing/model";
import {
  decodeTextureRef,
  joaat,
  readDrawable,
  readTextureDictionary,
} from "@modovik/rage-drawable";
import { poseFromClip, poseMeshes, poseSkeleton, skinMatrices } from "@modovik/rage-drawable/pose";
import { normalPictureOf } from "@modovik/clothing/shot-request";
import { readIdleTrack } from "./animations/idle-track.js";
import { readPedSkeleton } from "./animations/ped-skeleton.js";
import { PED_STYLES, pedChoice, pedGender } from "@modovik/clothing/ped-styles";
import { inflateRawNode } from "@modovik/rpf7/node";
import { encodePngFast as encodePng } from "./png-fast.js";
import { variantGender } from "@modovik/clothing/gender";
import { hasSkinZones, zoneBody } from "@modovik/clothing/tattoo-zones";
import { lacksSkin, withBodySkin, withHandMarks, withoutCoveredSkin } from "@modovik/clothing/body-fit";
import { cutoutBacking } from "@modovik/clothing/cutout-bleed";
import { bareLegSkin, skinTriangles } from "@modovik/clothing/body-ink";
import {
  FREEMODE,
  atomicWrite,
  catalogClothingFiles,
  catalogMoreFiles,
  catalogPicture,
  chooseGameTexture,
  clothingArchiveTools,
  clothingGameRoot,
  clothingSource,
  facesWritten,
  componentOfModelFile,
  gameHash,
  listGameClothing,
  placeOfItem,
  requestGender,
  textureByIndex,
  textureIndexOf,
  texturePlaceOf,
} from "./clothing-models.js";

const refusal = (code, message) => Object.assign(new Error(message), { code });

/*
 * Этапы сборки для стенда (`scripts/perf/baseline/wear-dress-sweep.mjs`, 02.11.2026): у инструментов чтения может быть `phase(name, run)` — стенд меряет им, куда ушло время
 * щелчка (разбор ydd, текстура, PNG, GLB). В Desktop его нет, и вызов — просто `run()`.
 */
const phase = (tools, name, run) => (typeof tools?.phase === "function" ? tools.phase(name, run) : run());

const PEDS = "models/cdimages/streamedpeds_mp.rpf";
const HEADTARGETS = `${PEDS}/mp_headtargets`;
const SKELETON = { archive: "x64v.rpf", entry: `${PEDS}/mp_m_freemode_01.yft` };
const HEAD_BONE = "SKEL_Head";

/* Скелет и клип покоя по полу: те же кости и теги, свои матрицы привязки и своя походка (женская стойка у `move_f`). */
const PED_FOLDERS = Object.freeze({ male: `${PEDS}/mp_m_freemode_01`, female: `${PEDS}/mp_f_freemode_01` });
const SKELETONS = Object.freeze({
  male: SKELETON,
  female: { archive: "x64v.rpf", entry: `${PEDS}/mp_f_freemode_01.yft` },
});
export const IDLE_POSES = Object.freeze({
  male: Object.freeze({ id: "idle-m", archive: "x64c.rpf", entry: "anim/ingame/clip_move_.rpf/move_m@generic.ycd", clip: "idle", time: 0 }),
  female: Object.freeze({ id: "idle-f", archive: "x64c.rpf", entry: "anim/ingame/clip_move_.rpf/move_f@generic.ycd", clip: "idle", time: 0 }),
});
/* Корень клипа живёт в пространстве мувера (куда идёт персонаж), а не скелета: его оставляют в позе привязки. */
const BONE_ROOT = 0;

const part = (name, model, texture, where = {}) =>
  Object.freeze({
    name,
    archive: where.archive || "x64v.rpf",
    folder: where.folder || FREEMODE,
    model,
    texture,
    ...(where.delta ? { delta: where.delta } : {}),
  });

/*
 * Части тела. Лицо — «родитель» №13 (его тон ближе всех к коже рук
 * `uppr_*_whi`), кеды — те же, что на карточке «Обувь».
 */
export const CHARACTER_PARTS = Object.freeze({
  head: part("head", "head_013_r.ydd", "head_diff_013_a_chi.ytd", {
    folder: HEADTARGETS,
  }),
  hair: part("hair", "hair_002_u.ydd", "hair_diff_002_a_uni.ytd"),
  arms: part("uppr", "uppr_000_r.ydd", "uppr_diff_000_a_whi.ytd"),
  bareTorso: part("uppr", "uppr_015_r.ydd", "uppr_diff_015_a_whi.ytd"),
  tee: part("jbib", "jbib_000_u.ydd", "jbib_diff_000_a_uni.ytd"),
  /* Рубашка с длинным рукавом — к перчаткам: перчатки игры — одни кисти. */
  shirt: part("jbib", "jbib_012_u.ydd", "jbib_diff_012_a_uni.ytd"),
  jeans: part("lowr", "lowr_000_r.ydd", "lowr_diff_000_g_whi.ytd"),
  shorts: part("lowr", "lowr_014_r.ydd", "lowr_diff_014_a_whi.ytd"),
  sneakers: part("feet", "feet_005_u.ydd", "feet_diff_005_a_uni.ytd", {
    archive: "update/x64/dlcpacks/mpchristmas3/dlc.rpf",
    folder:
      "x64/models/cdimages/mpchristmas3_male.rpf/mp_m_freemode_01_mp_m_christmas3",
  }),
  /* У штатных шлёпанцев модель — `_r` (`feet_005_u` в игре нет). */
  flipFlops: part("feet", "feet_005_r.ydd", "feet_diff_005_a_whi.ytd"),
  /* «Белые боксеры» (CLO_V2M_L_1_0) — бельё «На модельке» и у тела тату. */
  underwear: part("lowr", "lowr_001_r.ydd", "lowr_diff_001_a_whi.ytd", {
    archive: "update/x64/dlcpacks/mpvalentines2/dlc.rpf",
    folder:
      "x64/models/cdimages/mpvalentines2_male.rpf/mp_m_freemode_01_mp_m_valentines_02",
  }),
});

/*
 * Части тела свободного персонажа по полу, причёске и лицу (ТЗ 29.10.2026-e). Те же названия, что у `CHARACTER_PARTS`, поэтому наборы
 * (`CHARACTER_OUTFITS`, `ON_MODEL_REPLACES`) общие; женский персонаж в белье — ещё и верх купальника (`bra`), а нижняя часть — `underwear`.
 * Всё из папки своего пола: у женщины нет мужских DLC-кед и боксёров, зато есть свои, лежащие в основной папке.
 *
 * Голова — основа `head_000_r` своего пола плюс поправка родителя (`delta`, лицо) с его текстурой кожи; причёска — `hair_NNN_u` своего пола.
 * Без выбора (`style` не задан) — прежний мужской набор (`CHARACTER_PARTS`): его читают «Анимации», «В руках» и прежние проверки.
 */
export function characterPartsFor(style = null) {
  if (!style) return CHARACTER_PARTS;
  const gender = pedGender(style.gender);
  const choice = pedChoice(gender, style);
  const styles = PED_STYLES[gender];
  const hair = String(styles.hairs[choice.hair]).padStart(3, "0");
  const face = styles.faces[choice.face];
  const folder = PED_FOLDERS[gender];
  const own = { folder };
  const head = part("head", "head_000_r.ydd", `head_diff_${String(face.parent).padStart(3, "0")}_a_${face.tone}.ytd`, { folder, delta: face.delta });
  const hairPart = part("hair", `hair_${hair}_u.ydd`, `hair_diff_${hair}_a_uni.ytd`, own);
  if (gender === "male")
    return Object.freeze({
      ...CHARACTER_PARTS,
      head,
      hair: hairPart,
    });
  return Object.freeze({
    head,
    hair: hairPart,
    arms: part("uppr", "uppr_000_r.ydd", "uppr_diff_000_a_whi.ytd", own),
    bareTorso: part("uppr", "uppr_015_r.ydd", "uppr_diff_015_a_whi.ytd", own),
    tee: part("jbib", "jbib_000_u.ydd", "jbib_diff_000_a_uni.ytd", own),
    /* Рубашка с длинным рукавом — к перчаткам (у женщины перчатки игры тоже одни кисти). */
    shirt: part("jbib", "jbib_011_u.ydd", "jbib_diff_011_a_uni.ytd", own),
    jeans: part("lowr", "lowr_000_r.ydd", "lowr_diff_000_a_whi.ytd", own),
    shorts: part("lowr", "lowr_014_r.ydd", "lowr_diff_014_a_whi.ytd", own),
    sneakers: part("feet", "feet_001_u.ydd", "feet_diff_001_a_uni.ytd", own),
    flipFlops: part("feet", "feet_005_r.ydd", "feet_diff_005_a_whi.ytd", own),
    /* Бельё: верх и низ купальника — чёрные, как «белые боксёры» у мужчины: ровная ткань без рисунка. */
    bra: part("jbib", "jbib_015_u.ydd", "jbib_diff_015_a_uni.ytd", own),
    underwear: part("lowr", "lowr_015_r.ydd", "lowr_diff_015_a_whi.ytd", own),
  });
}

/*
 * «На модельке» (фикс 3 ТЗ 07.10.2026): на персонаже ровно то, что человек
 * сделал, — без майки, джинсов и кроссовок «для вида». Основа — тело в
 * белье (босых ног у мужского персонажа игры нет — штатные шлёпанцы); вещь
 * снимает с основы то, что закрывает (`ON_MODEL_REPLACES`). У тела тату
 * торс и бельё уже в самой вещи.
 */
export const ON_MODEL_BASE = Object.freeze(["head", "hair", "bareTorso", "underwear", "flipFlops"]);
/* У женщины бельё из двух частей: верх и низ. */
export const ON_MODEL_BASE_FEMALE = Object.freeze(["head", "hair", "bareTorso", "bra", "underwear", "flipFlops"]);
const ON_MODEL_BODY = Object.freeze(["head", "hair", "flipFlops"]);

/* Тело тату (`tattoo-body.js`): голова, торс с руками, боксёры, стопы — без
   причёски, тату головы под ней не видно. */
export const TATTOO_BODY_PARTS = Object.freeze([
  CHARACTER_PARTS.head,
  CHARACTER_PARTS.bareTorso,
  CHARACTER_PARTS.underwear,
  CHARACTER_PARTS.flipFlops,
]);

/* Те же части по названиям: у женщины бельё из двух частей (верх и низ купальника), остальное — как у мужчины. */
const TATTOO_BODY_NAMES = Object.freeze({
  male: Object.freeze(["head", "bareTorso", "underwear", "flipFlops"]),
  female: Object.freeze(["head", "bareTorso", "bra", "underwear", "flipFlops"]),
});

/**
 * Части тела тату своего пола (ТЗ 30.10.2026: тату на женском теле). Развёртка тела у женщины своя, но вторая развёртка (зоны наложений
 * игры) закодирована так же, как у мужчины, — `zoneBody` собирает зоны по частям женского тела, и тату игры (у них есть женские версии
 * со своими местами) ложатся на неё. `style` без пола — мужской набор, как до 30.10.
 */
export function tattooBodyPartsFor(style = null) {
  const gender = pedGender(style?.gender);
  const table = style ? characterPartsFor({ ...style, gender }) : CHARACTER_PARTS;
  return TATTOO_BODY_NAMES[gender].map((name) => table[name]);
}

/*
 * Тело тату «На модельке» (у «Тела» вещи игры нет — тату игры лишь
 * наложения на кожу): части тела тату без закрытых вещами, что человек
 * правил. Торс остаётся и под верхом: в вырез верха видна грудь.
 */
export function onModelTattooParts(others = [], style = null) {
  const gender = pedGender(style?.gender);
  const table = style ? characterPartsFor({ ...style, gender }) : CHARACTER_PARTS;
  const replaced = new Set(others.flatMap((item) => ON_MODEL_REPLACES[item] || []));
  return TATTOO_BODY_NAMES[gender].filter((name) => !replaced.has(name)).map((name) => table[name]);
}
/*
 * Верх лежит на голом торсе, а не на одних руках (02.11.2026, владелец: «когда я кофту одевал, у меня на бюсте пропадала часть тела, только горло»). `uppr_000` — руки без груди, шея кончается на голове, и в вырез кофты
 * было видно изнанку спины. Игра закрывает это своей парой `uppr` к каждому верху; пар здесь нет, а торс `uppr_015` садится под любой верх.
 */
export const ON_MODEL_REPLACES = Object.freeze({
  tshirts: ["bra"],
  "government-clothing": ["bareTorso", "bra"],
  pants: ["underwear"],
  shoes: ["flipFlops"],
  hats: ["hair"],
  masks: ["hair"],
  /* Причёска-вещь стоит вместо причёски облика (14.11.2026). */
  hair: ["hair"],
});
/**
 * Части тела «На модельке»: вещь `slot` и вещи `others`, что человек правил. `style` — `{ gender, hair, face }` (ТЗ 29.10.2026-e); без него —
 * прежний мужской набор.
 */
export function onModelOutfit(slot, others = [], style = null, { bare = false } = {}) {
  if (!Object.hasOwn(CHARACTER_OUTFITS, slot))
    throw refusal("CLOTHING_CHARACTER_SLOT", "Эту категорию на персонаже Astral не показывает.");
  /* Слот без вещи (`bare`): на персонаже только вещи других слотов, своя часть тела остаётся. */
  const worn = [...(bare ? [] : [slot]), ...others].filter((item) => item !== "tattoos");
  const replaced = new Set(worn.flatMap((item) => ON_MODEL_REPLACES[item] || []));
  const base = style && pedGender(style.gender) === "female" ? ON_MODEL_BASE_FEMALE : ON_MODEL_BASE;
  const names = (slot === "tattoos" ? ON_MODEL_BODY : base).filter((name) => !replaced.has(name));
  const table = characterPartsFor(style);
  return names.map((name) => table[name]);
}

/*
 * Во что персонаж одет к вещи категории: часть, которую вещь заменяет, не
 * надевается (футболка — вместо футболки, штаны — вместо джинсов).
 */
export const CHARACTER_OUTFITS = Object.freeze({
  tshirts: ["head", "hair", "bareTorso", "jeans", "sneakers"],
  "government-clothing": ["head", "hair", "jeans", "sneakers"],
  armor: ["head", "hair", "arms", "tee", "jeans", "sneakers"],
  pants: ["head", "hair", "arms", "tee", "sneakers"],
  shoes: ["head", "hair", "arms", "tee", "jeans"],
  /* С кепкой и маской — без причёски: у `hair_002` вторые модели (`_1`,
     `_2`) не «под шапку», волосы пробивали кепку (сверено снимком). */
  hats: ["head", "arms", "tee", "jeans", "sneakers"],
  accessories: ["head", "hair", "arms", "tee", "jeans", "sneakers"],
  masks: ["head", "arms", "tee", "jeans", "sneakers"],
  gloves: ["head", "hair", "shirt", "jeans", "sneakers"],
  bags: ["head", "hair", "arms", "tee", "jeans", "sneakers"],
  tattoos: ["head", "hair", "bareTorso", "shorts", "flipFlops"],
  /* Причёска-вещь — вместо причёски облика; борода (компонент `berd`) — на лице, причёска облика остаётся (14.11.2026). */
  hair: ["head", "arms", "tee", "jeans", "sneakers"],
  beards: ["head", "hair", "arms", "tee", "jeans", "sneakers"],
});

/* Какие части тела вещь категории снимает с персонажа в комплекте: футболка
   — футболку, штаны — джинсы, кепка и маска — причёску. */
export const OUTFIT_REPLACES = Object.freeze({
  tshirts: ["tee", "shirt", "arms"],
  "government-clothing": ["tee", "shirt", "bareTorso", "arms"],
  pants: ["jeans", "shorts"],
  shoes: ["sneakers", "flipFlops"],
  hats: ["hair"],
  masks: ["hair"],
  hair: ["hair"],
});

/**
 * Части тела к вещи категории; `others` — категории вещей комплекта.
 * Неизвестная категория — отказ словами.
 */
export function characterOutfit(slot, others = [], style = null) {
  const outfit = Object.hasOwn(CHARACTER_OUTFITS, slot)
    ? CHARACTER_OUTFITS[slot]
    : null;
  if (!outfit)
    throw refusal(
      "CLOTHING_CHARACTER_SLOT",
      "Эту категорию на персонаже Astral не показывает.",
    );
  const replaced = new Set(others.flatMap((other) => OUTFIT_REPLACES[other] || []));
  const table = characterPartsFor(style);
  const names = outfit.filter((name) => !replaced.has(name));
  /* Верх комплекта садится на голый торс: под ним нет майки «для вида», а в вырез видна грудь. */
  if (others.includes("tshirts") && !names.includes("bareTorso")) names.push("bareTorso");
  return names.map((name) => table[name]);
}

/* Слотов одежды теперь 12 с причёской и бородой (14.11.2026): полный комплект ничего не теряет. */
const MAX_OUTFIT = 12;
/* Пустая картинка зон тату: рисунок кладёт окно. */
const CLEAR_PICTURE = Object.freeze({ width: 4, height: 4, rgba: new Uint8ClampedArray(64) });

/* Вещи комплекта из запроса окна: вещь игры (`{ slot, variant }`) или вещь каталога (`{ slot, manifest, baseUrl, colour }`, ТЗ 30.10.2026 — человек одевает персонажа вещами
   из каталога по всем слотам), по одной на категорию. Тату (тело) в комплект не входят — они на коже. */
export function outfitOthers(input, slot, gender = "male") {
  const list = Array.isArray(input?.others) ? input.others.slice(0, MAX_OUTFIT) : [];
  const seen = new Set([slot]);
  const out = [];
  for (const item of list) {
    const other = String(item?.slot || "");
    if (!Object.hasOwn(CHARACTER_OUTFITS, other) || other === "tattoos" || seen.has(other)) continue;
    if (item?.manifest) {
      const id = String(item.manifest.id || "");
      if (!/^[a-z0-9][a-z0-9._-]{0,95}$/i.test(id) || !item.manifest.version) continue;
      seen.add(other);
      out.push({
        slot: other,
        variant: null,
        catalog: { manifest: item.manifest, baseUrl: String(item.baseUrl || ""), colour: /^[a-z]$/.test(String(item.colour || "")) ? String(item.colour) : "" },
      });
      continue;
    }
    const variant = Number(item?.variant);
    /* К персонажу идут вещи его пола: женское число — со смещением (`FEMALE_VARIANT`), мужское — как есть. */
    if (!Number.isInteger(variant) || variant < 0 || variantGender(variant) !== gender) continue;
    seen.add(other);
    /* Номер расцветки вещи игры (30.10.2026): без номера вещь берёт своё лицо. */
    const texture = textureIndexOf(item?.texture);
    out.push(texture === null ? { slot: other, variant } : { slot: other, variant, texture });
  }
  return out;
}

/* Шапка или маска (открытая или в комплекте) закрывают причёску: вещь-причёска и причёска облика под ними не рисуются. */
export const hairCovered = (slot, bare, others = []) =>
  (!bare && (slot === "hats" || slot === "masks")) || others.some((other) => other.slot === "hats" || other.slot === "masks");

/*
 * Какие вещи комплекта «на персонаже» (поле `outfit` ответа; ревью 14.11.2026, №1): надетые и скрытая шапкой или маской причёска — с признаком `hidden: true`.
 * Окно по этому списку судит, что встало: скрытая причёска-вещь каталога не пропала, она под шапкой. Свежая сборка и кэш отвечают одинаково.
 */
export function outfitAnswer(others, worn, covered) {
  const hiddenHair = (other) => covered && other.slot === "hair";
  return others
    .filter((other) => worn.includes(other) || hiddenHair(other))
    .map((other) => ({
      slot: other.slot,
      ...(other.catalog ? { catalog: other.catalog.manifest.id } : { variant: other.variant }),
      ...(hiddenHair(other) ? { hidden: true } : {}),
    }));
}

/*
 * Версия сборки в имени кэша: другая — персонажи собираются заново. c6 (31.10.2026): в кэше лежали персонажи без вещей каталога из комплекта (пакет не скачивался — IPC не давал
 * доверия вещам из `others`) и без их частей тела; такие файлы по ключу вещей не отличить, поэтому сборка новая. c7 (01.11.2026): под перчатками нет рук тела, у мода без весов они появились (`body-fit.js`). c8 (02.11.2026): под верхом голый торс, а не одни руки. c11 (03.11.2026): чернила блэкворка одинаковы во всех разделах — на кожаной руке перчаток и на ногах под штанами (`inkParts`). c12 (03.11.2026): под перчатками со своей кистью кисти тела нет целиком —
 * пальцы тела торчали кусками сквозь пальцы перчаток (`withHandMarks`). c13 (05.11.2026): чернила ног — только треугольники на поверхности голой ноги, без подола и тона текстуры (`body-ink.js`): бежевые шорты получали пятна на ткани.
 * c14 (14.11.2026): причёска и борода — вещи комплекта; у волос и бород с вырезом по альфе цвет затекает в прозрачные точки листа (`cutout-bleed.js`).
 */
const CHARACTER_BUILD = "c14";
const MAX_CHARACTER_BYTES = 96 * 1024 * 1024;

/*
 * Персонажи на диске (01.11.2026, владелец: «не забивай память»): GLB с комплектом — 10–25 МБ, и каждая примерка клала новый: у владельца за неделю 146 файлов и 800 МБ. Собирается он теперь
 * за доли секунды, поэтому на диске держатся только последние: остальное стирается, начиная со старых.
 */
const CHARACTER_CACHE_BYTES = 256 * 1024 * 1024;
const CHARACTER_FILE = /^character-.+\.glb$/;
const TRIM_EVERY = 8;
let writesSinceTrim = TRIM_EVERY;

export async function trimCharacterCache(directory, limit = CHARACTER_CACHE_BYTES) {
  const names = (await fs.readdir(directory).catch(() => [])).filter((name) => CHARACTER_FILE.test(name));
  const files = (
    await Promise.all(
      names.map(async (name) => {
        const stat = await fs.stat(path.join(directory, name)).catch(() => null);
        return stat ? { name, size: stat.size, at: stat.mtimeMs } : null;
      }),
    )
  ).filter(Boolean);
  let total = files.reduce((sum, file) => sum + file.size, 0);
  let removed = 0;
  for (const file of files.sort((left, right) => left.at - right.at)) {
    if (total <= limit) break;
    await fs.rm(path.join(directory, file.name), { force: true }).catch(() => {});
    total -= file.size;
    removed += 1;
  }
  return { removed, total };
}

const asArrayBuffer = (bytes) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

const characterWrites = new Set();
/** Запись персонажа в кэш ещё идёт: дождаться её (предзагрузка и тесты смотрят на файлы). */
export const characterWritten = () => Promise.all([...characterWrites, facesWritten()]);

function rememberCharacter(file, bytes) {
  const writing = atomicWrite(file, bytes)
    .then(() => {
      writesSinceTrim += 1;
      if (writesSinceTrim >= TRIM_EVERY) {
        writesSinceTrim = 0;
        return trimCharacterCache(path.dirname(file));
      }
      return null;
    })
    .catch(() => {})
    .finally(() => characterWrites.delete(writing));
  characterWrites.add(writing);
}

/*
 * Стойка персонажа по полу: кости скелета игры, поза кости головы и — если персонаж стоит в позе — матрицы скининга кадра клипа покоя.
 * Нужна всякий раз, когда на голову надевается проп (кепка, очки), и каждый раз, когда тело и вещь ставятся в позу. Кэш — на запуск Desktop,
 * по игре, полу и позе; не прочиталось — не кэшируется (следующий запрос пробует снова).
 */
const stances = new Map();

async function readEntryFile(resolved, gameRoot, archive, entry, output, context) {
  await resolved.read({ gameRoot, entry: `${archive.replace(/.rpf$/i, "")}:/${entry}`, output }, context);
  return fs.readFile(output);
}

async function loadStance(gameRoot, gender, posed, resolved, context, work, rig = false) {
  /* Живой персонаж: поза привязки без запекания — веса костей остаются у вершин, а скелет уезжает в GLB. Голова — по скелету пола, пропы вяжутся к её кости. */
  if (rig) {
    const ped = await readPedSkeleton({ gameRoot, gender }, resolved, context, work);
    const headIndex = ped.bones.findIndex((entry) => entry.name === HEAD_BONE);
    if (headIndex < 0) throw refusal("CLOTHING_CHARACTER_SKELETON", "В скелете персонажа нет кости головы — проп некуда надеть.");
    const { bind } = poseSkeleton(ped.bones);
    return Object.freeze({ id: "rig", matrices: null, rig: true, head: bind[headIndex].map(Number), headIndex, skeleton: ped.skeleton });
  }
  const skeleton = SKELETONS[gender];
  const bones = readDrawable(
    await readEntryFile(resolved, gameRoot, skeleton.archive, skeleton.entry, path.join(work, `skeleton-${gender}.yft`), context),
    { inflateRaw: inflateRawNode },
  ).drawables.flatMap((drawable) => drawable.bones || []);
  const headIndex = bones.findIndex((entry) => entry.name === HEAD_BONE);
  if (headIndex < 0 || !bones[headIndex].matrix)
    throw refusal("CLOTHING_CHARACTER_SKELETON", "В скелете персонажа нет кости головы — проп некуда надеть.");
  if (!posed) return Object.freeze({ id: "bind", matrices: null, head: bones[headIndex].matrix });
  const idle = IDLE_POSES[gender];
  const clip = path.join(work, `${idle.id}.ycd`);
  await readEntryFile(resolved, gameRoot, idle.archive, idle.entry, clip, context);
  const sampled = await resolved.native("sample-anim-pose", { input: clip, clip: idle.clip, time: idle.time }, context);
  const sampledBones = sampled?.result?.bones || sampled?.bones || [];
  if (!sampledBones.length) throw refusal("CLOTHING_CHARACTER_POSE", "В клипе покоя игры нет костей — персонажа нечем поставить в позу.");
  const pose = poseFromClip(sampledBones);
  pose.delete(BONE_ROOT);
  const solved = poseSkeleton(bones, pose);
  return Object.freeze({ id: idle.id, matrices: skinMatrices(solved), head: solved.posed[headIndex].map(Number) });
}

async function stanceOf(gameRoot, gender, posed, resolved, context, work, rig = false) {
  const key = `${gameHash(gameRoot)}|${gender}|${rig ? "rig" : posed ? "idle" : "bind"}`;
  if (!stances.has(key)) {
    const loading = loadStance(gameRoot, gender, posed, resolved, context, work, rig);
    stances.set(key, loading);
    loading.catch(() => stances.delete(key));
  }
  return stances.get(key);
}

/** Вещь или часть тела — в позу стойки скинингом; без матриц (поза привязки, живой персонаж) — как есть. */
const inStance = (drawable, stance) =>
  stance?.matrices && drawable?.meshes ? { ...drawable, meshes: poseMeshes(drawable.meshes, stance.matrices) } : drawable;

/** Веса костей читаются, когда вершины ставятся в позу на процессоре (запекание) или у видеокарты (живой персонаж). */
const wantsSkin = (stance) => Boolean(stance?.matrices || stance?.rig);

/**
 * Вещь целиком на одной кости: у каждой вершины вес 1 на кости `bone`. Нужна пропу головы живого персонажа: `onBone` уже поставил его в пространство скелета в позе привязки, кость
 * несёт его за собой. Веса пропа из файла игры не годятся — они считались для вершин в пространстве кости, а не скелета.
 */
export function riggedToBone(drawable, bone) {
  if (!drawable?.meshes?.length) return drawable;
  return {
    ...drawable,
    meshes: drawable.meshes.map((mesh) => {
      const count = (mesh.positions?.length || 0) / 3;
      const joints = new Uint16Array(count * 4);
      const weights = new Float32Array(count * 4);
      for (let vertex = 0; vertex < count; vertex += 1) {
        joints[vertex * 4] = bone;
        weights[vertex * 4] = 1;
      }
      return { ...mesh, skin: { joints, weights } };
    }),
  };
}

/** Проп головы: в пространство скелета по кости головы; у живого персонажа ещё и привязан к ней. */
const onHead = (drawable, stance) => {
  const placed = onBone(drawable, stance.head);
  return stance.rig ? riggedToBone(placed, stance.headIndex) : placed;
};

/*
 * Части для рисунка по зонам (`zoneBody`), общие у «Тела» и у остальных разделов (03.11.2026, владелец: «в Теле персонажа руки чёрные целиком, а перешёл в другой раздел — чернила только у плеча, как короткий рукав»).
 * Причина была в том, что в других разделах рисунок строился одной кожей тела: кожа под перчатками снята (`withoutCoveredSkin`), а кожаная рука самих перчаток — их собственная сетка со своими зонами — в рисунок не шла, и чернила
 * кончались там, где под перчаткой начинается её рука. «Тело» эту руку знало (`gloves`), остальные разделы — нет. Теперь у обоих путей одна сборка: кожа тела, кожаная рука перчаток (`zonesOnly`) и кожа ног под штанами.
 *
 * Ноги. Трусы и штаны — `lowr_*`, у ткани зона та же, что у ноги под ней, поэтому чернила ложились бы на ткань. Красится только кожа (`body-ink.js`): у трусов и штанов остаются треугольники, все вершины которых лежат на поверхности голой ноги, а у ткани зон ног нет (05.11.2026: подола и тона текстуры больше нет).
 * Резинка и зад (зона торса) — по-прежнему не в рисунке. Нет голой ноги для сверки (`reference`) — прежняя сборка: зоны ног с самих трусов.
 *
 * `parts` — `[{ name, model, drawable, picture }]` части тела (`model` — файл части: так узнаётся нижняя одежда); `gloves` — сетки надетых перчаток, `pants` — `[{ drawable, picture }]` надетых штанов в той же стойке.
 */
export function inkParts(parts, { gloves = [], pants = [], reference = null } = {}) {
  const out = [];
  const skinOf = (name, drawable) => {
    const skin = reference ? skinTriangles(drawable, reference) : null;
    if (skin) out.push({ name, drawable: skin, picture: null, zonesOnly: true });
    return Boolean(skin);
  };
  for (const part of parts) {
    const lower = /^lowr_/i.test(part.model || "");
    /* Зона торса на нижней части — резинка и зад трусов: V там те же, что на груди, и чернила с груди легли бы на ткань (02.11.2026, «текстурки не вылазили»). */
    const own = lower && reference ? skinOf(`${part.name}_skin`, part.drawable) : false;
    out.push({ name: part.name, drawable: part.drawable, picture: part.picture, noZones: own ? ["torso", "left-leg", "right-leg"] : lower ? ["torso"] : [] });
  }
  pants.forEach((pair, index) => skinOf(`outfit_pants_skin_${index}`, pair.drawable));
  /* У перчаток своя кожаная рука, и кожа тела под ней снята: рисунок должен лежать и на ней, иначе рукав обрывается там, где она начинается (02.11.2026). */
  gloves.forEach((glove, index) => {
    const meshes = (glove?.meshes || []).filter(hasSkinZones);
    if (meshes.length) out.push({ name: `outfit_gloves_skin_${index}`, drawable: { ...glove, meshes }, picture: null, zonesOnly: true });
  });
  return out;
}

/* Голая нога по трусам и шортам в той же стойке: по ней у нижней одежды отличают кожу от ткани. Нет такой ноги (модели не прочитались) — `null`, чернила идут по-старому. */
const legSkins = new WeakMap();
async function legReference(gameRoot, style, stance, resolved, context, work) {
  const table = characterPartsFor(style);
  try {
    const [underwear, shorts] = await Promise.all([
      readPart(gameRoot, table.underwear, stance, resolved, context, work),
      readPart(gameRoot, table.shorts, stance, resolved, context, work),
    ]);
    if (!underwear.drawable || !shorts.drawable) return null;
    if (!legSkins.has(underwear.drawable)) legSkins.set(underwear.drawable, new WeakMap());
    const bySecond = legSkins.get(underwear.drawable);
    if (!bySecond.has(shorts.drawable)) bySecond.set(shorts.drawable, bareLegSkin(underwear.drawable, shorts.drawable));
    return bySecond.get(shorts.drawable);
  } catch {
    return null;
  }
}

/* Тело тату с зонами — вещь «Тела» на модельке; материалы зон зовутся так
   же, как у модели «Татуировок», и рисунок черновика ложится на них. */
async function tattooBodyItem(gameRoot, others, stance, resolved, context, work, style, covers, gloves = [], pants = []) {
  const pieces = onModelTattooParts(others, style);
  /* Части тела и голая нога для сверки чернил читаются разом (15.11.2026): на занятом диске подряд они складывались. */
  const [reads, reference] = await Promise.all([
    Promise.all(pieces.map((piece) => readBodyPart(gameRoot, piece, stance, resolved, context, work, covers))),
    legReference(gameRoot, style, stance, resolved, context, work),
  ]);
  const parts = pieces.map((piece, index) => ({ name: piece.texture.replace(/\.ytd$/i, ""), model: piece.model, drawable: reads[index].drawable, picture: reads[index].picture }));
  const drawable = zoneBody(inkParts(parts, { gloves, pants, reference }));
  return { drawable, picture: null, component: "body" };
}

/*
 * Части тела в памяти Desktop (28.10.2026, владелец: «3D должно грузиться быстро — без пересборки персонажа каждый раз»): тело одно и то же
 * у всех вещей и всех расцветок — читать и разбирать его из архивов игры заново на каждый цвет незачем. Ключ — игра и часть;
 * части не меняются (`combinedDrawable` собирает новый набор, их не правит).
 */
/*
 * PNG картинок частей тела кодируется один раз (круг 4, 28.10.2026, замер в Desktop на игре этого ПК: сборка GLB персонажа — ~0,95 с, из них кодирование
 * PNG — ~115 мс на текстуру 1024², а их у персонажа 6–12). Картинки частей тела живут в памяти (`bodyParts`), поэтому тот же буфер даёт тот же PNG:
 * следующая вещь или другая расцветка той же вещи собирается без повторного кодирования тела. Буфер ушёл из памяти — ушёл и кэш (`WeakMap`).
 */
const encodedPngs = new WeakMap();
export function encodePngOnce(rgba, width, height) {
  if (!rgba || typeof rgba !== "object") return encodePng(rgba, width, height);
  let encoded = encodedPngs.get(rgba);
  if (!encoded) {
    encoded = Promise.resolve(encodePng(rgba, width, height));
    encodedPngs.set(rgba, encoded);
    encoded.catch(() => encodedPngs.delete(rgba));
  }
  return encoded;
}

const bodyParts = new Map();
const BODY_PARTS_LIMIT = 80;
export const forgetBodyParts = () => bodyParts.clear();

async function readPart(gameRoot, piece, stance, resolved, context, work) {
  const key = `${gameHash(gameRoot)}|${piece.archive}|${piece.folder}|${piece.model}|${piece.texture}|${piece.name}|${piece.delta || ""}|${stance.id}`;
  const known = bodyParts.get(key);
  if (known) return known;
  /* В памяти лежит само чтение, а не его итог (15.11.2026): тело читается разом с вещами комплекта, и тот, кто пришёл за частью, пока она читается, ждёт то же чтение, а не начинает второе. */
  const pending = readPartFromGame(gameRoot, piece, stance, resolved, context, work);
  bodyParts.set(key, pending);
  pending.catch(() => {
    if (bodyParts.get(key) === pending) bodyParts.delete(key);
  });
  if (bodyParts.size > BODY_PARTS_LIMIT) bodyParts.delete(bodyParts.keys().next().value);
  return pending;
}

/* Те же части с весами в позе привязки: запечённая в позу часть весов уже не несёт, а порядок вершин у неё тот же. */
const BIND_WITH_SKIN = Object.freeze({ id: "rig", matrices: null, rig: true });

/* Какие вещи лежат прямо на коже торса и рук: под ними кожа пробивала бы ткань. Сумка и цепь кожу не закрывают. */
const COVERS_SKIN = new Set(["tshirts", "armor", "gloves"]);

/* Часть тела без того, что закрывает надетая вещь: кожа не лежит в ткани и не пробивает её (`body-fit.js`). `covers` — сетки вещей в той же стойке. */
async function readBodyPart(gameRoot, piece, stance, resolved, context, work, covers) {
  const read = await readPart(gameRoot, piece, stance, resolved, context, work);
  if (piece.name !== "uppr" || !covers?.length) return read;
  return { ...read, drawable: withoutCoveredSkin(read.drawable, covers) };
}

/* Вещь без весов (автор выгрузил сетку без привязки) получает веса ближайших вершин тела: иначе она стоит в позе привязки рядом с покачивающимся персонажем. */
async function fittedToBody(item, stance, style, gameRoot, resolved, context, work) {
  if (!wantsSkin(stance) || isHeadProp(item.component) || !lacksSkin(item.drawable)) return item;
  const table = characterPartsFor(style);
  const references = (await Promise.all(["bareTorso", "jeans", "flipFlops", "head"].map((name) => readPart(gameRoot, table[name], BIND_WITH_SKIN, resolved, context, work)))).map((part) => part.drawable);
  return { ...item, drawable: withBodySkin(item.drawable, references) };
}

/*
 * Лицо: основа головы плюс поправка родителя — смещения тех же 1514 вершин (`micro_head_NNN_*.ydr`). Поправка не совпала по числу вершин
 * (другая версия игры) — голова остаётся основой, а не ломается.
 */
async function morphedDrawable(drawable, piece, file) {
  const target = readDrawable(await fs.readFile(file), { inflateRaw: inflateRawNode }).drawables.find((entry) => entry.meshes?.length);
  const shift = target?.meshes[0]?.positions;
  const at = drawable.meshes.findIndex((mesh) => mesh.positions?.length === shift?.length);
  if (!shift || at < 0) return drawable;
  const moved = new Float32Array(shift.length);
  for (let index = 0; index < moved.length; index += 1) moved[index] = drawable.meshes[at].positions[index] + shift[index];
  const meshes = drawable.meshes.slice();
  meshes[at] = { ...meshes[at], positions: moved };
  return { ...drawable, meshes };
}

/*
 * Причёска — одна сетка: основные пряди. В модели `hair_NNN_u.ydd` у «колючих» причёсок (шейдер `ped_hair_spiked`) лежат ещё мелкие сетки (63–272 вершины против
 * 2–4 тысяч) — у игры это отдельные проходы (чёлка, подкладка), а на персонаже без них они рисовались тем же вырезом и давали рваные куски кожи, чёрные дыры и
 * розовую ступеньку на лбу (30.10.2026, владелец: «первая нормальная, со второй и дальше битые текстуры»). Остаётся самая большая сетка: все шесть причёсок чистые.
 */
export function mainHairOnly(drawable) {
  const meshes = drawable?.meshes;
  if (!meshes || meshes.length < 2) return drawable;
  const main = meshes.reduce((best, mesh) => ((mesh.positions?.length || 0) > (best.positions?.length || 0) ? mesh : best));
  return { ...drawable, meshes: [main] };
}

async function readPartFromGame(gameRoot, piece, stance, resolved, context, work) {
  const prefix = piece.archive.replace(/\.rpf$/i, "");
  const model = path.join(work, `${piece.name}-${randomUUID()}.ydd`);
  const texture = path.join(work, `${piece.name}-${randomUUID()}.ytd`);
  /* Модель, текстура и поправка лица читаются разом: на занятом диске каждое обращение ждёт своей очереди, и подряд они складываются (15.11.2026). */
  const delta = piece.delta ? path.join(work, `${piece.name}-delta-${randomUUID()}.ydr`) : null;
  await Promise.all([
    resolved.read({ gameRoot, entry: `${prefix}:/${piece.folder}/${piece.model}`, output: model }, context),
    resolved.read({ gameRoot, entry: `${prefix}:/${piece.folder}/${piece.texture}`, output: texture }, context),
    ...(delta ? [resolved.read({ gameRoot, entry: `${prefix}:/${piece.folder}/${piece.delta}`, output: delta }, context)] : []),
  ]);
  let drawable = clothingDrawable(await fs.readFile(model), { inflateRaw: inflateRawNode, skin: wantsSkin(stance) });
  if (piece.name === "hair") drawable = mainHairOnly(drawable);
  if (drawable && piece.delta) drawable = await morphedDrawable(drawable, piece, delta);
  return {
    name: `astral_body_${piece.name}`,
    /* У рук тела — метки кисти до позы: вещь со своей кистью (перчатки) снимает кисть тела целиком (`withHandMarks`). */
    drawable: inStance(piece.name === "uppr" ? withHandMarks(drawable) : drawable, stance),
    picture: colourPicture(await fs.readFile(texture), {
      inflateRaw: inflateRawNode,
    }),
    extras: { astralBody: true },
  };
}

/* Модель по имени внутри словаря педа (форма патрульного — часть модели
   полицейского) и её текстура по началу имени. */
function namedDrawable(bytes, name, skin = false) {
  const parsed = readDrawable(bytes, { inflateRaw: inflateRawNode, ...(skin ? { skin: true } : {}) });
  const hash = joaat(name.toLowerCase());
  return (
    parsed.drawables.find(
      (entry) =>
        entry.hash === hash ||
        String(entry.name || "")
          .toLowerCase()
          .startsWith(name.toLowerCase()),
    ) || null
  );
}

function namedPicture(bytes, prefix) {
  const ref = readTextureDictionary(bytes, { inflateRaw: inflateRawNode }).find(
    (texture) =>
      texture.format &&
      String(texture.name || "")
        .toLowerCase()
        .startsWith(prefix.toLowerCase()),
  );
  return ref ? decodeTextureRef(ref, { maxSize: 1024 }) : null;
}

/*
 * Вещи игры в памяти Desktop (31.10.2026, ТЗ владельца: «выбрал другую модель — быстро отобразилась на персонаже»). Персонаж «одеть» — верх, низ, обувь и так далее; меняют одну
 * вещь, а прочие читались и разбирались заново на каждую смену (два чтения архива, разбор ydd со скинингом, декод текстуры, PNG): замер `wear-read.mjs` — вариант 110–127 мс при
 * 1×, из них неизменные вещи комплекта — больше половины. Разобранная вещь (сетка и картинка) живёт в памяти: ключ — игра, пол, категория, вещь, расцветка, поза (`stance.id`)
 * скинованность (`wantsSkin`), запекание (`stance.matrices`) и риг (`stance.rig`, живой персонаж: веса есть, запекания нет): запечённая в позу, с весами без позы и привязочная вещь — разные записи, как и кэш PNG тела по identity растра (`encodePngOnce`). Вещь не правят (персонаж собирает
 * из неё новую сетку), картинку — тем более: PNG кодируется один раз. Предел по памяти — `GAME_ITEMS_BYTES`, вытесняется давно не нужное; не прочиталась — записи нет.
 */
const gameItems = new Map();
/* Вещи каталога живут здесь же (01.11.2026): у человека, одетого из каталога, каждая смена заново разбирала все его текстуры, предел вырос под них. */
const GAME_ITEMS_BYTES = 160 * 1024 * 1024;
let gameItemsBytes = 0;
export const forgetGameItems = () => {
  gameItems.clear();
  gameItemsBytes = 0;
  itemLists.clear();
  idleTracks.clear();
};
export const gameItemsCached = () => gameItems.size;

const typedBytes = (value) => (ArrayBuffer.isView(value) ? value.byteLength : 0);
function pieceBytes(piece) {
  let bytes = typedBytes(piece?.picture?.rgba);
  for (const mesh of piece?.drawable?.meshes || []) for (const value of Object.values(mesh)) bytes += typedBytes(value);
  return bytes;
}

const stanceKey = (stance) => [wantsSkin(stance) ? "skin" : "bind", stance.matrices ? "baked" : "", stance.rig ? "rig" : "", stance.id];

function gameItem(input, stance, resolved, context, stateDir, work) {
  const key = [gameHash(input.gameRoot), input.gender, input.slot, input.variant, input.texture ?? "", ...stanceKey(stance)].join("|");
  return itemInMemory(key, () => readGameItem(input, stance, resolved, context, stateDir, work));
}

function itemInMemory(key, read) {
  const known = gameItems.get(key);
  if (known) {
    gameItems.delete(key);
    gameItems.set(key, known);
    return known.piece;
  }
  const entry = { piece: read(), bytes: 0 };
  gameItems.set(key, entry);
  entry.piece.then(
    (piece) => {
      if (gameItems.get(key) !== entry) return;
      entry.bytes = pieceBytes(piece);
      gameItemsBytes += entry.bytes;
      for (const [oldKey, old] of gameItems) {
        if (gameItemsBytes <= GAME_ITEMS_BYTES || oldKey === key) break;
        gameItems.delete(oldKey);
        gameItemsBytes -= old.bytes;
      }
    },
    () => {
      if (gameItems.get(key) === entry) gameItems.delete(key);
    },
  );
  return entry.piece;
}

/*
 * Оглавление категории в памяти потока (02.11.2026, стенд `wear-dress-sweep.mjs`): каждый щелчок по новой вещи заново собирал весь список категории — сверка отпечатка игры
 * (96 `stat`), журнал номеров дополнений с диска, слияние заплаток и пустышек, — 10–120 мс при ×1 у масок, верха и брони (вещи дополнений). Список живёт `ITEM_LIST_MS`
 * с последнего обращения; вещи в нём нет (оглавление обновилось) — список читается заново один раз.
 */
const ITEM_LIST_MS = 2 * 60_000;
const itemLists = new Map();

async function listedItem({ gameRoot, slot, gender, variant }, context, stateDir, resolved) {
  const key = [gameHash(gameRoot), stateDir, slot, gender].join("|");
  const fresh = () => {
    const loading = listGameClothing({ gameRoot, slot, gender }, context, stateDir, resolved);
    const entry = { loading, at: Date.now() };
    itemLists.set(key, entry);
    loading.catch(() => itemLists.get(key) === entry && itemLists.delete(key));
    return loading;
  };
  const known = itemLists.get(key);
  let listed = known && Date.now() - known.at < ITEM_LIST_MS ? known.loading : null;
  if (listed) known.at = Date.now();
  let item = listed ? (await listed.catch(() => null))?.variants?.find((entry) => entry.variant === variant) : null;
  if (!item) item = (await fresh()).variants.find((entry) => entry.variant === variant);
  return item || null;
}

/* Вещь из игры игрока «как в файле»: та же, что открыта в мастерской. */
async function readGameItem({ gameRoot, slot, variant, gender, texture: textureNumber = null }, stance, resolved, context, stateDir, work) {
  const source = clothingSource(slot, gender);
  const item = await phase(resolved, "list", () => listedItem({ gameRoot, slot, gender, variant }, context, stateDir, resolved));
  if (!item) throw refusal("CLOTHING_VARIANT", "Такой вещи в игре нет.");
  const place = placeOfItem(source, item);
  const texturePlace = texturePlaceOf(source, item);
  const prefix = place.archive.replace(/\.rpf$/i, "");
  const texturePrefix = texturePlace.archive.replace(/\.rpf$/i, "");
  const modelFile = path.join(work, "item.ydd");
  await resolved.read(
    {
      gameRoot,
      entry: `${prefix}:/${place.folder}/${item.showcase || item.model}`,
      output: modelFile,
    },
    context,
  );
  /* Расцветка по номеру (30.10.2026, «варианты у вещей игры»): выбранная, иначе лицо вещи — первая настоящая. */
  const texture = source.fixed
    ? item.texture
    : textureByIndex(item, textureNumber) || (await phase(resolved, "texture-pick", () => chooseGameTexture({ gameRoot, source: texturePlace, item, stateDir }, context, resolved, work)));
  let picture = null;
  if (texture) {
    const textureFile = path.join(work, "item.ytd");
    await resolved.read(
      { gameRoot, entry: `${texturePrefix}:/${texturePlace.folder}/${texture}`, output: textureFile },
      context,
    );
    const bytes = await fs.readFile(textureFile);
    picture = phase(resolved, "ytd", () =>
      item.drawable ? namedPicture(bytes, item.drawable.replace(/_\d{3}_[ur]$/i, "_diff")) : colourPicture(bytes, { inflateRaw: inflateRawNode }),
    );
  }
  const bytes = await fs.readFile(modelFile);
  const skin = wantsSkin(stance);
  const drawable = phase(resolved, "ydd", () => (item.drawable ? namedDrawable(bytes, item.drawable, skin) : clothingDrawable(bytes, { inflateRaw: inflateRawNode, skin })));
  return headItem({ drawable, picture, component: source.component }, true);
}

/*
 * Причёска и борода как вещи (14.11.2026): сетки с вырезом по альфе листа (`ped_hair_*`, мех) — цвет затекает в прозрачные точки листа, без белой каймы у прядей
 * (общее правило с обложками, `@modovik/clothing/cutout-bleed`). У причёски игры — только основные пряди (`mainHairOnly`: мелкие сетки «колючих» дают рваные куски), у причёски
 * мода — всё, что нарисовал автор. Остальные компоненты — как есть.
 */
function headItem(item, fromGame = false) {
  if (!item?.drawable || (item.component !== "hair" && item.component !== "berd")) return item;
  const drawable = fromGame && item.component === "hair" ? mainHairOnly(item.drawable) : item.drawable;
  const backed = cutoutBacking({ drawable });
  return { ...item, drawable, picture: item.picture && backed ? backed(item.picture) : item.picture };
}

/* Вещь каталога «как в файле» — из её подписанного пакета. Опубликованная версия неизменна, поэтому разобранная вещь живёт в памяти рядом с вещами игры. */
function catalogItem(input, stance, context, deps, fit) {
  const letter = /^[a-z]$/.test(String(input?.colour || "")) ? String(input.colour) : "";
  const key = ["catalog", gameHash(fit.gameRoot), fit.style.gender, input.manifest?.id, input.manifest?.version, letter, ...stanceKey(stance)].join("|");
  return itemInMemory(key, async () => {
    const piece = await readCatalogItem(input, stance, context, deps);
    return phase(deps.tools, "fit", () => fittedToBody(piece, stance, fit.style, fit.gameRoot, deps.tools, context, fit.work));
  });
}

/* Этапы вещи каталога для стенда `wear-catalog.mjs` (16.11.2026, «смена вещи каталога на персонаже ~5 с»): файлы пакета (выдача и скачивание — `download` у инструментов), модель `.ydd`, текстура `.ytd`. */
async function readCatalogItem(input, stance, context, deps) {
  const found = await phase(deps.tools, "catalog-files", () => catalogClothingFiles(input, context, deps, { first: true }));
  const { model, textures, colours } = found;
  /* Выбранная расцветка (буква пакета): на персонаже — именно она; нет такой буквы — первая, как у вещи без выбора. */
  const letter = /^[a-z]$/.test(String(input?.colour || "")) ? String(input.colour) : "";
  const drawable = await phase(deps.tools, "ydd", async () =>
    clothingDrawable(await fs.readFile(model), {
      inflateRaw: inflateRawNode,
      skin: wantsSkin(stance),
    }),
  );
  const pictureOf = async () => (letter && colours?.get(letter) && (await catalogPicture([colours.get(letter)]))) || (await catalogPicture(textures));
  let picture = await phase(deps.tools, "ytd", pictureOf);
  /* Первая текстура — заглушка (или нечитаема): докачиваются остальные расцветки пакета, лицо вещи ищется среди них, как прежде. */
  if (!picture && found.more) {
    await phase(deps.tools, "catalog-files", () => catalogMoreFiles(input, context, deps));
    picture = await phase(deps.tools, "ytd", pictureOf);
  }
  return headItem({ drawable, picture, component: componentOfModelFile(model) });
}

/**
 * Вещь заранее (02.11.2026, владелец: «одежда накладывается секунды 2–3»): человек навёл мышь на плитку — вещь скачивается, разбирается и кодируется в память, а щелчку остаётся только собрать персонажа.
 * Новая вещь каталога стоила скачивание (0,3–2 с по сети) и разбор текстур; к щелчку это уже сделано. `input` — как у вещи в `readClothingCharacter`, ответа нет: готовое лежит в `gameItems`.
 */
export async function warmClothingItem(input, context, deps) {
  const gender = pedGender(requestGender(input));
  const style = { gender, ...pedChoice(gender, input) };
  const resolved = { ...clothingArchiveTools(deps.stateDir), ...(deps.tools || {}) };
  const gameRoot = clothingGameRoot(input);
  const track = input?.animated === true ? await idleTrackOf(gameRoot, gender, deps.stateDir, context, resolved).catch(() => null) : null;
  const work = path.join(deps.stateDir, "clothing-models", "work", randomUUID());
  try {
    await fs.mkdir(work, { recursive: true });
    const stance = await stanceOf(gameRoot, gender, true, resolved, context, work, Boolean(track));
    const piece = input?.manifest
      ? await catalogItem(input, stance, context, { ...deps, tools: resolved }, { gameRoot, style, work })
      : await gameItem({ gameRoot, slot: String(input?.slot || ""), variant: Number(input?.variant), gender, texture: textureIndexOf(input?.texture) }, stance, resolved, context, deps.stateDir, work);
    if (piece?.picture) await encodePngOnce(piece.picture.rgba, piece.picture.width, piece.picture.height);
    /* И карта нормалей (02.11.2026): её PNG щелчок кодировал сам — тот же буфер картинки (`normalPictureOf` помнит её по текстуре словаря) даёт готовый PNG. */
    const normal = piece?.drawable ? normalPictureOf(piece.drawable) : null;
    if (normal) await encodePngOnce(normal.rgba, normal.width, normal.height);
    return true;
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/*
 * Дорожка покоя в памяти потока (02.11.2026): `readIdleTrack` на каждый щелчок читал и разбирал её файл кэша с диска (1–8 мс при ×1). Дорожка одна на игру и пол и не меняется;
 * не прочиталась — записи нет, следующий щелчок пробует снова.
 */
const idleTracks = new Map();
function idleTrackOf(gameRoot, gender, stateDir, context, tools) {
  const key = `${stateDir}|${gameHash(gameRoot)}|${gender}`;
  if (!idleTracks.has(key)) {
    const loading = readIdleTrack({ gameRoot, gender }, stateDir, context, tools);
    idleTracks.set(key, loading);
    loading.catch(() => idleTracks.get(key) === loading && idleTracks.delete(key));
  }
  return idleTracks.get(key);
}

/**
 * Персонаж в вещи — GLB. `input`: `{ gameRoot, slot, variant, texture? }` (вещь игры)
 * или `{ gameRoot, slot, manifest, baseUrl }` (вещь каталога); `others` —
 * вещи комплекта (`[{ slot, variant }]`). Кэш — по игре, категории и вещам.
 *
 * Кто стоит в кадре (ТЗ 29.10.2026-e): `gender` — `male` или `female` (по умолчанию мужской; вещи игры — того же пола, что персонаж),
 * `hair` и `face` — номера вариантов из подборки пола (`ped-styles.js`), `pose` — `idle` (по умолчанию: кадр клипа покоя игры) или `bind`
 * (поза привязки, как до 29.10). Ответ называет, что вышло: `gender`, `hair`, `face`, `pose` и сколько вариантов в подборке (`styles`).
 */
export async function readClothingCharacter(input, context, deps) {
  const slot = String(input?.slot || "");
  /* Пол персонажа — пол вещи: женская вещь «Моделей» (число со смещением) или явный `gender` у вещи каталога. */
  const gender = pedGender(requestGender(input));
  const choice = pedChoice(gender, input);
  const style = { gender, ...choice };
  const posed = String(input?.pose || "idle") !== "bind";
  /* Живой персонаж (`animated`): дорожка покоя читается раньше сборки — нет её (клип не снялся), и персонаж собирается запечённым. */
  const resolvedTools = { ...clothingArchiveTools(deps.stateDir), ...(deps.tools || {}) };
  const track = input?.animated === true && posed ? await phase(resolvedTools, "idle-track", () => idleTrackOf(clothingGameRoot(input), gender, deps.stateDir, context, resolvedTools)).catch(() => null) : null;
  const rig = Boolean(track);
  /* Слот без вещи (`bare`, ТЗ 30.10.2026): человек открыл категорию, но ничего не выбрал, — на персонаже все надетые вещи (и своего слота тоже), а не «вещь слота и остальные». */
  const bare = input?.bare === true && slot !== "tattoos";
  const others = outfitOthers(input, bare ? "" : slot, gender);
  /* Шапка или маска (открытая или в комплекте) закрывают причёску: вещь-причёска и причёска облика под ними не рисуются. */
  const coversHair = hairCovered(slot, bare, others);
  const hiddenHair = !bare && slot === "hair" && coversHair;
  /* Тату — на теле своего пола: зоны наложений игры лежат на второй развёртке частей тела, у женщины она закодирована так же, как у мужчины. */
  const tattoos = input?.tattoos === true && slot !== "tattoos";
  /* «На модельке»: основа — тело в белье, а не одежда «для вида». */
  const onModel = input?.onModel === true;
  /* «Тело» на модельке — само тело тату с зонами (части — без закрытых
     вещами), а не вещь игры: модели у тату игры нет. */
  const tattooBody = onModel && slot === "tattoos" && !input?.manifest;
  /* Части тела под вещами комплекта: считаются по тем вещам, что правда встали на персонажа (31.10.2026) — не прочиталась вещь, и её часть тела остаётся, а не дыра на месте ног. */
  const outfitOf = (worn) =>
    tattooBody
      ? []
      : onModel
        ? onModelOutfit(slot, worn.map((other) => other.slot), style, { bare })
        : characterOutfit(slot, worn.map((other) => other.slot), style);
  const gameRoot = clothingGameRoot(input);
  const catalog = Boolean(input?.manifest);
  const variant = Number(input?.variant);
  if (!catalog && !tattooBody && !bare && !Number.isInteger(variant))
    throw refusal("CLOTHING_VARIANT", "Такой вещи в игре нет.");
  const colourLetter = catalog && /^[a-z]$/.test(String(input?.colour || "")) ? String(input.colour) : "";
  /* Расцветка вещи игры по номеру (30.10.2026): у каждой своя запись в кэше; без номера ключ прежний. */
  const gameTexture = catalog || tattooBody || bare ? null : textureIndexOf(input?.texture);
  const itemKey = catalog
    ? `catalog-${String(input.manifest.id || "")}@${String(input.manifest.version || "")}${colourLetter ? `-c${colourLetter}` : ""}`
    : tattooBody
      ? "body"
      : bare
        ? "bare"
        : `game-${variant}${gameTexture === null ? "" : `-t${gameTexture}`}`;
  if (!/^[a-z0-9@._-]{1,140}$/i.test(itemKey))
    throw refusal("CLOTHING_CATALOG", "У вещи каталога нет пакета.");
  const outfitKey =
    others.length || tattoos
      ? `-o${createHash("sha256")
          .update([...others.map((other) => (other.catalog ? `${other.slot}:c:${other.catalog.manifest.id}@${other.catalog.manifest.version}${other.catalog.colour}` : `${other.slot}:${other.variant}${Number.isInteger(other.texture) ? `:t${other.texture}` : ""}`)), tattoos ? "tattoos" : ""].join("|"))
          .digest("hex")
          .slice(0, 12)}`
      : "";
  /* Пол, причёска, лицо и поза — в имени кэша: у каждого сочетания свой GLB. */
  const styleKey = `-${gender === "female" ? "f" : "m"}${choice.hair}${choice.face}${rig ? "r" : posed ? "i" : "b"}`;
  const cached = path.join(
    deps.stateDir,
    "clothing-models",
    gameHash(gameRoot),
    `character-${bare ? "bare" : slot}-${itemKey}${outfitKey}${onModel ? "-m" : ""}${styleKey}.${CHARACTER_BUILD}.glb`,
  );
  const wornOthers = [];
  /* Какая-то вещь комплекта не прочиталась: персонаж без неё — не тот, что просили, и «навсегда» (кэш) он не станет. */
  let degraded = false;
  let bytes = await fs.readFile(cached).catch(() => null);
  const fromCache = Boolean(bytes);
  if (!bytes) {
    const resolved = resolvedTools;
    const work = path.join(deps.stateDir, "clothing-models", "work", randomUUID());
    /* Чтения, что стартовали разом и не все дождались своего часа (отказ вещи, лишняя часть тела): папка чтения убирается, когда они кончились, а не под ними. */
    const started = [];
    try {
      await fs.mkdir(work, { recursive: true });
      const stance = await phase(resolved, "stance", () => stanceOf(gameRoot, gender, posed, resolved, context, work, rig));
      /* Вещи комплекта читаются до тела: часть тела под вещью уходит, только если сама вещь встала (не прочиталась — комплект без неё, а не отказ и не дыра на её месте). */
      const extra = [];
      /* Вещи на коже: то, что они закрывают, у тела не рисуется (`body-fit.js`). */
      const covers = [];
      const gloves = [];
      const pants = [];
      /*
       * Все чтения игры — разом (15.11.2026, замер `wear-body.mjs`: на занятом диске каждый файл из архива ждёт очереди, и подряд 13–30 чтений складывались в 2–11 с на вход в «Тело»): вещи комплекта,
       * главная вещь и части тела стартуют вместе, дальше сборка идёт в прежнем порядке по готовому. У каждой вещи своя папка: имена файлов чтения у них одинаковы.
       */
      const subFolder = async (name) => {
        const folder = path.join(work, name);
        await fs.mkdir(folder, { recursive: true });
        return folder;
      };
      const loads = others.map((other, index) => {
        if (other.slot === "hair" && coversHair) return null;
        const pending = subFolder(`other-${index}`).then((folder) =>
          other.catalog
            ? catalogItem({ ...other.catalog, slot: other.slot }, stance, context, { ...deps, tools: resolved }, { gameRoot, style, work: folder })
            : gameItem({ gameRoot, slot: other.slot, variant: other.variant, gender, texture: Number.isInteger(other.texture) ? other.texture : null }, stance, resolved, context, deps.stateDir, folder),
        );
        pending.catch(() => {});
        return pending;
      });
      const mainLoad =
        tattooBody || bare || hiddenHair
          ? null
          : subFolder("main").then((folder) =>
              catalog
                ? catalogItem(input, stance, context, { ...deps, tools: resolved }, { gameRoot, style, work: folder })
                : gameItem({ gameRoot, slot, variant, gender, texture: gameTexture }, stance, resolved, context, deps.stateDir, folder),
            );
      mainLoad?.catch(() => {});
      started.push(...loads.filter(Boolean).map((pending) => pending.catch(() => {})), mainLoad?.catch(() => {}));
      /* Части тела: все, что могут понадобиться (вещь комплекта, что не прочитается, вернёт свою часть); лишняя не читается дважды — чтение одно на ключ (`readPart`). */
      const bodyFolder = await subFolder("body");
      const wantedParts = tattooBody
        ? onModelTattooParts([], style)
        : outfitOf(others.filter((other) => !(other.slot === "hair" && coversHair)));
      for (const piece of wantedParts) started.push(readPart(gameRoot, piece, stance, resolved, context, bodyFolder).catch(() => {}));
      if (tattooBody || tattoos) started.push(legReference(gameRoot, style, stance, resolved, context, bodyFolder).catch(() => {}));
      for (const [index, other] of others.entries()) {
        /* Причёска-вещь под шапкой и маской не показывается — как причёска облика (14.11.2026). */
        if (other.slot === "hair" && coversHair) continue;
        try {
          const piece = await loads[index];
          /* Пустышка вещи у игры — один четырёхугольник в стороне от тела
             (маска №1115 лежала плоскостью на полу): в комплект не идёт. */
          const meshes = (piece.drawable?.meshes || []).filter(
            (mesh) => (mesh.positions?.length || 0) > 12,
          );
          if (!meshes.length) continue;
          const solid = { ...piece.drawable, meshes };
          const drawable = isHeadProp(piece.component) ? onHead(solid, stance) : inStance(COVERS_SKIN.has(other.slot) ? withHandMarks(solid) : solid, stance);
          if (COVERS_SKIN.has(other.slot)) covers.push(drawable);
          if (other.slot === "gloves") gloves.push(drawable);
          if (other.slot === "pants") pants.push({ drawable, picture: piece.picture });
          extra.push({
            name: `outfit_${other.slot}`,
            keepName: true,
            drawable,
            picture: piece.picture,
            extras: { astralBody: true, astralOutfit: other.slot },
          });
          wornOthers.push(other);
        } catch {
          /* вещи больше нет в игре или пакет не скачался — комплект без неё; такой персонаж в кэш не кладётся: вещь может вернуться */
          degraded = true;
        }
      }
      const outfit = outfitOf(wornOthers);
      const item = tattooBody
        ? await tattooBodyItem(gameRoot, wornOthers.map((other) => other.slot), stance, resolved, context, bodyFolder, style, covers, gloves, pants)
        : bare || hiddenHair
          ? { drawable: { meshes: [] }, picture: null, component: null }
          : await mainLoad;
      if (!bare && !hiddenHair && !item.drawable?.meshes?.length)
        throw refusal("CLOTHING_CHARACTER_ITEM", "У вещи нет модели — надевать нечего.");
      /* Проп головы лежит в пространстве кости головы — кость в позе несёт его с собой; прочее — скинингом в позу. */
      let worn = isHeadProp(item.component) ? onHead(item.drawable, stance) : inStance(!bare && COVERS_SKIN.has(slot) ? withHandMarks(item.drawable) : item.drawable, stance);
      if (!bare && COVERS_SKIN.has(slot)) covers.push(worn);
      /* Тату-вещь — рисунок поверх кожи: кожа здесь — само тело. */
      if (slot === "tattoos" && !tattooBody) {
        const shown = tattooShowcase(worn);
        worn = {
          ...shown,
          meshes: shown.meshes.filter((mesh) => !mesh.material?.extras?.astralUnderlay),
        };
      }
      const body = await phase(resolved, "body", () => Promise.all(outfit.map((piece) => readBodyPart(gameRoot, piece, stance, resolved, context, bodyFolder, covers))));
      if (tattoos) {
        /* Перчатки и штаны самого открытого раздела — тоже кожа под чернила, как и надетые вещи комплекта. */
        if (!bare && slot === "gloves") gloves.push(worn);
        if (!bare && slot === "pants") pants.push({ drawable: worn, picture: item.picture });
        const reference = await legReference(gameRoot, style, stance, resolved, context, bodyFolder);
        const zones = zoneBody(
          inkParts(
            body.map((part, index) => ({ name: part.name, model: outfit[index].model, drawable: part.drawable, picture: part.picture })),
            { gloves, pants, reference },
          ),
        ).meshes.filter((mesh) => mesh.material?.extras?.astralTattooZone);
        if (zones.length)
          extra.push({
            name: "outfit_tattoos",
            keepName: true,
            drawable: { meshes: zones },
            picture: CLEAR_PICTURE,
            extras: { astralBody: true, astralOutfit: "tattoos" },
          });
      }
      const combined = phase(resolved, "combine", () => combinedDrawable([
        ...body,
        { name: "item", keepName: true, drawable: worn, picture: item.picture },
        ...extra,
      ]));
      const encode = (rgba, width, height) => phase(resolved, "png", () => encodePngOnce(rgba, width, height));
      const glb = await phase(resolved, "glb", () => clothingModelGlb(combined, null, { name: `character-${slot}`, encodePng: encode, ...(rig ? { skeleton: stance.skeleton } : {}) }));
      bytes = Buffer.from(glb.buffer, glb.byteOffset, glb.byteLength);
      /* На диск — следом: человек ждёт персонажа, а не запись 30 МБ. */
      if (!degraded) rememberCharacter(cached, bytes);
    } finally {
      await Promise.allSettled(started);
      await fs.rm(work, { recursive: true, force: true }).catch(() => {});
    }
  }
  if (bytes.length > MAX_CHARACTER_BYTES)
    throw refusal("CLOTHING_MODEL_LARGE", "Персонаж слишком велик для редактора.");
  return {
    slot,
    size: bytes.length,
    bytes: asArrayBuffer(bytes),
    /* Какие вещи комплекта на персонаже. */
    outfit: outfitAnswer(others, fromCache ? others : wornOthers, coversHair),
    tattoos,
    gender,
    hair: choice.hair,
    face: choice.face,
    pose: posed ? "idle" : "bind",
    /* Живой: GLB со скелетом и весами, кости ставит окно по дорожке `track` (`{ fps, duration, frames, tags, rotations }`). */
    animated: rig,
    ...(rig ? { track: { gender: track.gender, fps: track.fps, duration: track.duration, frames: track.frames, tags: track.tags, rotations: track.rotations } } : {}),
    styles: { hairs: PED_STYLES[gender].hairs.length, faces: PED_STYLES[gender].faces.length },
  };
}

/* Сетки с развёрткой одной кучей: вершины, развёртка и индексы с общим отсчётом. Сетки без позиций или развёртки (тени, пустышки) пропускаются. */
function joinedMeshes(meshes) {
  const usable = (meshes || []).filter((mesh) => mesh?.positions?.length && mesh.uvs?.length && mesh.indices?.length);
  const count = (key) => usable.reduce((sum, mesh) => sum + mesh[key].length, 0);
  const positions = new Float32Array(count("positions"));
  const uvs = new Float32Array(count("uvs"));
  const indices = new Uint32Array(count("indices"));
  let vertexAt = 0;
  let indexAt = 0;
  let base = 0;
  for (const mesh of usable) {
    positions.set(mesh.positions, vertexAt * 3);
    uvs.set(mesh.uvs, vertexAt * 2);
    for (let at = 0; at < mesh.indices.length; at += 1) indices[indexAt + at] = mesh.indices[at] + base;
    base += mesh.positions.length / 3;
    vertexAt += mesh.positions.length / 3;
    indexAt += mesh.indices.length;
  }
  return { positions, uvs, indices };
}

/**
 * Голова и борода для запекания в лист штатной бороды (Ц3в, Б2): сетки в одном пространстве (поза привязки), как их собирает персонаж. `input` — как у вещи в `readClothingCharacter`:
 * вещь каталога `{ gameRoot, manifest, baseUrl, colour?, gender? }` или вещь игры `{ gameRoot, slot, variant, texture? }`. Голова — основа `head_000_r` своего пола без поправки лица (борода запекается
 * на голову по умолчанию). Ответ — входы `bakeBeardSheet`: `{ head, beard: { meshes } }`, текстура бороды — цвет вещи (`picture`) на всех её сетках.
 */
export async function readBeardBakeInputs(input, context, deps) {
  const gender = pedGender(requestGender(input));
  const style = { gender, ...pedChoice(gender, input) };
  const resolved = { ...clothingArchiveTools(deps.stateDir), ...(deps.tools || {}) };
  const gameRoot = clothingGameRoot(input);
  const work = path.join(deps.stateDir, "clothing-models", "work", randomUUID());
  try {
    await fs.mkdir(work, { recursive: true });
    const stance = await stanceOf(gameRoot, gender, false, resolved, context, work);
    const headPiece = { ...characterPartsFor(style).head, delta: undefined };
    const head = await readPart(gameRoot, headPiece, stance, resolved, context, work);
    const item = input?.manifest
      ? await catalogItem(input, stance, context, { ...deps, tools: resolved }, { gameRoot, style, work })
      : await gameItem({ gameRoot, slot: String(input?.slot || ""), variant: Number(input?.variant), gender, texture: textureIndexOf(input?.texture) }, stance, resolved, context, deps.stateDir, work);
    const beardMeshes = (item?.drawable?.meshes || []).filter((mesh) => mesh?.positions?.length && mesh.indices?.length);
    if (!beardMeshes.length) throw refusal("GAME_BEARDS", "В модели бороды нет сетки.");
    const picture = item.picture?.rgba ? { width: item.picture.width, height: item.picture.height, rgba: item.picture.rgba } : null;
    return {
      head: joinedMeshes(head.drawable?.meshes),
      beard: { meshes: beardMeshes.map((mesh) => ({ positions: mesh.positions, uvs: mesh.uvs, indices: mesh.indices, texture: picture })) },
    };
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
