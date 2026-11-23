/*
 * Ствол из игры игрока — таким, каким его видно в игре.
 *
 * Модель ствола в архиве — ещё не то, что человек видит в руках:
 *
 *  • магазин — отдельная модель (`w_pi_pistol_mag1.ydr` со своим словарём),
 *    игра вешает его на кость ствола `WAPClip`. Без него у пистолета пустая
 *    рукоять, «Перезарядке» нечего вынимать, а шаблон не красит обойму;
 *  • цвет — не в диффузе. У стволов на шейдерах `weapon_*_palette` в RGB
 *    лежит светлая деталь (≈200–230), а в альфе — номер столбца палитры
 *    `<ствол>_dpal` (128×32): строка — оттенок оружия (0 — штатный тёмный,
 *    2 — золото, 3 — розовый…). Игра умножает деталь на цвет палитры, и
 *    ствол без палитры выглядит белым.
 *
 * Здесь из этого собирается одна модель: ствол, магазин на своём месте и
 * штатный оттенок, перемноженный в картинку цвета. Студия красит её, кадр
 * витрины снимается с неё же. Чистый JS — главный процесс Desktop, тесты,
 * скрипт витрины.
 *
 * Обвесы (задача 6 ТЗ 17.10.2026, вторая половина): `parts` — модели
 * обвесов игры (глушитель, прицел, ствол MK2, камуфляж…) на костях ствола.
 * Обвес встаёт так, как его ставит игра: его кость крепления (`AAPSupp`)
 * совмещается с костью ствола (`WAPSupp`). Выбранный магазин встаёт
 * вместо штатного.
 *
 * Надписи оружия (ТЗ 12.10.2026, ночь): заводские надписи — клеймо, калибр,
 * номер, логотип — в модель не попадают (`./inscriptions.js`): куски
 * наклеек с надписями не берутся в модель, а надписи, нарисованные в самой
 * картинке корпуса, стёрты. Ствол в студии штатный, но чистый, и краска не
 * режется по форме букв.
 */

import { readDrawable, readTextureDictionary } from "@modovik/rage-drawable";
import { defaultMagazineModel } from "@modovik/rpf-inspector/weapon-identity";
import {
  clearPaintedInscriptions,
  findInscriptions,
  paintedInscriptionsOf,
  withoutTriangles,
} from "./inscriptions.js";
import { weaponModel } from "./model.js";

/* Штатный магазин ствола — по данным игры, одна таблица с установщиком
   скина (`@modovik/rpf-inspector/weapon-identity`). */
export { defaultMagazineModel };

/** Файлы, из которых собирается ствол из игры: что искать в архивах. */
export function gameWeaponFiles(model) {
  const base = String(model || "")
    .trim()
    .toLowerCase();
  const magazine = defaultMagazineModel(base);
  return {
    model: `${base}.ydr`,
    modelHi: `${base}_hi.ydr`,
    textures: `${base}.ytd`,
    texturesHi: `${base}+hi.ytd`,
    magazine: magazine ? `${magazine}.ydr` : null,
    magazineTextures: magazine ? `${magazine}.ytd` : null,
    magazineTexturesHi: magazine ? `${magazine}+hi.ytd` : null,
  };
}

/** Строка палитры, которую игра показывает без выбранного оттенка. */
export const STOCK_TINT_ROW = 0;

/**
 * Цвет детали в игре: RGB диффуза × цвет палитры в столбце из альфы.
 * Возвращает новую картинку (альфа — непрозрачная: у этих материалов она
 * не прозрачность, а номер столбца, и после перемножения она не нужна).
 */
