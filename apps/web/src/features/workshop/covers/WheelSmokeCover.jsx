import { useEffect, useMemo, useRef, useState } from "react";
import { parseWheelSmokeProject, wheelSmokeSignature } from "@modovik/ptfx-studio/wheel-smoke.js";
import { useTr } from "../../../locales/ui.js";
import { useCoverPending } from "./cover-bake-context.js";
import { parseCoverState } from "./cover-data.js";
import { readCoverFrame, writeCoverFrame } from "./cover-frames.js";

/*
 * Обложка «Дыма из-под колёс» (ТЗ 11.10.2026, вечер) — кадр редактора: та
 * же машина на матовом полу и тот же дым из-под задних колёс, снятый той же
 * сценой (`wheel-smoke-scene.js`) один раз и хранимый между запусками
 * (`cover-frames.js`) под ключом из отпечатка работы. Пока своего дыма нет —
 * дым игры, «как в игре»; поставил своё — обложка показывает его.
 *
 * Дым — правила ядра игрока: без игры (браузер, игра не найдена) в кадре
 * только машина, и такой кадр помнится отдельно — подключат игру, обложка
 * снимется с дымом. Пока кадр снимается, на месте плитки — матовая плашка
 * обложки (`editor-covers.css`).
 */

const FRAME = Object.freeze({ width: 640, height: 360 });
/* Версия съёмки: поменялись сцена или рамка — старый кадр не найдётся. */
const STAMP = "wheel-smoke-5"; // 5 — фон пола чёрный (18.10.2026)
const frames = new Map();
const capturing = new Map();

const idle = () =>
  new Promise((resolve) => {
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(() => resolve(), { timeout: 1500 });
    else window.setTimeout(resolve, 200);
  });
const pause = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

/* Кадр на отдельном холсте: машина доехала, листы игры загрузились, дым в разгаре — снимок и освобождение WebGL. */
async function renderFrame(project, base, car) {
  const { createWheelSmokeScene } = await import("../wheel-smoke-editor/wheel-smoke-scene.js");
  const canvas = document.createElement("canvas");
  /* Свой контекст: кадр снимается до пяти секунд, а рендерер окна держит один хозяин. */
  const scene = createWheelSmokeScene({ canvas, share: false });
  try {
    scene.resize(FRAME.width, FRAME.height, 1);
    scene.setProject(project);
    scene.setBase(base);
    scene.setCar(car);
    /* Дым работы — сразу, а не по таймеру ползунка; ждать — машину и листы. */
    scene.flush();
    for (let wait = 0; wait < 60; wait += 1) {
      await pause(80);
      scene.renderNow();
      if (scene.ready()) break;
    }
    scene.advance(0.4);
    scene.renderNow();
    return canvas.toDataURL("image/webp", 0.86);
  } finally {
    scene.dispose();
  }
}

function capture(signature, project) {
  if (frames.has(signature)) return Promise.resolve(frames.get(signature));
  if (capturing.has(signature)) return capturing.get(signature);
  const job = (async () => {
    /* Лучший кадр — с дымом игры и её машиной: он и ищется первым. */
    const best = `wheel-smoke:${STAMP}:${signature}:base:car`;
    const kept = await readCoverFrame(best);
    if (kept) return kept;
    await idle();
    const { findLegacyRoot, loadWheelSmokeBase, loadWheelSmokeCar } = await import("../wheel-smoke-editor/wheel-smoke-base.js");
    const root = await findLegacyRoot();
    const base = root ? await loadWheelSmokeBase(root).catch(() => null) : null;
    const car = root ? await loadWheelSmokeCar(root).catch(() => null) : null;
    const key = `wheel-smoke:${STAMP}:${signature}:${base ? "base" : "plain"}:${car ? "car" : "wheels"}`;
    if (key !== best) {
      const keptOther = await readCoverFrame(key);
      if (keptOther) return keptOther;
    }
    const url = await renderFrame(project, base, car);
    void writeCoverFrame(key, url);
    return url;
  })()
    .then((url) => {
      frames.set(signature, url);
      return url;
    })
    .finally(() => capturing.delete(signature));
  capturing.set(signature, job);
  return job;
}

export default function WheelSmokeCover({ state = null }) {
  useTr();
  const project = useMemo(() => parseWheelSmokeProject(parseCoverState(state) || {}), [state]);
  const signature = useMemo(() => wheelSmokeSignature(project), [project]);
  const [frame, setFrame] = useState(() => frames.get(signature) || "");
  const mounted = useRef(true);
  /* Кадр снимается — печь обложек ждёт его, а не пустую плашку. */
  const [gaveUp, setGaveUp] = useState("");
  useCoverPending(!frame && gaveUp !== signature);
  useEffect(() => {
    mounted.current = true;
    if (frames.has(signature)) {
      setFrame(frames.get(signature));
      return undefined;
    }
    capture(signature, project)
      .then((url) => mounted.current && (url ? setFrame(url) : setGaveUp(signature)))
      .catch(() => {
        /* WebGL не завёлся — остаётся матовая плашка обложки. */
        if (mounted.current) setGaveUp(signature);
      });
    return () => {
      mounted.current = false;
    };
    // Ключ — отпечаток работы: проект к нему привязан.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  if (!frame) return <span className="workshop-cover-canvas" aria-hidden="true" />;
  return (
    <img
      className="workshop-cover-image"
      src={frame}
      alt=""
      draggable="false"
    />
  );
}
