import { DEFAULT_RETICLE_ANIMATION, RETICLE_ANIMATION_LIMITS } from "@modovik/reticle-contract";
import Button from "../../../ui/Button.jsx";
import ColorField from "../../../ui/ColorField.jsx";
import Slider from "../../../ui/Slider.jsx";
import Switch from "../../../ui/Switch.jsx";
import { tr, useTr } from "../../../../locales/ui.js";
import { RETICLE_SWATCHES } from "./ReticleInspector.jsx";

/*
 * Раздел «Анимация» у прицела (10.11.2026; данные — Хелпер 28, `@modovik/reticle-contract/animation.js`): плавное затухание и появление, пульс на попадании и перелив цвета.
 *
 * Всё выключено по умолчанию, прежний прицел собирается байт в байт. Что игра присылает и чего нет:
 *  • затухание и появление работают, пока игра сама просит «притушить» прицел (`START_DIM_RETICLE`); решает ли движок на отпускании звать его или прячет прицел целиком — это
 *    зависит от игры и проверяется на стенде, поэтому раздел прямо так и подписан и ничего не обещает;
 *  • события выстрела в прицел игра не шлёт — есть только попадание, поэтому пульс — «при попадании», а не «при выстреле»;
 *  • у снайперской оптики из этого есть только перелив: затухание, появление и отметку попадания её роликов игра не вызывает.
 * Пределы и шаги ползунков — `RETICLE_ANIMATION_LIMITS`, те же числа зажимает компилятор.
 */

/**
 * Перелив в окне: готов ли на стороне сборки (`reticle-gfx-compiler.js`, клип из кадров с цветом). В игре вращение клипа внутри прицела не проверено (строка H28-5 стенда):
 * если стенд не подтвердит, достаточно выставить `false` — переключатель и цвета пропадут, остальное не изменится.
 */
export const RETICLE_SHIMMER_AVAILABLE = true;

/** Число секунд с тем же числом знаков, что у шага дорожки (0,05 — два, 0,1 — один). */
const fixed = (step) => (value) => Number(value).toFixed(String(step).split(".")[1]?.length ?? 0);

/**
 * @param {object} props
 * @param {"ordinary" | "sniper"} props.kind
 * @param {object} props.animation `normalizeReticleAnimation(...)`
 * @param {(change: object, label: string, property: string) => void} props.onPatch правка поля `animation` целиком
 * @param {(kind: "fade" | "pulse") => void} props.onPlay сыграть показ в кадре
 * @param {"fade" | "pulse" | null} [props.playing]
 */
