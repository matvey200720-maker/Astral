/*
 * Сцена кадра из собранного зала (шаг Б2, 24.10.2026): детали зала «игра + файлы мода поверх»
 * (`arena-hall-model.js`) → одна сцена ARS1 и листы для окна-съёмщика.
 *
 * Провайдер зала отдаёт манифест (какие детали и где стоят — по `.ytyp` мода) и GLB каждой детали с её
 * листами. Кадр каталога рисует сцены ARS1 (`snapshotScene`: свет, лампы, камера изнутри, облик
 * материалов), поэтому зал переводится в тот же формат: сетки каждой детали ставятся на её размещения
 * (оси игры, Z вверх — как у штатных сцен арен, поэтому камеры и лампы штатной сцены подходят и этой),
 * листы GLB (PNG) уходят в окно WebP, как листы мода.
 *
 * GLB читается здесь же, без three: у конвертера он простой — узлы с сетками, один набор вершин на
 * примитив, PNG-листы, прозрачность и двусторонность в материале.
 */

import sharp from "sharp";
import { inflateRawNode } from "@modovik/rpf7/node";
import { decodeTextureRef, readDrawable } from "@modovik/rage-drawable";
import { encodeShopScene } from "./recolor-shops-scene.js";

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const COMPONENTS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/* Сторона листа в окне: зал держит сотни листов, а кадр — несколько тысяч пикселей. */
const SHEET_SIDE = 1024;

/** Y-вверх GLB → Z-вверх игры. */
const toGame = (x, y, z) => [x, -z, y];

/** Разбор контейнера GLB: заголовок JSON и двоичный кусок. Бросает на чужом или обрезанном файле. */
export function readGlb(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (bytes.length < 20 || bytes.toString("latin1", 0, 4) !== "glTF") throw new Error("Файл детали — не GLB.");
  let json = null;
  let bin = null;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const length = bytes.readUInt32LE(at);
    const type = bytes.readUInt32LE(at + 4);
    if (at + 8 + length > bytes.length) throw new Error("GLB обрезан.");
    const chunk = bytes.subarray(at + 8, at + 8 + length);
    if (type === JSON_CHUNK) json = JSON.parse(chunk.toString("utf8"));
    else if (type === BIN_CHUNK && !bin) bin = chunk;
    at += 8 + length + ((4 - (length % 4)) % 4);
  }
  if (!json) throw new Error("В GLB нет описания.");
  return { json, bin: bin || Buffer.alloc(0) };
}

/* Данные доступа (accessor) → типизированный массив значений (с учётом шага вершин). */
function readAccessor({ json, bin }, index) {
  const accessor = json.accessors?.[index];
  if (!accessor) throw new Error("В GLB нет доступа к данным.");
  const Kind = COMPONENTS[accessor.componentType];
  const width = WIDTH[accessor.type];
  if (!Kind || !width) throw new Error("В GLB неизвестный тип данных.");
  const view = json.bufferViews?.[accessor.bufferView];
  if (!view) return new Kind(accessor.count * width);
  const base = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const size = Kind.BYTES_PER_ELEMENT;
  const stride = view.byteStride && view.byteStride !== size * width ? view.byteStride : size * width;
  if (base + (accessor.count - 1) * stride + size * width > bin.length) throw new Error("GLB обрезан.");
  const out = new Kind(accessor.count * width);
  const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const get = {
    5120: (at) => data.getInt8(at),
    5121: (at) => data.getUint8(at),
    5122: (at) => data.getInt16(at, true),
    5123: (at) => data.getUint16(at, true),
    5125: (at) => data.getUint32(at, true),
    5126: (at) => data.getFloat32(at, true),
  }[accessor.componentType];
  for (let item = 0; item < accessor.count; item += 1)
    for (let part = 0; part < width; part += 1) out[item * width + part] = get(base + item * stride + part * size);
  return out;
}

