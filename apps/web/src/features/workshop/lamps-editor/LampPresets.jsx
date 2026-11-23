import { memo, useEffect, useState } from "react";
import {
  LAMP_PRESETS,
  POLE_PRESETS,
  applyPolePreset,
  createLampProject,
} from "@modovik/street-light-contract/lamps";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import PresetShelf from "../../../components/ui/PresetShelf.jsx";
import { lampLook } from "./lamp-look.js";
import { paintLampThumb } from "./lamp-thumbs.js";
import { readTile, tileStoreKey, writeTile } from "../covers/tile-store.js";
import { tr, useTr } from "../../../locales/ui.js";

/*
 * Готовые фонари — сеткой под кадром, как готовые виды неба и прицелы.
 * Плитка — тот же фонарь ночью, что и кадр, в свете вида (та же модель
 * света игры, посчитанная на процессоре), с намёком на его частицы: рой в
 * движении — на большом кадре.
 *
 * Готовые столбы (ТЗ 10.10, вечер) — второй полкой: плитка — столб во весь
 * рост с его краской, блеском, прозрачностью и украшением (та же сетка, что
 * уедет в игру), в свете вида, если вид его задаёт.
 *
 * Выбранной плитки нет: вид — отправная точка. Поправил ручку — это уже свои
 * фонари, и подсвеченная плитка врала бы.
 */

const THUMB = Object.freeze({ width: 320, height: 180 });
const thumbs = new Map();

/* Плитки рисуются в свободное время окна: полка не должна тормозить въезд
   редактора шестнадцатью картинками разом. */
const idle = (task) =>
  typeof window.requestIdleCallback === "function"
    ? window.requestIdleCallback(task, { timeout: 1200 })
    : window.setTimeout(task, 60);
const cancelIdle = (id) =>
  typeof window.cancelIdleCallback === "function"
    ? window.cancelIdleCallback(id)
    : window.clearTimeout(id);

function paintThumb(project, models, view) {
  const canvas = document.createElement("canvas");
  canvas.width = THUMB.width;
  canvas.height = THUMB.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  paintLampThumb(context, lampLook(project, models), THUMB.width, THUMB.height, view);
  return canvas.toDataURL("image/webp", 0.86);
}

function usePresetThumb(key, project, models, view) {
  const [url, setUrl] = useState(() => thumbs.get(key) || null);
  useEffect(() => {
    if (thumbs.has(key)) {
      setUrl(thumbs.get(key));
      return undefined;
    }
    let alive = true;
    let id = null;
    /* Постоянное хранилище плиток (`tile-store.js`, шаг 5 кэша превью): трассировка кадра стоит ~60 мс,
       а плиток два десятка — готовые лежат между запусками, рисуем только недостающее. */
    const stored = tileStoreKey("lamp", view, key);
    (async () => {
      const kept = await readTile(stored);
      if (!alive) return;
      if (kept) {
        thumbs.set(key, kept);
        setUrl(kept);
        return;
      }
      id = idle(() => {
        let painted = null;
        try {
          painted = paintThumb(project, models, view);
        } catch {
          painted = null;
        }
        if (!painted) return;
        thumbs.set(key, painted);
        writeTile(stored, painted);
        setUrl(painted);
      });
    })();
    return () => {
      alive = false;
      if (id !== null) cancelIdle(id);
    };
  }, [key, project, models, view]);
  return url;
}

function PresetTile({ preset, thumbKey, project, view, models, onApply }) {
  const thumb = usePresetThumb(thumbKey, project, models, view);
  return (
    <ChoiceTile
      className="lamp-preset"
      media={
        thumb ? (
          <img src={thumb} alt="" draggable="false" />
        ) : (
          <span className="lamp-preset-pending" />
        )
      }
      title={preset.label}
      tooltip={preset.description}
      onClick={() => onApply(preset)}
    />
  );
}

/* Работа готового столба для плитки: столб вида на свежих фонарях. */
const poleProjects = new Map(POLE_PRESETS.map((preset) => [preset.id, applyPolePreset(createLampProject(), preset.id)]));

/* Готовые фонари и столбы — в панели инструмента «Шаблоны»: сетками без
   переключателя, видны сразу. */
function LampPresets({ models, modelsKey, onApply, onApplyPole = null }) {
  useTr();
  return (
    <>
      <PresetShelf
        title={tr("Готовые фонари")}
        label={tr("Готовые виды фонарей")}
        className="lamp-presets"
        collapsible={false}
      >
        {LAMP_PRESETS.map((preset) => (
          <PresetTile
            key={preset.id}
            preset={preset}
            thumbKey={`${preset.id}:${modelsKey}`}
            project={preset.look}
            view="thumb"
            models={models}
            onApply={onApply}
          />
        ))}
      </PresetShelf>
      {onApplyPole && (
        <PresetShelf
          title={tr("Готовые столбы")}
          label={tr("Готовые виды столбов")}
          className="lamp-presets"
          collapsible={false}
        >
          {POLE_PRESETS.map((preset) => (
            <PresetTile
              key={preset.id}
              preset={preset}
              thumbKey={`${preset.id}:${modelsKey}`}
              project={poleProjects.get(preset.id)}
              view="poleThumb"
              models={models}
              onApply={onApplyPole}
            />
          ))}
        </PresetShelf>
      )}
    </>
  );
}

export default memo(LampPresets);