export default function ReticleAnimationPanel({ kind, animation, onPatch, onPlay, playing = null }) {
  useTr();
  const limits = RETICLE_ANIMATION_LIMITS;
  const patch = (change, label, property) => onPatch({ ...animation, ...change }, label, property);
  const colours = animation.shimmerColours;
  const setColour = (at, value) => patch({ shimmerColours: colours.map((colour, index) => (index === at ? value : colour)) }, tr("Изменены цвета перелива"), "shimmerColours");
  return (
    <section className="ui-panel fx-section reticle-animation" aria-label={tr("Анимация")}>
      {kind === "ordinary" && (
        <>
          <Slider
            editable
            label={tr("Затухание")}
            hint={tr("Зависит от игры: работает, пока игра сама просит притушить прицел. Если прицел гаснет сразу, затухания не будет.")}
            /* Ноль дорожки — «как в игре» (0,01 с: штатный шаг одним ударом); так шаг 0,05 ложится на круглые 0,05, 0,10 … без сетки от 0,01. */
            value={animation.fadeSeconds <= limits.fadeSeconds.min ? 0 : animation.fadeSeconds}
            min={0}
            max={limits.fadeSeconds.max}
            step={limits.fadeSeconds.step}
            unit={animation.fadeSeconds <= limits.fadeSeconds.min ? "" : ` ${tr("с")}`}
            format={(value) => (value <= 0 ? tr("как в игре") : fixed(limits.fadeSeconds.step)(value))}
            onChange={(next) => patch({ fadeSeconds: next <= 0 ? limits.fadeSeconds.min : next }, tr("Изменено затухание прицела"), "fadeSeconds")}
          />
          <Slider
            editable
            label={tr("Появление")}
            value={animation.appearSeconds}
            min={limits.appearSeconds.min}
            max={limits.appearSeconds.max}
            step={limits.appearSeconds.step}
            unit={animation.appearSeconds <= 0 ? "" : ` ${tr("с")}`}
            format={(value) => (value <= 0 ? tr("сразу") : fixed(limits.appearSeconds.step)(value))}
            onChange={(appearSeconds) => patch({ appearSeconds }, tr("Изменено появление прицела"), "appearSeconds")}
          />
          <Button variant="secondary" size="sm" disabled={playing === "fade"} onClick={() => onPlay("fade")}>
            {tr("Показать затухание")}
          </Button>
          <p className="fx-hint">{tr("В кадре прицел гаснет до условных 20 %: сколько оставить, присылает сама игра.")}</p>

          <label className="ui-field reticle-toggle">
            <span>{tr("Пульс при попадании")}</span>
            <Switch
              checked={animation.hitPulse}
              label={tr("Пульс при попадании")}
              onChange={(hitPulse) => patch({ hitPulse }, hitPulse ? tr("Включён пульс при попадании") : tr("Выключен пульс при попадании"), "hitPulse")}
            />
          </label>
          {animation.hitPulse && (
            <>
              <Slider
                editable
                label={tr("Сила пульса")}
                value={animation.hitPulseStrength}
                min={limits.hitPulseStrength.min}
                max={limits.hitPulseStrength.max}
                step={limits.hitPulseStrength.step}
                unit=" %"
                onChange={(hitPulseStrength) => patch({ hitPulseStrength }, tr("Изменена сила пульса"), "hitPulseStrength")}
              />
              <Slider
                editable
                label={tr("Длительность пульса")}
                value={animation.hitPulseSeconds}
                min={limits.hitPulseSeconds.min}
                max={limits.hitPulseSeconds.max}
                step={limits.hitPulseSeconds.step}
                unit={` ${tr("с")}`}
                format={fixed(limits.hitPulseSeconds.step)}
                onChange={(hitPulseSeconds) => patch({ hitPulseSeconds }, tr("Изменена длительность пульса"), "hitPulseSeconds")}
              />
              <Button variant="secondary" size="sm" disabled={playing === "pulse"} onClick={() => onPlay("pulse")}>
                {tr("Показать попадание")}
              </Button>
              <p className="fx-hint">{tr("Игра сообщает о попадании, а не о выстреле: пульс идёт на отметке попадания.")}</p>
            </>
          )}
        </>
      )}
      {kind === "sniper" && (
        <p className="fx-hint">{tr("Затухание, появление и пульс — у обычного прицела: у снайперской оптики игра их не вызывает.")}</p>
      )}

      {RETICLE_SHIMMER_AVAILABLE && (
        <>
          <label className="ui-field reticle-toggle">
            <span>{tr("Перелив")}</span>
            <Switch
              checked={animation.shimmer}
              label={tr("Перелив")}
              onChange={(shimmer) => patch({ shimmer }, shimmer ? tr("Включён перелив прицела") : tr("Выключен перелив прицела"), "shimmer")}
            />
          </label>
          {animation.shimmer && (
            <>
              <div className="reticle-shimmer-colours" role="group" aria-label={tr("Цвета перелива")}>
                {colours.map((colour, at) => (
                  <div className="reticle-shimmer-colour" key={at}>
                    <ColorField
                      label={`${tr("Цвет")} ${at + 1}`}
                      value={colour}
                      swatches={RETICLE_SWATCHES}
                      onChange={(value) => setColour(at, value)}
                    />
                    {colours.length > limits.shimmerColours.min && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`${tr("Убрать цвет")} ${at + 1}`}
                        onClick={() => patch({ shimmerColours: colours.filter((_, index) => index !== at) }, tr("Изменены цвета перелива"), "shimmerColours")}
                      >
                        {tr("Убрать цвет")}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              {colours.length < limits.shimmerColours.max && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    patch(
                      { shimmerColours: [...colours, DEFAULT_RETICLE_ANIMATION.shimmerColours[colours.length % DEFAULT_RETICLE_ANIMATION.shimmerColours.length]] },
                      tr("Изменены цвета перелива"),
                      "shimmerColours",
                    )
                  }
                >
                  {tr("Добавить цвет")}
                </Button>
              )}
              <Slider
                editable
                label={tr("Один оборот")}
                value={animation.shimmerSeconds}
                min={limits.shimmerSeconds.min}
                max={limits.shimmerSeconds.max}
                step={limits.shimmerSeconds.step}
                unit={` ${tr("с")}`}
                format={fixed(limits.shimmerSeconds.step)}
                onChange={(shimmerSeconds) => patch({ shimmerSeconds }, tr("Изменён оборот перелива"), "shimmerSeconds")}
              />
              <p className="fx-hint">{tr("Прицел плавно переходит от цвета к цвету по кругу, и основной цвет в покое не виден. На цели цвет, как и раньше, задаёт игра.")}</p>
            </>
          )}
        </>
      )}
    </section>
  );
}