/*
 * Шейдеры игры, что рисуют не цвет: карту нормалей (`decal_normal_only`), блеск (`decal_spec_only`) и грязь или затенение по яркости листа (`decal_dirt`:
 * лист без альфы — сплошной прямоугольник). Цветом окна они — чёрные плиты и фиолетово-зелёные точки на полу (кресла Tiffany, 27.10.2026), поэтому
 * в сцену не идут.
 */
const NOT_COLOUR_SHADER = /^decal_(?:normal_only|spec_only|dirt)$/;

/*
 * Стекло: шейдера `glass_env` у конвертера в таблице нет — материал зовётся `<unknown:…>|лист`, и GLB не помечает его прозрачным. В кадре стеклянный цилиндр витрины
 * Majestic (`mj_ma_int3_rm4_glass_vitrine`) выходил сплошным и прятал статую внутри (12.11.2026, ALLIANCE V3; альфа листа `prop_green_glass` — 0,32). Прозрачным
 * считается материал без отметки в GLB, у которого шейдер назван `glass…` или не назван, а в имени листа есть «glass».
 */
const glassOf = (name) => {
  const [shader, ...rest] = String(name || "").toLowerCase().split("|");
  return /^glass/.test(shader) || (/^<unknown:\d+>$/.test(shader) && /glass/.test(rest.join("|")));
};
const alphaOf = (material) =>
  material.alphaMode === "BLEND" ? "blend" : material.alphaMode === "MASK" ? "cutout" : !material.alphaMode && glassOf(material.name) ? "blend" : "opaque";

/* Матрицы 4×4 по столбцам (как в glTF). */
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function multiply(left, right) {
  const out = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1)
    for (let row = 0; row < 4; row += 1)
      for (let k = 0; k < 4; k += 1) out[column * 4 + row] += left[k * 4 + row] * right[column * 4 + k];
  return out;
}
function composeNode(node) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return node.matrix;
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

/**
 * Сетки детали в осях игры (Z вверх), узлы уже применены.
 * `[{ positions, normals, uvs, indices, material: { image, alpha, doubleSided, colour, shader } }]`;
 * `images` — PNG-листы по номеру изображения GLB.
 */
