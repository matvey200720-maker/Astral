/*
 * Модель вещи в GLB — одна сборка на всех: витрина каталога («Покрутить в
 * 3D»), мастерская (вещь каталога и вещь из игры игрока) и «Вид».
 *
 * Вещь — меши модели (`.ydd`) с картой нормалей из неё же и текстура
 * расцветки (`.ytd`). Цвета вершин у педов — служебные маски, а не оттенок,
 * поэтому в GLB их нет: иначе ткань пожелтела бы. Чистый JS: собирается в
 * работнике разбора, в главном процессе Desktop и в окне.
 *
 * Расцветка-заглушка — шахматка или серая болванка вместо ткани: у части
 * вещей игры такой бывает первая или самая крупная буква. Её не показывают
 * лицом вещи (`isStubPicture`).
 */

import {
  decodeTextureRef,
  readDrawable,
  readTextureDictionary,
} from "@modovik/rage-drawable";
import { drawableToGlb } from "@modovik/rage-drawable/glb";
import { encodePng as encodePngJs } from "@modovik/gfx/png";
import { handsOnly } from "./glove-hands.js";
import { looksLikeChecker } from "./pictures.js";
import {
  normalPictureOf,
  shotRequestOf,
  TATTOO_SKIN,
} from "./shot-request.js";

/**
 * Модель вещи из байт `.ydd`: первая с мешами. `skin` — с весами костей (`mesh.skin`): так вещь пишется в скинованный GLB
 * (`clothingModelGlb(..., { skeleton })`) или ставится в позу скинингом (`@modovik/rage-drawable/pose`); без него — как в файле.
 */
export function clothingDrawable(bytes, { inflateRaw, skin = false } = {}) {
  const model = readDrawable(bytes, { inflateRaw, ...(skin ? { skin: true } : {}) });
  return (
    model.drawables.find((entry) => entry.meshes.length) ||
    model.drawables[0] ||
    null
  );
}

/**
 * Картинка расцветки из байт её `.ytd`. Внутри текстура зовётся как угодно
 * (`acne2`), поэтому берётся первая, которую можно прочесть.
 */
export function colourPicture(bytes, { inflateRaw, maxSize = 1024 } = {}) {
  const ref = readTextureDictionary(bytes, { inflateRaw }).find(
    (texture) => texture.format,
  );
  return ref ? decodeTextureRef(ref, { maxSize }) : null;
}

/*
 * Пропы головы (кепка, очки, серьги) лежат в пространстве кости головы: верх
 * вещи — по +X модели, а перед — по −Z (сверено по настоящим моделям: у
 * «Bugstars Forwards Cap» из ограбления казино козырёк уходит в −Z, у
 * «Backwards Cap» — в +Z, у очков стёкла в −Z, а дужки в +Z). Показанная как
 * есть, кепка лежала бы на боку, а очки стояли бы стёклами друг над другом.
 * Для показа — поворот на 90° вокруг оси взгляда (верх — вверх) и на 180°
 * вокруг вертикали: козырёк и стёкла смотрят на зрителя, как лицо педа у
 * остальной одежды. Установка файлов вещи это не трогает — только снимок и 3D.
 */
const HEAD_PROPS = new Set(["p_head", "p_eyes", "p_ears", "p_mouth"]);

/** Проп головы: лежит в пространстве кости головы, а не тела. */
export const isHeadProp = (component) => HEAD_PROPS.has(component);

function rollUp(array) {
  if (!array) return array;
  const out = new Float32Array(array.length);
  for (let at = 0; at < array.length; at += 3) {
    out[at] = array[at + 1];
    out[at + 1] = array[at];
    out[at + 2] = -array[at + 2];
  }
  return out;
}

