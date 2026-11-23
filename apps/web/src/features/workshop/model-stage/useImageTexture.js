/*
 * Картинка человека (эмблема, надпись, своя текстура) как текстура кадра:
 * пиксели как есть, без переворота — так их пишет в лист установщик.
 */

import { useEffect, useState } from "react";
import * as THREE from "three";

/** Текстура по адресу картинки (`blob:`/`data:`) или `null`, пока её нет. */
export function useImageTexture(url, { repeat = false } = {}) {
  const [texture, setTexture] = useState(null);
  useEffect(() => {
    if (!url) {
      setTexture(null);
      return undefined;
    }
    let cancelled = false;
    let loaded = null;
    new THREE.TextureLoader().load(url, (value) => {
      if (cancelled) {
        value.dispose();
        return;
      }
      value.colorSpace = THREE.NoColorSpace;
      value.flipY = false;
      if (repeat) {
        value.wrapS = THREE.RepeatWrapping;
        value.wrapT = THREE.RepeatWrapping;
      }
      value.anisotropy = 4;
      value.needsUpdate = true;
      loaded = value;
      setTexture(value);
    });
    return () => {
      cancelled = true;
      loaded?.dispose();
    };
  }, [url, repeat]);
  return texture;
}
