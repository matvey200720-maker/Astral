import { useEffect, useState } from "react";
import {
  SCREEN_RESOLUTION_LIMITS,
  normalizeScreenResolution,
  screenFormByName,
} from "@modovik/minimap-contract";
import Button from "../../../ui/Button.jsx";
import Select from "../../../ui/Select.jsx";
import TextField from "../../../ui/TextField.jsx";
import {
  SCREEN_FORM_CHOICES,
  gameScreenForm,
} from "../../../../features/workshop/game-screen/game-screen-view.js";
import {
  minimapWithMonitor,
  minimapWithoutMonitor,
} from "../../../../features/workshop/game-screen/minimap-viewport.js";
import { tr, useTr } from "../../../../locales/ui.js";
import { trFill } from "../../../../locales/tr-fill.js";

/*
 * «Разрешение игры» в «Положении карты» (владелец, 22.11.2026: «чтобы ты мог разрешение своё ставить, какое у тебя разрешение в игре, мог
 * указать любое разрешение плюс формат, чтобы чётко всё подставить»).
 *
 * Готовые разрешения — кнопками, «своё» — ширина и высота числами и формат из девяти форм игры. Выбор пишется в проект
 * (`targetViewport.monitor` и форма окна `targetViewport.aspect`), поэтому возвращается после перезапуска окна, а кадр предпросмотра
 * идёт за ним: растяжение (4:3 на 1920×1080) и зум «в размер игры». Места на экране считаются в долях формата, и разрешение на них не
 * влияет — карта встанет туда же на любом разрешении того же формата; в фильм мини-карты разрешение не попадает.
 *
 * Явный выбор (готовое, своё число, формат) ведёт и установку: `minimapWithMonitor` пишет `gameAspect: "screen"`, и положение считается под выбранный
 * формат, а не под найденный в настройках игры. «Как в игре» убирает и разрешение, и признак — читается настоящий экран. Если выбранное
 * отличается от найденного в настройках игры, под выбором стоит одна спокойная строка с обоими числами.
 */

/* Готовые: разрешение и формат игры. «Растянутое» — формат 4:3 на экране 16:9, как у многих игроков. */
const PRESETS = Object.freeze([
  Object.freeze({ id: "1920x1080", width: 1920, height: 1080, form: "16:9" }),
  Object.freeze({ id: "2560x1440", width: 2560, height: 1440, form: "16:9" }),
  Object.freeze({ id: "3440x1440", width: 3440, height: 1440, form: "21:9" }),
  Object.freeze({ id: "1280x1024", width: 1280, height: 1024, form: "5:4" }),
  Object.freeze({ id: "1024x768", width: 1024, height: 768, form: "4:3" }),
  Object.freeze({
    id: "stretched",
    width: 1920,
    height: 1080,
    form: "4:3",
    stretched: true,
  }),
]);

const sizeText = (resolution) => `${resolution.width}×${resolution.height}`;

