/*
 * Ствол в кадре «Вспышек выстрелов» (задача 3 ТЗ 06.10.2026): вспышка игры
 * без оружия — мелькающее пятно в пустоте, по которому не понять, что это.
 * Рядом с ней — модель ствола Astral (те же `.glb`, что у стрельбища студии
 * звука), дулом в точке эффекта, стволом вдоль оси вспышки.
 *
 * Модель переводится в форму сеток частиц рисовальщика (`buildModelGeometry`:
 * вершины, нормали, развёртка, треугольники и лист по имени): так её рисует
 * тот же шейдер моделей, что и куски эффектов, тем же светом сцены, и её
 * освещает сама вспышка. Сторону, куда смотрит ствол, модель не сообщает —
 * её находят по сетке, как у стрельбища: самая длинная ось — ствол, тонкий
 * конец — дуло, верх — сторона ствола у дула. Ось канала — середина сечения
 * у самого дула.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { tr } from "../../../../locales/ui.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

/** Модель по умолчанию — автомат: эффект в кадре — `muz_assault_rifle`. */
export const WEAPON_MODEL_URL = "/assets/catalog/weapons-3d/assault-rifle.glb";
/** Имя сетки ствола у рисовальщика и префикс его листов. */
export const WEAPON_MESH = "astral:weapon";

/* Длина ствола в кадре, м: у моделей каталога единицы бывают любыми. */
const LENGTH_RANGE = [0.3, 2.5];
const FALLBACK_LENGTH = 0.85;

export function sampled(root) {
  const points = [];
  const vertex = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((node) => {
    const position = node.geometry?.attributes?.position;
    if (!node.isMesh || !position) return;
    const step = Math.max(1, Math.floor(position.count / 6000));
    for (let index = 0; index < position.count; index += step)
      points.push(vertex.fromBufferAttribute(position, index).applyMatrix4(node.matrixWorld).clone());
  });
  return points;
}

/*
 * Поза модели: базис «вперёд по стволу, вверх, вбок» и точка дула — в
 * координатах модели. `null` — сетки не хватило.
 */
export function poseOf(points) {
  if (points.length < 8) return null;
  const box = new THREE.Box3().setFromPoints(points);
  const size = box.getSize(new THREE.Vector3());
  const axes = ["x", "y", "z"].sort((left, right) => size[right] - size[left]);
  const [lengthAxis, heightAxis, depthAxis] = axes;
  const length = size[lengthAxis];
  const band = length * 0.06;
  const slice = (predicate) => points.filter(predicate);
  const lowEnd = slice((point) => point[lengthAxis] < box.min[lengthAxis] + band);
  const highEnd = slice((point) => point[lengthAxis] > box.max[lengthAxis] - band);
  const extent = (list) => {
    if (!list.length) return Infinity;
    let low = Infinity;
    let high = -Infinity;
    for (const point of list) {
      low = Math.min(low, point[heightAxis]);
      high = Math.max(high, point[heightAxis]);
    }
    return high - low;
  };
  /* Дуло — тонкий конец: у приклада сечение шире. */
  const atMax = extent(highEnd) <= extent(lowEnd);
  const end = atMax ? highEnd : lowEnd;
  const middle = (box.min[heightAxis] + box.max[heightAxis]) / 2;
  const centre = new THREE.Vector3();
  for (const point of end) centre.add(point);
  centre.divideScalar(Math.max(1, end.length));
  const upSign = centre[heightAxis] >= middle ? 1 : -1;
  const unit = (axis, sign) => {
    const vector = new THREE.Vector3();
    vector[axis] = sign;
    return vector;
  };
  const forward = unit(lengthAxis, atMax ? 1 : -1);
  const up = unit(heightAxis, upSign);
  const side = new THREE.Vector3().crossVectors(forward, up);
  if (side.lengthSq() < 0.5) return null;
  /* Дуло — на самом конце, по оси канала (середина сечения у дула). */
  const muzzle = centre.clone();
  muzzle[lengthAxis] = atMax ? box.max[lengthAxis] : box.min[lengthAxis];
  void depthAxis;
  return { forward, up, side, muzzle, length };
}