/*
 * Сумки и рюкзаки (`hand`) в игре стоят на спине педа: лицо сумки — нашивки, карманы, принт — смотрит туда же, куда спина педа (−Z; пед смотрит в +Z), а к переду
 * педа обращены лямки. Для показа такая сумка разворачивается на 180° вокруг вертикали (Y: вещь уже Y-up): в мастерской, в 3D каталога и на обложке её открывают лицом, а не лямками.
 *
 * Но не каждую сумку носят сзади: поясные и нагрудные («Black_mqueen», «Killa BAG», «LaRoutine») в модели стоят впереди торса, и наружу они смотрят уже в +Z — разворот показал
 * бы их изнанкой (06.11.2026). Сторону решает геометрия, а не список: центр масс вершин по Z впереди порога — сумка носится спереди и не разворачивается. Порог подобран по 89 живым
 * сумкам: все рюкзаки — ниже −0,11, поясные и через плечо за спиной — от −0,06 до +0,03, носимые спереди — от +0,05 (Killa BAG +0,08, mqueen +0,11, Goyard +0,14).
 */
const TURNED = new Set(["hand"]);

/** Центр масс сумки по Z впереди этого — она носится спереди, наружная сторона уже смотрит к зрителю. */
export const FRONT_WORN_Z = 0.04;

/** Как носится сумка: `"back"` — за торсом (разворачивается на 180°), `"front"` — спереди (как в модели). Пустая модель — как носимая сзади, по прежнему правилу. */
export function bagFacing(drawable) {
  let sum = 0;
  let count = 0;
  for (const mesh of drawable?.meshes || [])
    for (let at = 2; at < (mesh.positions?.length || 0); at += 3) {
      sum += mesh.positions[at];
      count += 1;
    }
  /* Вершины — float32: порог берётся с запасом на округление. */
  return count && sum / count >= FRONT_WORN_Z - 1e-6 ? "front" : "back";
}

function turnAround(array) {
  if (!array) return array;
  const out = new Float32Array(array.length);
  for (let at = 0; at < array.length; at += 3) {
    out[at] = -array[at];
    out[at + 1] = array[at + 1];
    out[at + 2] = -array[at + 2];
  }
  return out;
}

/*
 * Перчатки в игре — две кисти на месте рук педа (компонент `uppr`): в позе
 * привязки руки опущены, ладони смотрят к телу, пальцы — вниз и чуть в
 * стороны. Показанные так, они стоят к зрителю ребром, далеко друг от друга.
 * Для показа и покраски каждая кисть разворачивается тыльной стороной к
 * зрителю пальцами вниз — как на снимке перчатки из ТЗ 04.10.2026, — и обе
 * встают рядом: правая слева, левая справа, как у человека лицом к нам.
 * Развёртка та же — краска ложится в ту же текстуру вещи.
 *
 * Оси кисти — главные оси её точек: самая длинная — от запястья к пальцам
 * (пальцы ниже запястья), самая короткая — толщина ладони (тыл — наружу от
 * тела). В середине модели точек быть не должно: вещь с туловищем (тату,
 * кофта) — не перчатки, и её показ не трогается.
 */
const GLOVE_MIDDLE = 0.12;
const GLOVE_GAP = 0.012;

/* Собственные векторы симметричной 3×3 (вращения Якоби). */
function principalAxes(cov) {
  const a = cov.map((row) => row.slice());
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 32; sweep += 1)
    for (let p = 0; p < 2; p += 1)
      for (let q = p + 1; q < 3; q += 1) {
        if (Math.abs(a[p][q]) < 1e-14) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t =
          (theta < 0 ? -1 : 1) / (Math.abs(theta) + Math.sqrt(theta ** 2 + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k += 1) {
          const kp = a[k][p];
          const kq = a[k][q];
          a[k][p] = c * kp - s * kq;
          a[k][q] = s * kp + c * kq;
        }
        for (let k = 0; k < 3; k += 1) {
          const pk = a[p][k];
          const qk = a[q][k];
          a[p][k] = c * pk - s * qk;
          a[q][k] = s * pk + c * qk;
        }
        for (let k = 0; k < 3; k += 1) {
          const kp = v[k][p];
          const kq = v[k][q];
          v[k][p] = c * kp - s * kq;
          v[k][q] = s * kp + c * kq;
        }
      }
  return [0, 1, 2]
    .map((index) => ({
      value: a[index][index],
      vector: [v[0][index], v[1][index], v[2][index]],
    }))
    .sort((left, right) => right.value - left.value);
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a) => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};

