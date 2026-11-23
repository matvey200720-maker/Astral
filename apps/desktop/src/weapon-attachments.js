import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import sharp from "sharp";
import { readDrawable } from "@modovik/rage-drawable";
import { weaponModel } from "@modovik/gunpack/model";
import {
  componentPlacement,
  composeTintPalette,
  findBone,
  gameWeaponModel,
  invertRigid,
  multiplyMatrices,
  placeOnBone,
} from "@modovik/gunpack/game-weapon";
import { colourTextureName } from "@modovik/gun-studio";
import { ATTACHMENT_LIMITS, ownModelMeshes } from "@modovik/gun-studio/own-model";
import { buildOwnModelBody } from "./weapon-own-model.js";

/*
 * Обвесы на стволе — в модель ствола в игре (задача 6 ТЗ 17.10.2026, вторая
 * половина: «устанавливать их визуально на дефолтные ганы»).
 *
 * Выбор человека приходит из студии (`project.attachments`: кость → обвес) и
 * сверяется с таблицей игры (`@modovik/rpf-inspector/weapon-attachments`).
 * Здесь из моделей обвесов игры игрока собираются куски для хоста:
 *
 *  • ВШИТЬ (`embed`, кость без штатного обвеса: глушитель, прицел, фонарь,
 *    рукоять, камуфляж MK2): обвес ставится на кость ствола так же, как его
 *    ставит игра (`componentPlacement`: кость ствола × обратная кости
 *    крепления обвеса), и куски уходят хосту запросом версии 4
 *    (`decorate-drawable`, `attachments`) — каждый держится за свою кость:
 *    камуфляж затвора ездит с затвором. В руках (`_hi`) — `_hi` обвеса и
 *    листы до 1024², вдали (обычная `.ydr`) — обычная модель обвеса и 512²;
 *  • ЗАМЕНИТЬ (`replace`, кость со штатным: магазин, ствол MK2, штатный
 *    прицел снайперки): игра всегда вешает штатный, поэтому выбранный
 *    встаёт В ЕГО МОДЕЛЬ (`w_ar_carbineriflemk2_mag1.ydr` несёт геометрию
 *    `…_mag2`) — хост версии 3 с `replace`. Двойного не бывает.
 *
 * Цвет — тот, что был в кадре студии: покраска человека (PNG по имени
 * текстуры цвета), а без неё — заводской с оттенком палитры, запечённым в
 * цвет (шейдер куска — `default`, палитры не знает). Пределы — как у своей
 * модели (`ATTACHMENT_LIMITS`): разрезка по 4 368 вершин, треугольники и
 * листы на модель.
 */

const inflateRaw = (bytes) =>
  new Uint8Array(
    zlib.inflateRawSync(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
      finishFlush: zlib.constants.Z_SYNC_FLUSH,
    }),
  );

