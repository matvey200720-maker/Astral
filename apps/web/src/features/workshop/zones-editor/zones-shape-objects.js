/*
 * Форма зоны в кадре (задача 23 ТЗ 18.10.2026): ширина, высота стенки и неон.
 *
 * Сетка зоны мода из сцены кадра пропускается через ту же функцию, что строит модели в игре (`zoneShapeMesh`,
 * `@modovik/climb-contract/recolor/zones`): лента нужной ширины и стенка нужной высоты. Это объект кадра, а сетка
 * мода в сцене прячется (`hidden`). Цвет и прозрачность — те же, что у кадра мода (`zoneFrameLook`), эффект — цветом
 * вершин по той же проекции, что уедет в игру.
 *
 * Неон. В игре — шейдер со свечением (`emissive_alpha`), его глаз видит как сияние. У кадра студийный свет и нет
 * ночного свечения, поэтому неон здесь — яркий цвет без тонирования и мягкий ореол вокруг ленты (шире её в несколько
 * раз, складывается со сценой): это нарисовано, подпись кадра говорит об этом.
 */

import * as THREE from "three";
import { ZONES_MOD_SHAPE, zoneKindHasWidth, zoneShape, zoneShapeMesh, zonesShapeChanged } from "@modovik/climb-contract/recolor/zones";
import { zoneFrameLook, zoneOfMaterial } from "./zones-text.js";

/* Ореол неона — три мягких слоя шире ленты (во сколько раз шире и какая доля яркости): ступени складываются в сияние. */
const HALO_LAYERS = Object.freeze([
  [2.5, 0.5],
  [5, 0.28],
  [9, 0.14],
]);
const HALO_LIFT = 0.04;

function colourAttribute(positions, look) {
  const out = new Float32Array(positions.length);
  const colour = new THREE.Color();
  for (let at = 0; at + 2 < positions.length; at += 3) {
    const [r, g, b] = look.colourAt(positions[at], positions[at + 1], positions[at + 2]);
    colour.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
    out[at] = colour.r;
    out[at + 1] = colour.g;
    out[at + 2] = colour.b;
  }
  return new THREE.BufferAttribute(out, 3);
}

function geometryOf(mesh, look) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  if (look.colourAt) geometry.setAttribute("color", colourAttribute(mesh.positions, look));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Объекты кадра для зон части `partIndex` сцены (вида `kind`): `{ objects: [{ object, dispose }], hidden: Set(id зон) }`.
 * Форма вида как у мода — пусто: кадр рисует сетку мода из сцены. `partIndex: null` — местность: зоны всех видов,
 * что лежат в сцене места (у каждой — форма её вида), а `shiftOf(зона)` — на сколько их сетка сдвинута от точки зоны.
 */
export function buildZoneShapeObjects({ asset, partIndex, project, kind, shiftOf = null }) {
  const none = { objects: [], hidden: new Set() };
  const everywhere = partIndex === null;
  if (!asset || (!everywhere && partIndex < 0)) return none;
  if (!everywhere && !zonesShapeChanged(project, kind)) return none;
  const objects = [];
  const hidden = new Set();
  for (const source of asset.meshes) {
    if (!everywhere && source.part !== partIndex) continue;
    const zone = zoneOfMaterial(asset.materials[source.material]);
    if (!zone || (!everywhere && zone.kind !== kind)) continue;
    if (!zonesShapeChanged(project, zone.kind)) continue;
    const shape = zoneShape(project, zone.kind);
    const look = zoneFrameLook(project, zone, shiftOf ? shiftOf(zone) : null);
    /* Невидимая зона не рисуется вовсе: сетка мода уже скрыта обликом. */
    if (!look.visible) continue;
    hidden.add(zone.id);
    const mesh = zoneShapeMesh({ positions: source.positions, indices: source.indices }, { width: shape.width, height: shape.height });
    const geometry = geometryOf(mesh, look);
    const neon = shape.neon;
    /* Неон — цвет без тонирования кадра (ярче) и ореол; прозрачность — ровно та, что задана видом. */
    const material = new THREE.MeshBasicMaterial({
      color: look.colourAt ? 0xffffff : new THREE.Color(look.colour),
      vertexColors: Boolean(look.colourAt),
      transparent: true,
      opacity: look.opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: !neon,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const group = new THREE.Group();
    group.name = `zone-shape:${zone.id}`;
    /* Щелчок по зоне берёт её (`hit.pick`): сетка мода в сцене спрятана и целиться в неё нечем. */
    group.userData.pick = { kind: "zone", id: zone.id };
    const body = new THREE.Mesh(geometry, material);
    body.renderOrder = 4;
    group.add(body);
    const disposables = [geometry, material];
    if (neon && zoneKindHasWidth(zone.kind)) {
      /* Ореол: три ленты шире основной, мягкие и складывающиеся со сценой (у заливки без ширины ореола нет — свечение даёт сам цвет). */
      const base = shape.width ?? ZONES_MOD_SHAPE[zone.kind].width;
      const strength = 0.35 + (shape.glow / 20) * 0.65;
      for (const [factor, share] of HALO_LAYERS) {
        const halo = zoneShapeMesh({ positions: source.positions, indices: source.indices }, { width: Math.max(base * factor, base + 0.6), height: 0 });
        for (let at = 2; at < halo.positions.length; at += 3) halo.positions[at] += HALO_LIFT;
        const haloGeometry = geometryOf(halo, look);
        const haloMaterial = new THREE.MeshBasicMaterial({
          color: look.colourAt ? 0xffffff : new THREE.Color(look.colour),
          vertexColors: Boolean(look.colourAt),
          transparent: true,
          opacity: Math.min(0.8, share * strength * (0.5 + look.opacity * 0.5)),
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          depthWrite: false,
          toneMapped: false,
        });
        const glow = new THREE.Mesh(haloGeometry, haloMaterial);
        glow.renderOrder = 3;
        glow.raycast = () => {};
        group.add(glow);
        disposables.push(haloGeometry, haloMaterial);
      }
    }
    objects.push({
      object: group,
      dispose() {
        for (const item of disposables) item.dispose();
      },
    });
  }
  return { objects, hidden };
}