export default function ResolutionControls({
  config,
  commit,
  screenInfo,
  gameInfo = null,
}) {
  useTr();
  const viewport = config.targetViewport;
  const monitor = viewport.monitor ?? null;
  const known =
    screenInfo?.width > 0 && screenInfo?.height > 0
      ? { width: screenInfo.width, height: screenInfo.height }
      : null;
  const shown = monitor ?? known;
  const [width, setWidth] = useState(shown ? String(shown.width) : "");
  const [height, setHeight] = useState(shown ? String(shown.height) : "");
  /* Проект поменялся не из полей (отмена, пресет, другое окно) — поля читают его заново. */
  const shownWidth = shown?.width;
  const shownHeight = shown?.height;
  useEffect(() => {
    setWidth(shownWidth ? String(shownWidth) : "");
    setHeight(shownHeight ? String(shownHeight) : "");
  }, [shownWidth, shownHeight]);

  const inset = screenInfo?.inset;
  const [minW, maxW] = SCREEN_RESOLUTION_LIMITS.width;
  const [minH, maxH] = SCREEN_RESOLUTION_LIMITS.height;
  const apply = (resolution, formName, label) =>
    commit(
      minimapWithMonitor(config, resolution, formName, { inset }),
      label,
      "targetViewport",
    );
  const typed = normalizeScreenResolution({ width, height });
  const widthBad =
    width !== "" && !normalizeScreenResolution({ width, height: minH });
  const heightBad =
    height !== "" && !normalizeScreenResolution({ width: minW, height });
  const commitTyped = () => {
    if (!typed) return;
    if (
      monitor &&
      monitor.width === typed.width &&
      monitor.height === typed.height
    )
      return;
    apply(typed, null, `${tr("Разрешение игры")}: ${sizeText(typed)}`);
  };
  const pickFormat = (name) => {
    if (name === viewport.aspect) return;
    const form = screenFormByName(name);
    if (!form) return;
    apply(
      typed ?? shown ?? { width: form.width, height: form.height },
      name,
      `${tr("Формат")}: ${name}`,
    );
  };
  const isOn = (preset) =>
    monitor?.width === preset.width &&
    monitor?.height === preset.height &&
    viewport.aspect === preset.form;
  const customActive = Boolean(monitor) && !PRESETS.some(isOn);
  const range = (a, b) => trFill("Допустимо от {0} до {1}", a, b);
  /* Одна спокойная строка, когда выбранное отличается от найденного в настройках игры: установка считает под выбранное. */
  const game = gameInfo?.known ? gameInfo : null;
  const gameForm = gameScreenForm(gameInfo);
  const gameText = game
    ? game.resolution
      ? `${game.resolution} (${gameForm?.name ?? game.form})`
      : String(gameForm?.name ?? game.form)
    : "";
  const chosenText = monitor ? sizeText(monitor) : "";
  const differs =
    Boolean(monitor) &&
    (!game ||
      (game.width > 0 &&
        game.height > 0 &&
        (game.width !== monitor.width || game.height !== monitor.height)) ||
      gameForm?.name !== viewport.aspect);
  const note = !monitor
    ? ""
    : !differs
      ? ""
      : game
        ? trFill(
            "В настройках игры сейчас {0}. Мини-карта будет рассчитана под выбранное: {1} ({2})",
            gameText,
            chosenText,
            viewport.aspect,
          )
        : trFill(
            "Настройки игры не прочитаны. Мини-карта будет рассчитана под выбранное: {0} ({1})",
            chosenText,
            viewport.aspect,
          );
  return (
    <div className="mmc-resolution" data-resolution>
      <div
        className="mmc-resolution-presets"
        role="group"
        aria-label={tr("Готовые разрешения")}
      >
        {PRESETS.map((preset) => (
          <Button
            key={preset.id}
            variant="secondary"
            size="sm"
            aria-pressed={isOn(preset)}
            data-preset={preset.id}
            onClick={() =>
              apply(
                preset,
                preset.form,
                `${tr("Разрешение игры")}: ${sizeText(preset)}, ${preset.form}`,
              )
            }
          >
            {preset.stretched
              ? trFill("Растянутое {0} на {1}", preset.form, sizeText(preset))
              : sizeText(preset)}
          </Button>
        ))}
      </div>
      {/* «Своё разрешение» — под одной строкой: готовых вариантов хватает большинству; если выбрано своё число, раздел открыт. */}
      <details className="mmc-resolution-own" open={customActive}>
        <summary className="mmc-resolution-own-summary">
          {tr("Своё разрешение")}
        </summary>
        <div className="mmc-resolution-custom">
          <TextField
            label={tr("Ширина экрана, px")}
            type="number"
            inputMode="numeric"
            min={minW}
            max={maxW}
            value={width}
            error={widthBad ? range(minW, maxW) : null}
            onChange={setWidth}
            onBlur={commitTyped}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitTyped();
            }}
          />
          <TextField
            label={tr("Высота экрана, px")}
            type="number"
            inputMode="numeric"
            min={minH}
            max={maxH}
            value={height}
            error={heightBad ? range(minH, maxH) : null}
            onChange={setHeight}
            onBlur={commitTyped}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitTyped();
            }}
          />
          <Select
            label={tr("Формат игры")}
            value={viewport.aspect}
            options={SCREEN_FORM_CHOICES.map((form) => [form.name, form.name])}
            onChange={pickFormat}
          />
        </div>
        <p className="mmc-section-hint">
          {tr(
            "Разрешение меняет предпросмотр и растяжение кадра. Карта встанет на экране туда же при любом разрешении того же формата.",
          )}
        </p>
      </details>
      {note ? (
        <p className="mmc-section-hint" data-resolution-note>
          {note}
        </p>
      ) : null}
      {monitor ? (
        <Button
          variant="secondary"
          size="sm"
          className="mmc-resolution-reset"
          aria-label={tr("Разрешение игры: как в игре")}
          onClick={() =>
            commit(
              minimapWithoutMonitor(config),
              tr("Разрешение игры: как в игре"),
              "targetViewport",
            )
          }
        >
          {tr("Как в игре")}
        </Button>
      ) : null}
    </div>
  );
}
