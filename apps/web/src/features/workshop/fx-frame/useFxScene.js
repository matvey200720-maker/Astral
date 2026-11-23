/*
 * Сцена кадра игры для режима редактора (`docs/fx-scenes.md`): список сцен из манифеста и загруженная выбранная.
 * Все сцены сняты с карабином: оружие, выбранное в редакторе, сцену не меняет — трассер любого ствола показывается на сцене карабина.
 *
 *   off      — выключено (`enabled: false`);
 *   loading  — читаем манифест или файлы сцены (`progress` — сколько файлов из скольких уже скачано);
 *   none     — для режима сцен нет (набор не выложен, нет медиа-хоста, CDN недоступен) — редактор остаётся со своим кадром;
 *   error    — файлы сцены не прошли проверку (`error` — словами);
 *   ready    — `frame` готов к `frame-stage.setFrame`.
 *
 * Пока грузится первая сцена, кадра нет (`frame: null`), и хозяин показывает экран загрузки, а не прежнюю сцену редактора. Когда соседняя сцена
 * того же режима грузится вместо готовой (переключили «в тело» / «в голову», «вблизи» / «вдали», ракурс), прежний кадр остаётся на экране, а поверх
 * него встаёт тонкая полоса загрузки (`switching`).
 *
 * `bone` выбирает сцену попадания («в тело» — `chest`, «в голову» — `head`). `view` и `distance` — желаемый ракурс (`side` / `third` / `first`) и
 * расстояние («вблизи» / «вдали», у `hit`); если такого в наборе нет, берётся соседний (`chooseView`, `chooseDistance`), а что есть, лежит в
 * `choices` — по нему редактор рисует переключатели (их нет, пока выбирать не из чего). Набор до ракурсов (записи без `view`) — это вид сбоку.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sceneChoices, viewOf } from "@modovik/fx-scenes/format.js";
import { frameSource } from "./frame-loader.js";

/** Какой ракурс показать: желаемый, если он есть в наборе; иначе третье лицо (так снимали для владельца), иначе первый из имеющихся. */
export function chooseView(wanted, views) {
  if (!views.length) return null;
  if (wanted && views.includes(wanted)) return wanted;
  return views.includes("third") ? "third" : views[0];
}

/** Какое расстояние показать: желаемое, если есть; иначе «вблизи», иначе первое из имеющихся; `null`, если у сцен расстояния нет. */
export function chooseDistance(wanted, distances) {
  if (!distances.length) return null;
  if (wanted && distances.includes(wanted)) return wanted;
  return distances.includes("close") ? "close" : distances[0];
}

const EMPTY = Object.freeze([]);

/**
 * @param {object} options
 * @param {boolean} [options.strict] — ракурс только тот, что просили: нет такой сцены — `none` (прежняя сцена редактора), а не соседний ракурс. Нужен экранным попаданиям: у
 *   каждого вида свои числа следа, и первое лицо нельзя показать на кадре от третьего.
 */
export function useFxScene({ mode, bone, view: wantedView, distance: wantedDistance, strict = false, enabled = true, source = null }) {
  const [list, setList] = useState({ key: "", all: [] });
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState({ id: "", frame: null, error: "" });
  const [progress, setProgress] = useState({ id: "", done: 0, total: 0 });
  const key = `${mode}|${bone || ""}`;
  const frames = source || frameSource();

  /* Все сцены режима (и кость); ракурс и расстояние выбираются из них без нового запроса. */
  useEffect(() => {
    if (!enabled) return undefined;
    let current = true;
    setIndex(0);
    frames
      .list({ mode, bone })
      .then((all) => current && setList({ key, all }))
      .catch(() => current && setList({ key, all: [] }));
    return () => {
      current = false;
    };
  }, [enabled, frames, key, mode, bone]);

  const all = list.key === key ? list.all : EMPTY;
  const choices = useMemo(() => sceneChoices(all), [all]);
  const view = strict ? (choices.views.includes(wantedView) ? wantedView : null) : chooseView(wantedView, choices.views);
  const distances = useMemo(() => sceneChoices(all, { view }).distances, [all, view]);
  const distance = chooseDistance(wantedDistance, distances);
  const entries = useMemo(() => all.filter((entry) => viewOf(entry) === view && (!distance || entry.distance === distance)), [all, view, distance]);
  const entry = entries[Math.min(index, entries.length - 1)] || null;

  /* Другой ракурс или расстояние — с первой сцены списка. */
  useEffect(() => {
    setIndex(0);
  }, [view, distance]);

  /* Файлы выбранной сцены. */
  useEffect(() => {
    if (!enabled || !entry) return undefined;
    let current = true;
    setProgress({ id: entry.id, done: 0, total: Object.keys(entry.files).filter((name) => name !== "stencil.png").length });
    frames
      .load(entry, { onProgress: (done, total) => current && setProgress({ id: entry.id, done, total }) })
      .then((frame) => current && setLoaded({ id: entry.id, frame, error: "" }))
      .catch((error) => current && setLoaded({ id: entry.id, frame: null, error: String(error?.message || error) }));
    return () => {
      current = false;
    };
  }, [enabled, frames, entry]);

  const select = useCallback((next) => setIndex(Math.max(0, next)), []);
  const listed = list.key === key;
  let status = "loading";
  if (!enabled) status = "off";
  else if (listed && !entries.length) status = "none";
  else if (entry && loaded.id === entry.id) status = loaded.frame ? "ready" : "error";
  const frame = status === "ready" || status === "loading" ? loaded.frame : null;
  /* Пока читается список соседнего режима (сменили кость «в тело» → «в голову»), переключатели не мигают: остаются такими, какими были. */
  const shown = useRef({ view: null, distance: null, views: EMPTY, distances: EMPTY });
  if (listed) shown.current = { view, distance, views: choices.views, distances };
  return {
    status,
    entries,
    entry,
    index: Math.min(index, Math.max(0, entries.length - 1)),
    select,
    /* Пока грузится соседняя сцена режима, прежний кадр остаётся на экране: холст не мигает. */
    frame,
    error: status === "error" ? loaded.error : "",
    /* Ракурс и расстояние, что на экране (или грузятся), и что можно выбрать. */
    view: shown.current.view,
    distance: shown.current.distance,
    choices: { views: shown.current.views, distances: shown.current.distances },
    /* Идёт загрузка: нет кадра совсем (экран загрузки) или он есть, а грузится соседний (`switching` — полоса поверх прежнего). */
    loading: status === "loading",
    switching: status === "loading" && Boolean(frame),
    /* Сколько файлов выбранной сцены скачано из скольких; пока список сцен читается, `known` — `false`. */
    progress: { known: Boolean(entry), done: progress.id === entry?.id ? progress.done : 0, total: progress.id === entry?.id ? progress.total : 0 },
  };
}
