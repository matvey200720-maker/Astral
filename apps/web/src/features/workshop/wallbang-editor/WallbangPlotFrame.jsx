/*
 * Кадр «Укрытие» на настоящем участке из игры (задача 24 ТЗ 19.10.2026).
 *
 * Под оболочкой — кусок карты вокруг первого места укрытия: дом и его участок, забор, крыша с кондиционером,
 * трансформатор, прицеп, бак — земля, соседние здания и мелочь из файлов GTA V игрока (сцена —
 * `scripts/prepare-wallbang-scenes.mjs`, листы читает приложение у игрока, в поставке их нет). Поверх укрытия —
 * настоящая оболочка из мода на том же месте, тем же поворотом и масштабом, что в игре, в облике работы.
 *
 * Выбрали другое укрытие — камера подлетает к нему: пока грузится новый участок, прежний стоит на кадре, а потом
 * камера садится на новый вид сверху и сбоку (`holdScene` у `ModelStage`, `arrive` у рамки). Время суток — свет кадра,
 * его смена камеру не двигает. Фон чёрный: за краем участка ничего нет, и кадр так и говорит.
 *
 * Камера — общая на мастерскую (`stage-camera.js`): ЛКМ — вращение, щелчок ПКМ — полёт по участку, колесо — приближение.
 * Нет участка или он не загрузился — прежний кадр на нарисованной земле (`fallback`).
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import ModelStage from "../model-stage/ModelStage.jsx";
import { loadSceneAsset } from "../model-stage/scene-asset.js";
import { findWallbangObject } from "@modovik/climb-contract/wallbang";
import { applyShellLook, plotDaylight, plotFrame, plotShellObject, wallbangPlot, wallbangPlotUrl } from "./wallbang-plot.js";
import { tr, useTr } from "../../../locales/ui.js";

/* Земля и стены — листами игры не крупнее 512: участок — основа под подсветкой, а не предмет правки. */
const LOOK = (index, info) => ({ colour: info.colour, mapSize: 512 });

const describe = (id) => `${findWallbangObject(id)?.label || tr("Укрытие")}: ${tr("настоящий участок из игры")}`;

/**
 * `shapes` — формы оболочек (`Map id → форма`), `scene` — время суток; `failed` — участок этого укрытия не
 * загрузился (хозяин кадра помнит это для подписи), `onFail(id)` — сообщить, что не загрузился. `fallback` — кадр
 * без участка.
 */
export default function WallbangPlotFrame({ project, objectId, scene, shapes, failed = false, onFail = null, onCamera = null, fallback = null }) {
  useTr();
  const stageRef = useRef(null);
  const plot = wallbangPlot(objectId);
  const shape = shapes?.get(objectId) || null;
  const url = plot ? wallbangPlotUrl(objectId) : null;
  const failRef = useRef(onFail);
  failRef.current = onFail;

  /* Участок, что не загрузился, меняется прежним кадром — без земли из игры; та же загрузка, что у `ModelStage`, из кэша окна. */
  useEffect(() => {
    if (!url) return undefined;
    let cancelled = false;
    loadSceneAsset(url).catch(() => {
      if (!cancelled) failRef.current?.(objectId);
    });
    return () => {
      cancelled = true;
    };
  }, [url, objectId]);

  /* Оболочка на своём месте: собирается раз на форму, а облик и время суток меняют только числа шейдера. */
  const shell = useMemo(() => (plot && shape ? plotShellObject(shape, plot) : null), [plot, shape]);
  useEffect(() => () => shell?.dispose(), [shell]);
  const objects = useMemo(() => (shell ? [{ object: shell.object }] : []), [shell]);
  useEffect(() => {
    if (!shell) return;
    applyShellLook(shell, project, objectId, scene);
    stageRef.current?.repaint();
  }, [shell, project, objectId, scene]);

  const frame = useCallback(() => plotFrame(shell, plot), [shell, plot]);
  const daylight = useMemo(() => plotDaylight(scene), [scene]);

  if (!plot || failed) return fallback;
  return (
    <ModelStage loadKit="props"
      ref={stageRef}
      className="wallbang-plot"
      scene={url}
      holdScene
      edgeFade
      look={LOOK}
      frame={shell ? frame : null}
      frameKey={`${objectId}|${shell ? "shell" : "wait"}`}
      objects={objects}
      daylight={daylight}
      onCamera={onCamera}
      highlight={null}
      label={`${describe(objectId)}. ${tr("Стрелки — повернуть, плюс и минус — приблизить, правая кнопка — полёт.")}`}
    />
  );
}
