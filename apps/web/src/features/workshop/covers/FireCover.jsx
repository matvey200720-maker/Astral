import { useEffect, useMemo, useRef, useState } from "react";
import { usePtfxBase } from "../../../components/desktop/workshop/ptfx/ptfx-base-store.js";
import { useCoverPending, useCoverProvisional } from "./cover-bake-context.js";
import { parseEffectsState } from "./cover-data.js";
import { readCoverFrame, writeCoverFrame } from "./cover-frames.js";
import { useTr } from "../../../locales/ui.js";

/*
 * Обложка огня и взрывов — объёмный огонь редактора (задача 3 ТЗ 06.10.2026).
 *
 * Тот же кадр, что в самом редакторе: пожар игры (`fire_map` из ядра
 * игрока) в 3D на матовом фоне с сеткой, под правкой человека — снимает его
 * та же сцена (`ptfx/environment-scene.js`), один раз, и кадр хранится между
 * запусками (`cover-frames.js`) под ключом из отпечатка базы и правки.
 *
 * Пока кадра нет (браузер, игра не найдена, база ещё читается) плитка — тёмная
 * плашка без рисунка (владелец, 20.10.2026: «нарисованных обложек у этих
 * редакторов быть не должно»): выдуманное пламя на плитке выдавало бы себя за
 * огонь игры. Снятый кадр берётся из хранилища сразу, при следующих заходах.
 */

const FRAME = Object.freeze({ width: 640, height: 360 });
/* Версия съёмки: поменялись сцена или рамка — старый кадр не найдётся. */
const FIRE_COVER_STAMP = "fire3d-3"; // 3 — фон пола чёрный (18.10.2026)
const frames = new Map();
const capturing = new Map();

const idle = () =>
  new Promise((resolve) => {
    if (typeof window.requestIdleCallback === "function")
      window.requestIdleCallback(() => resolve(), { timeout: 1500 });
    else window.setTimeout(resolve, 200);
  });
const pause = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

function fingerprint(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

/*
 * Кадр пожара: сцена на отдельном холсте, листы игры загрузились, правка
 * легла, пламя разгорелось — снимок и сразу освобождение контекста WebGL.
 */
async function renderFire({ scene, light, environment }) {
  const { createEnvironmentScene } = await import(
    "../../../components/desktop/workshop/ptfx/environment-scene.js"
  );
  const canvas = document.createElement("canvas");
  /* Пламя — главный рисунок плитки: рамка ближе, чем в редакторе. */
  /* Свой контекст: рендерер окна держит один хозяин, обложка его не занимает. */
  const view = createEnvironmentScene({ canvas, zoom: 0.5, share: false });
  try {
    view.resize(FRAME.width, FRAME.height, 1);
    view.setBase(scene, light);
    view.setFamily("fire");
    view.setEnvironment(environment);
    for (let wait = 0; wait < 60; wait += 1) {
      view.renderNow();
      if (view.ready()) break;
      await pause(60);
    }
    view.advance(0.5);
    view.renderNow();
    return canvas.toDataURL("image/webp", 0.86);
  } finally {
    view.dispose();
  }
}

function captureFire(key, spec) {
  if (frames.has(key)) return Promise.resolve(frames.get(key));
  if (capturing.has(key)) return capturing.get(key);
  const job = (async () => {
    const stored = `fire:${key}:${FIRE_COVER_STAMP}`;
    const kept = await readCoverFrame(stored);
    if (kept) return kept;
    await idle();
    const url = await renderFire(spec);
    void writeCoverFrame(stored, url);
    return url;
  })()
    .then((url) => {
      frames.set(key, url);
      return url;
    })
    .finally(() => capturing.delete(key));
  capturing.set(key, job);
  return job;
}

export default function FireCover({ state = null }) {
  useTr();
  const environment = useMemo(() => parseEffectsState(state)?.environment || {}, [state]);
  /* Базу эффектов обложка не просит сама (бета 16.10.2026): печь обложек
     запекает её через пять секунд после старта, и чтение базы в главном
     процессе на нестандартных эффектах редукса роняло весь Astral на каждом
     запуске. Базу читают полка мастерской и редактор эффектов; есть она —
     обложка снимает пожар игры, нет — плитка остаётся тёмной плашкой. */
  const ptfx = usePtfxBase();
  const scene = ptfx.base?.environmentScene?.picks?.fire ? ptfx.base.environmentScene : null;
  const key = scene ? `${ptfx.fingerprint}:${fingerprint(JSON.stringify(environment))}` : "";
  const [frame, setFrame] = useState(() => (key && frames.get(key)) || "");
  const mounted = useRef(true);
  /* Печь обложек ждёт базу эффектов игры и кадр пожара; кадр не снялся (игры нет, WebGL не завёлся) — ждать нечего. */
  const [gaveUp, setGaveUp] = useState("");
  useCoverPending(ptfx.loading || (Boolean(key) && !frame && gaveUp !== key));
  /* Плашка без кадра — заглушка: игру ещё могут подключить, и запечённая на трое суток пустая плашка осталась бы вместо настоящего кадра. */
  const markProvisional = useCoverProvisional();
  const empty = !frame;
  useEffect(() => {
    markProvisional(empty);
  }, [markProvisional, empty]);
  useEffect(() => {
    mounted.current = true;
    if (!key) return undefined;
    if (frames.has(key)) {
      setFrame(frames.get(key));
      return undefined;
    }
    captureFire(key, { scene, light: ptfx.base?.light || null, environment })
      .then((url) => mounted.current && (url ? setFrame(url) : setGaveUp(key)))
      .catch(() => {
        /* WebGL не завёлся — остаётся тёмная плашка. */
        if (mounted.current) setGaveUp(key);
      });
    return () => {
      mounted.current = false;
    };
    // Ключ — отпечаток базы и правки: сцена и свет к нему привязаны.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!frame) return null;
  return (
    <img
      className="workshop-cover-image"
      src={frame}
      alt=""
      draggable="false"
    />
  );
}
