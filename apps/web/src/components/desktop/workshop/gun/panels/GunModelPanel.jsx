/*
 * Инструмент «Оружие» мастерской оружия (задача 1 ТЗ 06.10.2026): вся
 * настройка самой модели ствола в одном месте — размер (был в «Моделях»),
 * материал и непрозрачность. Материал — настоящий шейдер игры в модели
 * ствола, а не обман кадра:
 *   • «Как в игре» — шейдеры Rockstar; непрозрачность ниже 100 % — прозрачный
 *     шейдер ствола (им сделаны стёкла прицелов);
 *   • «Стекло» — шейдер стёкол игры `glass_env`: отражает небо и свет,
 *     сквозь ствол видно;
 *   • «Рентген» — светящийся полупрозрачный шейдер: контуры деталей
 *     светятся цветом рентгена, плоскости просвечивают.
 * У каждого ползунка — число; «Стандарт» возвращает модель как в игре.
 */
import { ArrowCounterClockwise } from "../../../../ui/icons.jsx";
import { MODEL_GLOW, MODEL_MATERIAL_OPACITY } from "@modovik/gun-studio";
import Button from "../../../../ui/Button.jsx";
import ColorField from "../../../../ui/ColorField.jsx";
import SegmentedControl from "../../../../ui/SegmentedControl.jsx";
import Slider from "../../../../ui/Slider.jsx";
import SectionHeading from "../../../../../features/workshop/section-help.jsx";
import GunMuzzleQuiet from "./GunMuzzleQuiet.jsx";
import GunOwnModelPanel from "./GunOwnModelPanel.jsx";
import { tr, useTr } from "../../../../../locales/ui.js";
import { fill, trKey } from "../gun-copy.js";

const MATERIALS = [
  { value: "standard", label: trKey("Штатный") },
  { value: "glass", label: trKey("Стекло") },
  { value: "xray", label: trKey("Рентген") },
];

const MATERIAL_NOTES = {
  standard:
    trKey("Шейдеры Rockstar. Ниже 100 % непрозрачности ствол переходит на прозрачный шейдер игры, которым сделаны стёкла прицелов."),
  glass:
    trKey("Шейдер стёкол игры: ствол отражает небо и свет и просвечивает. Цвет — оттенок стекла, непрозрачность — насколько стекло плотное."),
  xray: trKey("Светящийся полупрозрачный шейдер игры: контуры деталей светятся цветом рентгена, плоскости просвечивают. Свечение видно и ночью."),
};

const SWATCHES = {
  glass: ["#cfe8ff", "#ffffff", "#bff5d8", "#ffd9f2", "#fff1b8", "#d7c9ff"],
  xray: ["#59d6ff", "#7dff9b", "#ff5ad6", "#ffd24a", "#ff6a3d", "#ffffff"],
};

/**
 * `model` — `{ scale, opacity, material, tint, glow, standard, scaleInGame,
 * note, onScale, onOpacity, onMaterial, onTint, onGlow, onReset }` или `null`
 * (ствол, модель которого Astral в игре не правит: своя модель, скин каталога без пакета). `scaleOnly` (29.10.2026) —
 * ствол пака и скин каталога: в игру едет только размер, материала и прозрачности нет.
 */
export default function GunModelPanel({ model, own = null, muzzle = null }) {
  useTr();
  /* «Без вспышки и дыма» (задача 6 ТЗ 17.10.2026) — у ствола игры при любой
     модели: это файл оружия, а не модель. */
  return (
    <>
      <ModelSection model={model} own={own} />
      <GunMuzzleQuiet quiet={muzzle} />
    </>
  );
}

function ModelSection({ model, own }) {
  /* Своя модель ствола из .glb (задача 6 ТЗ 17.10.2026): подгонка и что будет в игре. */
  if (own) return <GunOwnModelPanel own={own} />;
  if (!model)
    return (
      <section className="gun-model-panel" aria-label={tr("Оружие")}>
        <p className="gun-hint">
          {tr("Размер и материал правятся у ствола из игры, а размер — ещё у ствола из «Моих паков» и у скина каталога. Выберите такой ствол в «Моделях».")}
        </p>
      </section>
    );
  const material = model.material || "standard";
  return (
    <section className="gun-model-panel" aria-label={tr("Оружие")}>
      <div className="gun-section-head">
        <h3>{tr("Модель ствола")}</h3>
        <Button variant="secondary" size="sm" icon={<ArrowCounterClockwise />} disabled={model.standard} onClick={model.onReset}>
          {tr("Как в игре")}
        </Button>
      </div>
      {model.onScale && (
        <Slider label={tr("Размер")} value={Math.round(model.scale * 100)} min={50} max={200} unit="%" onChange={(value) => model.onScale(value / 100)} />
      )}
      {model.scaleOnly ? (
        <SectionHeading help={tr("Размер уедет в игру вместе со скином: ствол и магазин растут вокруг рукояти. Материал и прозрачность пока правятся только у ствола из игры.")} />
      ) : (
        <ModelMaterial model={model} material={material} />
      )}
    </section>
  );
}

/* Материал, непрозрачность, цвет и свечение — у ствола из игры, чья модель едет в игру целиком. */
function ModelMaterial({ model, material }) {
  return (
    <>
      <SegmentedControl label={tr("Материал")} size="sm" options={MATERIALS.map((item) => ({ ...item, label: tr(item.label) }))} value={material} onChange={model.onMaterial} />
      <Slider
        label={tr("Непрозрачность")}
        value={Math.round(model.opacity * 100)}
        min={10}
        max={100}
        unit="%"
        onChange={(value) => model.onOpacity(value / 100)}
      />
      {material !== "standard" && (
        <ColorField label={material === "glass" ? tr("Цвет стекла") : tr("Цвет рентгена")} value={model.tint} swatches={SWATCHES[material]} onChange={model.onTint} />
      )}
      {material === "xray" && (
        <Slider label={tr("Свечение")} value={model.glow} min={MODEL_GLOW.min} max={MODEL_GLOW.max} step={0.1} onChange={model.onGlow} />
      )}
      {/* Объяснение материала — за «?» у имени панели, а не абзацем (п. 1 `design-qa.md`). */}
      <SectionHeading
        help={[
          tr(MATERIAL_NOTES[material]),
          material !== "standard" && model.opacity === 1
            ? fill(tr("Совет: стеклу идёт {glass} %, рентгену — {xray} %."), {
                glass: Math.round(MODEL_MATERIAL_OPACITY.glass * 100),
                xray: Math.round(MODEL_MATERIAL_OPACITY.xray * 100),
              })
            : "",
          model.note || "",
        ].filter(Boolean)}
      />
    </>
  );
}
