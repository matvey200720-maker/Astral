/*
 * Готовые пресеты ReShade (ТЗ 17.10, задача 8; с ТЗ 23.10, п. G, — на одной странице с установкой и DLSS 5): восемь
 * карточек в один щелчок. На каждой настоящий кадр игры «без пресета / с пресетом» (честно подписанный: обработано
 * приложением, не кадр игры с пресетом) и кнопка «Применить». «Применить» ставит ReShade во все найденные проекты, если
 * его ещё нет, кладёт шейдер Astral.fx и пресеты и делает выбранный активным в ReShade.ini. Пресеты и DLSS 5 не зависят
 * друг от друга: «Без пресета» не трогает нейросеть и не удаляет ReShade. Что и куда кладёт установка —
 * `reshade-installer.js`.
 */

import { Check, Prohibit } from "../../components/ui/icons.jsx";
import {
  RESHADE_PRESETS,
  RESHADE_STYLE_IDS,
  reshadeMenuKeyByVk,
  reshadePresetTechniques,
} from "@modovik/optimizer/reshade.js";
import { hasDesktopBridge } from "../../api.js";
import Button from "../../components/ui/Button.jsx";

import { PresetShot } from "./ReshadePresetPreview.jsx";
import { useUiLanguage } from "../../locales/ui.js";
import { reshadeCopyFor } from "./reshade-copy.js";
import { reshadePageCopyFor } from "./reshade-page-copy.js";
import { reshadePresetsCopyFor } from "./reshade-presets-copy.js";
import { outcomeParts } from "./reshade-outcome.js";

/* Граница «до/после» идёт за курсором по плитке: значение кладётся прямо в стиль плитки, без перерисовки React. */
function followPointer(event) {
  const box = event.currentTarget.getBoundingClientRect();
  if (!box.width) return;
  const share = ((event.clientX - box.left) / box.width) * 100;
  event.currentTarget.style.setProperty(
    "--reshade-hover-split",
    `${Math.min(100, Math.max(0, share)).toFixed(1)}%`,
  );
}

function leavePointer(event) {
  event.currentTarget.style.removeProperty("--reshade-hover-split");
}

export default function ReshadePresets({ ctrl, onNotice }) {
  const language = useUiLanguage();
  const copy = reshadePresetsCopyFor(language);
  const pageCopy = reshadePageCopyFor(language);
  const dlssCopy = reshadeCopyFor(language);
  const { state, busy, run, presetOn, menuKey, projectFor, reshadeMissing } =
    ctrl;
  const nameOf = (id) => copy.presets[id]?.name ?? "";
  const canApply = hasDesktopBridge() && !busy && !reshadeMissing;

  async function apply(id) {
    const result = await run(`preset:${id}`, projectFor({ preset: id }));
    if (!result) return;
    onNotice?.(
      pageCopy.presetNotice({
        preset: nameOf(id),
        key: reshadeMenuKeyByVk(menuKey).label,
        ...outcomeParts(result, state, pageCopy, dlssCopy),
      }),
    );
  }

  async function removePreset() {
    const result = await run("preset-off", projectFor({ preset: "" }));
    if (!result) return;
    onNotice?.(presetOn ? copy.offNotice : copy.offNothing);
  }

  return (
    <section className="reshade-presets" aria-label={copy.listAria}>
      <header className="reshade-presets-head">
        <div>
          <h2>{copy.listTitle}</h2>
          <p className="fx-hint">{pageCopy.presetsNote}</p>
        </div>
        <Button
          size="sm"
          icon={<Prohibit />}
          disabled={!hasDesktopBridge() || Boolean(busy) || !presetOn}
          onClick={() => void removePreset()}
        >
          {busy === "preset-off" ? copy.offBusy : copy.offButton}
        </Button>
      </header>
      {RESHADE_STYLE_IDS.includes(presetOn) ? (
        <p className="fx-hint">{copy.styleNote}</p>
      ) : null}
      <p className="fx-hint">{copy.previewCaption}</p>
      <div className="reshade-preset-grid">
        {RESHADE_PRESETS.map((preset) => {
          const active = presetOn === preset.id;
          const loading = busy === `preset:${preset.id}`;
          const glow = reshadePresetTechniques(preset.id).includes(
            "AstralBloom",
          );
          return (
            <article
              className={`reshade-preset${active ? " is-active" : ""}${loading ? " is-loading" : ""}`}
              key={preset.id}
              data-preset={preset.id}
            >
              <div
                className="reshade-preset-thumb"
                onPointerMove={followPointer}
                onPointerLeave={leavePointer}
              >
                <PresetShot presetId={preset.id} name={nameOf(preset.id)} />
                <span className="reshade-preset-cost">
                  {glow ? copy.costGlow : copy.costLight}
                </span>
                {active ? (
                  <span className="reshade-preset-badge" aria-hidden="true">
                    <Check weight="bold" />
                  </span>
                ) : null}
                <div className="reshade-preset-copy">
                  <b>{nameOf(preset.id)}</b>
                  <p>{copy.presets[preset.id]?.text}</p>
                </div>
                <button
                  type="button"
                  className="reshade-preset-apply"
                  disabled={!canApply || active}
                  onClick={() => void apply(preset.id)}
                >
                  <span>
                    {loading
                      ? copy.applying
                      : active
                        ? copy.applied
                        : copy.apply}
                  </span>
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
