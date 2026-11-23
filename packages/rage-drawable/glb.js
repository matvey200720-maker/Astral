const MAGIC = 0x46546c67;
const VERSION = 2;
const CHUNK = { json: 0x4e4f534a, bin: 0x004e4942 };
const TARGET = { vertex: 34962, index: 34963 };
const TRIANGLES = 4;

// Тип компоненты определяется классом массива, а не его содержимым.
const COMPONENT_OF_CLASS = new Map([
  ["Float32Array", 5126],
  ["Uint32Array", 5125],
]);
const COMPONENT_OTHER = 5123;

const ASSET = Object.freeze({ version: "2.0", generator: "Astral rage-drawable" });
const SAMPLER = Object.freeze({ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 });

const BLANK_TEXTURE = /^(?:none|givemechecker|checker|null)$/i;

// ---- байты ----

const zeros = (count, fill = 0) => new Uint8Array(count).fill(fill);

// Сколько байт не хватает до кратного четырём.
const shortOf4 = (size) => -size & 3;

const word32 = (...words) => {
  const out = new Uint8Array(words.length * 4);
  const view = new DataView(out.buffer);
  words.forEach((word, at) => view.setUint32(at * 4, word, true));
  return out;
};

const joinBytes = (parts) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

// Упаковщик двоичного куска: каждый вид лежит по смещению, кратному 4.
class Packer {
  constructor() {
    this.pieces = [];
    this.viewDefs = [];
    this.accessorDefs = [];
    this.end = 0;
  }

  place(array, target) {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    const gap = shortOf4(this.end);
    const byteOffset = this.end + gap;
    this.end = byteOffset + bytes.byteLength;
    this.pieces.push(zeros(gap), bytes);
    this.viewDefs.push({ buffer: 0, byteOffset, byteLength: bytes.byteLength, ...(target && { target }) });
    return this.viewDefs.length - 1;
  }

  accessor(array, type, arity, target, measure) {
    const bufferView = this.place(array, target);
    this.accessorDefs.push({
      bufferView,
      componentType: COMPONENT_OF_CLASS.get(array[Symbol.toStringTag]) ?? COMPONENT_OTHER,
      count: array.length / arity,
      type,
      ...measure?.(array),
    });
    return this.accessorDefs.length - 1;
  }

  get byteLength() {
    return this.end + shortOf4(this.end);
  }

  chunks() {
    return [...this.pieces, zeros(shortOf4(this.end))];
  }
}

// ---- границы позиций ----

function* everyThird(values, from) {
  for (let at = from; at < values.length; at += 3) yield values[at];
}

const fold = (items, pick, start) => {
  let best = start;
  for (const item of items) best = pick(best, item);
  return best;
};

// NaN в сравнения не попадает; пустой список оставляет бесконечности.
const boundsOf = (values) => {
  const axes = [0, 1, 2];
  return {
    min: axes.map((axis) => fold(everyThird(values, axis), (low, value) => (value < low ? value : low), Infinity)),
    max: axes.map((axis) => fold(everyThird(values, axis), (high, value) => (value > high ? value : high), -Infinity)),
  };
};

// ---- описания материалов и картинок ----

const isSlot = (value) => Number.isInteger(value);
const textureRef = (key, value) => (isSlot(value) ? { [key]: { index: value } } : {});

// Поле-число берётся только как конечное число, без приведения типов.
const finiteField = (source, key) => (Number.isFinite(source?.[key]) ? { [key]: source[key] } : {});
const strengthOf = (material) => finiteField(material, "emissiveStrength").emissiveStrength ?? 1;

const ALPHA_MODES = {
  mask: (material) => ({ alphaMode: "MASK", alphaCutoff: material.alphaCutoff ?? 0.5 }),
  blend: () => ({ alphaMode: "BLEND" }),
};

// Куски описания материала в порядке ключей итогового объекта.
const MATERIAL_PARTS = [
  (material, index) => ({ name: material.name || `material_${index}` }),
  (material) => ({
    pbrMetallicRoughness: {
      metallicFactor: 0,
      roughnessFactor: 0.85,
      ...(material.baseColorFactor && { baseColorFactor: material.baseColorFactor }),
      ...textureRef("baseColorTexture", material.baseColorTexture),
    },
  }),
  (material) => ({ doubleSided: material.doubleSided !== false }),
  (material) => textureRef("normalTexture", material.normalTexture),
  (material) => (Object.hasOwn(ALPHA_MODES, material.alphaMode) ? ALPHA_MODES[material.alphaMode](material) : {}),
  (material) =>
    material.emissive && isSlot(material.baseColorTexture)
      ? { ...textureRef("emissiveTexture", material.baseColorTexture), emissiveFactor: Array(3).fill(strengthOf(material)) }
      : {},
  (material) => (material.extras ? { extras: material.extras } : {}),
];

