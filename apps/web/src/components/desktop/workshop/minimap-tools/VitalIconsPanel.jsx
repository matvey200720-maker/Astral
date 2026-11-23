import { useId } from "react";
import { MINIMAP_VITAL_STYLES, MINIMAP_VITAL_STYLE_IMAGE, MINIMAP_ICON_SIZE_LIMITS, minimapIconSizeUnits } from "@modovik/minimap-contract";
import Button from "../../../ui/Button.jsx";
import { ImageSquare } from "../../../ui/icons.jsx";
import Slider from "../../../ui/Slider.jsx";
import { tr, useTr } from "../../../../locales/ui.js";
import { ColorControl, Toggle } from "./parts.jsx";
import { VitalThumb } from "./VitalShape.jsx";
import {
  THICKNESS_PERCENT,
  VITAL_RING_MIN_SIZE,
  anyVitalIcon,
  applyDoubleRing,
  doubleRingMinimumSize,
  isDoubleRing,
  usesThickness,
  vitalIconShown,
  vitalIconStyle,
} from "./vital-icon-view.js";

/*
 * Значки HP и брони как шкалы (10.11.2026, данные — Хелпер 28, договор `minimap-contract/vital-icons.js`).
 *
 * Для каждого значка — свой вид: «Картинка» (прежний значок или шаблон) или одна из шести шкал, которые убывают с запасом. Остальное — общее на оба значка: толщина
 * кольца, цвет по уровню, мигание на малом запасе, подложка и заготовка «двойное кольцо». Ползунок «ХП / броня» ставит запас в кадре, чтобы увидеть шкалу на любом уровне;
 * в проект он не пишется. Предпросмотр рисует тот же кадр и тот же цвет, что игра ставит на этот запас.
 */

