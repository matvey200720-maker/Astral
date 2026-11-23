/*
 * Блэкворк по частям тела (голос владельца 01.11.2026: «забить себе левый рукав, правый, … ноги по одной, до колена, полностью ногу, торс»; 02.11.2026: «чтобы накладывались полностью на руку … до локтя … там, где кисть, размытость аккуратненькая, плавненький переход на обычную руку. То же для ног, для тела, для всех рук, для шеи»; 03.11.2026: «торс вместе с руками без щелей кожи на стыке, перед и спина полностью, голова с лицом, под штанами на ногах»).
 *
 * Рисунка здесь нет: часть — сплошные чернила по плоскости зоны тату (`tattoo-zones.js`, U обходит часть тела по кругу, V идёт от плеча к кисти, от бедра к стопе, от шеи к поясу) с мягким краем.
 * Картинка собирается на месте и едет как рисунок тату: рамка на всю зону, поэтому чернила ложатся одинаково у всех вариантов и нога «до колена» кончается там же, где у игры колено.
 *
 * На тело часть ложится слоем с ключом `blackwork:<часть>`, поэтому «Применить» спрашивает про неё отдельной строкой, как про тату, и ставит на то тату игры, что выбрал человек (рамка этого тату переезжает под рисунок).
 * Плитки — по группам (руки, ноги, торс, голова): основные сразу, остальные — под «Показать ещё» (`BLACKWORK_TILES`, у дополнительных `more`).
 *
 * Швы и края (03.11.2026). Зона кончается там, где начинается соседняя часть тела: плечо — у шеи и торса, торс — у пояса, шея — у воротника. Мягкий край на шве оставлял полоску кожи между чернилами руки и торса — на плече,
 * под мышкой, у ворота и у пояса, поэтому у шва край жёсткий: чернила идут до самой сетки зоны (`END` дальше её конца). Мягко сходят только свободные концы: запястье, щиколотка, локоть и колено у коротких вариантов,
 * граница груди и живота, подбородок. Так руки, торс и шея сходятся без щелей, а конец рукава и «до колена» остаются плавными.
 */

/*
 * Где что на плоскости зоны, по моделям игры (`uppr_015_r`, `lowr_001_r`, `head_000_r`, обмер 02–03.11.2026, кость вершины → V):
 *  рука: ключица 0–0,14, плечо до 0,38, локоть на 0,40, предплечье до 0,68, кисть до 0,88, пальцы до 1;
 *  нога: под трусами до 0,2, бедро до 0,47, голень до 0,86, стопа дальше;
 *  торс: от шеи 0,14, низ кожи на 0,88 уже под поясом, перед вокруг U 0,7, спина вокруг U 0,2;
 *  голова: от макушки 0 до подбородка 0,54, шея 0,54–0,78 (воротник), ниже 0,79 на плоскости лежат глаза и рот; лицо — U 0,37–0,64, V 0,21–0,58 (перед вокруг U 0,5, затылок у шва 0/1), уши — U 0,14 и 0,86;
 *    вырез воротника впереди (ямка между ключицами, 38 треугольников, y 0,50–0,55) лежит там же, на V 0,78–0,9, но по U 0,2–0,7; глаза и рот — по краям (U до 0,2 и от 0,7), так что вырез красится отдельно, не задевая их.
 */
export const ELBOW_V = 0.4;
export const WRIST_V = 0.68;
export const KNEE_V = 0.48;
export const ANKLE_V = 0.86;
const COLLAR_V = 0.8;

/* Конец зоны: дальше сетки нет, и край жёсткий — шов или самый конец (пальцы, ступня). */
const END = 1.1;

/* Ширина мягкого края, в долях зоны. */
const SOFT = 0.1;
const SOFT_IN = 0.08;
const SIDE_SOFT = 0.07;
const HOLE_SOFT = 0.04;

const band = (from, to, soft = {}) => Object.freeze({ from, to, softFrom: soft.from ?? 0, softTo: soft.to ?? 0 });
const sector = (centre, half) => Object.freeze({ centre, half });
const sided = (mask, side) => Object.freeze({ ...mask, side });

const part = (id, zone, title, mask) =>
  Object.freeze({
    key: `blackwork:${id}`,
    zone,
    /* Ключ словаря: на экране — через `tattooTitle`. */
    title,
    /* Рамка на всю зону, на весь обхват. */
    uv: Object.freeze({ x: 0.5, y: 0.5 }),
    scale: Object.freeze({ x: 0.5, y: 0.5 }),
    rotation: 0,
    gender: null,
    facing: "",
    blackwork: mask,
  });