export function composeTintPalette(diffuse, palette, row = STOCK_TINT_ROW) {
  const { width, height, rgba } = diffuse;
  const out = new Uint8Array(width * height * 4);
  const columns = palette.width;
  const line = Math.min(Math.max(0, row), palette.height - 1) * columns;
  /*
   * Таблицами, а не счётом на пиксель (02.11.2026, замер сборки ствола из игры): лист 2048² — 4 млн округлений и делений, ~300 мс из ~700 мс сборки GLB.
   * Столбец зависит только от альфы, произведение — только от байта и цвета столбца: 256 столбцов и 256 × 3 × столбцов произведений, ответ тот же байт в байт.
   */
  const columnOf = new Uint16Array(256);
  for (let alpha = 0; alpha < 256; alpha += 1) columnOf[alpha] = Math.min(columns - 1, Math.floor((alpha / 255) * columns));
  const product = new Uint8Array(columns * 3 * 256);
  for (let column = 0; column < columns; column += 1)
    for (let channel = 0; channel < 3; channel += 1) {
      const ink = palette.rgba[(line + column) * 4 + channel];
      const base = (column * 3 + channel) * 256;
      for (let value = 0; value < 256; value += 1) product[base + value] = Math.round((value * ink) / 255);
    }
  const end = width * height * 4;
  for (let at = 0; at < end; at += 4) {
    const base = columnOf[rgba[at + 3]] * 768;
    out[at] = product[base + rgba[at]];
    out[at + 1] = product[base + 256 + rgba[at + 1]];
    out[at + 2] = product[base + 512 + rgba[at + 2]];
    out[at + 3] = 255;
  }
  return { width, height, rgba: out };
}

/*
 * Оси: `readDrawable` отдаёт вершины уже в осях glTF (Y вверх), а матрица
 * кости — в осях RAGE (Z вверх). Точка glTF (x, y, z) — это RAGE (x, −z, y).
 */
const toRage = (x, y, z) => [x, -z, y];
const fromRage = (x, y, z) => [x, z, -y];

function transform(matrix, x, y, z, w) {
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12] * w,
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13] * w,
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14] * w,
  ];
}

/** Меши детали, переставленные на кость ствола (матрица — в осях RAGE). */
export function placeOnBone(meshes, matrix) {
  return meshes.map((mesh) => {
    const positions = new Float32Array(mesh.positions.length);
    for (let at = 0; at < positions.length; at += 3) {
      const [x, y, z] = toRage(
        mesh.positions[at],
        mesh.positions[at + 1],
        mesh.positions[at + 2],
      );
      const moved = fromRage(...transform(matrix, x, y, z, 1));
      positions.set(moved, at);
    }
    let normals = null;
    if (mesh.normals) {
      normals = new Float32Array(mesh.normals.length);
      for (let at = 0; at < normals.length; at += 3) {
        const [x, y, z] = toRage(
          mesh.normals[at],
          mesh.normals[at + 1],
          mesh.normals[at + 2],
        );
        const turned = fromRage(...transform(matrix, x, y, z, 0));
        const length = Math.hypot(...turned) || 1;
        normals.set(
          turned.map((value) => value / length),
          at,
        );
      }
    }
    return { ...mesh, positions, normals };
  });
}

/* Матрица кости в осях RAGE — обратная (кость жёсткая: поворот и перенос,
   масштаб у костей оружия единичный). */
export function invertRigid(matrix) {
  const m = matrix;
  const out = new Array(16).fill(0);
  /* Поворот — транспонированный, перенос — повёрнутый назад. */
  for (let row = 0; row < 3; row += 1)
    for (let column = 0; column < 3; column += 1)
      out[column * 4 + row] = m[row * 4 + column];
  for (let row = 0; row < 3; row += 1)
    out[12 + row] = -(out[row] * m[12] + out[4 + row] * m[13] + out[8 + row] * m[14]);
  out[15] = 1;
  return out;
}

export function multiplyMatrices(a, b) {
  const out = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1)
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  return out;
}

/* Кость модели по имени — без учёта регистра и подчёркиваний: в таблице
   игры кость камуфляжа `AAPCamo`, а в модели — `AAP_Camo`. */
const boneKey = (name) => String(name || "").toLowerCase().replace(/_/g, "");
export function findBone(drawable, name) {
  const wanted = boneKey(name);
  return (drawable?.bones || []).find((bone) => bone?.matrix && boneKey(bone.name) === wanted) || null;
}

/**
 * Где обвес стоит в модели ствола: кость ствола × обратная кости крепления
 * обвеса (обе — в осях RAGE). Кости крепления у обвеса нет — его начало
 * осей и есть точка крепления.
 */
