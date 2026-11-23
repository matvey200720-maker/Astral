/*
 * Звезда GTA5RP в кадре: та же сетка, что соберёт установщик
 * (`arenaStarModel` договора), та же подставка и то же движение
 * (`arenaStarMotion`). Фигура — своя картинка листом (развёртка — доли
 * картинки), подставка — графит. Фигура и подставка — две сетки: двигается
 * только фигура, как в игре (подставка привязана к корню скелета).
 */

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { ARENA_STAR_STAND_COLOUR, arenaStarModel, arenaStarMotion } from "@modovik/climb-contract/recolor/arena-star";

/* Маске хватает 512 px по длинной стороне: клеток у неё не больше 96. */
const MASK_SIDE = 512;

/** Пиксели картинки звезды по адресу: `{ rgba, width, height, canvas }` или `null`. */
export function useStarPixels(url) {
  const [pixels, setPixels] = useState(null);
  useEffect(() => {
    if (!url) {
      setPixels(null);
      return undefined;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const scale = Math.min(1, MASK_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      let context = null;
      try {
        context = canvas.getContext("2d", { willReadFrequently: true });
      } catch {
        context = null;
      }
      if (!context) return;
      context.drawImage(image, 0, 0, width, height);
      const data = context.getImageData(0, 0, width, height);
      setPixels({ rgba: data.data, width, height, canvas });
    };
    image.onerror = () => {
      if (!cancelled) setPixels(null);
    };
    image.src = url;
    return () => {
      cancelled = true;
    };
  }, [url]);
  return pixels;
}

function geometryOf(mesh, [start, count]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices.slice(start, start + count), 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Звезда как объект кадра: `{ object, update, standHeight }` или `null`.
 * `place` — точка статуи в сцене (низ, середина), `yaw` — куда смотрит
 * лицо (поворот вокруг Z), `settings` — раздел `star` работы. Объект
 * освобождается сам, когда меняется картинка или облик.
 */
export function useArenaStarObject({ pixels, place, yaw, settings }) {
  const shape = settings ? `${settings.size}|${settings.depth}|${settings.stand}` : "";
  const built = useMemo(() => {
    if (!pixels || !settings || !place) return null;
    const model = arenaStarModel(pixels.rgba, pixels.width, pixels.height, { size: settings.size, depth: settings.depth, stand: settings.stand });
    if (!model) return null;
    const { mesh } = model;
    const texture = new THREE.CanvasTexture(pixels.canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    /* Развёртка — доли картинки сверху вниз, как строки листа игры. */
    texture.flipY = false;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    const figureMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.55, metalness: 0.08 });
    const standMaterial = new THREE.MeshStandardMaterial({ color: ARENA_STAR_STAND_COLOUR, roughness: 0.42, metalness: 0.35 });
    const figure = new THREE.Mesh(geometryOf(mesh, mesh.groups.star), figureMaterial);
    const stand = new THREE.Mesh(geometryOf(mesh, mesh.groups.stand), standMaterial);
    for (const item of [figure, stand]) {
      item.castShadow = true;
      item.receiveShadow = true;
    }
    const group = new THREE.Group();
    /* Щелчок по своей звезде открывает «Звезду» (`arena-pick.js`): плашка кадра называет себя, как плашки полотен и своих моделей. */
    group.userData.pick = { kind: "star" };
    group.add(figure);
    if (mesh.groups.stand[1]) group.add(stand);
    group.position.set(place[0], place[1], place[2]);
    group.rotation.z = yaw;
    const dispose = () => {
      figure.geometry.dispose();
      stand.geometry.dispose();
      figureMaterial.dispose();
      standMaterial.dispose();
      texture.dispose();
    };
    return { group, figure, dispose, standHeight: mesh.standHeight };
    // Сетка меняется картинкой и формой, а не скоростью или высотой движения.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixels, shape, place?.join(","), yaw]);
  useEffect(() => () => built?.dispose(), [built]);

  const motionKey = settings ? `${settings.animation}|${settings.speed}|${settings.height}` : "";
  return useMemo(() => {
    if (!built) return null;
    const motion = arenaStarMotion(settings);
    const update = motion.period
      ? (seconds) => {
          const { lift, angle } = motion.at(seconds);
          built.figure.position.z = lift;
          built.figure.rotation.z = angle;
        }
      : null;
    if (!update) {
      built.figure.position.z = 0;
      built.figure.rotation.z = 0;
    }
    return { object: built.group, update, standHeight: built.standHeight };
    // Движение меняется своими полями, а не новым объектом работы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, motionKey]);
}
