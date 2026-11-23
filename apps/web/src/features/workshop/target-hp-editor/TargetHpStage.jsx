import { MagnifyingGlassPlus, Monitor } from "../../../components/ui/icons.jsx";
import { RETICLE_STAGE } from "@modovik/reticle-contract";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import { StageBar, StageNote } from "../../../components/ui/StageOverlay.jsx";
import HudPreviewWindow from "../../../components/desktop/workshop/hud-preview/HudPreviewWindow.jsx";
import { HUD_MATTE_SCENE } from "../../../components/desktop/workshop/hud-preview/hud-scenes.js";
import { useAmmoFontsReady } from "../../../components/desktop/workshop/reticle/ReticleAmmo.jsx";
import { stageFocusTail } from "../../../components/desktop/workshop/reticle-lang.js";
import { tr, useTr, useUiLanguage } from "../../../locales/ui.js";
import { TARGET_HP_EXAMPLES, TargetHealthArt, targetHealthExample, targetHealthFocus } from "./target-hp-art.jsx";

/*
 * Кадр «Полоски HP»: экран игры 1280×720 точек (та же сцена HUD, что у
 * прицела) в общем двумерном окне, на нём — постановочная сцена с тремя
 * игроками (`target-hp-art.jsx`). «Весь экран» — как метки стоят на экране,
 * «Крупно» — метка того, на кого навелись: в игре она мелкая, а разглядеть
 * надо толщину, цвета и цифры. Фон — тёмный, серый или светлый: белая
 * полоска на ярком небе читается хуже, и это видно сразу. «Пример» — сколько
 * HP и брони у того, на кого навелись: по умолчанию полное HP без брони, то
 * есть штатная белая полоска.
 */

const SCENES = Object.freeze([HUD_MATTE_SCENE]);

export const TARGET_HP_BACKDROPS = Object.freeze([
  Object.freeze({ id: "dark", label: "Тёмный фон", colour: null, swatch: "#141517" }),
  Object.freeze({ id: "grey", label: "Серый фон", colour: "#6f747c", swatch: "#6f747c" }),
  Object.freeze({ id: "light", label: "Светлый фон", colour: "#dfe3e8", swatch: "#dfe3e8" }),
]);

function BackdropPicker({ value, onChange }) {
  return (
    <div className="target-hp-backdrops" role="radiogroup" aria-label="Фон под игроками">
      {TARGET_HP_BACKDROPS.map((item) => (
        <button
          type="button"
          key={item.id}
          role="radio"
          aria-checked={value === item.id}
          aria-label={item.label}
          title={item.label}
          className={`ui-color-swatch${value === item.id ? " is-active" : ""}`}
          style={{ background: item.swatch }}
          onClick={() => onChange(item.id)}
        />
      ))}
    </div>
  );
}

export default function TargetHpStage({ config, view, onView, backdrop, onBackdrop, example, onExample }) {
  useTr();
  const language = useUiLanguage();
  const fontsReady = useAmmoFontsReady();
  const focus = view === "zoom" ? targetHealthFocus() : null;
  const zoom = focus ? focus.zoom : 1;
  const width = RETICLE_STAGE.width / zoom;
  const height = RETICLE_STAGE.height / zoom;
  const left = (focus?.x || 0) - width / 2;
  const top = (focus?.y || 0) - height / 2;
  const colour = TARGET_HP_BACKDROPS.find((item) => item.id === backdrop)?.colour;
  return (
    <div className="target-hp-stage" data-frost="off">
      <div className="target-hp-scene">
        <HudPreviewWindow className="target-hp-preview" design={RETICLE_STAGE} frames={SCENES}>
          <svg viewBox={`${left} ${top} ${width} ${height}`} role="img" aria-label="Игроки с полоской HP над головой">
            {colour && <rect x={left} y={top} width={width} height={height} fill={colour} />}
            <TargetHealthArt config={config} example={targetHealthExample(example)} />
          </svg>
        </HudPreviewWindow>
      </div>
      <StageBar className="target-hp-stage-bar">
        <SegmentedControl
          label="Масштаб кадра"
          size="sm"
          value={view}
          onChange={onView}
          options={[
            { value: "screen", label: "Весь экран", icon: <Monitor /> },
            { value: "zoom", label: view === "zoom" ? `Крупно ×${zoom}` : "Крупно", icon: <MagnifyingGlassPlus /> },
          ]}
        />
        <SegmentedControl
          label="Сколько HP и брони у того, на кого навелись"
          size="sm"
          value={targetHealthExample(example).id}
          onChange={onExample}
          options={TARGET_HP_EXAMPLES.map((item) => ({ value: item.id, label: item.label, title: item.note }))}
        />
        <BackdropPicker value={backdrop} onChange={onBackdrop} />
      </StageBar>
      {/* Строки состояния кадра — в панели редактора, не на картинке. */}
      <StageNote>
        {tr("Над головой — метка игрока GTA: имя и полоска; полоска — та же раскладка, что уйдёт в mp_gamer_info.gfx. Пустую часть HP игра рисует сама, в кадре она приглушена")}
        {stageFocusTail(language, Boolean(focus), zoom)}
      </StageNote>
      <StageNote tone={fontsReady ? undefined : "warning"}>
        {fontsReady
          ? tr("Имена и цифры — буквами шрифтов из вашей игры.")
          : tr("Имена и цифры — шрифтом окна: шрифты игры Astral читает из игры, а она ещё не найдена.")}
      </StageNote>
    </div>
  );
}