/** Выбор вида значка: «Картинка» и шесть шкал, у каждой — миниатюра на среднем запасе. */
export function VitalStylePicker({ side, value, onChange }) {
  useTr();
  const title = side === "health" ? "HP" : tr("Броня");
  const captionId = useId();
  const current = vitalIconStyle({ [side === "health" ? "healthIconStyle" : "armorIconStyle"]: value }, side) ?? MINIMAP_VITAL_STYLE_IMAGE;
  return (
    <div className="mmc-vital-picker" role="group" aria-labelledby={captionId}>
      {/* Подпись — отдельными узлами, не одной склеенной строкой: слой перевода окна режет склейку на куски и в украинском подменяет «значка» на «значки». */}
      <span id={captionId}>
        {tr("Вид значка")}
        <i> · </i>
        {title}
      </span>
      <div>
        <button
          type="button"
          className={current === MINIMAP_VITAL_STYLE_IMAGE ? "is-active" : ""}
          aria-pressed={current === MINIMAP_VITAL_STYLE_IMAGE}
          aria-label={`${tr("Картинка")} · ${title}`}
          title={tr("Картинка")}
          onClick={() => onChange(MINIMAP_VITAL_STYLE_IMAGE)}
        >
          <ImageSquare />
        </button>
        {MINIMAP_VITAL_STYLES.map((item) => (
          <button
            type="button"
            key={item.id}
            className={current === item.id ? "is-active" : ""}
            aria-pressed={current === item.id}
            aria-label={`${tr(item.label)} · ${title}`}
            title={`${tr(item.label)}: ${tr(item.note)}`}
            onClick={() => onChange(item.id)}
          >
            <VitalThumb styleId={item.id} side={side} />
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Общие настройки шкал и просмотр запаса. Показывается, пока хоть один видимый значок — шкала.
 * @param {object} props
 * @param {object} props.config конфигурация мини-карты
 * @param {(patch: object, label: string) => void} props.patchEffects
 * @param {(next: object, label: string, property?: string) => void} props.commit
 * @param {number} props.level запас в кадре, 0…100
 * @param {(percent: number) => void} props.onLevel
 */
export default function VitalScaleControls({ config, patchEffects, commit, level, onLevel }) {
  useTr();
  const { effects } = config;
  if (!anyVitalIcon(config)) return null;
  const shown = ["health", "armour"].filter((side) => vitalIconShown(config, side));
  const thick = shown.some((side) => usesThickness(vitalIconStyle(effects, side)));
  const double = isDoubleRing(config);
  /* Число HP стоит внутри внутреннего кольца — ему нужно отверстие значка не меньше `VITAL_RING_MIN_SIZE`. */
  const smallest = Math.max(doubleRingMinimumSize(MINIMAP_ICON_SIZE_LIMITS[0], effects.vitalThickness), config.layout.widgets.healthNumber.visible ? doubleRingMinimumSize(VITAL_RING_MIN_SIZE, effects.vitalThickness) : 0);
  return (
    <>
      <Slider
        editable
        label={tr("ХП / броня")}
        hint={tr("Запас в кадре: так шкала выглядит на этом уровне. Только просмотр, в проект не сохраняется.")}
        value={Math.round(level)}
        min={0}
        max={100}
        unit=" %"
        onChange={onLevel}
      />
      {thick && (
        <Slider
          editable
          label={tr("Толщина")}
          value={Math.round(effects.vitalThickness * 100)}
          min={THICKNESS_PERCENT.min}
          max={THICKNESS_PERCENT.max}
          unit=" %"
          onChange={(percent) => patchEffects({ vitalThickness: percent / 100 }, tr("Изменена толщина шкалы"))}
        />
      )}
      <Toggle
        label={tr("Цвет по уровню")}
        checked={effects.vitalLevelColours}
        onChange={(vitalLevelColours) => patchEffects({ vitalLevelColours }, vitalLevelColours ? tr("Включён цвет шкалы по уровню") : tr("Выключен цвет шкалы по уровню"))}
      />
      {effects.vitalLevelColours && (
        <p className="mmc-section-hint">{tr("Цвета и пороги ступеней — те же, что у полос: раздел «Полоски».")}</p>
      )}
      <Toggle
        label={tr("Мигание при малом запасе")}
        checked={effects.vitalBlinkLow}
        onChange={(vitalBlinkLow) => patchEffects({ vitalBlinkLow }, vitalBlinkLow ? tr("Включено мигание шкалы при малом запасе") : tr("Выключено мигание шкалы при малом запасе"))}
      />
      {/* Цвет пустой части шкалы — `vitalTrackColour` (его рисует предпросмотр); прежнее `vitalTrackColor` пишется тем же цветом, пока сборка игры читает его. */}
      <ColorControl
        label={tr("Цвет подложки")}
        value={effects.vitalTrackColour}
        onChange={(vitalTrackColour) => patchEffects({ vitalTrackColour, vitalTrackColor: vitalTrackColour }, tr("Изменён цвет подложки шкалы"))}
      />
      <Slider
        editable
        label={tr("Подложка")}
        value={effects.vitalTrackOpacity}
        min={0}
        max={100}
        unit=" %"
        onChange={(vitalTrackOpacity) => patchEffects({ vitalTrackOpacity }, tr("Изменена подложка шкалы"))}
      />
      <div className="mmc-vital-preset">
        <Button variant="secondary" size="sm" onClick={() => commit(applyDoubleRing(config), tr("Собрано двойное кольцо"), "layout")}>
          {tr("Двойное кольцо")}
        </Button>
        <p className="mmc-section-hint">{tr("Броня снаружи, HP внутри, общий центр: два обычных кольца, сложенные вместе.")}</p>
      </div>
      {double && (
        <Slider
          editable
          label={tr("Размер двойного кольца")}
          value={Math.round(minimapIconSizeUnits(config.layout.widgets.armorIcon))}
          min={smallest}
          max={MINIMAP_ICON_SIZE_LIMITS[1]}
          unit=" px"
          onChange={(size) => commit(applyDoubleRing(config, { size }), tr("Изменён размер двойного кольца"), "layout")}
        />
      )}
    </>
  );
}
