/*
 * Шейдеры игры в квартале из игры (`mega-mall-scene.js`): как их рисует игра, если конвертер секции знает их только хешем.
 *
 * Конвертер (`convert-scene`, таблица `rage-res/src/shader_tables.rs`) называет материал `шейдер|лист`, а шейдер, которого нет в
 * его таблице, — `<unknown:хеш>`. Таких в квартале Davis 20.11.2026 было три десятка, и два рода из них кадр рисовал не так, как игра:
 *
 *   • ТОЛЬКО ТЕНЬ. `cpv_only` (цвет по вершинам, без листа) и `trees_shadow_proxy` — упрощённые копии, которые игра кладёт только в
 *     карту теней: у пальмы `cpv_only` — копия ствола (203 вершины против 986), `trees_shadow_proxy` — копия кроны без нормалей; у
 *     щитов Self Storage — `sc1_21_shadowmesh` (архетип с флагом `0x800`, без словаря листов). Кадр рисовал их обычной геометрией:
 *     белой (цвета вершин в квартале выключены) и ровно в плоскости настоящей — плакат щита и его тень дрались за глубину, и любое
 *     движение камеры, даже поворот на месте, перекидывало кадр «плакат / белое / полосы» (разбор — `docs/mega-mall/billboard-flicker-2026-11-20.md`).
 *   • ВЫРЕЗ ПО АЛЬФЕ. Листва деревьев и кустов (`trees*`), трава-мех (`grass*`), сетка заборов (`cutout_fence*`) — карточки с дырами
 *     по альфе листа. Без выреза листья и сетка ложились сплошными карточками. Альфа в листе есть: конвертер пишет PNG всякому
 *     листу с прозрачностью (`run_job`), JPEG — только непрозрачным.
 *
 * Имена — по `joaat(имя)` (тест сверяет с `joaat` из `@modovik/rage-drawable`); хеш в ресурсе бывает и от имени файла `имя.sps`.
 * Когда конвертер выучит эти имена, материал придёт с именем — правило то же.
 */

/* Шейдеры, которые игра рисует только в карте теней. */
const SHADOW_ONLY = Object.freeze(["cpv_only", "trees_shadow_proxy"]);

/* Шейдеры листвы, травы и сетки: вырез по альфе листа. Список — шейдеры игры этих родов (`common:/shaders`). */
const CUTOUT = Object.freeze([
  "trees",
  "trees_tnt",
  "trees_lod",
  "trees_lod_tnt",
  "trees_lod2",
  "trees_lod2d",
  "trees_normal",
  "trees_normal_spec",
  "trees_normal_spec_tnt",
  "trees_normal_spec_wind",
  "trees_normal_diffspec",
  "trees_normal_diffspec_tnt",
  "trees_camera_aligned",
  "trees_camera_facing",
  "trees_normal_spec_camera_aligned",
  "trees_normal_spec_camera_aligned_tnt",
  "trees_normal_spec_camera_facing",
  "trees_normal_spec_camera_facing_tnt",
  "grass",
  "grass_batch",
  "grass_camera_aligned",
  "grass_fur",
  "grass_fur_mask",
  "cutout_fence",
  "cutout_fence_normal",
]);

/* Порог выреза — как у материалов `MASK` из того же конвертера (`alphaCutoff` glTF по умолчанию). */
export const CUTOUT_ALPHA = 0.5;

/** JOAAT игры: тот же, что `joaat` в `@modovik/rage-drawable` (тест сверяет), — свой, чтобы кадр не тянул весь читатель моделей. */
export function shaderHash(text) {
  const source = String(text).toLowerCase();
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = Math.imul(hash + (source.charCodeAt(index) & 0xff), 1025);
    hash ^= hash >>> 6;
  }
  hash = Math.imul(hash, 9);
  hash ^= hash >>> 11;
  return Math.imul(hash, 32769) >>> 0;
}

const LOOKS = new Map([...SHADOW_ONLY.map((name) => [name, "shadow"]), ...CUTOUT.map((name) => [name, "cutout"])]);
const NAME_OF_HASH = new Map(
  [...LOOKS.keys()].flatMap((name) => [
    [shaderHash(name), name],
    [shaderHash(`${name}.sps`), name],
  ]),
);

/**
 * Шейдер материала секции по его имени `шейдер|лист`: имя как есть или расшифрованный `<unknown:хеш>`; хеш вне таблицы — `null`.
 */
export function gameShader(materialName) {
  const head = String(materialName || "").split("|")[0].trim();
  const hashed = /^<unknown:(\d+)>$/.exec(head);
  if (hashed) return NAME_OF_HASH.get(Number(hashed[1]) >>> 0) ?? null;
  return head ? head.toLowerCase().replace(/\.sps$/, "") : null;
}

/** Как игра рисует шейдер: `"shadow"` — только в карте теней, `"cutout"` — с вырезом по альфе, `null` — как материал из конвертера. */
export function shaderLook(materialName) {
  const shader = gameShader(materialName);
  return (shader && LOOKS.get(shader)) || null;
}

/**
 * Вырез по альфе для материала листвы, травы и сетки — один раз на материал (разобранные бандлы живут дольше окна, материал тот
 * же). Обе стороны: карточку листа и сетку забора видно с любой стороны, а у части карточек игры второго слоя нет. Возвращает вид
 * шейдера (`shaderLook`).
 */
export function applyShaderLook(material, doubleSide) {
  const look = shaderLook(material?.name);
  if (look !== "cutout" || material.userData?.gameLook === look) return look;
  material.alphaTest = CUTOUT_ALPHA;
  material.transparent = false;
  material.depthWrite = true;
  material.side = doubleSide;
  material.userData = { ...(material.userData || {}), gameLook: look };
  material.needsUpdate = true;
  return look;
}

/* Сущность, которую игра рисует только в тенях или только в отражениях (`fwEntityDef`, те же биты, что `entityDrawnInView` настольных сборщиков сцен). */
const ONLY_SHADOWS = 1 << 23;
const ONLY_REFLECTIONS = 1 << 25;
const ONLY_WATER_REFLECTIONS = 1 << 27;

/** Сущность видна в кадре (не «только тень» и не «только отражение»). */
export const entityDrawnInView = (flags) => !((Number(flags) >>> 0) & (ONLY_SHADOWS | ONLY_REFLECTIONS | ONLY_WATER_REFLECTIONS));
