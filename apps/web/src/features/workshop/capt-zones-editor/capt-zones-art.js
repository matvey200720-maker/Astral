/*
 * Зоны каптов в 3D-кадре и на плитках — та же сетка, что уедет в игру.
 *
 * Шайбу строит договор (`captZoneMesh`) — тот же код, что у установщика:
 * 64-угольник радиуса мода, стенка до верха работы, крыша, каждая грань в
 * обе стороны. Кадру — только то, что над землёй в середине зоны: земля
 * кадра ровная, а стенка мода уходит под землю на десятки метров ради
 * склонов и низин. Материал — без света (у игры `emissive`: зона светится
 * сама), лист — та же полоса цветов эффекта с альфой прозрачности, что
 * зашьёт установщик; свечение — яркостью (×2 мода — цвет как есть, 0 —
 * тёмная дымка, как в игре).
 *
 * «Все зоны» — обзор: четырнадцать шайб на своих местах карты с подписями,
 * под ними — схема штата (`MAP_SCHEMATIC` из `@modovik/vector-map`: свой
 * обвод берега Astral, а не карта Rockstar); север — вверху кадра.
 */

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import {
  CAPT_ZONES,
  captZoneColourAt,
  captZoneLook,
  captZoneMesh,
  captZoneTexture,
  captZoneTop,
  findCaptZone,
  normalizeCaptZonesProject,
} from "@modovik/climb-contract/recolor/capt-zones";
import { paintSceneParts } from "../model-stage/mesh-painter.js";
import { captZonePick } from "./capt-zones-aim.js";
import { ALL_ZONES } from "./capt-zones-text.js";
import { tr } from "../../../locales/ui.js";
import { tileCanvas } from "../preset-tiles.js";

/* Обзор: середина рамки всех зон — в начале координат кадра. */
export const OVERVIEW = (() => {
  const min = [Infinity, Infinity];
  const max = [-Infinity, -Infinity];
  for (const zone of CAPT_ZONES)
    for (const axis of [0, 1]) {
      min[axis] = Math.min(min[axis], zone.position[axis] - zone.radius);
      max[axis] = Math.max(max[axis], zone.position[axis] + zone.radius);
    }
  const centre = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
  return Object.freeze({ centre, min: [min[0] - centre[0], min[1] - centre[1]], max: [max[0] - centre[0], max[1] - centre[1]] });
})();
export const overviewOffset = (zone) => [zone.position[0] - OVERVIEW.centre[0], zone.position[1] - OVERVIEW.centre[1], 0];

/* Яркость кадра по свечению шейдера: ×2 мода — цвет листа как есть. */
export const glowShade = (glow) => Math.min(3, Math.max(0, glow / 2));