/** Как развернуть кисть стороны `side` (−1 — правая, +1 — левая). */
function gloveTurn(points, side) {
  const count = points.length / 3;
  const centre = [0, 0, 0];
  for (let at = 0; at < points.length; at += 3)
    for (let k = 0; k < 3; k += 1) centre[k] += points[at + k] / count;
  const cov = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let at = 0; at < points.length; at += 3)
    for (let i = 0; i < 3; i += 1)
      for (let j = 0; j < 3; j += 1)
        cov[i][j] +=
          ((points[at + i] - centre[i]) * (points[at + j] - centre[j])) / count;
  const [length, , thickness] = principalAxes(cov);
  let fingers = unit(length.vector);
  if (fingers[1] > 0) fingers = fingers.map((value) => -value);
  let back = thickness.vector;
  if (Math.sign(back[0]) !== side) back = back.map((value) => -value);
  back = unit(back.map((value, k) => value - dot(back, fingers) * fingers[k]));
  const side3 = cross(fingers, back);
  /* Пальцы → −Y, тыл → +Z, третья ось → −X (правило правой руки). */
  const rotate = (x, y, z) => {
    const p = [x, y, z];
    return [-dot(side3, p), -dot(fingers, p), dot(back, p)];
  };
  return { centre, rotate };
}

export function glovesShowcase(drawable) {
  if (!drawable?.meshes?.length) return drawable;
  const sides = { [-1]: [], [1]: [] };
  for (const mesh of drawable.meshes) {
    const positions = mesh.positions;
    for (let at = 0; at < positions.length; at += 3) {
      const x = positions[at];
      if (Math.abs(x) < GLOVE_MIDDLE) return drawable;
      sides[x < 0 ? -1 : 1].push(positions[at], positions[at + 1], positions[at + 2]);
    }
  }
  if (!sides[-1].length || !sides[1].length) return drawable;
  const turns = {
    [-1]: gloveTurn(sides[-1], -1),
    [1]: gloveTurn(sides[1], 1),
  };
  const turned = drawable.meshes.map((mesh) => {
    const positions = new Float32Array(mesh.positions.length);
    const normals = mesh.normals ? new Float32Array(mesh.normals.length) : null;
    for (let at = 0; at < positions.length; at += 3) {
      const side = mesh.positions[at] < 0 ? -1 : 1;
      const { centre, rotate } = turns[side];
      const p = rotate(
        mesh.positions[at] - centre[0],
        mesh.positions[at + 1] - centre[1],
        mesh.positions[at + 2] - centre[2],
      );
      positions.set(p, at);
      if (normals)
        normals.set(
          rotate(mesh.normals[at], mesh.normals[at + 1], mesh.normals[at + 2]),
          at,
        );
    }
    return { mesh, positions, normals };
  });
  /* Рядом: правая — слева от середины, левая — справа, запястья на одной
     высоте, обе на одной глубине. */
  const box = { [-1]: null, [1]: null };
  for (const { mesh, positions } of turned)
    for (let at = 0; at < positions.length; at += 3) {
      const side = mesh.positions[at] < 0 ? -1 : 1;
      const b = (box[side] ||= {
        min: [Infinity, Infinity, Infinity],
        max: [-Infinity, -Infinity, -Infinity],
      });
      for (let k = 0; k < 3; k += 1) {
        b.min[k] = Math.min(b.min[k], positions[at + k]);
        b.max[k] = Math.max(b.max[k], positions[at + k]);
      }
    }
  const shift = {
    [-1]: [
      -GLOVE_GAP / 2 - box[-1].max[0],
      -box[-1].max[1],
      -(box[-1].min[2] + box[-1].max[2]) / 2,
    ],
    [1]: [
      GLOVE_GAP / 2 - box[1].min[0],
      -box[1].max[1],
      -(box[1].min[2] + box[1].max[2]) / 2,
    ],
  };
  return {
    ...drawable,
    meshes: turned.map(({ mesh, positions, normals }) => {
      for (let at = 0; at < positions.length; at += 3) {
        const offset = shift[mesh.positions[at] < 0 ? -1 : 1];
        positions[at] += offset[0];
        positions[at + 1] += offset[1];
        positions[at + 2] += offset[2];
      }
      return { ...mesh, positions, normals: normals || mesh.normals };
    }),
  };
}

