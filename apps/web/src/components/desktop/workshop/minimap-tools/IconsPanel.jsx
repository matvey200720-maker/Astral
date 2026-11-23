import { Heart, PlusCircle, Pulse, Seal, Shield, ShieldCheck } from "../../../ui/icons.jsx";
import Slider from "../../../ui/Slider.jsx";
import {
  MINIMAP_BUILTIN_ICONS,
  MINIMAP_ICON_SIZE_LIMITS,
  minimapIconSizeUnits,
  minimapIconWidgetSize,
} from "../minimap-layout.js";
import { MINIMAP_WIDGET_LABELS } from "../MinimapPreview.jsx";
import { AssetUpload, ColorControl, Section, Toggle } from "./parts.jsx";
import { Fine } from "./FineSettings.jsx";
import VitalScaleControls, { VitalStylePicker } from "./VitalIconsPanel.jsx";
import { anyVitalIcon, isDoubleRing, numberFitForIconSize, placeNumberInside, vitalIconStyle, vitalNumberPlace, vitalNumberSpot } from "./vital-icon-view.js";
import { MINIMAP_VITAL_STYLE_IMAGE } from "@modovik/minimap-contract";
import { tr, useTr } from "../../../../locales/ui.js";
import { useMinimapCopy } from "../minimap-lang.js";

/*
 * «Значки» — значки HP и брони: свободные (отдельные элементы карты) и
 * значок на самой полосе — он часть полосы, едет и растёт вместе с ней.
 * Шаблон и своя картинка общие для обоих. С ТЗ 22.10.2026 размер значка — ползунком здесь же («свои значки, чтобы их
 * можно было красить, менять размер, двигать»), а цифры рядом со значками — следующим разделом инструмента.
 */

const ICON_COMPONENTS = {
  health: { heart: Heart, cross: PlusCircle, pulse: Pulse },
  armor: { shield: Shield, "shield-check": ShieldCheck, badge: Seal },
};

function IconPresetPicker({ kind, value, onChange }) {
  useTr();
  const title = kind === "health" ? "HP" : tr("Броня");
  return (
    <div className="mmc-preset-picker">
      <span>{title}</span>
      <div>
        {MINIMAP_BUILTIN_ICONS[kind].map((item) => {
          const Icon = ICON_COMPONENTS[kind][item.id];
          return (
            <button
              type="button"
              key={item.id}
              className={value === item.id ? "is-active" : ""}
              onClick={() => onChange(item.id)}
              aria-label={`${item.label} · ${title}`}
              title={item.label}
            >
              <Icon />
            </button>
          );
        })}
      </div>
    </div>
  );
}

const ICON_SIDES = Object.freeze({ healthIcon: "health", armorIcon: "armour" });
const NUMBER_OF = Object.freeze({ healthIcon: "healthNumber", armorIcon: "armorNumber" });
const STYLE_FIELD = Object.freeze({ healthIcon: "healthIconStyle", armorIcon: "armorIconStyle" });

/* Где у вида стоит число: в центре значка (кольцо, сегменты), в контуре сердца и щита, рядом (остальные виды и картинка). Число сдвигается, когда место у вида другое. */
const numberPlaceOf = vitalNumberPlace;

