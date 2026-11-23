import { tr } from "../../../locales/ui.js";
import { sanitizeDesktopErrorMessage, readSkyTextures } from "../../../api.js";
import { useState, useEffect } from "react";

const PNG = { type: "image/png" };

function view(status, images = null, message = "") {
  return { status, images, message };
}

const useSkyTextures = (gameRoot) => {
  const [state, setState] = useState(view("idle"));

  useEffect(() => {
    if (gameRoot) {
      // Картинки создаются по одной. ImageBitmap держит память вне кучи: созданные закрываем
      // вручную при выходе, а запоздавшую после отмены — сразу.
      let cancelled = false;
      const images = {};
      const load = async () => {
        try {
          const { textures } = (await readSkyTextures({ gameRoot })) ?? {};
          if (cancelled) return;
          if (!textures) {
            setState(view("unavailable", null, tr("Луна и звёзды доступны в приложении Astral")));
            return;
          }
          for (const slot of Object.keys(textures)) {
            const blob = new Blob([textures[slot]], PNG);
            const bitmap = await createImageBitmap(blob);
            if (cancelled) return bitmap.close?.();
            images[slot] = bitmap;
          }
          setState(view("game", images));
        } catch (error) {
          if (!cancelled) setState(view("failed", null, sanitizeDesktopErrorMessage(error)));
        }
      };
      setState(view("loading"));
      load();
      return () => {
        cancelled = true;
        Object.values(images).forEach((bitmap) => bitmap.close?.());
      };
    }
    setState(view("unavailable", null, tr("Подключите GTA V — луна и звёзды возьмутся из неё")));
    return undefined;
  }, [gameRoot]);

  return state;
};

export default useSkyTextures;