export function componentPlacement(weaponDrawable, weaponBone, componentDrawable, componentBone) {
  const bone = findBone(weaponDrawable, weaponBone);
  if (!bone) return null;
  const own = findBone(componentDrawable, componentBone);
  return own ? multiplyMatrices(bone.matrix, invertRigid(own.matrix)) : [...bone.matrix];
}

/*
 * Камуфляж MK2 — сетка-наклейка поверх корпуса (шейдер наклейки игры
 * сдвигает её по глубине). В модели ствола она едет обычным прозрачным
 * шейдером, и чтобы не мерцать в корпусе, приподнята над ним на 0,3 мм по
 * нормали — глазом не видно ни в кадре, ни в руках.
 */
export const CAMO_LIFT = 0.0003;

function liftAlongNormals(mesh, lift) {
  if (!mesh.normals) return mesh;
  const positions = new Float32Array(mesh.positions.length);
  for (let at = 0; at < positions.length; at += 1)
    positions[at] = mesh.positions[at] + mesh.normals[at] * lift;
  return { ...mesh, positions };
}

const CLIP_BONES = ["wapclip", "wapclip_2", "gun_magazine"];

function clipBone(drawable) {
  const bones = drawable?.bones || [];
  for (const name of CLIP_BONES) {
    const bone = bones.find(
      (item) => String(item?.name || "").toLowerCase() === name,
    );
    if (bone?.matrix) return bone;
  }
  return null;
}

/**
 * Обвесы на костях модели ствола: модель обвеса (её `_hi`, если есть) со
 * своими словарями, после них — словари ствола `weaponTextures` (палитра
 * MK2-ствола лежит в них). Обвес, чья кость в модели не нашлась или чья
 * модель не читается, не встаёт — и об этом `parts[].skipped` (`bone` |
 * `read`). Общий шаг ствола из игры и ствола пака: `{ meshes, lookups,
 * parts }`, у каждой сетки — `part` (кость, обвес, вид).
 */
export function attachParts(drawable, parts, { weaponTextures = [], inflateRaw, maxTexture = 2048 } = {}) {
  const meshes = [];
  const lookups = [];
  const placedParts = [];
  for (const part of parts) {
    const report = { bone: part.bone, component: part.component?.id || "", model: part.component?.model || "" };
    try {
      const partModel = weaponModel(
        [...(part.files || []), ...weaponTextures.map((file) => ({ ...file, role: "texture" }))],
        { inflateRaw, maxTexture },
      );
      const matrix = componentPlacement(drawable, part.bone, partModel.drawable, part.component?.bone);
      if (!matrix) {
        placedParts.push({ ...report, skipped: "bone" });
        continue;
      }
      const camo = part.component?.kind === "camo";
      const placed = placeOnBone(partModel.drawable.meshes, matrix).map((mesh) => ({
        ...(camo ? liftAlongNormals(mesh, CAMO_LIFT) : mesh),
        part: { bone: part.bone, component: report.component, kind: part.component?.kind || "" },
      }));
      meshes.push(...placed);
      lookups.push(partModel.texture);
      placedParts.push({ ...report, meshes: placed.length });
    } catch {
      placedParts.push({ ...report, skipped: "read" });
    }
  }
  return { meshes, lookups, parts: placedParts };
}

/**
 * Ствол пака с обвесами на его костях (19.10.2026, владелец: «не
 * накладуються обвесы когда их ставишь, сделать чтобы люди могли ставить их
 * и делать себе скин»). Ствол — ровно тот, что без обвесов (`weaponModel`:
 * текстуры автора как есть, без палитры и чистки надписей), обвесы — как у
 * ствола из игры: кость крепления обвеса совмещена с костью модели пака,
 * оттенок палитры запечён в цвет. `files` — файлы ствола пака в ролях
 * `weaponModel`, `parts` — `[{ bone, component, files }]`. Ответ — `{ model,
 * drawable, texture(material, role), parts }` для `drawableToGlb`.
 */