export function glbMeshes(buffer) {
  const glb = readGlb(buffer);
  const { json, bin } = glb;
  const meshes = [];
  /* Сколько примитивов отброшено как «не цвет» (карта нормалей, блеск, грязь): модель только из них — не пропажа, а то, что кадр не рисует. */
  let skipped = 0;
  const walk = (index, parent) => {
    const node = json.nodes?.[index];
    if (!node) return;
    const world = multiply(parent, composeNode(node));
    for (const child of node.children || []) walk(child, world);
    if (!Number.isInteger(node.mesh)) return;
    for (const primitive of json.meshes?.[node.mesh]?.primitives || []) {
      if ((primitive.mode ?? 4) !== 4 || !Number.isInteger(primitive.attributes?.POSITION) || !Number.isInteger(primitive.indices)) continue;
      if (NOT_COLOUR_SHADER.test(String(json.materials?.[primitive.material]?.name || "").split("|")[0].toLowerCase())) {
        skipped += 1;
        continue;
      }
      const source = readAccessor(glb, primitive.attributes.POSITION);
      const sourceNormals = Number.isInteger(primitive.attributes.NORMAL) ? readAccessor(glb, primitive.attributes.NORMAL) : null;
      const uvs = Number.isInteger(primitive.attributes.TEXCOORD_0) ? readAccessor(glb, primitive.attributes.TEXCOORD_0) : null;
      const count = source.length / 3;
      const positions = new Float32Array(count * 3);
      const normals = new Float32Array(count * 3);
      for (let at = 0; at < count; at += 1) {
        const x = source[at * 3];
        const y = source[at * 3 + 1];
        const z = source[at * 3 + 2];
        positions.set(
          toGame(
            world[0] * x + world[4] * y + world[8] * z + world[12],
            world[1] * x + world[5] * y + world[9] * z + world[13],
            world[2] * x + world[6] * y + world[10] * z + world[14],
          ),
          at * 3,
        );
        if (sourceNormals) {
          const nx = sourceNormals[at * 3];
          const ny = sourceNormals[at * 3 + 1];
          const nz = sourceNormals[at * 3 + 2];
          const turned = [
            world[0] * nx + world[4] * ny + world[8] * nz,
            world[1] * nx + world[5] * ny + world[9] * nz,
            world[2] * nx + world[6] * ny + world[10] * nz,
          ];
          const length = Math.hypot(...turned) || 1;
          normals.set(toGame(turned[0] / length, turned[1] / length, turned[2] / length), at * 3);
        }
      }
      const material = json.materials?.[primitive.material] || {};
      const texture = material.pbrMetallicRoughness?.baseColorTexture?.index;
      const image = Number.isInteger(texture) ? json.textures?.[texture]?.source : null;
      const factor = material.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1, 1];
      const hex = (value) => Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, "0");
      meshes.push({
        positions,
        normals,
        uvs,
        indices: readAccessor(glb, primitive.indices),
        material: {
          image: Number.isInteger(image) ? image : null,
          /* Имя листа в игре: материал у конвертера зовётся «шейдер|лист». */
          texture: String(material.name || "").includes("|") ? String(material.name).split("|").slice(1).join("|").toLowerCase() : null,
          alpha: alphaOf(material),
          doubleSided: Boolean(material.doubleSided),
          /* Без цвета в материале конвертер оставляет белый — «ничего не известно»; белым трава с шейдером, которого
             нет в таблице, выжигала кадр, а серый — цвет штатных сцен для такого материала. */
          colour: factor[0] >= 0.999 && factor[1] >= 0.999 && factor[2] >= 0.999 ? "#8a8a8a" : `#${hex(factor[0])}${hex(factor[1])}${hex(factor[2])}`,
          /* Имя материала у конвертера — «шейдер|лист»: свечение узнаётся по шейдеру. */
          emissive: /^[^|]*emissive/i.test(String(material.name || "")),
        },
      });
    }
  };
  const roots = json.scenes?.[json.scene ?? 0]?.nodes || (json.nodes || []).map((_, index) => index);
  for (const root of roots) walk(root, IDENTITY);
  const images = (json.images || []).map((image) => {
    const view = json.bufferViews?.[image.bufferView];
    return view ? bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength) : null;
  });
  return { meshes, images, skipped };
}

/* Масштаб, поворот кватернионом (оси игры) и сдвиг размещения; `origin` — начало сцены. Масштаб — у карт (`scale: { xy, z }`). */
function placeMesh(mesh, { position, rotation, scale }, origin) {
  const [sx, sy, sz] = scale ? [scale.xy, scale.xy, scale.z] : [1, 1, 1];
  const { x: qx, y: qy, z: qz, w: qw } = rotation;
  const turn = ([x, y, z]) => {
    const tx = 2 * (qy * z - qz * y);
    const ty = 2 * (qz * x - qx * z);
    const tz = 2 * (qx * y - qy * x);
    return [x + qw * tx + (qy * tz - qz * ty), y + qw * ty + (qz * tx - qx * tz), z + qw * tz + (qx * ty - qy * tx)];
  };
  const count = mesh.positions.length / 3;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  for (let at = 0; at < count; at += 1) {
    const moved = turn([mesh.positions[at * 3] * sx, mesh.positions[at * 3 + 1] * sy, mesh.positions[at * 3 + 2] * sz]);
    positions.set([moved[0] + position.x - origin[0], moved[1] + position.y - origin[1], moved[2] + position.z - origin[2]], at * 3);
    normals.set(turn([mesh.normals[at * 3], mesh.normals[at * 3 + 1], mesh.normals[at * 3 + 2]]), at * 3);
  }
  return { ...mesh, positions, normals };
}