export default function IconsPanel({
  config,
  patchEffects,
  widgetToggle,
  uploadVisualAsset,
  onPatchWidget = null,
  commit = null,
  previewLevel = 100,
  onPreviewLevel = null,
}) {
  useTr();
  const copy = useMinimapCopy();
  const { effects, layout } = config;
  const showsIcons =
    layout.widgets.healthIcon.visible || layout.widgets.armorIcon.visible || effects.barIcons;
  const doubleRing = isDoubleRing(config);
  const iconStyleOf = (id) => vitalIconStyle(effects, ICON_SIDES[id]);
  /*
   * Выбор вида. Если вид меняет место числа (внутри значка ↔ рядом), число встаёт на новое место одним шагом с видом; пока число скрыто или вид из того же ряда,
   * цифры остаются где были: их двигали руками.
   */
  const pickStyle = (id, nextStyle) => {
    const label = id === "healthIcon" ? tr("Выбран вид значка HP") : tr("Выбран вид значка брони");
    const was = iconStyleOf(id);
    const next = nextStyle === MINIMAP_VITAL_STYLE_IMAGE ? null : nextStyle;
    const number = layout.widgets[NUMBER_OF[id]];
    const moves =
      commit &&
      layout.widgets[id].visible &&
      number.visible &&
      !(id === "armorIcon" && effects.lossDisplay === "combined") &&
      numberPlaceOf(was) !== numberPlaceOf(next);
    const patched = { ...config, effects: { ...effects, [STYLE_FIELD[id]]: nextStyle } };
    if (!moves) return patchEffects({ [STYLE_FIELD[id]]: nextStyle }, label);
    /* Внутрь значка число встаёт по центру (у сердца и щита — в безопасный прямоугольник контура), с кеглем по отверстию и значком не меньше наименьшего (`placeNumberInside`); наружу — справа от значка. */
    if (numberPlaceOf(next)) return commit(placeNumberInside(patched, NUMBER_OF[id]), label, "effects");
    const spot = vitalNumberSpot(layout.widgets[id], number, next, ICON_SIDES[id]);
    return commit(
      { ...patched, layout: { ...layout, widgets: { ...layout.widgets, [NUMBER_OF[id]]: { ...number, x: spot.x, y: spot.y } } } },
      label,
      "effects",
    );
  };
  return (
    <>
      <Section title={tr("Значки")}>
        {["healthIcon", "armorIcon"].map(widgetToggle)}
      </Section>
      <Fine>
        <Section>
        <Toggle
          label={tr("Значок на полосе")}
          checked={effects.barIcons}
          onChange={(barIcons) =>
            patchEffects(
              { barIcons },
              barIcons ? tr("Показан значок на полосе") : tr("Скрыт значок на полосе"),
            )
          }
        />
        {effects.barIcons && (
          <ColorControl
            label={tr("Цвет значка на полосе")}
            value={effects.barIconColor}
            onChange={(barIconColor) =>
              patchEffects({ barIconColor }, tr("Изменён цвет значка на полосе"))
            }
          />
        )}
        </Section>
      </Fine>
      {showsIcons && (
        <Fine>
        <Section title={tr("Вид значков")}>
          <VitalStylePicker side="health" value={effects.healthIconStyle} onChange={(id) => pickStyle("healthIcon", id)} />
          {iconStyleOf("healthIcon") === null && (
            <>
              <IconPresetPicker
                kind="health"
                value={effects.healthIconPreset}
                onChange={(healthIconPreset) =>
                  patchEffects({ healthIconPreset }, tr("Выбран шаблон значка HP"))
                }
              />
              <AssetUpload
                label={tr("Свой значок HP")}
                loaded={effects.healthIconPreset === "custom"}
                onChange={(file) =>
                  uploadVisualAsset("healthIcon", file, "healthIconAssetId", {
                    healthIconPreset: "custom",
                  })
                }
              />
            </>
          )}
          <VitalStylePicker side="armour" value={effects.armorIconStyle} onChange={(id) => pickStyle("armorIcon", id)} />
          {iconStyleOf("armorIcon") === null && (
            <>
              <IconPresetPicker
                kind="armor"
                value={effects.armorIconPreset}
                onChange={(armorIconPreset) =>
                  patchEffects({ armorIconPreset }, tr("Выбран шаблон значка брони"))
                }
              />
              <AssetUpload
                label={tr("Свой значок брони")}
                loaded={effects.armorIconPreset === "custom"}
                onChange={(file) =>
                  uploadVisualAsset("armorIcon", file, "armorIconAssetId", {
                    armorIconPreset: "custom",
                  })
                }
              />
            </>
          )}
          {commit && (
            <p className="mmc-section-hint">
              {tr("У кольца и сегментов число стоит внутри значка, у остальных видов — рядом: выбор вида ставит видимые цифры на место.")}
            </p>
          )}
        </Section>
        </Fine>
      )}
      {showsIcons && onPatchWidget && !doubleRing && (
        <Fine>
          <Section title={tr("Размер значков")}>
          {["healthIcon", "armorIcon"]
              .filter((id) => layout.widgets[id].visible)
              .map((id) => (
                <Slider
                  key={id}
                  editable
                  label={id === "healthIcon" ? tr("Размер значка HP") : tr("Размер значка брони")}
                  value={Math.round(minimapIconSizeUnits(layout.widgets[id]))}
                  min={MINIMAP_ICON_SIZE_LIMITS[0]}
                  max={MINIMAP_ICON_SIZE_LIMITS[1]}
                  unit=" px"
                  onChange={(size) =>
                    onPatchWidget(id, minimapIconWidgetSize(size), copy.iconSize(MINIMAP_WIDGET_LABELS[id]), {
                      clamp: true,
                      /* Число стоит внутри значка — кегль подгоняется под новый размер одним шагом с ним; у сердца и щита число идёт и за значком. */
                      effects: numberFitForIconSize(config, id, size) || undefined,
                      seatNumber: true,
                    })
                  }
                />
              ))}
          </Section>
        </Fine>
      )}
      {showsIcons && (
        <Fine>
          <Section title={tr("Цвет значков")}>
          <ColorControl
            label={tr("Цвет значка HP")}
            value={effects.healthIconColor}
            onChange={(healthIconColor) =>
              patchEffects({ healthIconColor }, tr("Изменён цвет значка HP"))
            }
          />
          <ColorControl
            label={tr("Цвет значка брони")}
            value={effects.armorIconColor}
            onChange={(armorIconColor) =>
              patchEffects({ armorIconColor }, tr("Изменён цвет значка брони"))
            }
          />
          </Section>
        </Fine>
      )}
      {commit && onPreviewLevel && anyVitalIcon(config) && (
        <Fine>
        <Section title={tr("Шкала значка")}>
          <VitalScaleControls config={config} patchEffects={patchEffects} commit={commit} level={previewLevel} onLevel={onPreviewLevel} />
        </Section>
        </Fine>
      )}
    </>
  );
}