export function packWeaponWithAttachments(files, { inflateRaw, maxTexture = 2048, parts = [] } = {}) {
  const main = weaponModel(files, { inflateRaw, maxTexture });
  const attached = attachParts(main.drawable, parts, {
    weaponTextures: files.filter((file) => file.role === "texture-hi" || file.role === "texture"),
    inflateRaw,
    maxTexture,
  });
  const ownMaterials = new Set(attached.meshes.map((mesh) => mesh.material).filter(Boolean));
  const partPicture = (name) => {
    for (const lookup of attached.lookups) {
      const found = lookup(name);
      if (found) return found;
    }
    return main.texture(name);
  };
  const tinted = new Map();
  const texture = (material, role) => {
    const name = material?.textures?.[role];
    if (!name) return null;
    if (!ownMaterials.has(material)) return main.texture(name);
    const paletteName = material.textures.palette;
    if (role !== "diffuse" || !paletteName) return partPicture(name);
    const key = `${String(name).toLowerCase()}|${String(paletteName).toLowerCase()}`;
    if (!tinted.has(key)) {
      const diffuse = partPicture(name);
      const palette = partPicture(paletteName);
      tinted.set(
        key,
        diffuse && palette?.width > 0 && palette.height > 0
          ? { name: diffuse.name, ...composeTintPalette(diffuse, palette) }
          : diffuse,
      );
    }
    return tinted.get(key);
  };
  for (const mesh of attached.meshes) {
    const material = mesh.material;
    if (!material || material.extras) continue;
    material.extras = { shader: material.shader || "", ...(material.textures?.palette ? { palette: material.textures.palette, tintRow: STOCK_TINT_ROW } : {}) };
  }
  return {
    model: main.model,
    /* Цвета вершин у обвесов игры — маски шейдера, а не оттенок (как у
       ствола из игры, `vertexColours: false`): с ними обвес пожелтел бы. */
    drawable: { ...main.drawable, meshes: [...main.drawable.meshes, ...attached.meshes.map((mesh) => ({ ...mesh, colours: null }))] },
    texture,
    parts: attached.parts,
  };
}

/**
 * Модель ствола «как в игре».
 *
 * `files` — `[{ name, role, bytes }]` в ролях `weaponModel` (`model`,
 * `model-hi`, `texture`, `texture-hi`) плюс `magazine`, `magazine-texture`,
 * `magazine-texture-hi`. Возвращает `{ drawable, texture(name), magazine }`
 * для `drawableToGlb`: у материалов палитры картинка цвета уже с оттенком,
 * материал называется именем своей текстуры цвета (в неё запекается
 * покраска), а шейдер и палитра — в `extras`. Ещё `raw(name)` — картинка
 * текстуры как есть и `inscriptions.triangles` — сколько треугольников
 * заводских надписей не вошло в модель.
 */
