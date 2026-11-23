import { useEffect, useState } from "react";
import {
  detectInstallations,
  hasDesktopBridge,
  listGameBeards,
  readGameBeardPicture,
} from "../../api.js";
import { tr } from "../../locales/ui.js";
import { gameBeardItem, gameBeardTargets } from "./game-beard-items.js";

/*
 * Данные «Бород игры» для окна «На что поставить?» (Ц3в, 16.11.2026): список штатных бород из игры этого ПК (`listGameBeards`, только чтение) и картинки их листов (`readGameBeardPicture`).
 * Без Astral Desktop или без игры — пусто, окно чип не показывает. Лист — прозрачный рисунок на лице; на плитке он окрашен спокойным цветом по умолчанию (`tint` ответа), чтобы читался на тёмной плитке.
 * Картинки читаются по одной, пока окно открыто на нужной вкладке; адреса отпускаются при закрытии окна.
 */

/** PNG листа → адрес картинки, окрашенной в `tint` (`source-in`: форма листа, цвет игры по умолчанию); нет холста (тесты) — лист как есть. */
async function tintedUrl(bytes, tint) {
  const plain = new Blob([bytes], { type: "image/png" });
  try {
    if (
      typeof createImageBitmap !== "function" ||
      typeof document === "undefined"
    )
      return URL.createObjectURL(plain);
    const bitmap = await createImageBitmap(plain);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) return URL.createObjectURL(plain);
    context.drawImage(bitmap, 0, 0);
    context.globalCompositeOperation = "source-in";
    context.fillStyle = tint || "#3a2218";
    context.fillRect(0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    return URL.createObjectURL(blob || plain);
  } catch {
    return URL.createObjectURL(plain);
  }
}

/** Папка GTA V Legacy, найденная Astral (как у «Животных»): `""`, пока не нашлась. */
function useGameRoot(enabled) {
  const [gameRoot, setGameRoot] = useState("");
  useEffect(() => {
    if (!enabled || !hasDesktopBridge()) return undefined;
    let cancelled = false;
    detectInstallations()
      .then((games) => {
        if (cancelled) return;
        const legacy = (Array.isArray(games) ? games : []).find(
          (item) =>
            item?.path &&
            String(item.edition || "Legacy").toLowerCase() === "legacy",
        );
        if (legacy) setGameRoot(legacy.path);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return gameRoot;
}

const NONE = Object.freeze({ beards: [], previews: {} });

/**
 * `enabled` — окно у модели бороды или усов на вкладке «GTA» (иначе ничего не читается). Отдаёт `{ beards, items }`: записи `listGameBeards` (все) и вещи окна для плиток (только цели, с картинками по мере
 * чтения; названия — на языке окна).
 */
export function useGameBeards(enabled) {
  const gameRoot = useGameRoot(enabled);
  const [loaded, setLoaded] = useState(NONE);
  useEffect(() => {
    if (!enabled || !gameRoot) {
      setLoaded(NONE);
      return undefined;
    }
    let cancelled = false;
    const urls = [];
    listGameBeards({ gameRoot })
      .then(async (answer) => {
        const beards = Array.isArray(answer?.beards) ? answer.beards : [];
        if (cancelled) return;
        setLoaded({ beards, previews: {} });
        for (const beard of gameBeardTargets(beards)) {
          if (cancelled) return;
          try {
            const picture = await readGameBeardPicture({
              gameRoot,
              key: beard.key,
            });
            if (cancelled) return;
            const url = await tintedUrl(picture.bytes, picture.tint);
            if (cancelled) {
              URL.revokeObjectURL(url);
              return;
            }
            urls.push(url);
            setLoaded((now) => ({
              ...now,
              previews: { ...now.previews, [beard.key]: url },
            }));
          } catch {
            /* Нет картинки у номера — плитка без неё, выбор не мешает. */
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [enabled, gameRoot]);
  /* Названия — на языке окна на каждый кадр (окно подписано на смену языка, `useTr`): девятнадцать плиток не стоят замера. */
  const items = gameBeardTargets(loaded.beards).map((beard) =>
    gameBeardItem(beard, {
      title: `${tr(beard.shape === "moustache" ? "Усы игры" : "Борода игры")} №${beard.number}`,
      preview: loaded.previews[beard.key] || "",
    }),
  );
  return { beards: loaded.beards, items, gameRoot };
}