async function pngOf(picture) {
  const buffer = await sharp(Buffer.from(picture.rgba.buffer, picture.rgba.byteOffset, picture.rgba.byteLength), {
    raw: { width: picture.width, height: picture.height, channels: 4 },
  })
    .png({ compressionLevel: 3 })
    .toBuffer();
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

const opaqueOf = (material) => !material?.alphaMode || material.alphaMode === "opaque";

/*
 * Модель для `ownModelMeshes` из сеток обвесов: материал — на пару «кость,
 * материал игры», картинка — своя у каждой кости (листы не делятся между
 * костями: кусок держится за одну). `boneOf` — кость по номеру листа.
 */
async function piecesModel(groups, { painted }) {
  const meshes = [];
  const materials = [];
  const images = [];
  const boneOfMaterial = [];
  const keyOf = new Map();
  const used = new Set();
  let triangles = 0;
  let vertices = 0;
  for (const { bone, meshes: list, texture } of groups)
    for (const mesh of list) {
      if (!mesh.indices?.length || !mesh.positions?.length) continue;
      const material = mesh.material || null;
      const key = `${bone}|${material?.textures?.diffuse || ""}|${material?.alphaMode || ""}`;
      if (!keyOf.has(key)) {
        const diffuse = material?.textures?.diffuse || "";
        const paintName = colourTextureName(diffuse).toLowerCase();
        const own = painted.get(paintName) || null;
        let image = null;
        if (own) {
          used.add(paintName);
          images.push({ mimeType: "image/png", bytes: own });
          image = images.length - 1;
        } else {
          const picture = texture(material, "diffuse");
          if (picture?.rgba) {
            images.push({ mimeType: "image/png", bytes: await pngOf(picture) });
            image = images.length - 1;
          }
        }
        keyOf.set(key, materials.length);
        materials.push({
          name: diffuse || "attachment",
          colour: [1, 1, 1, 1],
          image,
          alpha: opaqueOf(material) ? "opaque" : "blend",
          cutoff: 0.5,
        });
        boneOfMaterial.push(bone);
      }
      meshes.push({
        positions: mesh.positions,
        normals: mesh.normals || null,
        uvs: mesh.uvs || null,
        indices: mesh.indices,
        material: keyOf.get(key),
      });
      triangles += mesh.indices.length / 3;
      vertices += mesh.positions.length / 3;
    }
  return {
    model: { meshes, materials, images, stats: { meshes: meshes.length, materials: materials.length, images: images.length, vertices, triangles } },
    boneOfMaterial,
    painted: [...used],
  };
}

/* Куски и листы хосту — через сборщик своей модели (те же пределы, DXT5). */
async function bodyOf({ model, boneOfMaterial, lod, staging, prefix }, tools) {
  if (!model.meshes.length) return null;
  let sheetBones = [];
  const meshes = async () => {
    const result = ownModelMeshes(model, null, { lod, limits: ATTACHMENT_LIMITS });
    sheetBones = result.sheets.map((sheet) => boneOfMaterial[sheet.materials?.[0]] ?? null);
    return { ...result, images: model.images };
  };
  return buildOwnModelBody(
    {
      own: { bytes: null, fit: null },
      lod,
      staging,
      prefix,
      extra: prefix === "astral_part_" ? (piece) => ({ bone: sheetBones[piece.sheet] || "gun_root" }) : null,
    },
    { meshes, ...(tools.encode ? { encode: tools.encode } : {}) },
  );
}

/* Байты файлов источника: `[{ name, role, bytes }]` из `{ name, role, output }`. */
async function filesOf(sources) {
  return Promise.all(
    sources.map(async (item) => ({ name: item.name, role: item.role, bytes: new Uint8Array(await fs.readFile(item.output)) })),
  );
}

/* Файлы обвеса кости из источников скина (`part:<кость>:<роль>`). */
function partFiles(files, bone, lod) {
  const prefix = `part:${bone}:`;
  return files
    .filter((file) => file.role.startsWith(prefix))
    .map((file) => ({ ...file, role: file.role.slice(prefix.length) }))
    /* Вдали — обычная модель обвеса: у `_hi` вершин в разы больше. */
    .filter((file) => lod !== "low" || file.role !== "model-hi");
}

/**
 * Вшиваемые обвесы для модели ствола `weaponFile` (`{ name, role, output }`,
 * роль `model` или `model-hi`): `{ attachments: { textures, pieces },
 * report }` или `null`, если вшивать нечего. `parts` — `[{ bone, component }]`
 * (режим `embed`), `sources` — найденные файлы скина, `painted` — покраска:
 * `Map<текстура цвета строчными, PNG>`.
 */
export async function embeddedAttachments({ weaponFile, parts, sources, painted, staging, lod }, tools = {}) {
  if (!parts.length) return null;
  const files = await filesOf(sources.filter((item) => item.role.startsWith("part:") || ["texture", "texture-hi"].includes(item.role)));
  const weaponBytes = new Uint8Array(await fs.readFile(weaponFile.output));
  const weaponFiles = [
    { name: weaponFile.name, role: "model", bytes: weaponBytes },
    ...files.filter((file) => file.role === "texture" || file.role === "texture-hi"),
  ];
  const built = gameWeaponModel(weaponFiles, {
    inflateRaw,
    maxTexture: lod === "low" ? ATTACHMENT_LIMITS.lowTexture : ATTACHMENT_LIMITS.hiTexture,
    parts: parts.map((part) => ({ bone: part.bone, component: part.component, files: partFiles(files, part.bone, lod) })),
  });
  const groups = parts.map((part) => ({
    bone: part.bone,
    meshes: built.drawable.meshes.filter((mesh) => mesh.part?.bone === part.bone),
    texture: built.texture,
  }));
  const { model, boneOfMaterial, painted: used } = await piecesModel(groups, { painted });
  const body = await bodyOf({ model, boneOfMaterial, lod, staging, prefix: "astral_part_" }, tools);
  return body
    ? {
        attachments: body.body,
        painted: used,
        report: { lod, ...body.report, parts: built.parts },
      }
    : { attachments: null, painted: [], report: { lod, parts: built.parts } };
}

/*
 * Картинка детали обвеса с оттенком палитры — как `gameWeaponModel`, но без
 * ствола: словари обвеса, затем ствола (палитра ствола MK2 лежит в нём).
 */
function tintedTexture(model) {
  return (material, role) => {
    const name = material?.textures?.[role];
    if (!name) return null;
    const paletteName = material?.textures?.palette;
    const picture = model.texture(name);
    if (role !== "diffuse" || !paletteName || !picture) return picture;
    const palette = model.texture(paletteName);
    return palette ? { name: picture.name, ...composeTintPalette(picture, palette) } : picture;
  };
}

/**
 * Выбранный обвес — в модель штатного той же кости (`replace`): `{ body,
 * report }` для хоста (`replace: true`) или `null`. `standardFile` — модель
 * штатного (`.ydr` или `_hi.ydr`), `part` — `{ bone, component }`.
 */
export async function replacementBody({ standardFile, part, sources, painted, staging, lod }, tools = {}) {
  const files = await filesOf(sources.filter((item) => item.role.startsWith(`part:${part.bone}:`) || ["texture", "texture-hi"].includes(item.role)));
  const own = partFiles(files, part.bone, lod);
  if (!own.some((file) => file.role === "model")) return null;
  const chosen = weaponModel(
    [...own, ...files.filter((file) => file.role === "texture").map((file) => ({ ...file, role: "texture" }))],
    { inflateRaw, maxTexture: lod === "low" ? ATTACHMENT_LIMITS.lowTexture : ATTACHMENT_LIMITS.hiTexture },
  );
  const standard = readDrawable(new Uint8Array(await fs.readFile(standardFile.output)), { inflateRaw }).drawables[0];
  /* Кость крепления штатного × обратная кости выбранного: выбранный встаёт
     туда же, где стоял штатный (у обоих кость — в начале осей, но бывает
     иначе). */
  const standardBone = findBone(standard, part.component.bone);
  const chosenBone = findBone(chosen.drawable, part.component.bone);
  const matrix = multiplyMatrices(
    standardBone?.matrix || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    chosenBone?.matrix ? invertRigid(chosenBone.matrix) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  );
  const meshes = placeOnBone(chosen.drawable.meshes, matrix);
  const { model, boneOfMaterial, painted: used } = await piecesModel([{ bone: part.bone, meshes, texture: tintedTexture(chosen) }], { painted });
  const body = await bodyOf({ model, boneOfMaterial, lod, staging, prefix: "astral_body_" }, tools);
  return body ? { body: body.body, painted: used, report: { lod, ...body.report } } : null;
}

/** Где обвес встанет в модели ствола — для проверки (`componentPlacement`). */
export { componentPlacement };

/** Имя файла в рабочей папке — без пути. */
export const fileName = (file) => path.basename(String(file || ""));
