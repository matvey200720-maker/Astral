/*
 * Данные редактора «Животные» (05.11.2026): игра человека, какие животные в ней есть и тело выбранного животного.
 *
 * Тело читает поток чтения игры (`apps/desktop/src/animals/animal-reads.js`): GLB с сетками и листами цвета из файлов
 * `x64e.rpf`. Прочитанное окно держит несколько штук — переключение между соседями в списке не ждёт чтения. Без Astral Desktop
 * (браузер, песочница) файлов игры нет: окно честно говорит, что кадр постановочный.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ANIMALS } from "@modovik/climb-contract/animals";
import { detectInstallations, hasDesktopBridge, listAnimals, readAnimal } from "../../../api.js";

/** Папка GTA V Legacy, найденная Astral: `""`, пока не нашлась. */
export function useGameRoot() {
  const [gameRoot, setGameRoot] = useState("");
  useEffect(() => {
    let cancelled = false;
    detectInstallations()
      .then((games) => {
        if (cancelled) return;
        const legacy = (Array.isArray(games) ? games : []).find((item) => item?.path && String(item.edition || "Legacy").toLowerCase() === "legacy");
        if (legacy) setGameRoot(legacy.path);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return [gameRoot, setGameRoot];
}

/**
 * Какие животные каталога лежат в игре. `status`: `loading`, `ready` (`present` — множество id), `staged` (игры нет:
 * показываем весь каталог без моделей), `error`.
 */
export function useAnimalList(gameRoot) {
  const [state, setState] = useState({ status: hasDesktopBridge() ? "loading" : "staged", present: null, reason: "" });
  useEffect(() => {
    if (!hasDesktopBridge()) {
      setState({ status: "staged", present: null, reason: "" });
      return undefined;
    }
    if (!gameRoot) {
      setState({ status: "staged", present: null, reason: "" });
      return undefined;
    }
    let cancelled = false;
    setState((current) => ({ ...current, status: "loading" }));
    listAnimals({ gameRoot })
      .then((answer) => {
        if (cancelled) return;
        if (!answer) setState({ status: "staged", present: null, reason: "" });
        else setState({ status: "ready", present: new Set(answer.animals.filter((item) => item.present).map((item) => item.id)), reason: "" });
      })
      .catch((error) => {
        if (!cancelled) setState({ status: "error", present: null, reason: String(error?.message || error) });
      });
    return () => {
      cancelled = true;
    };
  }, [gameRoot]);
  return state;
}

/** Каталог с учётом того, что нашлось в игре: нет игры — все, есть — только найденные. */
export function useShownAnimals(list) {
  return useMemo(() => (list.present ? ANIMALS.filter((animal) => list.present.has(animal.id)) : ANIMALS), [list.present]);
}

/* Прочитанные тела: не больше шести, давно не открывавшиеся уходят первыми. Ключ — игра и животное. */
const KEEP = 6;
const cache = new Map();
const flights = new Map();

function remember(key, value) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > KEEP) cache.delete(cache.keys().next().value);
}

/** Прочитать тело животного (или взять уже прочитанное). */
export function loadAnimal(gameRoot, id) {
  const key = `${gameRoot}|${id}`;
  if (cache.has(key)) {
    const value = cache.get(key);
    remember(key, value);
    return Promise.resolve(value);
  }
  if (!flights.has(key))
    flights.set(
      key,
      readAnimal({ gameRoot, id })
        .then((value) => {
          if (value) remember(key, value);
          return value;
        })
        .finally(() => flights.delete(key)),
    );
  return flights.get(key);
}

/** Тело выбранного животного: `{ status: "idle|loading|ready|error|staged", model, reason }`. */
export function useAnimalModel(gameRoot, id) {
  const [state, setState] = useState({ status: "idle", model: null, reason: "", id: "" });
  const latest = useRef(0);
  useEffect(() => {
    const ticket = ++latest.current;
    if (!id) {
      setState({ status: "idle", model: null, reason: "", id: "" });
      return undefined;
    }
    if (!hasDesktopBridge() || !gameRoot) {
      setState({ status: "staged", model: null, reason: "", id });
      return undefined;
    }
    setState((current) => ({ status: "loading", model: current.id === id ? current.model : null, reason: "", id }));
    loadAnimal(gameRoot, id)
      .then((model) => {
        if (latest.current !== ticket) return;
        setState(model ? { status: "ready", model, reason: "", id } : { status: "staged", model: null, reason: "", id });
      })
      .catch((error) => {
        if (latest.current === ticket) setState({ status: "error", model: null, reason: String(error?.message || error), id });
      });
    return () => {
      latest.current += 1;
    };
  }, [gameRoot, id]);
  return state;
}

/** Забыть прочитанное (после смены игры). */
export const forgetAnimals = () => cache.clear();

/** Стабильный обработчик для подписок сцены. */
export function useLatest(value) {
  const ref = useRef(value);
  ref.current = value;
  return useCallback(() => ref.current, []);
}
