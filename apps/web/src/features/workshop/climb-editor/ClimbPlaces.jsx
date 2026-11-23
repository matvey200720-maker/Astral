/*
 * Кадр залазов «На месте» — кусок настоящей карты из игры игрока с метками мода (задача 26 ТЗ 19.10.2026).
 *
 * Земля, дороги и дома вокруг точки — сетки сущностей карт игры (сцена места, как у «Зон каптов»); метки
 * — на тех местах, где их ставит расстановка мода (`climbs.ymap`): каждая плашка — те же пиксели, что
 * уедут в DDS (`climbMarkerCanvas`), на том же четырёхугольнике лица, что соберёт установщик
 * (`climbMarkerLayout`). Правка метки видна на всех её местах разом, на любом из четырёх мест. Камера —
 * общая на мастерскую: ЛКМ — вращение, щелчок ПКМ — полёт (W A S D, Q и E, Shift), колесо — ближе.
 *
 * Кадр рисуется только на изменение: стоящий кадр ничего не стоит, правка метки — одна отрисовка.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { CLIMB_SLOTS, climbMarkerEmission, climbMarkerLayout } from "@modovik/climb-contract";
import { climbPlace } from "@modovik/climb-contract/climb-places";
import ModelStage from "../model-stage/ModelStage.jsx";
import { loadSceneAsset } from "../model-stage/scene-asset.js";
import { climbMarkerCanvas } from "./climb-render.js";
import { CLIMB_SCENE_LIGHT } from "./climb-preview.js";
import { markerView, markersByModel, parseClimbMarkers, placeHomeView, plateGeometry } from "./climb-places-scene.js";
import { useTr } from "../../../locales/ui.js";

/* Сторона текстуры метки в кадре: метке ростом в десятки сантиметров хватает 256 по высоте. */
const PLATE_SIDE = 256;

/*
 * Плашка ближе к глазу по лучу взгляда на столько метров: стена в кадре — ужатая сетка игры, она местами
 * выступает перед настоящей на дециметры, и плашка вплотную тонула бы в ней. Сдвиг вдоль луча от глаза не
 * меняет, куда плашка попадает на экране, — меняется только глубина.
 */
const PLATE_DEPTH_PULL = 0.9;

function pullTowardsEye(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <project_vertex>",
      `vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
       float eyeDistance = length( mvPosition.xyz );
       mvPosition.xyz -= mvPosition.xyz / max( eyeDistance, 1e-4 ) * min( ${PLATE_DEPTH_PULL.toFixed(3)}, eyeDistance * 0.5 );
       gl_Position = projectionMatrix * mvPosition;`,
    );
  };
  material.customProgramCacheKey = () => "astral-climb-plate-pull";
}

/* Земля и дома — фон, а не предмет правки: листы вполовину меньше; вечером и ночью — темнее вместе с небом. */
const GROUND_LIGHT = Object.freeze({ day: "#ffffff", dusk: "#8e8696", night: "#3b4156" });

/* Луч от метки к глазу: загорожен ли он сеткой сцены места (стена, крыша). Сцена — ссылки на массивы кэша, копий нет. */
const blockers = new WeakMap();
function sceneBlocker(asset) {
  if (!blockers.has(asset)) {
    const group = new THREE.Group();
    for (const mesh of asset.meshes) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
      geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
      group.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })));
    }
    group.updateMatrixWorld(true);
    blockers.set(asset, group);
  }
  const group = blockers.get(asset);
  const ray = new THREE.Raycaster();
  return (from, to) => {
    const start = new THREE.Vector3(...from);
    const direction = new THREE.Vector3(...to).sub(start);
    const distance = direction.length();
    ray.set(start, direction.normalize());
    ray.far = distance;
    return ray.intersectObject(group, true).length > 0;
  };
}

/**
 * Рамка кадра места: поле метров вокруг середины меток, где гуляет камера (от него — скорость и пределы
 * полёта), и взгляд по умолчанию — изнутри, над крышами, на метки (`placeHomeView`).
 */
export function climbPlaceFrame(place) {
  const { span = 55, yaw, pitch, zoom } = place.view;
  const [fx, fy, fz] = place.focus || [0, 0, 0];
  const low = (place.ground?.min ?? -4) - 3;
  const top = Math.max(place.ground?.max ?? 8, fz) + 60;
  return {
    bounds: { min: [fx - span, fy - span, low], max: [fx + span, fy + span, top] },
    centre: [fx, fy, fz],
    ground: false,
    view: { yaw, pitch, zoom },
    inside: placeHomeView(place),
  };
}

/*
 * Край места — круг вокруг середины куска (начало сцены): сцену собирает `groundChunk` с `whole` на `reach` и 4 м запаса, внутри круга
 * всё целое, за ним чёрная пустота; полоса затухания — внутри круга, метки на ней темнеют вместе со стеной (ТЗ 20.10.2026).
 */
export const CLIMB_PLACE_FADE = 22;
export const climbPlaceEdge = (place) => ({ shape: "disc", centre: [0, 0], radius: (place?.reach ?? 90) + 4, width: CLIMB_PLACE_FADE });