const materialEntry = (material, index) => Object.assign({}, ...MATERIAL_PARTS.map((part) => part(material, index)));

const imageEntry = (image, bufferView) => ({
  bufferView,
  mimeType: image.mimeType || "image/png",
  ...(image.extras && { extras: image.extras }),
});

// ---- сетки ----

const asClass = (Kind, values) => (values instanceof Kind ? values : Kind.from(values));

// Вершинные потоки в порядке записи; необязательные берутся, если поле сетки истинное.
const STREAMS = [
  { name: "POSITION", type: "VEC3", arity: 3, source: (mesh) => mesh.positions, always: true, measure: boundsOf },
  { name: "NORMAL", type: "VEC3", arity: 3, source: (mesh) => mesh.normals },
  { name: "TEXCOORD_0", type: "VEC2", arity: 2, source: (mesh) => mesh.uvs },
  { name: "COLOR_0", type: "VEC4", arity: 4, source: (mesh) => mesh.colours },
  {
    name: "JOINTS_0",
    type: "VEC4",
    arity: 4,
    source: (mesh, skeleton) => skeleton && mesh.skin && asClass(Uint16Array, mesh.skin.joints),
  },
  {
    name: "WEIGHTS_0",
    type: "VEC4",
    arity: 4,
    source: (mesh, skeleton) => skeleton && mesh.skin && asClass(Float32Array, mesh.skin.weights),
  },
];

function packMesh(packer, mesh, index, skeleton, materialCount) {
  const attributes = Object.fromEntries(
    STREAMS.flatMap(({ name, type, arity, source, always, measure }) => {
      const array = source(mesh, skeleton);
      return array || always ? [[name, packer.accessor(array, type, arity, TARGET.vertex, measure)]] : [];
    }),
  );
  const indices = packer.accessor(mesh.indices, "SCALAR", 1, TARGET.index);
  const known = isSlot(mesh.material) && mesh.material >= 0 && mesh.material < materialCount;
  return {
    label: mesh.name || `mesh_${index}`,
    skinned: "JOINTS_0" in attributes,
    primitive: { attributes, indices, mode: TRIANGLES, ...(known && { material: mesh.material }) },
  };
}

// ---- скелет ----

const parentOf = (parent, index, count) => (isSlot(parent) && parent >= 0 && parent < count && parent !== index ? parent : -1);

function packRig(packer, skeleton, first) {
  const count = skeleton.bones.length;
  const parents = skeleton.bones.map((bone, index) => parentOf(bone.parent, index, count));
  const childrenOf = parents.reduce(
    (table, parent, child) => (parent < 0 ? table : table.set(parent, [...(table.get(parent) ?? []), first + child])),
    new Map(),
  );
  const nodes = skeleton.bones.map((bone, index) => ({
    name: bone.name || `bone_${index}`,
    matrix: Array.from(bone.matrix),
    ...(childrenOf.has(index) && { children: childrenOf.get(index) }),
  }));
  const inverseBindMatrices = packer.accessor(Float32Array.from(skeleton.inverseBind), "MAT4", 16);
  const roots = parents.flatMap((parent, index) => (parent < 0 ? [first + index] : []));
  const skin = {
    name: "skeleton",
    joints: nodes.map((_, index) => first + index),
    inverseBindMatrices,
    ...(roots.length && { skeleton: roots[0] }),
  };
  return { nodes, roots, skin };
}

export function writeGlb({ meshes = [], materials = [], images = [], name = "model", skeleton = null } = {}) {
  const packer = new Packer();
  const imageDefs = images.map((image) => imageEntry(image, packer.place(image.bytes)));
  const materialDefs = materials.map(materialEntry);
  const packed = meshes.map((mesh, index) => packMesh(packer, mesh, index, skeleton, materialDefs.length));

  const rigged = Boolean(skeleton?.bones?.length);
  const meshNodes = packed.map(({ label, skinned }, index) => ({
    name: label,
    mesh: index,
    ...(rigged && skinned && { skin: 0 }),
  }));
  const rig = rigged ? packRig(packer, skeleton, meshNodes.length) : null;

  const document = {
    asset: ASSET,
    scene: 0,
    scenes: [{ name, nodes: [...meshNodes.keys(), ...(rig ? rig.roots : [])] }],
    nodes: [...meshNodes, ...(rig ? rig.nodes : [])],
    ...(rig && { skins: [rig.skin] }),
    meshes: packed.map(({ label, primitive }) => ({ name: label, primitives: [primitive] })),
    accessors: packer.accessorDefs,
    bufferViews: packer.viewDefs,
    buffers: [{ byteLength: packer.byteLength }],
    ...(materialDefs.length && { materials: materialDefs }),
    ...(imageDefs.length && {
      images: imageDefs,
      textures: imageDefs.map((_, source) => ({ sampler: 0, source })),
      samplers: [SAMPLER],
    }),
  };

  // Заголовок, кусок JSON (добивается пробелами), двоичный кусок (добивается нулями).
  const text = new TextEncoder().encode(JSON.stringify(document));
  const textPadding = shortOf4(text.length);
  const total = 12 + 8 + text.length + textPadding + 8 + packer.byteLength;
  return joinBytes([
    word32(MAGIC, VERSION, total),
    word32(text.length + textPadding, CHUNK.json),
    text,
    zeros(textPadding, 0x20),
    word32(packer.byteLength, CHUNK.bin),
    ...packer.chunks(),
  ]);
}

