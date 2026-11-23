/*
 * Готовая растительность — сеткой под кадром, как у воды и зон.
 *
 * Сверху — времена года (задача 2 ТЗ 10.10.2026, вечер): весна, лето,
 * осень, зима — каждый сезон красит разом листву, кусты и изгороди, траву
 * и землю и включает или убирает цветы; взятый сезон правится как любая
 * работа — так делаются свои времена года. Ниже — готовые виды отдельных
 * частей.
 *
 * Плитка показывает то, что вид меняет: у листвы и сезонов — тот же дуб,
 * что в кадре и на обложке (3D-снимок, `OakArt`), в облике вида; у травы —
 * тот же лист земли, что в кадре (в городе — газон гольф-клуба, за городом —
 * трава мода на месте пустыни Сэнди-Шорс), с травой цвета вида
 * (`recolourGrass` — та же функция, что у установщика). Отмечена плитка, с
 * которой работа совпадает в её части.
 *
 * Дуб на плитке не ставится: одинаковые дубы разницы не показывали, а без листа игры выходили пустыми
 * тёмными карточками (п. 20 `design-qa.md`). Виды листвы — полкой плашек без картинки, как времена года;
 * виды травы — отдельной полкой с листом травы: в общей сетке ряды одной высоты, и плашки без картинки
 * растягивались до высоты плитки с травой (четвёртый круг критика 31.10.2026).
 */

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { VEGETATION_PRESETS, applyVegetationPreset, matchingVegetationPreset } from "@modovik/climb-contract/recolor/vegetation";
import { grassPreviewColour } from "./vegetation-text.js";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import PresetShelf from "../../../components/ui/PresetShelf.jsx";
import ChoiceRows from "../choice-rows.jsx";
import { fillWithTile, grassSheet, grassTile, loadGrassPixels } from "./grass-ground.js";
import { tr, useTr } from "../../../locales/ui.js";

const SEASONS = Object.freeze(VEGETATION_PRESETS.filter((preset) => preset.season));
/* Вид травы — только трава мода, без деревьев: у него есть что показать (лист травы цвета вида). */
const isGrass = (preset) => Boolean(preset.sandy?.enabled && !preset.trees);
const LEAVES = Object.freeze(VEGETATION_PRESETS.filter((preset) => !preset.season && !isGrass(preset)));
const GRASS = Object.freeze(VEGETATION_PRESETS.filter((preset) => !preset.season && isGrass(preset)));

/** Лист травы зоны плиткой; трава — цвета вида. */
function GrassThumb({ zone, colour }) {
  const canvasRef = useRef(null);
  const { entry } = grassSheet(zone, true);
  useEffect(() => {
    let cancelled = false;
    loadGrassPixels(entry).then((base) => {
      if (!cancelled && base) fillWithTile(canvasRef.current, grassTile(base, colour), 3);
    });
    return () => {
      cancelled = true;
    };
  }, [entry, colour]);
  return <canvas ref={canvasRef} className="scene-thumb" width={320} height={180} aria-hidden="true" />;
}

/* Вид только для города — газон города, остальные — трава загорода. */
const grassZone = (preset) => (preset.sandy.zones?.country?.enabled === false ? "city" : "country");

function GrassArt({ preset }) {
  const project = useMemo(() => applyVegetationPreset({}, preset.id), [preset.id]);
  const zone = grassZone(preset);
  return <GrassThumb zone={zone} colour={grassPreviewColour(project, zone)} />;
}

/*
 * Читается ли лист травы зоны: газон города — лист игры, без игры его нет, и плитка выходила чёрной (четвёртый круг критика
 * 31.10.2026, п. 20). Пока не ответили — нет: вид без картинки стоит строкой под полкой и встаёт плиткой, когда лист прочитан.
 */
function useGrassReady() {
  const [ready, setReady] = useState({ city: false, country: false });
  useEffect(() => {
    let cancelled = false;
    for (const zone of ["city", "country"])
      loadGrassPixels(grassSheet(zone, true).entry).then((base) => {
        if (!cancelled && base) setReady((current) => ({ ...current, [zone]: true }));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return ready;
}

function Shelf({ title, label, presets, current, onApply }) {
  return (
    <PresetShelf title={title} label={label} className="recolor-presets" collapsible={false}>
      {presets.map((preset) => (
        <ChoiceTile
          key={preset.id}
          className="recolor-preset"
          selected={preset.id === current}
          media={isGrass(preset) ? <GrassArt preset={preset} /> : null}
          title={preset.label}
          tooltip={preset.description}
          onClick={() => onApply(preset)}
        />
      ))}
    </PresetShelf>
  );
}

function VegetationPresets({ project, onApply }) {
  useTr();
  const current = matchingVegetationPreset(project);
  const ready = useGrassReady();
  const shown = GRASS.filter((preset) => ready[grassZone(preset)]);
  const plain = GRASS.filter((preset) => !ready[grassZone(preset)]);
  return (
    <>
      <Shelf title={tr("Времена года")} label={tr("Времена года")} presets={SEASONS} current={current} onApply={onApply} />
      <Shelf title={tr("Листва")} label={tr("Готовые виды листвы")} presets={LEAVES} current={current} onApply={onApply} />
      {shown.length > 0 && <Shelf title={tr("Трава")} label={tr("Готовые виды травы")} presets={shown} current={current} onApply={onApply} />}
      {plain.length > 0 && (
        <ChoiceRows
          title={shown.length ? "" : tr("Трава")}
          label={tr("Готовые виды травы без картинки")}
          options={plain.map((preset) => ({ value: preset.id, label: tr(preset.label) }))}
          value={current}
          onChange={(id) => onApply(plain.find((preset) => preset.id === id))}
        />
      )}
    </>
  );
}

export default memo(VegetationPresets);
