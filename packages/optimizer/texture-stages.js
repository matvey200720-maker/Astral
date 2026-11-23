import { TEXTURE_STYLES } from "./texture-style-ids.js";

/*
 * Конвейер текстур мира «Оптимизации» (ТЗ 17.10.2026, задача 10: ЧБ-мир и
 * стили мира).
 *
 * Пакет дополнения `astral_textures` везёт словари и модели карты игрока,
 * собранные одним проходом нативного хоста (`downscale-textures`,
 * `TextureLevelCommands.cs` + `TextureStages.cs`). Проход — цепочка стадий,
 * у каждой текстуры по порядку:
 *
 *   1. срез — верхние ступени mip до предела стороны («Ухудшение текстур»;
 *      без ступени у ЧБ-мира — `GRAY_WORLD_CAP`);
 *   2. стиль мира — один из `TEXTURE_STYLES` (`texture-styles.js`:
 *      рисованный, комикс, мультяшный, акварель, ретро) или ни одного:
 *      красится верхняя ступень mip, остальные — её уменьшением (задача 35);
 *   3. ЧБ — `grayscale`: цвет текстуры → её яркость.
 *
 * Порядок держит `TEXTURE_STAGES`: стиль стоит ДО ЧБ, поэтому включённый
 * ЧБ-мир красит в серый уже стилизованные текстуры. Стиль без ступени
 * «Ухудшения текстур» ставится с тем же пределом, что ЧБ (`GRAY_WORLD_CAP`).
 * Новая стадия:
 *
 *   • имя — в `TEXTURE_STAGES` на своё место (порядок = порядок прохода);
 *   • пиксели — в хосте: `TextureStages.Apply(texture, stage)` и, если
 *     стадии нужны пиксели целиком: `TextureStages.TransformLevels` (каждая
 *     ступень mip сама, как у ЧБ) или `TransformFromTop` (стиль: красится
 *     верхняя ступень, остальные — её уменьшением, чтобы вдали рисунок не
 *     менялся скачком на каждой ступени) — разжимают ступени в RGBA, отдают
 *     функции стадии и сжимают обратно В ТОТ ЖЕ формат и размер (BC7 — в DXT5
 *     того же веса): память видеокарты и вес пакета не растут, игра не тормозит;
 *   • в окне — функция пикселей того же правила для предпросмотра (как
 *     `grayscaleRgba`) и вариант в записи установки (`textures.js`).
 *
 * Собранное помнится по варианту: ключ `textureVariantKey(cap, stages)` —
 * `128` у чистого среза (как прежде), `128+grayscale` у ЧБ,
 * `128+style-comic` у стиля, `128+style-comic+grayscale` у обоих. Один и
 * тот же словарь разных вариантов лежит в кэше рядом и не пересобирается,
 * когда человек переключает ЧБ или стиль туда и обратно.
 *
 * Что красится в ЧБ: только цвет мира — словари и модели переписи карты
 * (`texture-census.js`: город, загород, земля, дороги, растительность,
 * предметы, интерьеры и дальние планы LOD/SLOD) и, с задачи 35 (б), словари
 * машин и деталей и штатное оружие (`vehicles`, `weapons` переписи; оружие —
 * пока нет Astral Weapons DLC). Люди и одежда в перепись не входят и остаются
 * цветными (как на сервере из примера владельца); небо, вода и свет — не
 * текстуры, их цвет задаёт таймцикл.
 * Нормали (`_n`, `_nm`, `_nrm`, `_norm`, `_normal`, `_dn`, `_bump`, а
 * также по содержимому — голубые карты около (128, 128, 255)) и блеск
 * (`_s`, `_sp`, `_spec`) — не цвет, а данные освещения: серыми они
 * испортили бы свет, поэтому остаются. Палитры тинта (`_pal`) — цвет
 * заборов и контейнеров: им ЧБ нужен, и красятся они точка в точку, без
 * усреднения (`texture-stage-tint-palettes`).
 */

