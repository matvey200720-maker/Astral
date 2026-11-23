import * as THREE from "three";
import { usePlaceModelLooks } from "../models/usePlaceModelLooks.js";
import { fitReplacementMesh } from "@modovik/climb-contract/recolor/arena-replace";
import { useEffect, useMemo, useRef } from "react";
import { ARENA_ITEM_LIMITS, arenaItemGroupOf, arenaItemMoveOffset } from "@modovik/climb-contract/recolor/arena-item-looks";

const SWAP_KINDS = new Set(["picture", "model"]);
const MODEL_FIELDS = ["asset", "shape", "texture", "depth", "width", "height"];
const GEOMETRY_CHANNELS = [
  ["position", "positions", 3],
  ["normal", "normals", 3],
  ["uv", "uvs", 2],
];

/* Замена вещи: картинка или своя модель, но не облик части. */
function isSwap(group) {
  return SWAP_KINDS.has(group.kind) && !group.part;
}

/* Протяжка: массив — только сдвиг; объект — { move, turn, scale }; ложное — «ничего». */
function readDrag(change) {
  const { move, turn, scale } = Array.isArray(change) ? { move: change } : change || {};
  return { move: move || [0, 0, 0], turn: turn || 0, scale: scale || 1 };
}

/* Угол в пределах −180…180, целые градусы. */
function foldDegrees(angle) {
  const wrapped = (((angle + 180) % 360) + 360) % 360;
  return Math.round(wrapped - 180);
}

/* Масштаб в пределах из договора, сотые доли. */
function foldScale(factor) {
  const [least, most] = ARENA_ITEM_LIMITS.scale;
  const clamped = Math.min(Math.max(factor, least), most);
  return Math.round(clamped * 100) / 100;
}

export function itemLookKeys(groups) {
  return Array.from(groups ?? [], (group) => (group.model ? group.keys : [])).flat();
}

/* Место первой вещи группы; у не-замены или без функции места его нет. */
function swapPlace(group, placeOf) {
  return isSwap(group) && placeOf ? placeOf(group.keys[0]) : null;
}

export function itemMoveLook(groups, key, change, placeOf) {
  const drag = readDrag(change);
  const group = arenaItemGroupOf(groups, key);
  const place = group ? swapPlace(group, placeOf) : null;
  if (!place) return null;
  const adjust = (field, differs, compute) => (differs ? { [field]: compute() } : null);
  const look = Object.assign(
    { ...group, offset: arenaItemMoveOffset(place, group.offset, drag.move) },
    adjust("turn", drag.turn !== 0, () => foldDegrees((group.turn || 0) + drag.turn)),
    adjust("scale", drag.scale !== 1, () => foldScale((group.scale || 1) * drag.scale)),
  );
  return { keys: group.keys, look };
}

/* ------------------------------------------------------------------ */
/* Облик вещей в кадре                                                 */
/* ------------------------------------------------------------------ */

const signatureOf = (group) => [
  group.keys,
  group.scale,
  group.turn,
  group.offset ?? null,
  ...MODEL_FIELDS.map((field) => group.model[field]),
];

/* Группы с моделью: прежний список, пока не изменилось содержимое по полям. */
function useModelGroups(groups) {
  const held = useRef(null);
  const list = (groups ?? []).filter((group) => group.model);
  const signature = JSON.stringify(list.map(signatureOf));
  if (held.current?.signature !== signature) held.current = { signature, list };
  return held.current.list;
}

const zeros = () => [0, 0, 0];
const restingPose = () => ({ scene: "", position: zeros(), rotation: zeros(), size: 1, motion: "none" });

/* Место в списке облика; номер g1, g2… считается по группам с моделью. */
class LookSlot {
  constructor(id, group, frame) {
    this.id = id;
    this.group = group;
    this.frame = frame;
  }

  toModel() {
    return Object.assign({}, this.group.model, { id: this.id }, restingPose());
  }
}

function lookSlots(modelGroups, frameOf) {
  const slots = [];
  modelGroups.forEach((group, at) => {
    const frame = frameOf(group.keys[0]);
    if (frame) slots.push(new LookSlot(`g${at + 1}`, group, frame));
  });
  return slots;
}

function firstById(looks) {
  const byId = new Map();
  for (const look of looks) {
    if (!byId.has(look.id)) byId.set(look.id, look);
  }
  return byId;
}

const typed = (Kind, values) => (values instanceof Kind ? values : Kind.from(values));

