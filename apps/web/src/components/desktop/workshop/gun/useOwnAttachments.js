import { useCallback, useEffect, useRef } from "react";
import { readGameWeaponModel } from "../../../../api.js";

const GLB_MIME = "model/gltf-binary";

// Просит у Astral Desktop слой из одних обвесов и превращает байты в адрес blob:
async function buildLayer({ gameRoot, weaponId, attachments, looks }) {
  const query = { gameRoot, model: weaponId, attachments, attachmentsOnly: true };
  if (looks) query.looks = looks;
  const reply = await readGameWeaponModel(query);
  const url = URL.createObjectURL(new Blob([reply.bytes], { type: GLB_MIME }));
  return { url, parts: Array.isArray(reply.parts) ? reply.parts : [] };
}

// Обещания слоёв по id запроса; живёт столько же, сколько компонент
class LayerCache {
  #layers = new Map();

  obtain(request) {
    const { id } = request;
    const known = this.#layers.get(id);
    if (known) return known;

    const layer = buildLayer(request);
    this.#layers.set(id, layer);
    // Запись уходит раньше, чем отказ увидит вызывающий; чужую запись не трогаем
    layer.catch(() => {
      if (this.#layers.get(id) === layer) this.#layers.delete(id);
    });
    return layer;
  }

  // Кэш пустеет сразу, адреса отзываются по мере готовности обещаний
  release() {
    const layers = [...this.#layers.values()];
    this.#layers.clear();
    for (const layer of layers) {
      layer.then(
        ({ url }) => URL.revokeObjectURL(url),
        () => {},
      );
    }
  }
}

export function useOwnAttachments() {
  const cacheRef = useRef(null);
  if (cacheRef.current === null) cacheRef.current = new LayerCache();

  useEffect(() => {
    const cache = cacheRef.current;
    return () => cache.release();
  }, []);

  return useCallback((request) => cacheRef.current.obtain(request), []);
}