export function gameWeaponModel(
  files,
  { inflateRaw, maxTexture = 2048, tintRow = STOCK_TINT_ROW, parts = [] } = {},
) {
  const weaponFiles = files.filter((file) =>
    ["model", "model-hi", "texture", "texture-hi"].includes(file.role),
  );
  const main = weaponModel(weaponFiles, { inflateRaw, maxTexture });
  const meshes = [...main.drawable.meshes];
  const lookups = [main.texture];

  let magazine = null;
  const magazineFile = files.find((file) => file.role === "magazine");
  const bone = clipBone(main.drawable);
  /* Выбранный магазин (обвес на `WAPClip`) встаёт вместо штатного. */
  const clipChosen = parts.some((part) => /^wapclip/i.test(String(part?.bone || "")));
  if (magazineFile && bone && !clipChosen) {
    try {
      const magazineModel = weaponModel(
        [
          { ...magazineFile, role: "model" },
          ...files
            .filter((file) => file.role === "magazine-texture-hi")
            .map((file) => ({ ...file, role: "texture-hi" })),
          ...files
            .filter((file) => file.role === "magazine-texture")
            .map((file) => ({ ...file, role: "texture" })),
          /* Словарь самого ствола — последним: у части стволов магазин
             берёт текстуры из него. */
          ...weaponFiles
            .filter((file) => file.role === "texture")
            .map((file) => ({ ...file, role: "texture" })),
        ],
        { inflateRaw, maxTexture },
      );
      /* `mount` — кость, на которой висит магазин: точка места «Магазин» на
         схеме обвесов — на нём самом (`weapon-outline.js`). */
      meshes.push(...placeOnBone(magazineModel.drawable.meshes, bone.matrix).map((mesh) => ({ ...mesh, mount: bone.name })));
      lookups.push(magazineModel.texture);
      magazine = {
        model: magazineFile.name,
        bone: bone.name,
        meshes: magazineModel.drawable.meshes.length,
      };
    } catch {
      /* Магазин не разобрался — ствол всё равно показывается, без него. */
      magazine = null;
    }
  }

  const attached = attachParts(main.drawable, parts, {
    weaponTextures: weaponFiles.filter((file) => file.role === "texture"),
    inflateRaw,
    maxTexture,
  });
  meshes.push(...attached.meshes);
  lookups.push(...attached.lookups);
  const placedParts = attached.parts;

  const stock = (name) => {
    for (const lookup of lookups) {
      const found = lookup(name);
      if (found) return found;
    }
    return null;
  };
  /* Надписи, нарисованные в самой картинке (`PAINTED_INSCRIPTIONS`), —
     стёрты: цвет, карта нормалей, альфа букв — от фона. */
  const cleared = new Map();
  const raw = (name) => {
    const boxes = paintedInscriptionsOf(name);
    if (!boxes) return stock(name);
    const key = String(name).toLowerCase();
    if (!cleared.has(key)) {
      const picture = stock(name);
      cleared.set(key, picture ? { name: picture.name, ...clearPaintedInscriptions(picture, boxes) } : null);
    }
    return cleared.get(key);
  };

  /* Надписи оружия (ТЗ 12.10.2026, ночь): куски наклеек с надписями — прочь,
     винты и точки мушки — остаются. То же правило сводит их в точку в
     моделях пакета скина (`weapon-inscriptions.js`), и игра с кадром
     студии сходятся. */
  /* Камуфляж MK2 — наклейка-узор во весь ствол: его пятна — не надписи. */
  const inscriptions = findInscriptions(
    meshes.filter((mesh) => mesh.part?.kind !== "camo"),
    raw,
  );
  const clean = [];
  for (const mesh of meshes) {
    const removed = inscriptions.meshes.get(mesh);
    const rest = removed ? withoutTriangles(mesh, removed) : mesh;
    if (rest) clean.push(rest);
  }
  const tinted = new Map();
  const texture = (material, role) => {
    const name = material?.textures?.[role];
    if (!name) return null;
    const paletteName = material?.textures?.palette;
    if (role !== "diffuse" || !paletteName) return raw(name);
    const key = `${String(name).toLowerCase()}|${String(paletteName).toLowerCase()}`;
    if (tinted.has(key)) return tinted.get(key);
    const diffuse = raw(name);
    const palette = raw(paletteName);
    const value =
      diffuse && palette && palette.width > 0 && palette.height > 0
        ? { name: diffuse.name, ...composeTintPalette(diffuse, palette, tintRow) }
        : diffuse;
    tinted.set(key, value);
    return value;
  };

  for (const mesh of clean) {
    const material = mesh.material;
    if (!material || material.extras) continue;
    material.extras = {
      shader: material.shader || "",
      ...(material.textures?.palette
        ? { palette: material.textures.palette, tintRow }
        : {}),
    };
  }

  return {
    model: main.model,
    drawable: { ...main.drawable, meshes: clean },
    texture,
    /* Картинка по имени текстуры — та же, по которой разобраны надписи. */
    raw,
    magazine,
    /* Обвесы на костях: что встало и что нет (`skipped`: bone | read). */
    parts: placedParts,
    inscriptions: { triangles: inscriptions.triangles },
  };
}

/** Есть ли у модели палитра оттенков (по любому материалу). */
export function usesTintPalette(drawable) {
  return (drawable?.materials || []).some(
    (material) => material?.textures?.palette,
  );
}

/** Имена текстур палитры в словаре (`*_dpal`, `*_pal`) — для запекания. */
export function paletteTextureNames(bytes, { inflateRaw } = {}) {
  return readTextureDictionary(bytes, { inflateRaw })
    .map((texture) => texture.name)
    .filter((name) => /_d?pal$/i.test(String(name || "")));
}

export { readDrawable };
