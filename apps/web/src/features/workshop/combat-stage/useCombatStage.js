/*
 * Общая часть экранов 3D-сцены боя (задача 4А, 18.10.2026): холст и размер,
 * ворота внимания, база эффектов, персонаж и ствол из игры, ракурс, дистанция,
 * темп стрельбы и скорость кадра. Экран режима (попадания, трейсеры) добавляет
 * своё — зоны и метку, след и вспышку — поверх этой сцены.
 *
 * Сцена создаётся один раз на холст; всё, что меняется, доходит до неё
 * эффектами по отдельности, чтобы смена ракурса не пересобирала эффект, а
 * правка эффекта не трогала камеру.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRememberedState } from "../../../section-memory.js";
import { ATTENTION_HIDDEN, useAttention, useFrameGate } from "../../../attention.js";
import { SEPARATION } from "./combat-layout.js";
import { combatBodiesAvailable, combatDecalsReadable, loadCombatBodies, loadCombatDecalData } from "./combat-bodies.js";

/**
 * @param {object} options
 * @param {(canvas: HTMLCanvasElement, callbacks: object) => object} options.createScene — сцена режима
 * @param {string} options.memory — приставка ключей памяти экрана («impact», «tracer»)
 * @param {{near: number, far: number}} [options.separations] — расстояние боя «вблизи / вдали», м
 * @param {object|null} options.base — база эффектов из игры игрока (`readPtfxBase`)
 * @param {boolean} [options.baseLoading]
 * @param {boolean} [options.paused] — извне: кадр стоит
 * @param {() => void} [options.onFrame] — после каждого кадра сцены
 * @param {(canvas: HTMLCanvasElement) => void} [options.onDraw] — после рисования кадра, пока холст хранит картинку
 * @param {string} [options.defaultView] — ракурс по умолчанию («shooter» у попаданий, «third» у следов урона)
 * @param {string} [options.view] — ракурс извне (его хранит редактор, например «от третьего лица»): тогда свой не нужен
 * @param {string} [options.gameRoot] — папка игры, если редактор знает её раньше базы эффектов
 * @param {(zoneId: string) => void} [options.onPick] — щелчок по телу
 * @param {boolean} [options.withDecals] — режиму нужны раны и кровь (попадания, килл): данные читаются только тогда
 * @param {{style?: string, speed?: number}} [options.shooting] — темп и скорость стрельбы, заданные экраном: у попаданий параметров кадра нет (20.10.2026), и память прежних значений не в счёт
 */