function fittedGeometry(fitted) {
  const geometry = new THREE.BufferGeometry();
  const channels = fitted.uvs ? GEOMETRY_CHANNELS : GEOMETRY_CHANNELS.slice(0, 2);
  for (const [name, field, size] of channels) {
    geometry.setAttribute(name, new THREE.BufferAttribute(typed(Float32Array, fitted[field]), size));
  }
  geometry.setIndex(new THREE.BufferAttribute(typed(Uint32Array, fitted.indices), 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function lookMaterial({ texture, alpha, opacity, shape }) {
  const material = new THREE.MeshStandardMaterial({ map: texture || null, color: texture ? 0xffffff : 0xb8b8b8 });
  return Object.assign(material, {
    roughness: 0.7,
    metalness: 0,
    transparent: Boolean(alpha) || opacity < 100,
    opacity: (opacity ?? 100) / 100,
    alphaTest: alpha ? 0.02 : 0,
    side: shape === "plate" ? THREE.DoubleSide : THREE.FrontSide,
  });
}

function placedCopy(geometry, material, place, itemKey) {
  const { position, rotation, scale: [flat, tall] } = place;
  const copy = new THREE.Mesh(geometry, material);
  copy.userData.pick = { kind: "item", key: itemKey, point: Array.from(position) };
  copy.castShadow = copy.receiveShadow = true;
  copy.position.fromArray(position);
  copy.quaternion.fromArray(rotation);
  copy.scale.set(flat, flat, tall);
  return copy;
}

function buildCluster({ group, frame }, look, placeOf, entityOf) {
  const geometry = fittedGeometry(fitReplacementMesh(look.unit, frame.bounds, group));
  const material = lookMaterial(look);
  const copies = group.keys.flatMap((key) => {
    const place = placeOf(key);
    return place ? [placedCopy(geometry, material, place, entityOf ? entityOf(key) : key)] : [];
  });
  const holder = new THREE.Group();
  for (const copy of copies) holder.add(copy);
  const release = () => {
    geometry.dispose();
    material.dispose();
  };
  return { object: holder, dispose: release };
}

function useDisposing(objects) {
  useEffect(() => {
    return () => {
      for (const object of objects) object.dispose();
    };
  }, [objects]);
  return objects;
}

export function useItemLookObjects(options) {
  const { groups, frameOf, placeOf, entityOf = null, active = true } = options;
  const modelGroups = useModelGroups(groups);
  const slots = useMemo(() => (active ? lookSlots(modelGroups, frameOf) : []), [modelGroups, frameOf, active]);
  const looks = usePlaceModelLooks(useMemo(() => slots.map((slot) => slot.toModel()), [slots]));
  return useDisposing(
    useMemo(() => {
      const byId = firstById(looks);
      return slots.flatMap((slot) => {
        const look = byId.get(slot.id);
        return look?.unit ? [buildCluster(slot, look, placeOf, entityOf)] : [];
      });
    }, [slots, looks, placeOf, entityOf]),
  );
}

/* ------------------------------------------------------------------ */
/* Протяжка замены мышью                                               */
/* ------------------------------------------------------------------ */

/* Начало протяжки одной копии: так она стояла, и опорная точка поворота и роста. */
class DragStart {
  constructor(copy) {
    this.position = copy.position.clone();
    this.quaternion = copy.quaternion.clone();
    this.scale = copy.scale.clone();
    this.pivot = DragStart.pivotOf(copy);
  }

  /* Середина шара геометрии копии в мировых осях. */
  static pivotOf(copy) {
    const { geometry } = copy;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const world = new THREE.Matrix4().compose(copy.position, copy.quaternion, copy.scale);
    return geometry.boundingSphere.center.clone().applyMatrix4(world);
  }

  /* Плечо от опоры растёт и поворачивается, затем сдвиг сцены. */
  applyTo(copy, { move, scale }, spin) {
    const arm = new THREE.Vector3().subVectors(this.position, this.pivot).multiplyScalar(scale).applyQuaternion(spin);
    copy.position.addVectors(this.pivot, arm).add(new THREE.Vector3().fromArray(move));
    copy.quaternion.multiplyQuaternions(spin, this.quaternion);
    copy.scale.set(this.scale.x * scale, this.scale.y * scale, this.scale.z * scale);
    copy.updateMatrix();
  }
}

/* Номера вещей-замен; через entityOf, если он задан. */
function swappedKeys(groups, entityOf) {
  const keys = (groups ?? []).flatMap((group) => (isSwap(group) ? group.keys : []));
  return new Set(entityOf ? keys.map(entityOf) : keys);
}

function copiesOf(objects, key) {
  return objects.flatMap((entry) => entry.object.children.filter((child) => child.userData?.pick?.key === key));
}

function changed(drag) {
  const moved = drag.move.some((part) => part !== 0);
  return moved || drag.turn !== 0 || drag.scale !== 1;
}

const TURN_AXIS = new THREE.Vector3(0, 0, 1);

function swapDescriptor(key, latest) {
  return {
    test: (pick) => pick?.kind === "item" && pick.key === key,
    onDrag(pick, change, phase) {
      const drag = readDrag(change);
      const spin = new THREE.Quaternion().setFromAxisAngle(TURN_AXIS, THREE.MathUtils.degToRad(drag.turn));
      for (const copy of copiesOf(latest.current.objects, key)) {
        const { userData } = copy;
        userData.dragBase ??= new DragStart(copy);
        userData.dragBase.applyTo(copy, drag, spin);
        if (phase === "end") delete userData.dragBase;
      }
      if (phase === "end" && changed(drag)) latest.current.onMove?.(key, drag);
    },
  };
}

export function useItemSwapDrag(options) {
  const { groups, key, objects, onMove, entityOf = null } = options;
  const latest = useRef({ objects, onMove });
  useEffect(() => {
    latest.current = { objects, onMove };
  });

  const draggable = useMemo(() => swappedKeys(groups, entityOf), [groups, entityOf]);
  const ready = Boolean(onMove) && Number.isInteger(key) && draggable.has(key);

  return useMemo(() => (ready ? swapDescriptor(key, latest) : null), [ready, key]);
}
