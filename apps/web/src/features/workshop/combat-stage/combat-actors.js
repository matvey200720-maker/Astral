/*
 * Стрелок и жертва 3D-предпросмотров эффектов (задача 4А, 18.10.2026).
 *
 * Тела приходят из игры игрока уже в позе (`readWeaponInHands`,
 * `readStandingBody` в главном процессе): GLB в осях glTF, начало — таз,
 * ствол в руке стрелка — модель игры на матрице кисти. Здесь они становятся
 * объектами сцены частиц: оси Z вверх, материалы — как у «Посмотреть на
 * персонаже» одежды (`clothing-shot.js`), тени, луч для точек входа и выхода
 * пули.
 *
 * Положение актёра в мире — `setPlacement({ position, yaw })`: таз в
 * `position`, поворот вокруг Z. Раскладку считает `combat-layout.js`.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { poseOf, sampled } from "../../../components/desktop/workshop/ptfx/ptfx-weapon.js";
import { gltfToScene } from "./combat-layout.js";

/* У DirectX зелёный канал нормали смотрит вниз — отсюда −1 по Y. */
const NORMAL_SCALE = new THREE.Vector2(0.9, -0.9);

function loader() {
  const gltf = new GLTFLoader();
  gltf.setMeshoptDecoder?.(MeshoptDecoder);
  return gltf;
}

/* Материал тела и ствола. Свет — настоящий (`combat-lighting.js`), поэтому
   нужен физический материал, а не сырой цвет модели. */
function bodyMaterial(source, { weapon = false } = {}) {
  const mode = source.alphaMode || (source.transparent ? "BLEND" : source.alphaTest > 0 ? "MASK" : "OPAQUE");
  /* Волосы у игры блестят: у вырезных карточек с матовым материалом они читались чёрной глыбой, а с бликом солнца — прядями. */
  const hair = /hair/i.test(source.name || "");
  const material = new THREE.MeshStandardMaterial({
    map: source.map || null,
    color: source.map ? 0xffffff : source.color || 0x777777,
    roughness: weapon ? 0.5 : hair ? 0.4 : 0.82,
    metalness: weapon ? 0.35 : 0,
    side: THREE.DoubleSide,
    normalMap: source.normalMap || null,
    normalScale: NORMAL_SCALE.clone(),
    transparent: mode === "BLEND" || source.transparent === true,
    alphaTest: source.alphaTest > 0 ? source.alphaTest : mode === "MASK" ? 0.5 : 0,
  });
  /* Декаль ствола лежит на той же сетке, что металл: без сдвига глубины они
     спорили бы, чей пиксель ближе. */
  if (material.transparent) {
    material.depthWrite = false;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
  }
  return material;
}

const AXIS_Z = new THREE.Vector3(0, 0, 1);

/*
 * Лысый (просьба владельца 20.10.2026: «верни, как был персонаж, просто сделай
 * его лысым»). Тело, лицо и одежда — те же, что из игры игрока, без перекраски:
 * прячутся только волосы — сетки частей с «hair» в имени материала (в теле из
 * игры материал части зовётся `astral_body_hair`, `weapon-in-hands.js`).
 * Сетка запоминает исходную видимость в `userData.bald`, поэтому вызов
 * безопасно повторять; луч для точек входа волос и так не видит
 * (`skinMeshes` без вырезных карточек).
 */
export const isHairMesh = (mesh) => /hair/i.test(`${mesh.userData?.part || ""} ${mesh.name || ""}`);

export function applyBald(meshes, on) {
  for (const mesh of meshes) {
    if (!isHairMesh(mesh)) continue;
    const saved = (mesh.userData.bald ??= { visible: mesh.visible, castShadow: mesh.castShadow });
    mesh.visible = on ? false : saved.visible;
    mesh.castShadow = on ? false : saved.castShadow;
  }
}

/* Положение и поворот группы тела: поворот вокруг Z, а после него — наклон падения. */
function applyPlacement(group, { position, yaw, tilt = 0, lean = 0 }) {
  group.position.set(position[0], position[1], position[2]);
  if (tilt) {
    /* Ось наклона лежит в земле и перпендикулярна азимуту падения: вращение вокруг неё кладёт «вверх» на (sin lean, cos lean). */
    const fall = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-Math.cos(lean), Math.sin(lean), 0), tilt);
    group.quaternion.copy(fall.multiply(new THREE.Quaternion().setFromAxisAngle(AXIS_Z, yaw)));
  } else {
    group.rotation.set(0, 0, yaw);
  }
  group.updateMatrixWorld(true);
}

function adopt(root, options) {
  const meshes = [];
  const materials = new Map();
  root.traverse((node) => {
    if (!node.isMesh) return;
    const source = node.material;
    let material = materials.get(source);
    if (!material) {
      material = bodyMaterial(source, options);
      materials.set(source, material);
    }
    node.material = material;
    /* Имя части тела из игры (`astral_body_hair`): по нему находятся волосы (`applyBald`). */
    node.userData.part = String(source.name || "");
    node.castShadow = !material.transparent;
    node.receiveShadow = true;
    meshes.push(node);
  });
  return { meshes, materials: [...materials.values()] };
}

/**
 * Актёр. `body` — GLB тела (ArrayBuffer), `hand` — матрица кисти (16 чисел,
 * оси glTF, по столбцам), `weapon` — GLB ствола, `joints` — суставы из кэша
 * тела (оси glTF).
 */
