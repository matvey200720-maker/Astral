import { memo, useEffect, useRef, useState } from "react";
import { weaponCatalogSlots } from "../../../../catalog-taxonomy.js";
import { STAGE_IDLE, startStageLoop } from "../stage-loop.js";
import { loadPtfxBase, usePtfxBase } from "../ptfx/ptfx-base-store.js";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * Кадр стрельбища: ствол сбоку и выстрелы в такт звуку.
 *
 * Вспышка, дым и гильзы — частицы игры из базы эффектов игрока
 * (`readPtfxBase`, та же, что у «Огня и взрывов» и «Эффектов попадания»);
 * без игры их в кадре нет, и подпись студии это говорит.
 *
 * Сцена ничего не решает сама: когда стрелять, говорит проигрыватель звука
 * (`feed` — лента выстрелов на часах страницы, пополняется, пока идёт
 * стрельба), и вспышка встаёт ровно на выстрел. Модели нет — кадр честно
 * говорит об этом, а не подсовывает чужой ствол. Органы поверх кадра (выбор
 * ствола, «Огонь» — `StageBar`), полку стволов и подпись студия кладёт
 * детьми: они живут в той же пластине, во весь кадр каркаса.
 */

/** Есть ли у стрельбища эффекты игры: база прочитана и правила тира в ней собраны. */
export function useRangeEffects() {
  const { base } = usePtfxBase();
  return Boolean(base?.rangeScene?.exports?.length);
}

/* Модель ствола — та же, что в каталоге и мастерской оружия. */
export function weaponModelUrl(model) {
  if (!model) return "";
  const slot = weaponCatalogSlots.find((item) => item.id === model);
  return slot?.model || `/assets/catalog/weapons-3d/${model}.glb`;
}

function WeaponStage({ weapon, feed, children = null }) {
  useTr();
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const loopRef = useRef(null);
  /* Сцена: `pending` → `ready` или `failed` (нет WebGL). */
  const [scene, setScene] = useState("pending");
  /* Модель ствола: `loading` → `ready` или `missing`. */
  const [model, setModel] = useState("loading");
  const url = weaponModelUrl(weapon?.model);
  const { base } = usePtfxBase();

  /* База эффектов — одна на окно; здесь только просьба её прочитать. */
  useEffect(() => {
    loadPtfxBase().catch(() => {});
  }, []);

  /* Сцена одна на студию: ствол меняется загрузкой модели, а не новым
     WebGL-контекстом — их у браузера считанное число. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof window.WebGLRenderingContext === "undefined") {
      setScene("failed");
      return undefined;
    }
    let cancelled = false;
    let range = null;
    let observer = null;
    import("./weapon-range-scene.js")
      .then(({ createWeaponRange }) => {
        if (cancelled) return;
        try {
          range = createWeaponRange(canvas, { onChange: () => loopRef.current?.invalidate() });
        } catch {
          setScene("failed");
          return;
        }
        sceneRef.current = range;
        /* Стенд разработки видит сцену стрельбища. */
        if (import.meta.env?.DEV) window.__astralRange = range;
        range.resize();
        const loop = startStageLoop({
          element: canvas,
          frame: (time) => {
            const next = range.frame(time);
            return next === Number.POSITIVE_INFINITY ? STAGE_IDLE : next;
          },
          maxFps: 60,
        });
        loopRef.current = loop;
        observer = new ResizeObserver(() => {
          range.resize();
          loop.invalidate();
        });
        observer.observe(canvas);
        setScene("ready");
      })
      .catch(() => {
        if (!cancelled) setScene("failed");
      });
    return () => {
      cancelled = true;
      observer?.disconnect();
      loopRef.current?.stop();
      loopRef.current = null;
      range?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const range = sceneRef.current;
    if (scene !== "ready" || !range) return;
    range.setBase(base);
    loopRef.current?.invalidate();
  }, [scene, base]);

  /* Ствол — модель; без модели сцена стоит пустой с подписью. */
  useEffect(() => {
    const range = sceneRef.current;
    if (scene !== "ready" || !range) return undefined;
    if (!url) {
      setModel("missing");
      return undefined;
    }
    let cancelled = false;
    setModel("loading");
    range
      .load(url, { shells: weapon?.group !== "heavy", group: weapon?.group })
      .then(() => {
        if (cancelled) return;
        setModel("ready");
        loopRef.current?.invalidate();
      })
      .catch(() => {
        if (!cancelled) setModel("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [scene, url, weapon?.group]);

  /* Выстрелы — лентой от проигрывателя: расписание сцены пополняется, пока
     идёт стрельба, и очищается, когда её остановили. */
  useEffect(() => {
    if (!feed) return undefined;
    return feed.subscribe((message) => {
      const range = sceneRef.current;
      if (!range) return;
      if (message.type === "clear") range.clear();
      else if (message.type === "shots" && message.times?.length)
        range.schedule(message.times);
      loopRef.current?.invalidate();
    });
  }, [feed]);

  const state = scene === "failed" ? "failed" : scene === "pending" ? "loading" : model;
  return (
    <div className={`snd-range-frame is-${state}`}>
      <canvas ref={canvasRef} aria-hidden="true" />
      {state === "missing" && (
        <p className="snd-range-empty">
          {weapon?.model
            ? tr("Модель ствола не загрузилась — звук слышен и без неё.")
            : tr("Модели «{title}» в Astral нет — звук слышен и без неё.").replace("{title}", weapon?.title || tr("ствола"))}
        </p>
      )}
      {state === "failed" && (
        <p className="snd-range-empty">
          {tr("Трёхмерная сцена в этом окне недоступна — звук слышен и без неё.")}
        </p>
      )}
      {children}
    </div>
  );
}

export default memo(WeaponStage);
