import SegmentedControl from "../../../ui/SegmentedControl.jsx";
import Slider from "../../../ui/Slider.jsx";
import { MINIMAP_NUMBER_SIZE_LIMITS } from "../minimap-layout.js";
import { numbersInsideHole } from "./vital-icon-view.js";
import { ColorControl, Section, Toggle, VisibilityChoice } from "./parts.jsx";
import { Fine } from "./FineSettings.jsx";
import GameFontsLink from "../../../../features/workshop/emblem/GameFontsLink.jsx";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * «Цифры» — цифры HP и брони (задача 15 ТЗ 10.10.2026, вечер). Владелец:
 * «не просто редактировать цифры ХП брони, но и писать их прямо на
 * мини-карте». Щелчок по карте ставит туда цифры (HP или брони — выбор ниже)
 * и включает их, а тянуть их можно, как полосы, — инструмент «Текст» в
 * Photoshop. Шрифт — один из двух шрифтов HUD, что minimap.gfx игры уже
 * подключает; размер — в точках, цвет — свой у каждой.
 *
 * С ТЗ 22.10.2026 цифры — раздел инструмента «Значки» («цифры рядом со значками… можно двигать по отдельности»):
 * щелчок по карте ставит их, только пока включён «Ставить щелчком по карте», иначе щелчок выбирает элемент; вид цифр
 * (шрифт, размер, цвет) появляется, когда цифры включены.
 */

export const numberTargets = () => [
  { value: "healthNumber", label: tr("Цифры HP") },
  { value: "armorNumber", label: tr("Цифры брони") },
];
const fontChoices = () => [
  ["cond", tr("Узкий HUD")],
  ["regular", tr("Обычный")],
];

export default function NumbersPanel({
  config,
  patchEffects,
  toggleWidget,
  target,
  onTarget,
  placing = false,
  onPlacing = null,
}) {
  useTr();
  const { widgets } = config.layout;
  const { effects } = config;
  const combined = effects.lossDisplay === "combined";
  const showsNumbers = widgets.healthNumber.visible || widgets.armorNumber.visible;
  return (
    <>
      <Section title={tr("Цифры")}>
        <Toggle
          label={tr("Цифры HP")}
          checked={widgets.healthNumber.visible}
          onChange={(visible) => toggleWidget("healthNumber", visible)}
        />
        <Toggle
          label={tr("Цифры брони")}
          checked={widgets.armorNumber.visible && !combined}
          disabled={combined}
          onChange={(visible) => toggleWidget("armorNumber", visible)}
        />
        {combined && (
          <p className="mmc-section-hint">
            {tr("Одна цифра на месте цифр HP: пока есть броня — броня, потом HP («Урон»).")}
          </p>
        )}
        {numbersInsideHole(config) && (
          <p className="mmc-section-hint">
            {tr("Мелкие цифры в игре не читаются: сделайте значок крупнее.")}
          </p>
        )}
      </Section>
      <Fine>
        <Section title={tr("Расстановка цифр")}>
        {onPlacing && (
          <Toggle label={tr("Ставить щелчком по карте")} checked={placing} onChange={onPlacing} />
        )}
        {placing && (
          <>
            <SegmentedControl
              label={tr("Щелчок по карте ставит")}
              size="sm"
              value={target}
              onChange={onTarget}
              options={numberTargets().map((item) => ({
                ...item,
                disabled: combined && item.value === "armorNumber",
              }))}
            />
            <p className="mmc-section-hint">
              {target === "armorNumber"
                ? tr("Щёлкните по карте — цифры брони встанут туда. Поставленные цифры тянут мышью и двигают стрелками.")
                : tr("Щёлкните по карте — цифры HP встанут туда. Поставленные цифры тянут мышью и двигают стрелками.")}
            </p>
          </>
        )}
        {!placing && (
          <p className="mmc-section-hint">
            {tr("Цифры стоят отдельно от значков: тяните их по карте мышью или двигайте стрелками.")}
          </p>
        )}
        </Section>
      </Fine>
      {showsNumbers && (
        <Fine>
        <Section title={tr("Вид цифр")}>
          <VisibilityChoice
            label={tr("Шрифт")}
            value={effects.numberFont}
            options={fontChoices()}
            onChange={(numberFont) =>
              patchEffects(
                { numberFont },
                numberFont === "regular" ? tr("Шрифт цифр — обычный") : tr("Шрифт цифр — узкий HUD"),
              )
            }
          />
          <GameFontsLink />
          <Slider
            label={tr("Размер цифр")}
            value={effects.numberSize}
            min={MINIMAP_NUMBER_SIZE_LIMITS[0]}
            max={MINIMAP_NUMBER_SIZE_LIMITS[1]}
            unit=" px"
            onChange={(numberSize) => patchEffects({ numberSize }, tr("Изменён размер цифр"))}
          />
          <ColorControl
            label={tr("Цвет цифр HP")}
            value={effects.healthNumberColor}
            onChange={(healthNumberColor) =>
              patchEffects({ healthNumberColor }, tr("Изменён цвет цифр HP"))
            }
          />
          {!combined && (
            <ColorControl
              label={tr("Цвет цифр брони")}
              value={effects.armorNumberColor}
              onChange={(armorNumberColor) =>
                patchEffects({ armorNumberColor }, tr("Изменён цвет цифр брони"))
              }
            />
          )}
          <p className="mmc-section-hint">
            {tr("В игре цифры пишет шрифт HUD самой игры; в кадре — шрифт Astral той же ширины: шрифтов Rockstar в поставке нет.")}
          </p>
        </Section>
        </Fine>
      )}
    </>
  );
}