/**
 * Встроенные листы модели (`.ydr`) для `hallScene`: `async (имя листа) → WebP | null`.
 *
 * Лист, зашитый в саму модель, главнее одноимённого листа словаря — так ищет игра (сначала словарь самой модели, потом
 * словарь архетипа), а конвертер зала берёт словарь первым: у мода 314 оболочка несёт настоящие листы стен, дверей и
 * кирпича, а в его словаре под теми же именами лежат белые заглушки 8×8 и 52×52 — зал выходил белым и без деталей.
 * Разбирается один раз на файл и только когда спросили; не разобралось — листов нет, остаётся лист конвертера.
 */
export function embeddedSheets(readBytes) {
  let known = null;
  const refs = () => {
    known ||= (async () => {
      try {
        const bytes = await readBytes();
        const drawable = readDrawable(new Uint8Array(bytes), { inflateRaw: inflateRawNode }).drawables[0];
        return new Map((drawable?.embeddedTextures || []).map((ref) => [String(ref.name).toLowerCase(), ref]));
      } catch {
        return new Map();
      }
    })();
    return known;
  };
  return async (name) => {
    const ref = (await refs()).get(String(name || "").toLowerCase());
    if (!ref) return null;
    try {
      const level = decodeTextureRef(ref, { level: 0 });
      return await sheetOf(Buffer.from(level.rgba.buffer, level.rgba.byteOffset, level.rgba.byteLength), {
        raw: { width: level.width, height: level.height, channels: 4 },
      });
    } catch {
      return null;
    }
  };
}

/**
 * Экраны зала Majestic — листы-раскладки кадров (`uv`, `uv1`…`uv7` в `txd_uv.ytd`: сетка 16×16 или 8×16 кадров ролика), а игра листает клип развёртки (`clip@<модель>.ycd`:
 * на каждый кадр свои масштаб и сдвиг UV). Целиком лист на экране — мозаика из мелких кадров, а не картинка, и кадр обложки её не листает. Берётся первый кадр клипа.
 * @param {number[]|null} frame строки матрицы развёртки `[x, y, z, x', y', z']` (u' = x·u + y·v + z; v' = x'·u + y'·v + z') — кадр клипа
 * @returns {{ left: number, top: number, width: number, height: number }|null} клетка листа в долях (0…1); матрица с поворотом или вне листа — `null`
 */
export function atlasCell(frame) {
  if (!Array.isArray(frame) || frame.length < 6 || !frame.every(Number.isFinite)) return null;
  const [x, y, z, x2, y2, z2] = frame;
  if (Math.abs(y) > 1e-6 || Math.abs(x2) > 1e-6 || !(x > 0 && y2 > 0) || x > 1 || y2 > 1) return null;
  if (z < -1e-6 || z2 < -1e-6 || z + x > 1 + 1e-6 || z2 + y2 > 1 + 1e-6) return null;
  return { left: Math.max(0, z), top: Math.max(0, z2), width: x, height: y2 };
}

/*
 * Оттенок листов в сцене и свет кадра. У залов GTA 5 RP цвет листа — тёплый серый, а свет кадра тёплый (`arena-hall-light.js: hallDaylight`: подобран по кадрам игры).
 * У Majestic автор берёт чёрные и серые материалы и нейтральный таймцикл («Gray timecycle» в его редуксе), и тёплый свет красил их коричневым (13.11.2026, ALLIANCE V3;
 * замер по кадрам 12.11: тёмный пол, чьи листы нейтральны, выходил 26 : 21 : 12 по каналам). Для Majestic (`neutral`) лист нейтральный той же яркости, а сцена несёт
 * отметку `neutralLight`: окно светит ей белым и серым (`scene-snapshot.js: daylightFor`). Зал GTA 5 RP — прежний.
 */