// ---- ключ содержимого ----

const keyCache = new WeakMap();

// Короткий ключ: длина и два 32-битных хэша в системе по основанию 36.
export function imageContentKey(bytes) {
  const known = keyCache.get(bytes);
  if (known !== undefined) return known;
  const length = bytes.length;
  let first = 0x811c9dc5;
  let second = 0x01000193 ^ length;
  let at = 0;
  while (at < length) {
    const value = bytes[at];
    first = Math.imul(first ^ value, 0x01000193);
    second = (Math.imul(second ^ value, 0x85ebca6b) + at) | 0;
    at += 1;
  }
  const key = [length, first >>> 0, second >>> 0].map((part) => part.toString(36)).join("-");
  keyCache.set(bytes, key);
  return key;
}

// ---- модель целиком ----

// Накопитель материалов и картинок: общие картинки по ключу «роль:имя», материалы по тождеству значения.
class Wardrobe {
  constructor({ textureFor, encodePng, materialName, imageKeys }) {
    Object.assign(this, { textureFor, encodePng, materialName, imageKeys });
    this.images = [];
    this.materials = [];
    this.imageSlots = new Map();
    this.materialSlots = { plain: new Map(), shell: new Map() };
  }

  async imageFor(material, role) {
    const textureName = material?.textures?.[role];
    if (textureName && BLANK_TEXTURE.test(textureName)) return undefined;
    const key = textureName ? `${role}:${textureName}` : null;
    if (this.imageSlots.has(key)) return this.imageSlots.get(key);

    const picture = await this.textureFor?.(material, role);
    if (!picture || !this.encodePng) return undefined;
    const bytes = await this.encodePng(picture.rgba, picture.width, picture.height);
    this.images.push({
      bytes,
      mimeType: "image/png",
      ...(this.imageKeys && { extras: { astralKey: imageContentKey(bytes) } }),
    });
    if (key !== null) this.imageSlots.set(key, this.images.length - 1);
    return this.images.length - 1;
  }

  async dress(material, shell) {
    const label = this.materialName ? this.materialName(material) : null;
    const baseColorTexture = await this.imageFor(material, "diffuse");
    const normalTexture = await this.imageFor(material, "normal");
    return {
      ...(shell && { doubleSided: false }),
      name: label || material?.shader || "material",
      ...(baseColorTexture !== undefined && { baseColorTexture }),
      ...(normalTexture !== undefined && { normalTexture }),
      alphaMode: material?.alphaMode || "opaque",
      emissive: Boolean(material?.emissive),
      ...finiteField(material, "emissiveStrength"),
      ...(material?.colour && { baseColorFactor: material.colour }),
      ...(material?.extras && { extras: material.extras }),
    };
  }

  async slotOf(mesh) {
    const material = mesh.material;
    const shell = Boolean(mesh.invertedHull);
    const slots = shell ? this.materialSlots.shell : this.materialSlots.plain;
    if (!slots.has(material)) {
      slots.set(material, this.materials.length);
      this.materials.push(await this.dress(material, shell));
    }
    return slots.get(material);
  }
}

export async function drawableToGlb(
  drawable,
  { textureFor, encodePng, name, vertexColours = true, materialName = null, skeleton = null, imageKeys = false } = {},
) {
  const wardrobe = new Wardrobe({ textureFor, encodePng, materialName, imageKeys });
  const meshes = [];
  for (const mesh of drawable.meshes) {
    const material = await wardrobe.slotOf(mesh);
    meshes.push({ ...mesh, ...(!vertexColours && { colours: null }), material });
  }
  return writeGlb({
    meshes,
    materials: wardrobe.materials,
    images: wardrobe.images,
    name: name || drawable.name || "model",
    skeleton,
  });
}