/*
 * Версия стадий: меняется, когда меняется то, как хост красит (правило ЧБ,
 * что считается нормалью, краска любого стиля мира). Собранные варианты со
 * стадиями прежней версии пересобираются, чистый срез — нет
 * (`texture-levels.js`). Новый стиль версию не трогает: у него новое имя и
 * свой вариант в кэше. Краску стилей сторожит `texture-styles.test.js`: он
 * не даёт изменить её, не подняв версию.
 *
 * 1 — стили мира (ТЗ 17.10.2026, задача 10);
 * 2 — задача 35 (19.10.2026): стиль красит верхнюю ступень mip, остальные —
 *     её уменьшением; вырезная альфа (листва) красится по видимым точкам;
 *     ступени яркости комикса — внутри яркости текстуры, а не от 0 до 255;
 *     усиление цвета комикса и мультяшного не обрезает канал;
 * 3 — задача 35 (а): упакованные данные (`…_h`, `_gobo`, маски) не красятся ни
 *     стилем, ни ЧБ (`isPackedDataTexture`): собранное с ними прежней версией
 *     пересобирается;
 * 4 — задача 35 (остальные стили): ступени яркости рисованного, мультяшного,
 *     акварели и ретро — внутри яркости текстуры, как у комикса (почти ровное
 *     не постеризуется, ровное тёмное не подскакивает на ступень, чёрного
 *     нет); у рисованного усиление цвета не обрезает канал; бумага акварели
 *     светлит тёмное меньше; цвет ретро крупными шагами ослабляется вместе со
 *     ступенями. Варианты со стилем пересобираются.
 */
export const TEXTURE_STAGES_VERSION = 4;

/** Стадии в порядке прохода: стили мира (один из них), потом ЧБ. */
export const TEXTURE_STAGES = Object.freeze([...TEXTURE_STYLES, "grayscale"]);
/** Порядок по видам: стиль мира — перед ЧБ. */
export const TEXTURE_STAGE_ORDER = Object.freeze(["style", "grayscale"]);

export { TEXTURE_STYLES };

/**
 * Предел стороны ЧБ-мира без «Ухудшения текстур». Вся карта в полном
 * размере — около 20 ГиБ словарей (замер 17.10.2026 на игре владельца:
 * 1024 px — 18,5; 512 — 11,4; 256 — 3,9; 128 — 1,1 ГиБ), а пакет
 * дополнения держит до 3,6 ГиБ вместе с моделями. 128 px — самый чёткий
 * предел, при котором серым встаёт вся карта: словари и крупные модели —
 * в первом пакете (3,71 ГБ), остальные модели со своими текстурами — во
 * втором, `astral_textures_b` (1,23 ГБ; `textureLevelFiles`).
 */
export const GRAY_WORLD_CAP = 128;

/*
 * Чёткость ЧБ-мира и стилей без «Ухудшения текстур» (ТЗ 17.10.2026, задача
 * 10): 128 px — «легко» (два пакета, около 5 ГиБ) или 256 px — «детальнее»
 * (три пакета, около 9,3 ГиБ: замер на игре владельца, словари 4,1 и модели
 * 5,3). Со ступенью «Ухудшения» предел её.
 */
export const WORLD_DETAILS = Object.freeze([GRAY_WORLD_CAP, 256]);

/** Чёткость мира: 128 или 256; не названа — 128; иное — отказ. */
export function worldDetailOf(detail) {
  if (detail === null || detail === undefined || detail === "") return GRAY_WORLD_CAP;
  const value = Number(detail);
  if (!WORLD_DETAILS.includes(value)) throw new Error(`Чёткости мира ${detail} px нет.`);
  return value;
}

/** Стадии по порядку прохода без повторов; незнакомая — отказ, два стиля разом — тоже. */
export function normalizeTextureStages(stages) {
  const named = (Array.isArray(stages) ? stages : []).filter((stage) => stage !== null && stage !== undefined && stage !== "");
  const list = [...new Set(named.map(String))];
  for (const stage of list) if (!TEXTURE_STAGES.includes(stage)) throw new Error(`Стадии текстур «${stage}» нет.`);
  if (list.filter((stage) => TEXTURE_STYLES.includes(stage)).length > 1) throw new Error("Стиль мира один: два стиля разом не ставятся.");
  return TEXTURE_STAGES.filter((stage) => list.includes(stage));
}