/** Лист зоны для кадра: полоса эффекта с альфой прозрачности. */
function sheetTexture(project, zone, look) {
  const picture = captZoneTexture(project, zone);
  const texture = new THREE.DataTexture(new Uint8Array(picture.rgba), picture.width, picture.height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  /* Линия повторяет полосу по кругу; у остальных развёртка — внутри листа. */
  texture.wrapS = look.effect.mode === "line" ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Объект кадра: шайба зоны в облике работы, со сдвигом `offset`. Над землёй кадра — то, что выше
 * середины зоны; на настоящей местности (`underground`) стенка уходит под землю, как в игре: на склонах
 * её край виден там, где земля ниже точки зоны, — но не глубже `floor` (чуть ниже самой низкой земли куска).
 */
export function captZoneObject(zone, input, { offset = [0, 0, 0], underground = false, floor = null } = {}) {
  const project = normalizeCaptZonesProject(input);
  const look = captZoneLook(project, zone);
  const mesh = captZoneMesh(zone, project, { aboveGround: !underground, floor });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingSphere();
  const map = sheetTexture(project, zone, look);
  const opaque = look.alpha >= 255;
  /* Грани и так в обе стороны (как в игре): лицевая сторона у каждой своя. */
  const material = new THREE.MeshBasicMaterial({ map, transparent: !opaque, depthWrite: opaque, side: THREE.FrontSide, toneMapped: false });
  material.color.setScalar(glowShade(look.glow));
  const object = new THREE.Mesh(geometry, material);
  object.name = `capt-zone-${zone.id}`;
  object.position.set(...offset);
  object.visible = !look.hidden;
  /* Шайбу можно выбрать щелчком: сетки сцены под ней спрятаны, она — единственное, во что целится кадр. */
  object.userData.pick = captZonePick(zone);
  return {
    object,
    dispose() {
      geometry.dispose();
      material.dispose();
      map.dispose();
    },
  };
}

/* ------------------------------------------------------------------ *
 * Обзор «Все зоны»: схема штата и подписи зон
 * ------------------------------------------------------------------ */

/* Цвета схемы — тёмные, под матовой плашкой кадра: земля, вода, город, шоссе. */
const MAP_COLOURS = Object.freeze({ land: 0x24272d, water: 0x141d26, urban: 0x2c3038, road: 0x3d434c });

/*
 * Схема штата под обзором — обвод берега, Аламо, застройка и шоссе из
 * `@modovik/vector-map` (`MAP_SCHEMATIC`: своя схема Astral в координатах
 * игры, а не карта Rockstar). Лежит ниже шайб, на «земле» обзора.
 */
function overviewMapObject(schematic) {
  const group = new THREE.Group();
  group.name = "capt-zones-map";
  const disposables = [];
  const point = (item) => [item.x - OVERVIEW.centre[0], item.y - OVERVIEW.centre[1]];
  const fill = (points, colour, z) => {
    const shape = new THREE.Shape();
    points.forEach((item, index) => (index ? shape.lineTo(...point(item)) : shape.moveTo(...point(item))));
    const geometry = new THREE.ShapeGeometry(shape);
    const material = new THREE.MeshBasicMaterial({ color: colour, toneMapped: false });
    disposables.push(geometry, material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = z;
    group.add(mesh);
  };
  const line = (points, colour, z) => {
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map((item) => new THREE.Vector3(...point(item), z)));
    const material = new THREE.LineBasicMaterial({ color: colour, toneMapped: false });
    disposables.push(geometry, material);
    group.add(new THREE.Line(geometry, material));
  };
  fill(schematic.coastline, MAP_COLOURS.land, -3);
  for (const area of schematic.urban || []) fill(area.points, MAP_COLOURS.urban, -2.5);
  for (const water of schematic.water || []) fill(water, MAP_COLOURS.water, -2);
  for (const road of schematic.highways || []) line(road.points, MAP_COLOURS.road, -1.5);
  return {
    object: group,
    dispose() {
      for (const item of disposables) item.dispose();
    },
  };
}

/* Подпись зоны над обзором: на стороне, дальней от ближайшей соседки. */
const LABEL_HEIGHT = 260;
function labelSide(zone) {
  let nearest = null;
  for (const other of CAPT_ZONES) {
    if (other === zone) continue;
    const distance = Math.hypot(other.position[0] - zone.position[0], other.position[1] - zone.position[1]);
    if (!nearest || distance < nearest.distance) nearest = { other, distance };
  }
  return nearest && nearest.other.position[0] > zone.position[0] ? -1 : 1;
}

function labelObject(zone, project) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return null;
  const family = getComputedStyle(document.body).fontFamily || "sans-serif";
  const font = `600 44px ${family}`;
  context.font = font;
  const text = zone.kind === "arena" ? tr("Арена") : zone.label;
  canvas.width = Math.ceil(context.measureText(text).width) + 24;
  canvas.height = 64;
  context.font = font;
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.lineWidth = 10;
  context.strokeStyle = "rgba(9, 10, 12, 0.9)";
  context.strokeText(text, 12, 34);
  context.fillStyle = "#f1f3f6";
  context.fillText(text, 12, 34);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map, depthTest: false, transparent: true, toneMapped: false });
  const sprite = new THREE.Sprite(material);
  const side = labelSide(zone);
  sprite.center.set(side < 0 ? 1 : 0, 0.5);
  sprite.scale.set((LABEL_HEIGHT * canvas.width) / canvas.height, LABEL_HEIGHT, 1);
  const [x, y] = overviewOffset(zone);
  sprite.position.set(x + side * (zone.radius + 90), y, captZoneTop(zone, project) + 40);
  sprite.renderOrder = 10;
  sprite.name = `capt-zone-label-${zone.id}`;
  return {
    object: sprite,
    dispose() {
      material.dispose();
      map.dispose();
    },
  };
}

