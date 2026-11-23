/*
 * Сцена кадра помещения — от Astral Desktop (задача 5 ТЗ 11.10.2026).
 *
 * Помещение собирается целиком из файлов игры игрока в главном процессе
 * (`apps/desktop/src/recolor-shops-scene.js`) и держится в его кэше; окно
 * получает готовый файл сцены и отдаёт его общему кадру ссылкой `blob:` —
 * кадр грузит её, как сцены других наборов. Ссылка одна на помещение за
 * сеанс окна: повторное открытие — без сборки и без копии байт.
 */

import { useEffect, useState } from "react";
import { readShopScene } from "../../../api.js";
import { detectLegacyGame } from "../install-queue/game-root.js";
import { loadSceneAsset } from "../model-stage/scene-asset.js";

const sources = new Map();

/** Сцена помещения: обещание `{ url }` или `{ reason, desktop }` (без сцены). */
export function shopSceneSource(interiorId) {
  if (!interiorId) return Promise.resolve({ reason: "" });
  if (!sources.has(interiorId)) {
    const pending = (async () => {
      const gameRoot = await detectLegacyGame().catch(() => "");
      let answer = null;
      try {
        answer = await readShopScene({ interior: interiorId, gameRoot: gameRoot || undefined });
      } catch (error) {
        return { reason: String(error?.message || error || ""), desktop: true };
      }
      if (!answer) return { reason: "", desktop: false };
      if (!answer.scene) return { reason: answer.reason || "", desktop: true };
      return { url: URL.createObjectURL(new Blob([answer.scene], { type: "application/octet-stream" })) };
    })().then((result) => {
      /* Без сцены — не помним: игру могли подключить, следующий раз спросим заново. */
      if (!result.url && sources.get(interiorId) === pending) sources.delete(interiorId);
      return result;
    });
    sources.set(interiorId, pending);
  }
  return sources.get(interiorId);
}

/** Сцена помещения для кадра: `{ state: "loading" | "ready" | "missing", url, reason, desktop }`. */
export function useShopScene(interiorId) {
  const [result, setResult] = useState({ id: null, state: "loading", url: "", reason: "", desktop: true });
  useEffect(() => {
    let alive = true;
    shopSceneSource(interiorId).then((answer) => {
      if (!alive) return;
      setResult(
        answer.url
          ? { id: interiorId, state: "ready", url: answer.url, reason: "", desktop: true }
          : { id: interiorId, state: "missing", url: "", reason: answer.reason || "", desktop: answer.desktop !== false },
      );
    });
    return () => {
      alive = false;
    };
  }, [interiorId]);
  return result.id === interiorId ? result : { id: interiorId, state: "loading", url: "", reason: "", desktop: true };
}

/*
 * Модели замены (свои вещи на местах штатных): сцена моделей каталога
 * помещения, каждая своей частью, — кадр ставит их копиями на места
 * заменённых вещей. Набор моделей — ключ: та же замена — та же сцена.
 */
const pieces = new Map();
const PIECES_LIMIT = 8;

export function shopPiecesSource(interiorId, models) {
  const names = [...new Set(models || [])].sort();
  if (!interiorId || !names.length) return Promise.resolve({ asset: null });
  const key = `${interiorId}|${names.join(",")}`;
  if (!pieces.has(key)) {
    const pending = (async () => {
      const gameRoot = await detectLegacyGame().catch(() => "");
      const answer = await readShopScene({ interior: interiorId, gameRoot: gameRoot || undefined, models: names }).catch(() => null);
      if (!answer?.scene) return { asset: null };
      const url = URL.createObjectURL(new Blob([answer.scene], { type: "application/octet-stream" }));
      const asset = await loadSceneAsset(url).catch(() => null);
      URL.revokeObjectURL(url);
      return { asset };
    })().then((result) => {
      if (!result.asset && pieces.get(key) === pending) pieces.delete(key);
      return result;
    });
    pieces.set(key, pending);
    while (pieces.size > PIECES_LIMIT) pieces.delete(pieces.keys().next().value);
  }
  return pieces.get(key);
}

/** Сцена моделей замены: разобранная сцена (`asset`) или `null`, пока её нет. */
export function useShopPieces(interiorId, models) {
  const key = `${interiorId}|${[...new Set(models || [])].sort().join(",")}`;
  const [state, setState] = useState({ key: "", asset: null });
  useEffect(() => {
    let alive = true;
    shopPiecesSource(interiorId, models).then((result) => {
      if (alive) setState({ key, asset: result.asset });
    });
    return () => {
      alive = false;
    };
    // Набор моделей меняется ключом, а не новым массивом с теми же именами.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state.asset : null;
}

/* Для тестов: ссылки живут весь сеанс окна. */
export function forgetShopScenes() {
  sources.clear();
  pieces.clear();
}