/*
 * Обувь стоит на ногах педа — пара в четверти метра друг от друга, и в
 * квадрате карточки ботинки мелкие и по углам. Для показа левый и правый
 * сдвигаются к середине до зазора в пару сантиметров; форма и развёртка те же.
 * Вещь с точками в середине (не пара) не трогается.
 */
const PAIR_MIDDLE = 0.03;
const PAIR_GAP = 0.02;

export function pairShowcase(drawable) {
  if (!drawable?.meshes?.length) return drawable;
  let leftInner = -Infinity;
  let rightInner = Infinity;
  for (const mesh of drawable.meshes)
    for (let at = 0; at < mesh.positions.length; at += 3) {
      const x = mesh.positions[at];
      if (Math.abs(x) < PAIR_MIDDLE) return drawable;
      if (x < 0) leftInner = Math.max(leftInner, x);
      else rightInner = Math.min(rightInner, x);
    }
  if (!Number.isFinite(leftInner) || !Number.isFinite(rightInner))
    return drawable;
  const left = -PAIR_GAP / 2 - leftInner;
  const right = PAIR_GAP / 2 - rightInner;
  return {
    ...drawable,
    meshes: drawable.meshes.map((mesh) => {
      const positions = new Float32Array(mesh.positions);
      for (let at = 0; at < positions.length; at += 3)
        positions[at] += positions[at] < 0 ? left : right;
      return { ...mesh, positions };
    }),
  };
}

/*
 * Проп на кости — «Посмотреть на персонаже»: кепка и очки лежат в
 * пространстве кости головы, а тело — в позе привязки педа. `matrix` —
 * абсолютная матрица кости из скелета педа (`readDrawable(...).bones`, оси
 * RAGE, по столбцам); точки вещи уже в осях glTF ((x, y, z) → (x, z, −y)),
 * поэтому сначала обратно в RAGE, через кость — и снова в glTF.
 */
export function onBone(drawable, matrix) {
  if (!drawable?.meshes?.length || !Array.isArray(matrix) || matrix.length < 16)
    return drawable;
  const m = matrix;
  const place = (array, translate) => {
    if (!array) return array;
    const out = new Float32Array(array.length);
    for (let at = 0; at < array.length; at += 3) {
      const x = array[at];
      const y = -array[at + 2];
      const z = array[at + 1];
      const w = translate ? 1 : 0;
      const rx = m[0] * x + m[4] * y + m[8] * z + m[12] * w;
      const ry = m[1] * x + m[5] * y + m[9] * z + m[13] * w;
      const rz = m[2] * x + m[6] * y + m[10] * z + m[14] * w;
      out[at] = rx;
      out[at + 1] = rz;
      out[at + 2] = -ry;
    }
    return out;
  };
  return {
    ...drawable,
    meshes: drawable.meshes.map((mesh) => ({
      ...mesh,
      positions: place(mesh.positions, true),
      normals: place(mesh.normals, false),
    })),
  };
}

/**
 * Модель вещи так, как её показывают: пропы головы — верхом вверх, сумки —
 * лицом к зрителю, обувь — парой рядом, перчатки (`slot: "gloves"`) — парой
 * тыльной стороной к зрителю. Слот нужен перчаткам: их компонент `uppr` — и
 * руки тату. На персонаже (`посмотреть на персонаже`) вещь — как в файле.
 */