/* Схема штата — кусок большой карты: грузится, только когда нужен обзор. */
function useSchematic(active) {
  const [schematic, setSchematic] = useState(null);
  useEffect(() => {
    if (!active || schematic) return undefined;
    let cancelled = false;
    import("@modovik/vector-map")
      .then((module) => {
        if (!cancelled) setSchematic(module.MAP_SCHEMATIC || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [active, schematic]);
  return active ? schematic : null;
}

/** Глубина, до которой стенка шайбы показана на местности: на 3 м ниже самой низкой земли куска (`null` — как у мода). */
export const territoryFloor = (territory) => (territory?.ground ? territory.ground.min - 3 : null);

/** Объекты кадра: зона в кадре или все зоны обзором; пересобираются по смыслу работы. */
export function useCaptZonesObjects({ project, target, territory = null, general = false }) {
  const normal = normalizeCaptZonesProject(project);
  const overview = target === ALL_ZONES;
  const key = JSON.stringify([target, territory?.id ?? null, general, normal.enabled, normal.look, normal.opacity, normal.zones, normal.glow, normal.height, normal.roof]);
  const items = useMemo(
    () => {
      if (overview) return CAPT_ZONES.map((zone) => captZoneObject(zone, normal, { offset: overviewOffset(zone) }));
      const zone = findCaptZone(target) || CAPT_ZONES[0];
      /* `general` — «Все зоны» показаны одной зоной: у неё общий облик, без своих правок (они у остальных своё). */
      const shown = general ? { ...normal, zones: {} } : normal;
      return [captZoneObject(zone, shown, { underground: Boolean(territory), floor: territoryFloor(territory) })];
    },
    // Сетки пересобираются по смыслу работы (`key`), а не по новому объекту.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  useEffect(() => () => items.forEach((item) => item.dispose()), [items]);
  /* Подписи обзора — по высоте стенки (над крышей). */
  const labels = useMemo(
    () => (overview ? CAPT_ZONES.map((zone) => labelObject(zone, normal)).filter(Boolean) : []),
    // Подписи меняются с обзором и высотой стенки, а не с каждой правкой цвета.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overview, normal.height],
  );
  useEffect(() => () => labels.forEach((item) => item.dispose()), [labels]);
  const schematic = useSchematic(overview);
  const map = useMemo(() => (schematic ? overviewMapObject(schematic) : null), [schematic]);
  useEffect(() => () => map?.dispose(), [map]);
  return useMemo(() => [...(map ? [map] : []), ...items, ...labels], [map, items, labels]);
}

/**
 * Рамка кадра: у зоны — от земли до верха стенки (мода или работы — что
 * выше), с землёй и человеком (`territory` — настоящая местность из игры вместо
 * нарисованных); у обзора — все зоны сверху, без земли.
 */
export function captZonesFrame(target, project, territory = null) {
  if (target === ALL_ZONES) {
    const top = Math.max(...CAPT_ZONES.map((zone) => captZoneTop(zone, project)));
    return {
      bounds: { min: [OVERVIEW.min[0], OVERVIEW.min[1], 0], max: [OVERVIEW.max[0], OVERVIEW.max[1], top] },
      ground: false,
      person: false,
      view: { yaw: 0, pitch: 1.2, zoom: 1.14 },
    };
  }
  const zone = findCaptZone(target) || CAPT_ZONES[0];
  const top = Math.max(zone.top, captZoneTop(zone, project));
  return {
    bounds: { min: [-zone.radius, -zone.radius, territory ? Math.max(zone.bottom, territoryFloor(territory) ?? 0) : 0], max: [zone.radius, zone.radius, top] },
    ground: !territory,
    person: !territory,
    view: { pitch: 0.32, zoom: 0.95 },
  };
}

/*
 * Плитка и обложка — шайба зоны сверху-сбоку на земле с сеткой, в облике
 * работы: тот же рисователь, что у плиток зон (`paintSceneParts`), сетка —
 * та же, что уедет в игру (над землёй). Это схема зоны, а не кадр из игры.
 */
export function paintCaptZone(context, zoneId, input, { width, height, left = 0, top = 0, view = { yaw: -0.55, pitch: 0.3 }, ground = true } = {}) {
  const zone = findCaptZone(zoneId) || CAPT_ZONES[0];
  const project = normalizeCaptZonesProject(input);
  const look = captZoneLook(project, zone);
  const mesh = captZoneMesh(zone, project, { aboveGround: true });
  const asset = {
    parts: [{ id: zone.id, bounds: mesh.bounds }],
    materials: [{ id: zone.id }],
    meshes: [{ part: 0, material: 0, positions: mesh.positions, indices: mesh.indices }],
  };
  const colourAt = captZoneColourAt(project, zone);
  const shade = glowShade(look.glow);
  return paintSceneParts(context, asset, {
    parts: [zone.id],
    look: () => ({
      colour: look.colour,
      opacity: look.alpha / 255,
      visible: !look.hidden,
      colourAt: (x, y, z) => colourAt(x, y, z).map((value) => Math.min(255, value * shade)),
    }),
    width,
    height,
    left,
    top,
    view,
    margin: 0.06,
    ground,
    grid: Math.max(10, Math.round(zone.radius / 5 / 10) * 10),
  });
}

/** Холст плитки зоны в облике работы (кодирует полка — вне главного потока, `preset-tiles.js`). */
export function captZoneCanvas(zoneId, project, { width = 200, height = 96 } = {}) {
  return tileCanvas(width, height, (context) => paintCaptZone(context, zoneId, project, { width, height }));
}
