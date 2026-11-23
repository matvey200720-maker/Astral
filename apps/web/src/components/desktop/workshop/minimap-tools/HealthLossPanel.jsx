import { TextT } from "../../../ui/icons.jsx";
import { DEFAULT_MINIMAP_EFFECTS, MINIMAP_DAMAGE_NUMBER_LIMITS } from "@modovik/minimap-contract";
import Button from "../../../ui/Button.jsx";
import Slider from "../../../ui/Slider.jsx";
import { ColorControl, Section, Toggle, VisibilityChoice, pickFields } from "./parts.jsx";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * «Как отнимается HP» (задача 15 ТЗ 10.10.2026, вечер). Владелец: «у тебя
 * 100 ХП и 100 на бронежилете. В тебя стреляют — на мини-карте ты можешь
 * выставить, что броня начинает отниматься с сотки до нуля, потом ХП с сотки
 * до нуля… Сделай, чтобы появления были разные, и человек выбирал, как
 * именно у него отнимается ХП на мини-карте».
 *
 * Здесь три вещи, и все уходят в игру правкой minimap.gfx:
 *   • как меняются цифры: сразу, как полоса игры, или счётом вниз — цифра
 *     тает до нового значения с выбранной скоростью;
 *   • сколько цифр: у каждой полосы своя или одна — пока есть броня, она
 *     считает броню, потом HP;
 *   • вылетающие цифры урона и лечения (задача 8 утром) — с видом вылета:
 *     вверх, вниз, вспышкой на месте или в сторону.
 */

const modeChoices = () => [
  ["game", tr("Сразу")],
  ["countdown", tr("Счёт вниз")],
];
const speedChoices = () => [
  ["fast", tr("Быстро")],
  ["normal", tr("Обычно")],
  ["slow", tr("Медленно")],
];
const displayChoices = () => [
  ["separate", tr("У каждой своя")],
  ["combined", tr("Одна общая")],
];
const floatStyleChoices = () => [
  ["rise", tr("Вверх")],
  ["fall", tr("Вниз")],
  ["pop", tr("Вспышкой")],
  ["side", tr("В сторону")],
];

export const LOSS_FIELDS = Object.freeze(["lossMode", "lossDisplay", "lossSpeed"]);
export const DAMAGE_NUMBER_FIELDS = Object.freeze([
  "damageNumbers",
  "floatingHealthDamage",
  "floatingArmorDamage",
  "floatingHeal",
  "damageNumberColor",
  "armorDamageNumberColor",
  "healNumberColor",
  "damageNumberSize",
  "damageNumberDurationMs",
  "floatStyle",
]);
const sameFields = (effects, fields) =>
  fields.every((field) => effects[field] === DEFAULT_MINIMAP_EFFECTS[field]);

