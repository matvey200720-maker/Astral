/*
 * Готовые зоны — сеткой под кадром, как готовые прострелы.
 *
 * Готовый вид меняет все виды зон. Плитка показывает зону выбранного вида
 * (у запретных — двор в Западном Вайнвуде, у зелёных — выбранный контур, у
 * бизвара, ВЗХ и порта — угол обвода с обеими линиями) в облике готового
 * вида — тем же рисователем, что обложка. Отмечена плитка, с которой работа
 * совпадает; поправил цвет — это уже своё.
 */

import { memo, useEffect, useState } from "react";
import {
  ZONES_INVENTORY,
  ZONES_PRESETS,
  applyZonesPreset,
  matchingZonesPreset,
  zonesProjectIsHidden,
} from "@modovik/climb-contract/recolor/zones";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import ChoiceRows from "../choice-rows.jsx";
import PresetShelf from "../../../components/ui/PresetShelf.jsx";
import { paintSceneParts } from "../model-stage/mesh-painter.js";
import { loadSceneAsset } from "../model-stage/scene-asset.js";
import { findZoneItem, zoneFrameLook, zoneOfMaterial } from "./zones-text.js";
import { tr, useTr } from "../../../locales/ui.js";
import { encodeTile } from "../preset-tiles.js";

const TILE_ZONE = "gucci_ss1_02_building03";
/* Готовые виды, где зон не видно: на плитке показывать нечего. Они — строкой под сеткой, а не пустой карточкой в ней: ряды сетки
   одной высоты, и плитка без картинки выходила пустым прямоугольником с именем вверху (п. 20, четвёртый круг критика 31.10.2026). */
const hiddenPresets = new Set(ZONES_PRESETS.filter((preset) => zonesProjectIsHidden(applyZonesPreset({}, preset.id))).map((preset) => preset.id));
/* Готовые плитки по сцене: asset → (зона|вид|пресет → адрес картинки). */
const tileCache = new WeakMap();
const TILE = Object.freeze({ width: 200, height: 96 });
const VIEW = Object.freeze({ yaw: -0.55, pitch: 0.5 });

/* Плитка рисуется на холст; кодирование — отдельно и асинхронно (`encodeTile`), чтобы не держать кадр. */
function presetCanvas(asset, project, zoneId, kind) {
  if (typeof document === "undefined") return null;
  const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
  const canvas = document.createElement("canvas");
  canvas.width = TILE.width * ratio;
  canvas.height = TILE.height * ratio;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  const zone = findZoneItem(zoneId, kind);
  /* Облик — по материалу: у обвода в одной части две линии. */
  paintSceneParts(context, asset, {
    parts: [zone.part],
    look: (index, info) => {
      const owner = zoneOfMaterial(info);
      return owner ? zoneFrameLook(project, owner) : { visible: false };
    },
    width: TILE.width,
    height: TILE.height,
    view: VIEW,
    margin: 0.08,
    grid: 3,
  });
  return canvas;
}


function ZonesPresets({ project, kind = "forbidden", zoneId = "", onApply }) {
  useTr();
  const [asset, setAsset] = useState(null);
  useEffect(() => {
    let cancelled = false;
    loadSceneAsset(ZONES_INVENTORY.scene.url)
      .then((loaded) => {
        if (!cancelled) setAsset(loaded);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /* Плитки не зависят от работы: вид готового набора — всегда его
     собственный; зона — у запретных постоянная, у остальных — выбранная. */
  const tileZone = kind === "forbidden" ? TILE_ZONE : findZoneItem(zoneId, kind).id;
  /* Плитки — по одной, в своих задачах: клик по виду не стоит всеми сразу (замер 20.10: 1,2 с на главном потоке).
     Готовая плитка держится в кэше по сцене, зоне и виду: повторный клик — без рисования. */
  const [images, setImages] = useState(() => new Map());
  useEffect(() => {
    if (!asset) return undefined;
    const cache = tileCache.get(asset) || new Map();
    tileCache.set(asset, cache);
    const zoneKey = `${tileZone}|${kind}`;
    setImages(new Map(ZONES_PRESETS.map((preset) => [preset.id, cache.get(`${zoneKey}|${preset.id}`) || ""])));
    const todo = ZONES_PRESETS.map((preset) => preset.id).filter((id) => !cache.has(`${zoneKey}|${id}`));
    let cancelled = false;
    let timer = 0;
    const next = () => {
      if (cancelled || !todo.length) return;
      const id = todo.shift();
      const canvas = presetCanvas(asset, applyZonesPreset({}, id), tileZone, kind);
      encodeTile(canvas, (href) => {
        if (cancelled) return;
        cache.set(`${zoneKey}|${id}`, href);
        setImages((current) => new Map(current).set(id, href));
        timer = setTimeout(next, 0);
      });
    };
    timer = setTimeout(next, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [asset, tileZone, kind]);
  const current = matchingZonesPreset(project);

  const plain = ZONES_PRESETS.filter((preset) => hiddenPresets.has(preset.id));
  return (
    <>
      <PresetShelf title={tr("Готовые зоны")} label={tr("Готовые виды зон")} className="recolor-presets" collapsible={false}>
        {ZONES_PRESETS.filter((preset) => !hiddenPresets.has(preset.id)).map((preset) => {
          const href = images.get(preset.id);
          return (
            <ChoiceTile
              key={preset.id}
              className="recolor-preset"
              selected={preset.id === current}
              media={href ? <img src={href} alt="" /> : <i aria-hidden="true" />}
              title={tr(preset.label)}
              tooltip={tr(preset.description)}
              onClick={() => onApply(preset)}
            />
          );
        })}
      </PresetShelf>
      {plain.length > 0 && (
        <ChoiceRows
          label={tr("Готовые виды зон без картинки")}
          options={plain.map((preset) => ({ value: preset.id, label: tr(preset.label) }))}
          value={current}
          onChange={(id) => onApply(plain.find((preset) => preset.id === id))}
        />
      )}
    </>
  );
}

export default memo(ZonesPresets);
