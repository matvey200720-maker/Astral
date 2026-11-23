import { MINIMAP_BAR_STYLE_LIMITS, MINIMAP_GAME_BAR_OPACITY } from "../minimap-layout.js";
import Slider from "../../../ui/Slider.jsx";
import MinimapFillPanel, { followBarColor } from "../minimap-fill/MinimapFillPanel.jsx";
import {
  ColorControl,
  FRAME_SWATCHES,
  Section,
  Toggle,
  VisibilityChoice,
} from "./parts.jsx";
import { Fine } from "./FineSettings.jsx";
import { tr, useTr } from "../../../../locales/ui.js";
import { useMinimapCopy } from "../minimap-lang.js";

/*
 * Цвета полосок — часть инструмента «Полоски» (задача 15 ТЗ 10.10.2026, вечер; ТЗ 22.10.2026).
 *
 * Владелец (10.10): «инструмент, где он может настроить цвет полосок, цвет малого ХП, цвет задника полосок и обводки».
 * Владелец (22.10): «ХП — цветовая палитра, где заливка, и справа от него сразу место, чтобы подложку под ним
 * разрисовать; то же у брони: цвет брони, цвет заливки, цвет рамки; ниже „убрать фон“ и ползунок; всякие анимации на
 * полоски — чтобы цвет у них менялся: полоска белая — и анимации красятся в белый».
 *
 * Поэтому: цвета HP и брони — подряд, по одному в строку (двое в одной строке колонки не помещались: подписи ломались, код
 * цвета налезал); подложка — выбором «как в игре / свой цвет / без подложки» с
 * ползунком прозрачности; рамка полосок; анимация заливки идёт за цветом полосы, пока её цвета не тронуты руками
 * (`followBarColor`). Процентов цвета нет: заливка — «как в игре» или сплошная, порог малого HP — тот, что у игры.
 */

/* Подложка полос: прозрачность своей — та, что уже стоит в работе (по умолчанию как у игры), «без подложки» — её ноль. */
const trackChoices = () => [
  ["game", tr("Как в игре")],
  ["custom", tr("Свой цвет")],
  ["none", tr("Убрать")],
];
const fillChoices = () => [
  ["game", tr("Как в игре")],
  ["solid", tr("Сплошная")],
];
const SOLID_OPACITY = MINIMAP_BAR_STYLE_LIMITS.barOpacity[1];

export function trackChoiceOf(effects) {
  if (effects.trackMode !== "custom") return "game";
  return effects.trackOpacity > 0 ? "custom" : "none";
}

export default function ColorsPanel({ config, patchEffects, barAspect, onFill, onVideo }) {
  useTr();
  const copy = useMinimapCopy();
  const { effects } = config;
  const fillChoice = effects.barOpacity >= (MINIMAP_GAME_BAR_OPACITY + SOLID_OPACITY) / 2 ? "solid" : "game";
  const pickTrack = (choice) => {
    if (choice === "game")
      return patchEffects({ trackMode: "game" }, tr("Подложка полос — как в игре"));
    if (choice === "none")
      return patchEffects({ trackMode: "custom", trackOpacity: 0 }, tr("Полосы без подложки"));
    return patchEffects(
      {
        trackMode: "custom",
        /* Подложка, которая была убрана, возвращается с прозрачностью игры. */
        trackOpacity: effects.trackOpacity > 0 ? effects.trackOpacity : 50,
      },
      tr("Свой цвет подложки полос"),
    );
  };
  /* Цвет полосы и анимация, что шла за ним, — одним шагом истории. */
  const pickBar = (side, color) =>
    patchEffects(
      { [side === "health" ? "healthColor" : "armorColor"]: color, ...followBarColor(effects, side, color) },
      side === "health" ? tr("Изменён цвет HP") : tr("Изменён цвет брони"),
    );
  return (
    <>
      <Section title={tr("Цвета полосок")}>
        <ColorControl label={tr("Цвет HP")} value={effects.healthColor} onChange={(color) => pickBar("health", color)} />
        <ColorControl label={tr("Цвет брони")} value={effects.armorColor} onChange={(color) => pickBar("armor", color)} />
      </Section>
      <Fine>
        <Section title={tr("Малое HP и заливка")}>
        <ColorControl
          label={tr("Цвет малого HP")}
          value={effects.lowHealthColor}
          onChange={(lowHealthColor) => patchEffects({ lowHealthColor }, tr("Изменён цвет малого HP"))}
        />
        {/* 50% — заливка самой игры: у Rockstar полоса наполовину
            прозрачна, поэтому зелёный в игре приглушённый. */}
        <VisibilityChoice
          label={tr("Заливка")}
          value={fillChoice}
          options={fillChoices()}
          onChange={(choice) =>
            patchEffects(
              { barOpacity: choice === "solid" ? SOLID_OPACITY : MINIMAP_GAME_BAR_OPACITY },
              choice === "solid" ? tr("Заливка полос — сплошная") : tr("Заливка полос — как в игре"),
            )
          }
        />
        <p className="mmc-section-hint">{copy.lowHealthHint(effects.lowHealthThreshold)}</p>
        </Section>
      </Fine>
      <Fine>
      <Section title={tr("Подложка")}>
        <VisibilityChoice
          label={tr("Подложка полосок")}
          value={trackChoiceOf(effects)}
          options={trackChoices()}
          onChange={pickTrack}
        />
        {trackChoiceOf(effects) === "custom" && (
          <>
            <ColorControl
              label={tr("Цвет подложки")}
              value={effects.trackColor}
              swatches={FRAME_SWATCHES}
              onChange={(trackColor) => patchEffects({ trackColor }, tr("Изменён цвет подложки полос"))}
            />
            <Slider
              label={tr("Прозрачность подложки")}
              value={100 - effects.trackOpacity}
              min={0}
              max={99}
              unit="%"
              onChange={(percent) =>
                patchEffects({ trackOpacity: 100 - percent }, tr("Изменена прозрачность подложки полос"))
              }
            />
          </>
        )}
      </Section>
      </Fine>
      <Fine>
      <Section title={tr("Рамка полосок")}>
        <Toggle
          label={tr("Рамка полосок")}
          checked={effects.barOutline}
          onChange={(barOutline) =>
            patchEffects(
              { barOutline },
              barOutline ? tr("Включена рамка полосок") : tr("Выключена рамка полосок"),
            )
          }
        />
        {effects.barOutline && (
          <>
            <ColorControl
              label={tr("Цвет рамки полосок")}
              value={effects.barOutlineColor}
              swatches={FRAME_SWATCHES}
              onChange={(barOutlineColor) => patchEffects({ barOutlineColor }, tr("Изменён цвет рамки полосок"))}
            />
            <Slider
              label={tr("Толщина рамки")}
              value={effects.barOutlineWidth}
              min={MINIMAP_BAR_STYLE_LIMITS.barOutlineWidth[0]}
              max={MINIMAP_BAR_STYLE_LIMITS.barOutlineWidth[1]}
              step={0.5}
              unit=" px"
              onChange={(barOutlineWidth) => patchEffects({ barOutlineWidth }, tr("Изменена толщина рамки полосок"))}
            />
          </>
        )}
      </Section>
      </Fine>
      <Fine>
        <MinimapFillPanel effects={effects} aspects={barAspect} onFill={onFill} onVideo={onVideo} />
      </Fine>
    </>
  );
}
