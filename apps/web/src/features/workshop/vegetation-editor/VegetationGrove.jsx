/*
 * Кадр «В разнобой» — кусок настоящей карты из игры игрока (задача 22 ТЗ 19.10.2026, ночь).
 *
 * Земля, дороги и дома вокруг точки — сетки сущностей карт игры (сцена места, как у «Зон каптов»);
 * деревья и кусты — настоящие модели игры на тех местах, где они стоят (`grove/grove-scene.js`:
 * копии, три уровня детализации, невидимые не рисуются). Цвет каждого дерева — тот же выбор по
 * месту и сиду, что у установщика, лист — лист игры, перекрашенный той же функцией. Камера — общая
 * на мастерскую: ЛКМ — вращение, щелчок ПКМ — полёт (W A S D, Q и E, Shift), колесо — ближе.
 *
 * Кадр рисуется только на изменение: стоящий кадр ничего не стоит, правка палитры — одна отрисовка. Пока роща
 * собирается (модели и расстановка едут, сетки грунтуются частями, листы считает поток), `onBusy(true)` — кадр
 * держит «Обновляю…» (ТЗ 22.10.2026, п. 6).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GROVE_FADE, vegetationGrove, groveModels } from "@modovik/climb-contract/recolor/vegetation-groves";
import { vegetationProjectSignature } from "@modovik/climb-contract/recolor/vegetation";
import ModelStage from "../model-stage/ModelStage.jsx";
import { loadSceneAsset } from "../model-stage/scene-asset.js";
import { createGrove } from "./grove/grove-scene.js";
import { parseGrovePlants } from "./grove/grove-plan.js";
import { useTr } from "../../../locales/ui.js";

/* Земля, дороги и дома — фон, а не предмет правки: листы вполовину меньше, видеокарте легче. */
const groundLook = (_index, info) => ({ colour: info.colour, mapSize: 256 });

/**
 * Рамка кадра места: поле метров вокруг точки, где гуляет камера (от него — расстояние орбиты, скорость
 * и пределы полёта), и вид по умолчанию — над землёй на `height` метров.
 */
export function groveFrame(grove) {
  const { span = 70, yaw, pitch, zoom, height = 8 } = grove.view;
  const low = (grove.ground?.min ?? -4) - 2;
  const top = Math.max(grove.ground?.max ?? 8, height) + 28;
  return {
    bounds: { min: [-span, -span, low], max: [span, span, top] },
    centre: [0, 0, height],
    ground: false,
    view: { yaw, pitch, zoom },
  };
}

/**
 * Роща места `groveId`. `onReal(true|false)` — прочитались ли листы игры (подпись кадра);
 * `onState({ plants, ... })` — для стенда.
 */
export default function VegetationGrove({ project, groveId, label = "", onReal = null, onState = null, onBusy = null, onCamera = null }) {
  useTr();
  const grove = vegetationGrove(groveId);
  const edge = useMemo(() => (grove ? { shape: "disc", centre: [0, 0], radius: grove.reach + 4, width: GROVE_FADE } : true), [grove]);
  const models = groveModels();
  const stageRef = useRef(null);
  const [made, setMade] = useState(null);
  const signature = useMemo(() => vegetationProjectSignature(project), [project]);
  const projectRef = useRef(project);
  projectRef.current = project;
  const repaint = useCallback(() => stageRef.current?.repaint?.(), []);
  const busyRef = useRef(onBusy);
  busyRef.current = onBusy;

  /* Модели и расстановка места: один раз на место (модели — на окно, `loadSceneAsset` держит их в кэше). */
  useEffect(() => {
    if (!grove || !models) return undefined;
    let cancelled = false;
    let instance = null;
    setMade(null);
    /* Новое место — рощи ещё нет: кадр занят, пока она не соберётся. */
    busyRef.current?.(true);
    (async () => {
      const [asset, plan] = await Promise.all([
        loadSceneAsset(models.url),
        fetch(grove.plants.url)
          .then((response) => {
            if (!response.ok) throw new Error("расстановка не загрузилась");
            return response.json();
          })
          .then(parseGrovePlants),
      ]);
      if (cancelled) return;
      instance = createGrove({ asset, plan, onChange: repaint, onBusy: (busy) => !cancelled && busyRef.current?.(busy) });
      instance.configure(projectRef.current);
      await instance.prepare();
      if (cancelled) return;
      instance.configure(projectRef.current);
      if (import.meta.env?.DEV) window.__astralGrove = instance;
      setMade(instance);
    })().catch(() => {
      /* Нет моделей или расстановки — остаётся земля места без растений, а «Обновляю…» не висит. */
      if (!cancelled) busyRef.current?.(false);
    });
    return () => {
      cancelled = true;
      busyRef.current?.(false);
      instance?.dispose();
      if (import.meta.env?.DEV && window.__astralGrove === instance) window.__astralGrove = null;
    };
    // Роща пересобирается местом, а не каждым новым объектом работы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grove?.id]);

  /* Правка работы — места палитры и листы заново; кадр — одной отрисовкой. */
  useEffect(() => {
    if (!made) return;
    made.configure(projectRef.current);
    repaint();
    // Работа читается по смыслу (`signature`), а не по новому объекту.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [made, signature]);

  useEffect(() => {
    if (made) onReal?.(made.real);
  }, [made, onReal]);

  useEffect(() => {
    if (made) onState?.(made);
  }, [made, onState]);

  const objects = useMemo(() => (made ? [{ object: made.object, beforeDraw: made.beforeDraw }] : null), [made]);
  const frame = useCallback(() => groveFrame(grove), [grove]);
  if (!grove) return null;
  return (
    <ModelStage loadKit="nature"
      ref={stageRef}
      scene={grove.scene.url}
      look={groundLook}
      frame={frame}
      frameKey={grove.id}
      /* Кусок карты с деревьями — круг: внутри всё целое, за ним чёрная пустота с мягким краем (20.10.2026). */
      edgeFade={edge}
      objects={objects}
      shadows={false}
      onCamera={onCamera}
      label={label}
    />
  );
}