const WARM_TINT = "#9a958c";
const NEUTRAL_TINT = "#959595";

/* Лист-раскладка кадров в сцене зала: `uv`, `uv1`… */
const ATLAS_SHEET = /^uv\d*$/;

/* PNG детали → WebP для окна: уменьшен до стороны листа; `cell` (`atlasCell`) — берётся только эта клетка листа. */
async function sheetOf(png, options, cell = null) {
  const bytes = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  let image = sharp(bytes, options);
  if (cell) {
    const { width, height } = await sharp(bytes, options).metadata();
    const left = Math.min(width - 1, Math.round(cell.left * width));
    const top = Math.min(height - 1, Math.round(cell.top * height));
    image = image.extract({
      left,
      top,
      width: Math.max(1, Math.min(width - left, Math.round(cell.width * width))),
      height: Math.max(1, Math.min(height - top, Math.round(cell.height * height))),
    });
  }
  return new Uint8Array(await image.resize({ width: SHEET_SIDE, height: SHEET_SIDE, fit: "inside", withoutEnlargement: true }).webp({ quality: 88 }).toBuffer());
}

/**
 * Сцена зала: `{ bytes, sheets: [{ key, bytes }], stats }` или `null`, если ставить нечего.
 *
 * `manifest` — манифест провайдера зала (детали, размещения в осях игры), `readPiece(index)` — GLB детали
 * (`Buffer` или `null`: пустышка, отказ — деталь пропускается и считается в `stats.missing`), `lamps` —
 * лампы штатной сцены того же интерьера (они в тех же осях, свет зала — свет игры), `origin` — начало сцены в
 * мире игры (у штатной сцены «снаружи» — её `origin`), `partOf(stem)` — часть кадра, в которую идёт деталь
 * (по частям кадр берёт рамку: фасад без площади), `embeddedOf(piece)` — встроенные листы модели
 * (`embeddedSheets`): они главнее листов словаря с теми же именами. `surround` — окружение арены из штатной сцены «снаружи»
 * (`arena-stock-surround.js`: `{ materials, textures, meshes }` в метрах сцены, начало общее): отдельной частью после деталей зала.
 * `modSheets` — имена листов в файлах самого мода (строчные, `Set`): у материалов с таким листом в сцене остаётся игровое имя листа
 * (`sheet`) и пометка `mine` — редактор арены мода (`arena-mod.js`) красит именно их; в ответе `named` — лист → ключ картинки для
 * превью. `uvFirstFrame(stem)` — первый кадр клипа развёртки модели (`[x, y, z, x', y', z']`, `arena-hall-cover.js`): у экрана-раскладки берётся его клетка листа (`atlasCell`).
 * `keepSolids` — вернуть ещё и сетки деталей в мире (`solids`: `{ stem, positions, indices, doubleSided, blend }`): по ним главный процесс
 * выбирает ракурсы на звезду автора (`arena-view-plan.js`); в сцену и в ответ окну они не идут.
 */