export function useCombatStage({
  createScene,
  memory,
  separations = SEPARATION,
  base,
  baseLoading = false,
  paused = false,
  onFrame = null,
  onDraw = null,
  defaultView = "shooter",
  view: viewFromOutside = "",
  gameRoot: gameRootFromOutside = "",
  onPick = null,
  withDecals = false,
  shooting = null,
}) {
  const canvasRef = useRef(null);
  const layersRef = useRef(null);
  const sceneRef = useRef(null);
  const frameRef = useRef(onFrame);
  frameRef.current = onFrame;
  const drawRef = useRef(onDraw);
  drawRef.current = onDraw;
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const createRef = useRef(createScene);
  createRef.current = createScene;
  const [sceneState, setSceneState] = useState({ ready: false, failed: false, failures: [] });
  const [actors, setActors] = useState({ state: "idle", message: "" });
  /* Раны и кровь из игры: листы и числа системы повреждений педа (`combat-decals.js`). */
  const [decals, setDecals] = useState({ state: "idle" });
  const [camera, setCamera] = useState({ mode: "inside", speed: 1 });
  const [ownView, setView] = useRememberedState(`effects:${memory}-view`, defaultView);
  const view = viewFromOutside || ownView;
  const [distance, setDistance] = useRememberedState(`effects:${memory}-distance`, "near");
  const [ownStyle, setStyle] = useRememberedState(`effects:${memory}-style`, "burst");
  const [ownSpeed, setSpeed] = useRememberedState(`effects:${memory}-speed`, 1);
  const style = shooting?.style ?? ownStyle;
  const speed = shooting?.speed ?? ownSpeed;
  const [stopped, setStopped] = useState(false);

  /* Сцена — WebGL. Без него (тесты в jsdom, отключённое ускорение) кадр пуст,
     а подпись говорит почему. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let scene = null;
    try {
      scene = createRef.current(canvas, {
        onFrame: () => frameRef.current?.(),
        onDraw: (glCanvas) => drawRef.current?.(glCanvas),
        onCamera: (mode, info) => setCamera({ mode, speed: info?.speed ?? 1 }),
        onPick: (zoneId) => pickRef.current?.(zoneId),
      });
    } catch {
      setSceneState({ ready: false, failed: true, failures: [] });
      return undefined;
    }
    sceneRef.current = scene;
    /* Стенд разработки видит сцену: кадры, точки, камеру. */
    if (import.meta.env?.DEV) window.__astralCombatScene = scene;
    setSceneState({ ready: true, failed: false, failures: [] });
    const measure = () => {
      const box = canvas.getBoundingClientRect();
      scene.resize(box.width, box.height, Math.min(2, window.devicePixelRatio || 1));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(layersRef.current || canvas);
    measure();
    scene.start();
    return () => {
      observer.disconnect();
      sceneRef.current = null;
      scene.dispose();
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setBase(base);
  }, [base, sceneState.ready]);

  /* Персонаж и ствол — из игры игрока (только чтение). */
  const gameRoot = gameRootFromOutside || base?.gameRoot || "";
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return undefined;
    if (!gameRoot || !combatBodiesAvailable()) {
      void scene.setActors(null);
      setActors({ state: baseLoading ? "loading" : "missing", message: "" });
      return undefined;
    }
    let active = true;
    setActors({ state: "loading", message: "" });
    loadCombatBodies({ gameRoot })
      .then((bodies) => (active ? scene.setActors(bodies) : false))
      .then((done) => {
        if (active && done) setActors({ state: "ready", message: "" });
      })
      .catch((error) => {
        if (!active) return;
        void scene.setActors(null);
        setActors({ state: "failed", message: String(error?.message || error) });
      });
    return () => {
      active = false;
    };
  }, [gameRoot, baseLoading, sceneState.ready]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !withDecals) return undefined;
    if (!gameRoot || !combatDecalsReadable()) {
      scene.setDecalData(null);
      setDecals({ state: baseLoading ? "loading" : "missing" });
      return undefined;
    }
    let active = true;
    setDecals({ state: "loading" });
    loadCombatDecalData({ gameRoot })
      .then((raw) => {
        if (!active) return;
        scene.setDecalData(raw);
        setDecals({ state: scene.decalsReady ? "ready" : "failed" });
      })
      .catch(() => {
        if (!active) return;
        scene.setDecalData(null);
        setDecals({ state: "failed" });
      });
    return () => {
      active = false;
    };
  }, [gameRoot, baseLoading, sceneState.ready, withDecals]);

  /* Ворота внимания: свёрнутое окно и прокрученная за край сцена стоят. */
  const gateOpen = useFrameGate(layersRef);
  const attention = useAttention();
  useEffect(() => {
    sceneRef.current?.setPaused(paused || stopped || !gateOpen);
  }, [paused, stopped, gateOpen, sceneState.ready]);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (attention === ATTENTION_HIDDEN) scene.stop();
    else scene.start();
  }, [attention, sceneState.ready]);

  useEffect(() => {
    sceneRef.current?.setView(view);
  }, [view, actors.state, sceneState.ready]);
  useEffect(() => {
    sceneRef.current?.setSeparation(distance === "far" ? separations.far : separations.near);
  }, [distance, separations.far, separations.near, sceneState.ready]);
  useEffect(() => {
    sceneRef.current?.setShooting({ style });
  }, [style, sceneState.ready]);
  useEffect(() => {
    sceneRef.current?.setSpeed(speed);
  }, [speed, sceneState.ready]);

  /** Ошибки сборки эффекта, что сцена знает, — в состояние экрана. */
  const syncFailures = useCallback(() => {
    const failures = sceneRef.current?.failures || [];
    setSceneState((state) => (state.failures.join("\n") === failures.join("\n") ? state : { ...state, failures }));
  }, []);

  return {
    canvasRef,
    layersRef,
    sceneRef,
    sceneState,
    actors,
    decals,
    camera,
    view,
    setView,
    distance,
    setDistance,
    style,
    setStyle,
    speed,
    setSpeed,
    stopped,
    setStopped,
    syncFailures,
  };
}
