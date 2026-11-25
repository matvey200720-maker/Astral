import { isBlackSheet } from "@modovik/gunpack/crude-model";
import { inflateSync } from "fflate";
import { environmentName } from "@modovik/gunpack/shader-colour";
import { weaponModel } from "@modovik/gunpack/model";
import { seeThroughOf } from "./see-through.js";

const SLOT_ROLES = "diffuse normal specular emissive".split(" ");

const keep = (value) => value;
const orNull = (value) => value || null;

// Поля в порядке выдачи и способ приведения каждого.
const MESH_FIELDS = [
  ["positions", keep],
  ["normals", orNull],
  ["uvs", orNull],
  ["colours", orNull],
  ["indices", keep],
  ["invertedHull", Boolean],
];
const MATERIAL_FIELDS = [
  ["alphaMode", (value) => value || "opaque"],
  ["emissive", Boolean],
  ["shader", (value) => value || ""],
];

const convertFields = (table, source) =>
  Object.fromEntries(table.map(([key, convert]) => [key, convert(source?.[key])]));

const hasGeometry = (mesh) => mesh.positions?.length >= 9 && Boolean(mesh.indices?.length);

// Реестр листов: ключ в нижнем регистре, повторная запись место в порядке не меняет.
class SheetShelf {
  #read;
  #sheets = new Map();

  constructor(texture) {
    this.#read = (name) => texture(name);
  }

  // Лист без записи в реестр.
  peek(name) {
    return this.#read(name);
  }

  lookup(name) {
    const sheet = this.#read(name);
    return sheet ? this.#shelve(String(name).toLowerCase(), sheet) : null;
  }

  get images() {
    return Array.from(this.#sheets, ([key, sheet]) => Object.assign({ key }, sheet));
  }

  #shelve(key, sheet) {
    this.#sheets.set(key, sheet);
    return key;
  }
}

// Отражение берётся из шейдера, только если лист цвета целиком чёрный.
function reflectionOf(shelf, material) {
  const diffuse = shelf.peek(material?.textures?.diffuse);
  if (!isBlackSheet(diffuse)) return "";
  return environmentName(material);
}

function describeMesh(mesh, shelf) {
  const { material } = mesh;
  const textures = Object.fromEntries(
    SLOT_ROLES.map((role) => [role, shelf.lookup(material?.textures?.[role])]),
  );
  const reflection = reflectionOf(shelf, material);
  textures.environment = shelf.lookup(reflection);

  return {
    ...convertFields(MESH_FIELDS, mesh),
    material: {
      ...convertFields(MATERIAL_FIELDS, material),
      textures,
      /* Имя листа цвета из материала — для причины отказа «часть ствола без текстуры» (white-gate.js): какой лист не нашёлся в словарях пака. */
      diffuseName: material?.textures?.diffuse ?? null,
      environmentLost: Boolean(reflection) && !textures.environment,
      reflectivePower: material?.reflectivePower ?? null,
    },
  };
}

// Листы частей «blend» помечаются здесь, в потоке разбора: сцена на главном потоке пиксели не перебирает.
function markSeeThrough(meshes, images) {
  const blended = new Set(meshes.filter((mesh) => mesh.material.alphaMode === "blend").map((mesh) => mesh.material.textures.diffuse));
  images.filter((image) => blended.has(image.key)).forEach(seeThroughOf);
  return images;
}

export const parseWeaponModel = ({ files, maxTexture }) => {
  const options = { inflateRaw: (bytes) => inflateSync(bytes), maxTexture };
  const loaded = weaponModel(files, options);
  const shelf = new SheetShelf(loaded.texture);
  const meshes = loaded.drawable.meshes.filter(hasGeometry).reduce((kept, mesh) => {
    kept.push(describeMesh(mesh, shelf));
    return kept;
  }, []);

  return { model: loaded.model, meshes, images: markSeeThrough(meshes, shelf.images), bounds: loaded.drawable.bounds };
};