/**
 * Места меток `placeId`. `design` — макет (устоявшийся), `pictures` — принесённые картинки, `scene` —
 * время суток (`CLIMB_SCENES`). `onReal` — прочитались ли листы игры (подпись кадра).
 */
const NO_PICTURES = Object.freeze({});

export default function ClimbPlaces({ design, pictures = NO_PICTURES, placeId, scene = "day", label = "", onCamera = null, slotId = "", visit = 0, onVisitable = null }) {
  useTr();
  const place = useMemo(() => climbPlace(placeId), [placeId]);
  const stageRef = useRef(null);
  const [markers, setMarkers] = useState(null);
  const [focus, setFocus] = useState(null);
  const group = useMemo(() => new THREE.Group(), []);
  const cursor = useRef({ slot: "", at: -1 });

  /* Расстановка меток места: один раз на место. */
  useEffect(() => {
    if (!place) return undefined;
    let cancelled = false;
    setMarkers(null);
    fetch(place.markers.url)
      .then((response) => {
        if (!response.ok) throw new Error("расстановка не загрузилась");
        return response.json();
      })
      .then((data) => {
        if (!cancelled) setMarkers(parseClimbMarkers(data));
      })
      .catch(() => {
        /* Нет расстановки — остаётся земля места без меток. */
      });
    return () => {
      cancelled = true;
    };
  }, [place]);

  /* Метки выбранной метки-модели в этом месте: «К метке» летит к ним по очереди. */
  const mine = useMemo(() => (markers ? markersByModel(markers).get(slotId) || [] : []), [markers, slotId]);
  useEffect(() => {
    onVisitable?.(mine.length);
  }, [mine.length, onVisitable]);
  useEffect(() => {
    setFocus(null);
    cursor.current = { slot: "", at: -1 };
  }, [placeId]);
  /* «К метке» (`visit` растёт с каждым нажатием): взгляд вплотную на следующую метку выбранной модели. Сцена места
     читается из кэша окна — по ней проверяется, не загораживает ли метку стена или крыша. */
  useEffect(() => {
    if (!visit || !mine.length) return undefined;
    let cancelled = false;
    cursor.current = { slot: slotId, at: cursor.current.slot === slotId ? (cursor.current.at + 1) % mine.length : 0 };
    const item = mine[cursor.current.at];
    const quad = climbMarkerLayout(design, slotId).quad;
    loadSceneAsset(place.scene.url)
      .then((asset) => {
        if (!cancelled) setFocus(markerView(item, quad, place.view.yaw, sceneBlocker(asset)));
      })
      .catch(() => {
        if (!cancelled) setFocus(markerView(item, quad, place.view.yaw));
      });
    return () => {
      cancelled = true;
    };
    // Полёт — по нажатию (`visit`), а не по каждой правке макета.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visit]);

  /* Плашки: по одной на метку-модель — все её места в одном буфере; пересобираются с правкой макета. */
  const light = CLIMB_SCENE_LIGHT[scene] || CLIMB_SCENE_LIGHT.day;
  const emissive = !climbMarkerEmission(design).lit;
  useEffect(() => {
    if (!markers) return undefined;
    const made = [];
    const byModel = markersByModel(markers);
    for (const slot of CLIMB_SLOTS) {
      const items = byModel.get(slot.id);
      if (!items?.length || !design.markers[slot.id]?.enabled) continue;
      const canvas = climbMarkerCanvas(design, slot.id, { size: PLATE_SIDE * slot.aspect, picture: pictures[slot.id] || null });
      if (!canvas) continue;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;
      texture.anisotropy = 4;
      texture.needsUpdate = true;
      /* Метка светится сама (`emissive`) — вечером не темнеет; крашеная темнеет вместе со стеной. */
      const brightness = emissive ? 1 : 1 - light.shade * 0.9;
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        color: new THREE.Color(brightness, brightness, brightness),
        transparent: true,
        alphaTest: 0.02,
        depthWrite: false,
        toneMapped: false,
      });
      pullTowardsEye(material);
      const geometry = plateGeometry(climbMarkerLayout(design, slot.id).quad, items);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      group.add(mesh);
      made.push({ mesh, texture, material, geometry });
    }
    if (import.meta.env?.DEV) window.__astralClimbPlaces = { group, markers };
    stageRef.current?.repaint?.();
    return () => {
      for (const item of made) {
        group.remove(item.mesh);
        item.texture.dispose();
        item.material.dispose();
        item.geometry.dispose();
      }
    };
  }, [markers, design, pictures, emissive, light.shade, group]);

  const look = useCallback((_index, info) => ({ colour: info.colour, mapSize: 256, multiply: GROUND_LIGHT[scene] || GROUND_LIGHT.day }), [scene]);
  const objects = useMemo(() => [{ object: group }], [group]);
  const frame = useCallback(() => climbPlaceFrame(place), [place]);
  if (!place) return null;
  /* Место — кусок настоящей карты кругом: внутри всё целое, за кругом чёрная пустота с мягким краем (20.10.2026). */
  return <ModelStage loadKit="climb" ref={stageRef} scene={place.scene.url} look={look} frame={frame} frameKey={place.id} edgeFade={climbPlaceEdge(place)} objects={objects} insideFocus={focus} shadows={false} onCamera={onCamera} label={label} />;
}
