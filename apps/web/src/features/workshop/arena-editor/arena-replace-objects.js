/*
 * Замена моделей сервера в кадре (Majestic, ТЗ 11.10.2026, ночь, задача 2).
 *
 * Своя модель встаёт туда же, куда её поставит игра: сетка вписана в рамку
 * прежней в её осях (`fitReplacementMesh` — та же функция, что у
 * установщика), а оси прежней модели в сцене — её расстановки из описи
 * (`arena-replace.js`: место и поворот каждой; у аирдропа их две). Прежняя
 * модель в кадре прячется (`arenaReplacedFiles` — по файлу материала сцены).
 * Сетка и лист своей модели читаются тем же хуком, что у «Моделей» мест.
 */

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { activeArenaReplacements, activeArenaSigns, fitReplacementMesh } from "@modovik/climb-contract/recolor/arena-replace";
import { usePlaceModelLooks } from "../models/usePlaceModelLooks.js";

/**
 * Что из моделей сервера в кадре спрятано: файлы целиком (свои модели или
 * «Убрать») — имена `.ydr`, и буквы надписи домика со своей надписью или
 * «Убрать» (ТЗ 12.10.2026) — `<файл>|<лист букв>`. Один `Set`.
 */
export function arenaReplacedFiles(server, settings) {
  return new Set([
    ...activeArenaReplacements(server, settings?.replace).map(({ replacement }) => `${replacement.model}.ydr`),
    ...activeArenaSigns(server, settings?.replace)
      .filter(({ spec }) => spec.texture)
      .map(({ spec, replacement }) => `${replacement.model}.ydr|${spec.texture}`),
  ]);
}

function replacementObject(look, entry, replacement) {
  const mesh = fitReplacementMesh(look.unit, replacement.bounds, entry);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  if (mesh.uvs) geometry.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs instanceof Float32Array ? mesh.uvs : Float32Array.from(mesh.uvs), 2));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices instanceof Uint32Array ? mesh.indices : Uint32Array.from(mesh.indices), 1));
  geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({
    map: look.texture || null,
    color: look.texture ? 0xffffff : 0xb8b8b8,
    transparent: look.alpha || look.opacity < 100,
    opacity: (look.opacity ?? 100) / 100,
    alphaTest: look.alpha ? 0.02 : 0,
    roughness: 0.7,
    metalness: 0,
    side: look.shape === "plate" ? THREE.DoubleSide : THREE.FrontSide,
    ...(look.glow > 0 && look.texture ? { emissive: 0xffffff, emissiveMap: look.texture, emissiveIntensity: look.glow / 100 } : {}),
  });
  const group = new THREE.Group();
  for (const placement of replacement.placements) {
    const copy = new THREE.Mesh(geometry, material);
    const [x, y, z, w] = placement.rotation;
    copy.quaternion.set(x, y, z, w);
    copy.position.set(...placement.position);
    copy.castShadow = true;
    copy.receiveShadow = true;
    copy.userData.pick = { kind: "replace", key: replacement.id, point: [...placement.position] };
    group.add(copy);
  }
  return {
    object: group,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** Свои модели вместо моделей сервера — объектами кадра: `[{ object, dispose }]`. */
export function useArenaReplacementObjects({ server, settings, active = true }) {
  const list = useMemo(
    () => (active ? activeArenaReplacements(server, settings?.replace).filter(({ entry }) => entry.mode === "model") : []),
    [server, settings?.replace, active],
  );
  /* Своя модель как модель «Моделей» мест: тот же облик (сетка, лист, форма). */
  const items = useMemo(() => list.map(({ id, entry }) => ({ ...entry.model, id, scene: "", position: [0, 0, 0], rotation: [0, 0, 0], size: 1, motion: "none" })), [list]);
  const looks = usePlaceModelLooks(items);
  const objects = useMemo(() => {
    const out = [];
    for (const { id, entry, replacement } of list) {
      const look = looks.find((item) => item.id === id);
      if (look?.unit) out.push(replacementObject(look, entry, replacement));
    }
    return out;
  }, [list, looks]);
  useEffect(() => () => objects.forEach((item) => item.dispose()), [objects]);
  return objects;
}