export async function hallScene({ manifest, readPiece, lamps = null, origin = [0, 0, 0], partOf = () => "hall", embeddedOf = null, surround = null, modSheets = null, keepSolids = false, uvFirstFrame = null, neutral = false }) {
  const byPiece = new Map();
  for (const place of manifest?.placements || []) {
    if (!byPiece.has(place.piece)) byPiece.set(place.piece, []);
    byPiece.get(place.piece).push(place);
  }
  const materials = [];
  const materialIndex = new Map();
  const textures = [];
  const textureIndex = new Map();
  const sheets = [];
  const meshes = [];
  const partIds = [];
  const solids = [];
  const named = new Map();
  /* `own*` — то же у деталей автора (его файл или его словарь у модели игры): пропажа в моде, а не в игре. */
  const stats = { pieces: 0, missing: 0, meshes: 0, decalOnly: 0, untextured: 0, untexturedNames: [], ownMissing: [], ownUntextured: [] };
  /* Лист, который материал просит по имени, а картинки у него нет (словарь не пришёл, лист не прочитан): поверхность в кадре серая — «пропавшая текстура». */
  const untextured = new Set();
  const ownUntextured = new Set();

  for (const piece of manifest?.pieces || []) {
    const places = byPiece.get(piece.index) || [];
    if (!places.length || piece.stub) continue;
    let model = null;
    try {
      const glb = await readPiece(piece.index);
      model = glb ? glbMeshes(glb) : null;
    } catch {
      model = null;
    }
    /* Деталь целиком из «не цвета» (тени-пятна, грязь по стенам): кадр её не рисует по замыслу, это не пропажа. */
    if (model && !model.meshes.length && model.skipped) {
      stats.decalOnly += 1;
      continue;
    }
    if (!model?.meshes.length) {
      stats.missing += 1;
      if (piece.overlay || piece.retextured) stats.ownMissing.push(String(piece.stem).toLowerCase());
      continue;
    }
    stats.pieces += 1;
    /* Лист детали: запись заголовка и WebP для окна — один раз на деталь, сколько бы ни стояло копий. */
    const resource = String(piece.stem).toLowerCase();
    const embedded = embeddedOf?.(piece) || null;
    const clip = uvFirstFrame ? atlasCell(uvFirstFrame(resource)) : null;
    const textureOf = async (image, name = null) => {
      /* Экран-раскладка с клипом: лист — клетка первого кадра, со своим ключом (клетки у разных моделей разные). */
      const cell = clip && ATLAS_SHEET.test(String(name)) && image !== null && model.images[image] ? clip : null;
      /* Встроенный лист модели — свой лист и свой ключ: у разных имён один образ GLB (заглушка) не общий. */
      const own = !cell && embedded && name ? await embedded(name) : null;
      if (own) {
        const label = `e_${String(name).replace(/[^a-z0-9_.-]/g, "_")}`;
        const key = `${resource}|${label}`;
        if (!textureIndex.has(key)) {
          textureIndex.set(key, textures.length);
          textures.push({ name: `h:${resource}:${label}`, set: "hall", resource, texture: label });
          sheets.push({ key: `set:hall/${resource}/${label}`, bytes: own });
        }
        return textureIndex.get(key);
      }
      if (image === null || !model.images[image]) return null;
      const key = `${resource}|${image}${cell ? "|first" : ""}`;
      const label = cell ? `t${image}f` : `t${image}`;
      if (!textureIndex.has(key)) {
        let bytes = null;
        try {
          bytes = await sheetOf(model.images[image], undefined, cell);
        } catch {
          bytes = null;
        }
        if (!bytes) {
          textureIndex.set(key, null);
        } else {
          textureIndex.set(key, textures.length);
          textures.push({ name: `h:${resource}:${label}`, set: "hall", resource, texture: label });
          sheets.push({ key: `set:hall/${resource}/${label}`, bytes });
        }
      }
      return textureIndex.get(key);
    };
    const local = [];
    for (const mesh of model.meshes) {
      const texture = await textureOf(mesh.material.image, mesh.material.texture);
      /* `flat` — заглушка шейдера (сплошной цвет без листа), а не словарная картинка: пропажей она не считается. */
      if (texture === null && mesh.material.texture && mesh.material.texture !== "flat") {
        untextured.add(`${resource}|${mesh.material.texture}`);
        if (piece.overlay || piece.retextured) ownUntextured.add(`${resource}|${mesh.material.texture}`);
      }
      /* Лист самого мода: его имя в игре и пометка остаются у материала (отдельные материалы у разных листов). */
      const sheet = modSheets && mesh.material.texture && modSheets.has(mesh.material.texture) ? mesh.material.texture : null;
      const spec = `${sheet ? `s:${sheet}|` : ""}${texture ?? "none"}|${mesh.material.alpha}|${mesh.material.doubleSided ? 1 : 0}|${mesh.material.emissive ? 1 : 0}|${texture === null ? mesh.material.colour : ""}`;
      const key = `${resource}|${spec}`;
      if (!materialIndex.has(key)) {
        materialIndex.set(key, materials.length);
        materials.push({
          id: key,
          group: "hall",
          name: resource,
          alpha: mesh.material.alpha,
          doubleSided: mesh.material.doubleSided || mesh.material.alpha !== "opaque",
          colour: texture === null ? mesh.material.colour : neutral ? NEUTRAL_TINT : WARM_TINT,
          texture,
          ...(sheet ? { sheet, mine: true } : {}),
          ...(mesh.material.emissive ? { emissive: true, glow: 3 } : {}),
        });
        if (sheet && texture !== null) {
          const entry = textures[texture];
          const known = named.get(sheet) || { name: sheet, key: `set:${entry.set}/${entry.resource}/${entry.texture}`, uses: 0 };
          known.uses += 1;
          named.set(sheet, known);
        }
      }
      local.push({ ...mesh, material: materialIndex.get(key) });
    }
    const id = partOf(piece.stem);
    if (!partIds.includes(id)) partIds.push(id);
    for (const place of places)
      for (const mesh of local) {
        const placed = placeMesh(mesh, place, origin);
        meshes.push({ ...placed, part: partIds.indexOf(id) });
        stats.meshes += 1;
        const { alpha, doubleSided } = materials[mesh.material];
        if (keepSolids) solids.push({ stem: resource, positions: placed.positions, indices: placed.indices, doubleSided, blend: alpha === "blend" });
      }
  }
  if (!meshes.length) return null;
  stats.untextured = untextured.size;
  stats.untexturedNames = [...untextured].sort();
  stats.ownUntextured = [...ownUntextured].sort();

  /* Окружение (дороги, земля, кварталы): своя часть, листы — записи игры, их картинки приезжают вместе с запросом окну. */
  if (surround?.meshes?.length) {
    const own = (texture) => {
      if (!Number.isInteger(texture)) return null;
      const entry = surround.textures[texture];
      const known = textures.findIndex((item) => item.name === entry.name);
      if (known >= 0) return known;
      textures.push({ ...entry });
      return textures.length - 1;
    };
    const base = materials.length;
    for (const material of surround.materials)
      materials.push({
        ...material,
        group: material.group || "surround",
        texture: own(material.texture),
        ...(material.terrain ? { terrain: { ...material.terrain, layers: (material.terrain.layers || []).map(own), mask: own(material.terrain.mask) } } : {}),
      });
    partIds.push("surround");
    for (const mesh of surround.meshes) meshes.push({ ...mesh, material: mesh.material + base, part: partIds.length - 1 });
  }

  const boxes = partIds.map(() => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }));
  for (const mesh of meshes) {
    const box = boxes[mesh.part];
    for (let at = 0; at < mesh.positions.length; at += 1) {
      const axis = at % 3;
      if (mesh.positions[at] < box.min[axis]) box.min[axis] = mesh.positions[at];
      if (mesh.positions[at] > box.max[axis]) box.max[axis] = mesh.positions[at];
    }
  }
  const min = [0, 1, 2].map((axis) => Math.min(...boxes.map((box) => box.min[axis])));
  const max = [0, 1, 2].map((axis) => Math.max(...boxes.map((box) => box.max[axis])));
  const bytes = new Uint8Array(
    encodeShopScene({
      bounds: { min, max },
      parts: partIds.map((id, at) => ({ id, bounds: boxes[at] })),
      materials,
      textures,
      meshes,
      ...(Array.isArray(lamps) && lamps.length ? { lamps } : {}),
      ...(neutral ? { neutralLight: true } : {}),
    }),
  );
  return { bytes, sheets, stats, named: [...named.values()], ...(keepSolids ? { solids } : {}) };
}