/* Картинка материала → холст листа (у материала без картинки — его цвет). */
function sheetOf(material) {
  const canvas = document.createElement("canvas");
  const image = material?.map?.image || null;
  const width = Number(image?.width) || 0;
  const height = Number(image?.height) || 0;
  if (width && height) {
    const scale = Math.min(1, 1024 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  canvas.width = 4;
  canvas.height = 4;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = `#${(material?.color || new THREE.Color(0x2b2d31)).getHexString()}`;
    context.fillRect(0, 0, 4, 4);
  }
  return canvas;
}

/**
 * Ствол для сцены: `{ mesh: { parts }, sheets: Map(имя листа → холст),
 * length }`. Модель поставлена так: дуло — в начале координат, ствол — по +X,
 * верх — по +Z (метры).
 */
export async function loadWeaponMesh(url = WEAPON_MODEL_URL, { loader = null } = {}) {
  const gltfLoader = loader || new GLTFLoader();
  gltfLoader.setMeshoptDecoder?.(MeshoptDecoder);
  const gltf = await gltfLoader.loadAsync(url);
  const root = gltf.scene;
  const pose = poseOf(sampled(root));
  if (!pose) throw new Error(tr("У модели ствола не найти, где дуло."));
  const scale =
    pose.length >= LENGTH_RANGE[0] && pose.length <= LENGTH_RANGE[1]
      ? 1
      : FALLBACK_LENGTH / Math.max(pose.length, 1e-6);
  /* Модель → кадр: перенос дула в начало, поворот базиса на (+X, +Z, −Y). */
  const basis = new THREE.Matrix4().makeBasis(pose.forward, pose.up, pose.side);
  const toScene = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, -1, 0),
  );
  const rotation = new THREE.Matrix4().multiplyMatrices(toScene, basis.clone().invert());
  const place = new THREE.Matrix4()
    .makeScale(scale, scale, scale)
    .multiply(rotation)
    .multiply(new THREE.Matrix4().makeTranslation(-pose.muzzle.x, -pose.muzzle.y, -pose.muzzle.z));
  const parts = [];
  const sheets = new Map();
  const vertex = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const normalMatrix = new THREE.Matrix3();
  root.updateMatrixWorld(true);
  root.traverse((node) => {
    if (!node.isMesh || !node.geometry?.attributes?.position) return;
    const geometry = node.geometry;
    const position = geometry.attributes.position;
    const normals = geometry.attributes.normal || null;
    const uv = geometry.attributes.uv || null;
    matrix.multiplyMatrices(place, node.matrixWorld);
    normalMatrix.getNormalMatrix(matrix);
    const positions = new Array(position.count * 3);
    const outNormals = new Array(position.count * 3);
    const uvs = new Array(position.count * 2);
    for (let index = 0; index < position.count; index += 1) {
      vertex.fromBufferAttribute(position, index).applyMatrix4(matrix);
      positions[index * 3] = vertex.x;
      positions[index * 3 + 1] = vertex.y;
      positions[index * 3 + 2] = vertex.z;
      if (normals) normal.fromBufferAttribute(normals, index).applyMatrix3(normalMatrix).normalize();
      else normal.set(0, 0, 1);
      outNormals[index * 3] = normal.x;
      outNormals[index * 3 + 1] = normal.y;
      outNormals[index * 3 + 2] = normal.z;
      uvs[index * 2] = uv ? uv.getX(index) : 0;
      uvs[index * 2 + 1] = uv ? uv.getY(index) : 0;
    }
    const index = geometry.index
      ? Array.from(geometry.index.array)
      : Array.from({ length: position.count }, (_, at) => at);
    const material = Array.isArray(node.material) ? node.material[0] : node.material;
    const name = `${WEAPON_MESH}:${parts.length}`;
    sheets.set(name, sheetOf(material));
    parts.push({ positions, normals: outNormals, uvs, indices: index, texture: name });
  });
  if (!parts.length) throw new Error(tr("В модели ствола нет сеток."));
  return { mesh: { parts }, sheets, length: pose.length * scale };
}