export async function loadActor({ body, hand = null, weapon = null, joints = null }) {
  const gltf = loader();
  const parsed = await gltf.parseAsync(body.slice(0), "");
  const bodyRoot = parsed.scene;
  const adopted = adopt(bodyRoot, {});
  bodyRoot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(bodyRoot);

  /* Оси glTF (Y вверх) → оси сцены (Z вверх): поворот на 90° вокруг X. */
  const frame = new THREE.Group();
  frame.rotation.x = Math.PI / 2;
  frame.add(bodyRoot);
  const placement = new THREE.Group();
  placement.add(frame);

  const result = {
    placement,
    footLift: Math.max(0.1, -box.min.y),
    height: box.max.y - box.min.y,
    joints,
    meshes: [...adopted.meshes],
    /* Сетки тела без ствола и без волос: пуля проходит через кожу и одежду. */
    skinMeshes: adopted.meshes.filter((mesh) => !(mesh.material.alphaTest > 0)),
    weaponObject: null,
    muzzle: null,
    forward: null,
    head: joints?.head ? gltfToScene(joints.head) : null,
  };
  const disposables = [...adopted.materials];

  if (weapon && Array.isArray(hand) && hand.length === 16) {
    const gun = await loader().parseAsync(weapon.slice(0), "");
    const gunRoot = gun.scene;
    const gunAdopted = adopt(gunRoot, { weapon: true });
    disposables.push(...gunAdopted.materials);
    /* Дуло и ось ствола — по сетке модели (длинная ось, тонкий конец). */
    const pose = poseOf(sampled(gunRoot));
    const matrix = new THREE.Matrix4().fromArray(hand);
    gunRoot.matrixAutoUpdate = false;
    gunRoot.matrix.copy(matrix);
    gunRoot.matrixWorldNeedsUpdate = true;
    frame.add(gunRoot);
    result.weaponObject = gunRoot;
    result.meshes.push(...gunAdopted.meshes);
    if (pose) {
      const muzzle = pose.muzzle.clone().applyMatrix4(matrix);
      const forward = pose.forward.clone().transformDirection(matrix);
      result.muzzle = gltfToScene([muzzle.x, muzzle.y, muzzle.z]);
      result.forward = gltfToScene([forward.x, forward.y, forward.z]);
    }
  }

  /* Лысый: волосы спрятаны, тело и одежда игры на месте; `false` возвращает причёску. */
  result.setBald = (on) => applyBald(adopted.meshes, Boolean(on));

  /**
   * Тело — на место в мире. `tilt` и `lean` — падение: наклон на `tilt` радиан
   * в сторону азимута `lean` (0 — к +Y, положительный — к +X) вокруг ступней
   * в точке `position`, которую вызывающий уже сдвинул на таз.
   */
  result.setPlacement = (next) => applyPlacement(placement, next);

  /*
   * Луч сквозь тело: `{ entry, exit }` — где пуля вошла и вышла (точка и
   * нормаль наружу), в мире. Сетки тела двусторонние, поэтому вход — первая
   * точка, а выход — последняя в пределах `reach` метров за ней.
   */
  const raycaster = new THREE.Raycaster();
  result.pierce = (origin, direction, reach = 0.7) => {
    placement.updateMatrixWorld(true);
    raycaster.set(new THREE.Vector3(...origin), new THREE.Vector3(...direction).normalize());
    raycaster.far = 200;
    const hits = raycaster.intersectObjects(result.skinMeshes, false);
    if (!hits.length) return null;
    const first = hits[0];
    const limit = first.distance + reach;
    let last = first;
    for (const hit of hits) if (hit.distance <= limit && hit.distance > last.distance) last = hit;
    const normalOf = (hit) => {
      const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(...direction).negate();
      return normal;
    };
    const entryNormal = normalOf(first);
    if (entryNormal.dot(new THREE.Vector3(...direction)) > 0) entryNormal.negate();
    const exitNormal = normalOf(last);
    if (exitNormal.dot(new THREE.Vector3(...direction)) < 0) exitNormal.negate();
    return {
      /* `object` — сетка, в которую пуля попала: декаль раны проецируется на неё. */
      entry: { point: first.point.toArray(), normal: entryNormal.toArray(), object: first.object },
      exit: last === first ? null : { point: last.point.toArray(), normal: exitNormal.toArray(), object: last.object },
    };
  };

  /*
   * Двойник: те же сетки, материалы и текстуры, своё положение. Сетки тела
   * неподвижны (поза запечена при чтении), поэтому копия — не пересчёт тела, а
   * ещё одна группа с теми же ссылками: толпа врагов не множит память. Двойник
   * ничего не освобождает — владелец ресурсов оригинал, и двойники убираются
   * раньше него.
   */
  result.clone = () => {
    const group = placement.clone(true);
    const copy = {
      placement: group,
      footLift: result.footLift,
      height: result.height,
      joints: result.joints,
      meshes: [],
      skinMeshes: [],
      weaponObject: null,
      muzzle: result.muzzle,
      forward: result.forward,
      head: result.head,
      isClone: true,
    };
    group.traverse((node) => {
      if (node.isMesh) copy.meshes.push(node);
    });
    copy.setPlacement = (next) => applyPlacement(group, next);
    copy.dispose = () => group.removeFromParent();
    return copy;
  };

  result.dispose = () => {
    placement.removeFromParent();
    const geometries = new Set();
    const textures = new Set();
    placement.traverse((node) => {
      if (node.isMesh) geometries.add(node.geometry);
    });
    for (const material of disposables)
      for (const key of ["map", "normalMap", "roughnessMap", "emissiveMap"]) if (material[key]) textures.add(material[key]);
    geometries.forEach((geometry) => geometry.dispose());
    textures.forEach((texture) => texture.dispose());
    disposables.forEach((material) => material.dispose());
  };
  return result;
}