export function showcaseDrawable(drawable, component, { slot = null, picture = null } = {}) {
  /* Перчатки лежат в `uppr` вместе с рукой и плечами: в кадре только две кисти (`glove-hands.js`), а не вся рука. `picture` — расцветка: по ней находится
     манжета на предплечье и убирается кожа у края. Уже вырезанное (`handsCut`) второй раз не режется. */
  if (slot === "gloves") return glovesShowcase(component === "uppr" ? handsOnly(drawable, { picture }) || drawable : drawable);
  /* Обувь и украшения рук (`teef` у серверов — кольца и когти на пальцах, `gta5rp_skins7f`: куски лежат у обеих кистей, в метре друг от друга): парой, у середины.
     Цепочка и галстук лежат на оси тела — у них точки в середине, и `pairShowcase` их не трогает. */
  if (component === "feet" || component === "teef") return pairShowcase(drawable);
  const turn = HEAD_PROPS.has(component)
    ? rollUp
    : TURNED.has(component) && bagFacing(drawable) === "back"
      ? turnAround
      : null;
  if (!drawable || !turn) return drawable;
  return {
    ...drawable,
    meshes: drawable.meshes.map((mesh) => ({
      ...mesh,
      positions: turn(mesh.positions),
      normals: turn(mesh.normals),
    })),
  };
}

/** Заглушка вместо ткани: шахматка, болванка или ничего. */
export const isStubPicture = (picture) => !picture || looksLikeChecker(picture);

export { TATTOO_SKIN };

/*
 * Тату в модах — облегающая сетка торса и рук с рисунком на прозрачном
 * фоне, надетая вместо аксессуара. У неё альфа — сам рисунок, а не маска
 * блеска, как у остальной одежды: без кожи под ним тату висело бы в пустоте,
 * а с альфой, залитой в 255, стало бы серой кофтой. Поэтому у показа тату
 * под сеткой лежит та же сетка в тоне кожи — тело из геометрии самой вещи,
 * не нарисованный манекен, — а сама сетка прозрачная.
 */
/** Подложка кожи под тату — не деталь: её не красят и в неё не целятся. */
export const UNDERLAY_MATERIAL = "astral_skin";

const linearOf = (value) => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** Модель тату для показа: кожа из той же сетки и прозрачный рисунок. */
export function tattooShowcase(drawable) {
  if (!drawable) return drawable;
  const skin = {
    shader: UNDERLAY_MATERIAL,
    textures: {},
    alphaMode: "opaque",
    /* Цвет материала glTF — линейный, а тон кожи записан в sRGB. */
    colour: [...TATTOO_SKIN.map(linearOf), 1],
    extras: { astralUnderlay: true },
  };
  const drawings = new Map();
  const drawing = (material) => {
    /* `astralDrawing`: краска мастерской добавляет рисунок, а не
       обрезается по его альфе, как у вырезов наклеек Rockstar. Свечение
       неонового тату (шейдер `emissive`) в показ не идёт: карта свечения —
       старый рисунок, и он светил бы сквозь новую краску, серя чёрную тушь. */
    if (!drawings.has(material))
      drawings.set(material, {
        ...material,
        alphaMode: "blend",
        emissive: false,
        extras: { astralDrawing: true },
      });
    return drawings.get(material);
  };
  return {
    ...drawable,
    meshes: [
      ...drawable.meshes.map((mesh) => ({ ...mesh, material: skin })),
      ...drawable.meshes.map((mesh) => ({
        ...mesh,
        material: drawing(mesh.material || {}),
      })),
    ],
  };
}

/*
 * Тату сервера — наложение, а не вещь (`decorations.js`): сетки у него нет,
 * игра рисует картинку прямо по коже. В мастерской его красят на листе —
 * прямоугольник в пропорциях картинки, лицом к зрителю (+Z), развёртка во
 * всю картинку (glTF, как DirectX, считает v сверху). Под листом та же
 * кожа, что у тату-вещей (`tattooShowcase`): рисунок на прозрачном фоне.
 */