/* Рука и нога: от шва плотно, конец сходит мягко за запястьем и щиколоткой — «обрубленной линии» нет. */
const SLEEVE = band(0, WRIST_V + 0.06, { to: SOFT });
const WHOLE_ARM = band(0, END);
const UPPER_ARM = band(0, ELBOW_V + 0.02, { to: SOFT });
const FOREARM = band(ELBOW_V - 0.02, WRIST_V + 0.06, { from: SOFT_IN, to: SOFT });
const WHOLE_LEG = band(0, ANKLE_V + 0.06, { to: SOFT });
const THIGH = band(0, KNEE_V + 0.04, { to: SOFT });
const SHIN = band(KNEE_V - 0.04, ANKLE_V + 0.06, { from: SOFT_IN, to: SOFT });

/* Торс: от ворота до пояса без мягких краёв; перед и спина — половины по U с мягким краем сбоку. */
const WHOLE_TORSO = band(0, END);
const FRONT = sector(0.7, 0.25);
const BACK = sector(0.2, 0.25);
const CHEST = band(0, 0.56, { to: SOFT });
const BELLY = band(0.46, END, { from: SOFT });

/*
 * Голова: шея от подбородка до воротника (воротник — шов с торсом, край жёсткий); голова целиком — от макушки, с лицом (глаза и рот лежат ниже 0,79 и остаются, как у человека).
 * Вырез воротника впереди — отдельная полоса V 0,78–0,92 по середине U (`COLLAR_DIP`): без неё между шеей и торсом оставалась ямка с кожей.
 */
const COLLAR_DIP = sided(band(COLLAR_V - 0.02, 0.92), sector(0.45, 0.25));
const withDip = (mask) => Object.freeze({ ...mask, also: Object.freeze([COLLAR_DIP]) });
const NECK = withDip(band(0.5, COLLAR_V, { from: SOFT_IN }));
const HEAD = withDip(band(0, COLLAR_V));
/* Лицо — прямоугольник на плоскости головы: перед U 0,3–0,7, от лба до подбородка. */
const FACE_HOLE = Object.freeze({ u: 0.5, v: 0.39, halfU: 0.2, halfV: 0.22 });
const NECK_AND_HEAD = Object.freeze({ ...HEAD, hole: FACE_HOLE });
const FACE = sided(band(0.16, 0.62, { from: 0.04, to: 0.04 }), sector(0.5, 0.2));

export const BLACKWORK_SECTIONS = Object.freeze([
  Object.freeze({ id: "arms", title: "Руки" }),
  Object.freeze({ id: "legs", title: "Ноги" }),
  Object.freeze({ id: "torso", title: "Торс" }),
  Object.freeze({ id: "head", title: "Голова" }),
]);

export const BLACKWORK_PARTS = Object.freeze([
  part("left-sleeve", "left-arm", "Левая рука", SLEEVE),
  part("right-sleeve", "right-arm", "Правая рука", SLEEVE),
  part("left-arm-hand", "left-arm", "Левая рука с кистью", WHOLE_ARM),
  part("right-arm-hand", "right-arm", "Правая рука с кистью", WHOLE_ARM),
  part("left-arm-elbow", "left-arm", "Левая рука до локтя", UPPER_ARM),
  part("right-arm-elbow", "right-arm", "Правая рука до локтя", UPPER_ARM),
  part("left-forearm", "left-arm", "Левое предплечье", FOREARM),
  part("right-forearm", "right-arm", "Правое предплечье", FOREARM),
  part("left-leg-full", "left-leg", "Левая нога", WHOLE_LEG),
  part("right-leg-full", "right-leg", "Правая нога", WHOLE_LEG),
  part("left-leg-knee", "left-leg", "Левая нога до колена", THIGH),
  part("right-leg-knee", "right-leg", "Правая нога до колена", THIGH),
  part("left-shin", "left-leg", "Левая голень", SHIN),
  part("right-shin", "right-leg", "Правая голень", SHIN),
  part("torso", "torso", "Перед и спина", WHOLE_TORSO),
  part("torso-upper", "torso", "Грудь и спина", CHEST),
  part("torso-lower", "torso", "Живот и поясница", BELLY),
  part("torso-front", "torso", "Весь перед", sided(WHOLE_TORSO, FRONT)),
  part("torso-back", "torso", "Вся спина", sided(WHOLE_TORSO, BACK)),
  part("torso-chest", "torso", "Грудь", sided(CHEST, FRONT)),
  part("torso-belly", "torso", "Живот", sided(BELLY, FRONT)),
  part("torso-back-upper", "torso", "Верх спины", sided(CHEST, BACK)),
  part("torso-back-lower", "torso", "Поясница", sided(BELLY, BACK)),
  part("neck", "head", "Шея", NECK),
  part("neck-head", "head", "Шея и голова", NECK_AND_HEAD),
  part("head-full", "head", "Голова целиком", HEAD),
  part("face", "head", "Лицо", FACE),
]);

const byKey = new Map(BLACKWORK_PARTS.map((item) => [item.key, item]));

const single = (id, section, more = false) => Object.freeze({ ...byKey.get(`blackwork:${id}`), section, more });