/** Стадии ЧБ-мира: `gray` — включён ли. */
export const grayWorldStages = (gray) => (gray ? ["grayscale"] : []);

/** Стиль мира среди стадий или `null`. */
export const styleOfStages = (stages) => (Array.isArray(stages) ? stages.find((stage) => TEXTURE_STYLES.includes(stage)) || null : null);

/** Стиль мира по имени: нет такого — отказ; не назван — `null`. */
export function worldStyleOf(style) {
  if (style === null || style === undefined || style === "") return null;
  if (!TEXTURE_STYLES.includes(String(style))) throw new Error(`Стиля мира «${style}» нет.`);
  return String(style);
}

/** Стадии мира: стиль (если назван) и ЧБ (`gray`) по порядку прохода. */
export const worldStages = (style, gray) => normalizeTextureStages([worldStyleOf(style), ...grayWorldStages(gray)]);

/**
 * Ключ варианта в кэше ступеней: число у чистого среза (так его писали
 * всегда), строка `<предел>+<стадии>` у стадий.
 */
export function textureVariantKey(cap, stages = []) {
  const list = normalizeTextureStages(stages);
  return list.length ? `${cap}+${list.join("+")}` : Number(cap);
}

/**
 * Предел стороны пакета: ступень «Ухудшения» или, у одного ЧБ или стиля,
 * чёткость мира (`detail`: 128 — по умолчанию, или 256).
 */
export function textureLookCap(levelCap, gray, style = null, detail = GRAY_WORLD_CAP) {
  const look = Boolean(gray) || worldStyleOf(style) !== null;
  return levelCap || (look ? worldDetailOf(detail) : null);
}

/*
 * Яркость — коэффициенты Rec. 709 по значениям sRGB, как у хоста
 * (`TextureStages.Luma`): та же формула красит кадр предпросмотра.
 */
export const GRAY_LUMA = Object.freeze([0.2126, 0.7152, 0.0722]);

/** Яркость цвета 0…255 (целым). */
export const grayLuma = (r, g, b) => Math.round(GRAY_LUMA[0] * r + GRAY_LUMA[1] * g + GRAY_LUMA[2] * b);

/**
 * ЧБ на месте: каждый пиксель RGBA — своя яркость, альфа та же. Для кадра
 * предпросмотра и проверок; в игру те же правила кладёт хост.
 */
export function grayscaleRgba(rgba) {
  for (let at = 0; at + 3 < rgba.length; at += 4) {
    const y = grayLuma(rgba[at], rgba[at + 1], rgba[at + 2]);
    rgba[at] = y;
    rgba[at + 1] = y;
    rgba[at + 2] = y;
  }
  return rgba;
}

/* Имена карт освещения, а не цвета: нормали и блеск (копия правила хоста,
   `TextureStages.IsLightingData`; совпадение держит тест). */
const LIGHTING_DATA = /_(?:n|nm|nrm|norm|normal|dn|bump|s|sp|spec|specular)$/i;

/** Карта освещения (нормаль, блеск) по имени текстуры — её ЧБ не красит. */
export const isLightingDataTexture = (name) => LIGHTING_DATA.test(String(name || ""));

/*
 * Упакованные данные по имени (задача 35, а; копия `PackedData` хоста): карты
 * высот `…_h` (у терраина и дорог `nxg_*_h` — каналы RGB несут высоту и
 * вспомогательные карты, а не цвет), прожекторные маски `…_gobo`, маски и таблицы
 * (`_mask`, `_msk`, `_ao`, `_lightmap`, `_ramp`). Ни стиль, ни ЧБ их не красят.
 */
const PACKED_DATA = /_(?:h|gobo|mask|msk|ao|lightmap|ramp)\d*$/i;

/** Упакованные данные (высоты, маски), а не цвет, по имени текстуры — ни стиль, ни ЧБ их не красят. */
export const isPackedDataTexture = (name) => PACKED_DATA.test(String(name || ""));

/** Красит ли хост эту текстуру по имени: не карта освещения и не упакованные данные (формат и содержимое он смотрит сам). */
export const isColourTextureName = (name) => !isLightingDataTexture(name) && !isPackedDataTexture(name);