export function decorationSheet(picture, { texture = "tattoo" } = {}) {
  const aspect = picture?.height ? picture.width / picture.height : 1;
  const w = aspect / 2;
  const h = 0.5;
  return {
    name: texture,
    meshes: [
      {
        positions: new Float32Array([-w, h, 0, -w, -h, 0, w, -h, 0, w, h, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
        uvs: new Float32Array([0, 0, 0, 1, 1, 1, 1, 0]),
        indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
        material: { shader: texture, textures: { diffuse: texture } },
      },
    ],
  };
}

/** GLB листа тату сервера: кожа и рисунок наложения поверх. */
export const decorationModelGlb = (
  picture,
  { texture, name, encodePng } = {},
) =>
  clothingModelGlb(decorationSheet(picture, { texture }), picture, {
    encodePng,
    name: name || texture,
    category: "tattoos",
  });

/**
 * GLB вещи в расцветке `picture` (`{ width, height, rgba }` или `null`).
 * `category: "tattoos"` — рисунок поверх кожи (`tattooShowcase`).
 */
export function clothingModelGlb(
  drawable,
  picture,
  { encodePng = encodePngJs, name, category = null, skeleton = null } = {},
) {
  const request = shotRequestOf(drawable, { texture: picture });
  const shown = category === "tattoos" ? tattooShowcase(drawable) : drawable;
  return drawableToGlb(shown, {
    textureFor: (material, role) => {
      if (material?.extras?.astralUnderlay) return null;
      /* Вещь из нескольких (`combinedDrawable`): у каждой своя расцветка. */
      const own = material?.astralPart;
      if (role === "diffuse") return own ? own.picture : request.texture;
      if (role === "normal") return own ? own.normal : request.normal;
      return null;
    },
    materialName: (material) => material?.astralPart?.name || null,
    encodePng,
    name,
    vertexColours: false,
    /* Ключ содержимого у каждой картинки: окно не заливает в видеочип заново то, что уже стоит (тело, неизменные вещи комплекта). */
    imageKeys: true,
    /* Скинованный GLB: меши с `skin` (`readDrawable(..., { skin: true })`) получают веса, а кости — узлы скелета игры (`ped-skeleton.js`). */
    ...(skeleton ? { skeleton } : {}),
  });
}

/**
 * Несколько вещей одним показом — цепочка и балаклава на карточке
 * «Аксессуары». Вещи педа лежат в одном пространстве (поза привязки), поэтому
 * стоят друг относительно друга так же, как на персонаже. У каждой своя
 * расцветка и карта нормалей (`material.astralPart`) — их берут снимок
 * (`shotRequestOf`) и GLB. Имена текстур получают имя вещи впереди: у двух
 * вещей они бывают одинаковыми, а GLB делит картинки по имени.
 *
 * `parts` — `[{ name, drawable, picture }]`.
 */
export function combinedDrawable(parts) {
  const meshes = [];
  for (const [index, part] of parts.entries()) {
    if (!part?.drawable?.meshes?.length) continue;
    const name = part.name || `part_${index}`;
    const normal = normalPictureOf(part.drawable);
    const materials = new Map();
    for (const mesh of part.drawable.meshes) {
      if (!materials.has(mesh.material)) {
        const material = mesh.material || {};
        materials.set(mesh.material, {
          ...material,
          textures: Object.fromEntries(
            Object.entries(material.textures || {}).map(([role, texture]) => [
              role,
              `${name}:${texture}`,
            ]),
          ),
          /* `keepName` — материал зовётся, как в GLB самой вещи (по шейдеру):
             мастерская привязывает покраску по имени, и на персонаже вещь
             остаётся той же деталью. `extras` — метки показа (`astralBody`). */
          /* Материал уже знает свою часть (тело тату `zoneBody`: у каждой
             части тела своя кожа) — а у части своей картинки нет: картинка
             материала остаётся, иначе тело «На модельке» выходило белым. */
          astralPart:
            material.astralPart && !part.picture
              ? { ...material.astralPart, ...(part.keepName ? {} : { name }), normal: material.astralPart.normal || normal }
              : {
                  name: part.keepName ? null : name,
                  picture: part.picture || null,
                  normal,
                },
          ...(part.extras
            ? { extras: { ...(material.extras || {}), ...part.extras } }
            : {}),
        });
      }
      meshes.push({ ...mesh, material: materials.get(mesh.material) });
    }
  }
  return {
    name: parts.map((part) => part?.name).filter(Boolean).join("+"),
    meshes,
    embeddedTextures: [],
  };
}