/**
 * Плитки вкладки «Блэкворк» по порядку: в каждой группе сначала основные, потом (`more`) те, что раскрывает «Показать ещё», — другой длины и площади: рука до локтя, предплечье, с кистью; нога до колена, голень;
 * грудь, живот, верх спины, поясница; шея и голова, лицо. Стопы в вариантах нет: на ней обувь, и чернила легли бы на ткань.
 */
export const BLACKWORK_TILES = Object.freeze([
  single("left-sleeve", "arms"),
  single("right-sleeve", "arms"),
  single("left-arm-elbow", "arms", true),
  single("right-arm-elbow", "arms", true),
  single("left-forearm", "arms", true),
  single("right-forearm", "arms", true),
  single("left-arm-hand", "arms", true),
  single("right-arm-hand", "arms", true),
  single("left-leg-full", "legs"),
  single("right-leg-full", "legs"),
  single("left-leg-knee", "legs", true),
  single("right-leg-knee", "legs", true),
  single("left-shin", "legs", true),
  single("right-shin", "legs", true),
  single("torso", "torso"),
  single("torso-front", "torso"),
  single("torso-back", "torso"),
  single("torso-upper", "torso", true),
  single("torso-lower", "torso", true),
  single("torso-chest", "torso", true),
  single("torso-belly", "torso", true),
  single("torso-back-upper", "torso", true),
  single("torso-back-lower", "torso", true),
  single("neck", "head"),
  single("head-full", "head"),
  single("neck-head", "head", true),
  single("face", "head", true),
]);

/** Чернила части лежат на спине: плитку снимают сзади, а не спереди, где их не видно. */
export const blackworkFacesBack = (item) => item?.zone === "torso" && item.blackwork?.side?.centre === BACK.centre;

/** Часть блэкворка по ключу слоя или `null`. */
export const blackworkPart = (key) => byKey.get(key) || null;

/** Другие части той же зоны: у зоны в установке одно тату, поэтому новая часть сменяет прежнюю. */
export const blackworkRivals = (item, keys) =>
  [...keys].filter((key) => {
    const other = blackworkPart(key);
    return other && other.key !== item.key && other.zone === item.zone;
  });

const smooth = (edge) => {
  const clamped = Math.max(0, Math.min(1, edge));
  return clamped * clamped * (3 - 2 * clamped);
};

/** Вдоль части тела: 1 внутри, плавно к нулю на мягких краях. */
export function blackworkAlong(mask, v) {
  const start = mask.softFrom > 0 ? smooth((v - mask.from) / mask.softFrom) : v >= mask.from ? 1 : 0;
  const end = mask.softTo > 0 ? smooth((mask.to - v) / mask.softTo) : v <= mask.to ? 1 : 0;
  return Math.min(start, end);
}

/* Внутри полосы шириной `2 · half` вокруг `centre` по кругу U: 1, к краю — плавно в ноль. */
const within = (u, centre, half, soft) => {
  const turned = Math.abs((((u - centre + 0.5) % 1) + 1) % 1 - 0.5);
  return smooth((half + soft / 2 - turned) / soft);
};

/** Плотность чернил в точке зоны, 0…1. У U нет краёв: она обходит часть тела по кругу. `also` — добавочные полосы: чернила там, где плотнее любая из них. */
export function blackworkAlpha(mask, u, v) {
  let alpha = ownAlpha(mask, u, v);
  for (const other of mask.also || []) alpha = Math.max(alpha, ownAlpha(other, u, v));
  return alpha;
}

function ownAlpha(mask, u, v) {
  let alpha = blackworkAlong(mask, v);
  if (!alpha) return 0;
  if (mask.side) alpha *= within(u, mask.side.centre, mask.side.half, SIDE_SOFT);
  /* Лицо у «шеи и головы» остаётся кожей: дыра в чернилах с мягким краем. */
  if (mask.hole)
    alpha *= 1 - within(u, mask.hole.u, mask.hole.halfU, HOLE_SOFT) * smooth((mask.hole.halfV + HOLE_SOFT / 2 - Math.abs(v - mask.hole.v)) / HOLE_SOFT);
  return alpha;
}

const PICTURE = 512;
const INK = 10;

/** Картинка части в RGBA: `{ width, height, data }`. */
export function blackworkPixels(item, size = PICTURE) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const at = (y * size + x) * 4;
      data[at] = INK;
      data[at + 1] = INK;
      data[at + 2] = INK;
      data[at + 3] = Math.round(255 * blackworkAlpha(item.blackwork, (x + 0.5) / size, (y + 0.5) / size));
    }
  return { width: size, height: size, data };
}

/** Картинка части: PNG, как у тату игры (`readGameTattooPicture`). */
export async function readBlackworkPicture(item) {
  const { width, height, data } = blackworkPixels(item);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").putImageData(new ImageData(data, width, height), 0, 0);
  const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("blackwork"))), "image/png"));
  return { key: item.key, bytes: await blob.arrayBuffer() };
}