export default function HealthLossPanel({ config, patchEffects, onShowNumbers }) {
  useTr();
  const { effects, layout } = config;
  const numbersOnMap = layout.widgets.healthNumber.visible || layout.widgets.armorNumber.visible;
  return (
    <>
      <Section
        title={tr("Как отнимается HP")}
        standard={sameFields(effects, LOSS_FIELDS)}
        onStandard={() =>
          patchEffects(pickFields(DEFAULT_MINIMAP_EFFECTS, LOSS_FIELDS), tr("Цифры меняются сразу, как в игре"))
        }
      >
        <VisibilityChoice
          label={tr("Как меняются")}
          value={effects.lossMode}
          options={modeChoices()}
          onChange={(lossMode) =>
            patchEffects(
              { lossMode },
              lossMode === "countdown" ? tr("Цифры считают вниз") : tr("Цифры меняются сразу"),
            )
          }
        />
        {effects.lossMode === "countdown" && (
          <VisibilityChoice
            label={tr("Скорость счёта")}
            value={effects.lossSpeed}
            options={speedChoices()}
            onChange={(lossSpeed) => patchEffects({ lossSpeed }, tr("Изменена скорость счёта"))}
          />
        )}
        <VisibilityChoice
          label={tr("Сколько цифр")}
          value={effects.lossDisplay}
          options={displayChoices()}
          onChange={(lossDisplay) =>
            patchEffects(
              { lossDisplay },
              lossDisplay === "combined"
                ? tr("Одна цифра: сначала броня, потом HP")
                : tr("У каждой полосы своя цифра"),
            )
          }
        />
        <p className="mmc-section-hint">
          {effects.lossDisplay === "combined"
            ? tr("Одна цифра на месте цифр HP: в вас стреляют — она считает броню до нуля, потом HP. Броня у игры всегда уходит первой.")
            : tr("Броня у игры уходит первой: сперва тает её цифра, потом цифра HP.")}
        </p>
        {!numbersOnMap && (
          <div className="mmc-loss-numbers">
            <p className="mmc-section-hint">
              {tr("Цифр на карте сейчас нет — считать нечему.")}
            </p>
            <Button variant="secondary" size="sm" icon={<TextT />} onClick={onShowNumbers}>
              {tr("Показать цифры")}
            </Button>
          </div>
        )}
      </Section>
      <Section
        title={tr("Вылетающие цифры")}
        standard={sameFields(effects, DAMAGE_NUMBER_FIELDS)}
        onStandard={() =>
          patchEffects(
            pickFields(DEFAULT_MINIMAP_EFFECTS, DAMAGE_NUMBER_FIELDS),
            tr("Вылетающие цифры — выключены, как в игре"),
          )
        }
      >
        <Toggle
          label={tr("Цифры урона из полос")}
          checked={effects.damageNumbers}
          onChange={(damageNumbers) =>
            patchEffects(
              { damageNumbers },
              damageNumbers ? tr("Включены вылетающие цифры урона") : tr("Выключены вылетающие цифры урона"),
            )
          }
        />
        {effects.damageNumbers && (
          <>
            <VisibilityChoice
              label={tr("Как вылетают")}
              value={effects.floatStyle}
              options={floatStyleChoices()}
              onChange={(floatStyle) => patchEffects({ floatStyle }, tr("Изменён вылет цифр"))}
            />
            <Toggle
              label={tr("Урон по HP")}
              checked={effects.floatingHealthDamage}
              onChange={(floatingHealthDamage) =>
                patchEffects({ floatingHealthDamage }, tr("Изменены цифры урона по HP"))
              }
            />
            {effects.floatingHealthDamage && (
              <ColorControl
                label={tr("Цвет урона по HP")}
                value={effects.damageNumberColor}
                onChange={(damageNumberColor) =>
                  patchEffects({ damageNumberColor }, tr("Изменён цвет цифр урона по HP"))
                }
              />
            )}
            <Toggle
              label={tr("Урон по броне")}
              checked={effects.floatingArmorDamage}
              onChange={(floatingArmorDamage) =>
                patchEffects({ floatingArmorDamage }, tr("Изменены цифры урона по броне"))
              }
            />
            {effects.floatingArmorDamage && (
              <ColorControl
                label={tr("Цвет урона по броне")}
                value={effects.armorDamageNumberColor}
                onChange={(armorDamageNumberColor) =>
                  patchEffects({ armorDamageNumberColor }, tr("Изменён цвет цифр урона по броне"))
                }
              />
            )}
            <Toggle
              label={tr("Лечение")}
              checked={effects.floatingHeal}
              onChange={(floatingHeal) => patchEffects({ floatingHeal }, tr("Изменены цифры лечения"))}
            />
            {effects.floatingHeal && (
              <ColorControl
                label={tr("Цвет лечения")}
                value={effects.healNumberColor}
                onChange={(healNumberColor) =>
                  patchEffects({ healNumberColor }, tr("Изменён цвет цифр лечения"))
                }
              />
            )}
            <Slider
              label={tr("Размер цифр")}
              value={effects.damageNumberSize}
              min={MINIMAP_DAMAGE_NUMBER_LIMITS.size[0]}
              max={MINIMAP_DAMAGE_NUMBER_LIMITS.size[1]}
              unit=" px"
              onChange={(damageNumberSize) =>
                patchEffects({ damageNumberSize }, tr("Изменён размер вылетающих цифр"))
              }
            />
            <Slider
              label={tr("Длительность полёта")}
              value={effects.damageNumberDurationMs}
              min={MINIMAP_DAMAGE_NUMBER_LIMITS.durationMs[0]}
              max={MINIMAP_DAMAGE_NUMBER_LIMITS.durationMs[1]}
              step={50}
              unit={tr(" мс")}
              onChange={(damageNumberDurationMs) =>
                patchEffects({ damageNumberDurationMs }, tr("Изменена длительность вылетающих цифр"))
              }
            />
            <p className="mmc-section-hint">
              {tr("Цифра вылетает из своей полосы и гаснет: столько, сколько полосы ушло или пришло; три удара подряд — три цифры.")}
            </p>
          </>
        )}
      </Section>
    </>
  );
}
