/*
 * Кадр редактора «Вода» из игры (задача 20 ТЗ 18.10.2026, поздний вечер): кусок
 * настоящего моря у Венис-Бич из GTA V игрока — песок, мель, подводный склон,
 * кораллы и водоросли — под небом и светом таймцикла, с лентой суток над ним и
 * водой по работе человека.
 *
 * Квартал и небо — тот же кадр, что у «Таймциклов» и «Фонарей»
 * (`SkyBlockStage`): берег и дно приезжают из установленной игры. Воду рисует
 * сведение кадра (`block-shaders.js`, блок «Вода») так же, как игра
 * (`PS_FogComposite`): у моря в игре нет моделей, это квады и туман, а глубина
 * сцены говорит, сколько метров воды лежит над дном. Числа — из работы
 * (`water-frame.js`): цвет толщи по плиткам тумана (отмель → глубь), прозрачность —
 * на скольких метрах остаётся 10 % света, под водой — подводные модификаторы.
 * Два вида — «У берега» (стоим на песке, смотрим в море через мель) и «Под
 * водой» (среди кораллов и водорослей); человек летит где хочет.
 *
 * Подпись честная (CLAUDE.md): берег и дно — из игры, а гладь и толща воды
 * посчитаны Astral по числам работы, это не кадр из игры. Когда кадр собрать
 * нельзя (браузер, игры нет, видеокарта без буфера с плавающей точкой), он
 * сообщает причину (`onUnavailable`), и редактор остаётся на постановочных видах.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import SkyBlockStage from "../timecycle-block/SkyBlockStage.jsx";
import useGameSky from "../timecycle-block/useGameSky.js";
import { motionEnabled } from "../../../motion-preference.js";
import { smooth } from "../model-stage/camera-return.js";
import { finiteWaterSpec, mixWaterSpec, waterFrameSpec } from "./water-frame.js";
import { SEA_SECTION, seaPose } from "./water-sea-views.js";
import { tr, useTr } from "../../../locales/ui.js";

/* Вода меняется плавно от прежней к новой (шаблон, час, работа), мс; не дольше, чем человек успевает заметить рывок (П6.5, 22.10.2026). */
const WATER_EASE_MS = 260;


export default function WaterSeaStage({
  project,
  looks,
  view = "close",
  hour,
  onHourChange,
  /* Орган кадра рядом с лентой суток: переключатель вида. */
  viewControl = null,
  onUnavailable = null,
  /* Папка игры; без неё кадр её находит сам. */
  gameRoot: given = "",
}) {
  useTr();
  const { gameRoot, searched, sky, hats, sheets, textures } = useGameSky({ gameRoot: given, hour });
  /* Игры нет — кадр не собрать: редактор остаётся на постановочных видах. */
  useEffect(() => {
    if (searched && !gameRoot) onUnavailable?.(tr("подключите GTA V"));
  }, [searched, gameRoot, onUnavailable]);

  /* Сцена кадра — от него; вода на ней — по работе и свету часа. */
  const [scene, setScene] = useState(null);
  const spec = useMemo(() => (sky?.state ? waterFrameSpec({ project, looks, state: sky.state }) : null), [project, looks, sky]);
  /*
   * Вода идёт в сцену плавно: прежнее сведение доезжает до нового за `WATER_EASE_MS`, а не заменяется целиком между
   * двумя кадрами (шаблон, «Под водой»). Сведение с неконечным числом кадру не уходит — остаётся прежнее. Первая вода,
   * её пропажа и выключенные анимации — сразу.
   */
  const shown = useRef(null);
  useEffect(() => {
    if (!scene) return undefined;
    if (!spec) {
      shown.current = null;
      scene.setWater(null);
      return undefined;
    }
    if (!finiteWaterSpec(spec)) return undefined;
    const from = shown.current;
    if (!from || !motionEnabled()) {
      shown.current = spec;
      scene.setWater(spec);
      return undefined;
    }
    let frame = 0;
    const started = performance.now();
    const step = (now) => {
      const share = Math.min(1, Math.max(0, (now - started) / WATER_EASE_MS));
      const next = share >= 1 ? spec : mixWaterSpec(from, spec, smooth(share));
      shown.current = next;
      scene.setWater(next);
      frame = share >= 1 ? 0 : requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [scene, spec]);
  useEffect(() => () => scene?.setWater(null), [scene]);

  /* Вид «по умолчанию» — по виду кадра. */
  const first = useRef(seaPose(view));
  useEffect(() => {
    if (!scene) return;
    scene.setView(seaPose(view));
  }, [scene, view]);

  return (
    <SkyBlockStage
      sectionId={SEA_SECTION}
      state={sky?.state || null}
      hour={hour}
      onHourChange={onHourChange}
      clouds={sky?.clouds || null}
      hats={hats}
      sheets={sheets}
      textures={textures}
      modeControl={viewControl}
      onUnavailable={onUnavailable}
      pose={first.current.pose}
      frame={first.current.frame}
      onScene={setScene}
    />
  );
}
