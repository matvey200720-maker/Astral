/*
 * Значки карты из игры игрока для экрана «Иконки» (05.11.2026): таблица номеров, символов и клеток и атлас штатных клеток
 * одной картинкой — настоящие значки из его файлов. Читается один раз, когда инструмент открыт (чтение — полсекунды), и
 * держится, пока открыт редактор.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { blipIconsSupported, readBlipIcons } from "../../../../../api.js";
import { detectLegacyGame } from "../../../../../features/workshop/install-queue/game-root.js";
import { indexBlipState } from "./blip-icons-model.js";

const bytesOf = (base64) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
  return bytes;
};

const IDLE = Object.freeze({ status: "idle", reason: "", index: null, atlasUrl: "" });

/* Вид списка: «Иконки сервера» (по умолчанию) или «Все значки игры». Помнится на этом компьютере, как закладка в окне. */
export const BLIP_VIEW_KEY = "astral-map-icons-view";
const readView = () => {
  try {
    return window.localStorage.getItem(BLIP_VIEW_KEY) === "game" ? "game" : "server";
  } catch {
    return "server";
  }
};

/**
 * @param {boolean} active инструмент открыт — читать из игры
 * @returns {{ status: "idle"|"loading"|"ready"|"unsupported"|"error", reason: string, index: object|null, atlasUrl: string, reload: () => void, view: "server"|"game", setView: (view: "server"|"game") => void }}
 */
export function useBlipIconsState(active) {
  const [result, setResult] = useState(IDLE);
  const [view, setViewState] = useState(readView);
  const setView = useCallback((next) => {
    const value = next === "game" ? "game" : "server";
    setViewState(value);
    try {
      window.localStorage.setItem(BLIP_VIEW_KEY, value);
    } catch {
      /* закладку не запомнить — окно работает и без неё */
    }
  }, []);
  const urlRef = useRef("");
  const [round, setRound] = useState(0);
  const started = useRef(-1);
  const mounted = useRef(true);

  useEffect(() => {
    if (!active || started.current === round) return;
    started.current = round;
    if (!blipIconsSupported()) {
      setResult({ ...IDLE, status: "unsupported" });
      return;
    }
    setResult((current) => ({ ...current, status: "loading", reason: "" }));
    (async () => {
      try {
        const gameRoot = await detectLegacyGame();
        if (!gameRoot) throw new Error("");
        const state = await readBlipIcons({ gameRoot });
        if (!mounted.current) return;
        if (!state?.available) {
          setResult({ ...IDLE, status: "error", reason: String(state?.reason || "") });
          return;
        }
        const blob = state.atlas?.png ? new Blob([bytesOf(state.atlas.png)], { type: "image/png" }) : null;
        const atlasUrl = blob ? URL.createObjectURL(blob) : "";
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = atlasUrl;
        setResult({ status: "ready", reason: "", index: indexBlipState(state), atlasUrl });
      } catch (error) {
        if (mounted.current) setResult({ ...IDLE, status: "error", reason: String(error?.message || "") });
      }
    })();
  }, [active, round]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const reload = useCallback(() => setRound((value) => value + 1), []);
  return { ...result, reload, view, setView };
}
