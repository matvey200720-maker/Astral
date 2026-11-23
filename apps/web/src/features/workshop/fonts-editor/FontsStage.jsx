/*
 * Кадр редактора шрифтов: название шрифта его же буквами по центру матовой
 * плашки — и ничего больше (владелец, 04.10.2026).
 *
 * Буквы своего шрифта — те же контуры, что уедут в игру (`font-preview.js`:
 * подгонка под высоту заглавных основного шрифта игры, ширина, толщина,
 * интервал, наклон, подъём). Пока свой шрифт выключен — название основного
 * шрифта игры его буквами (из игры игрока). Шаблон Windows без Astral
 * Desktop прочесть нечем — тогда название рисует шрифт окна, приближённо, и
 * подпись кадра это говорит.
 */

import { useEffect, useMemo, useRef } from "react";
import { GAME_FONT_TARGETS, fontTemplate, fontsProjectIsVanilla } from "@modovik/climb-contract/recolor/fonts";
import { StageNote } from "../../../components/ui/StageOverlay.jsx";
import { createGlyphSet, drawFontName, drawFontSpecimen } from "./font-preview.js";
import { fontNameOf, fontsNotes } from "./fonts-text.js";
import { useTr } from "../../../locales/ui.js";

const MAIN = GAME_FONT_TARGETS[0];

/** Что в кадре: название, набор глифов (или `null`) и шрифт окна на замену. */
export function nameFrame({ project, source, game }) {
  const vanilla = fontsProjectIsVanilla(project);
  const gameFont = game?.fonts.get(MAIN.export) || null;
  const own = !vanilla && Boolean(source);
  const set = own || gameFont ? createGlyphSet({ target: MAIN, source, game: gameFont, settings: project.settings, own }) : null;
  const name = vanilla ? MAIN.game : fontNameOf(project);
  let fallback = null;
  if (!own && !vanilla) {
    const template = project.source.kind === "template" ? fontTemplate(project.source.template) : null;
    const family = template ? template.family : project.source.file.family;
    if (family) fallback = { family: `"${family}", sans-serif`, weight: template?.weight || 400, settings: project.settings };
  }
  if (!set && !fallback) fallback = { family: "sans-serif", weight: 600, settings: {} };
  return { name, set: own || vanilla ? set : null, fallback, own };
}

export default function FontsStage({ project, source, game }) {
  useTr();
  const canvasRef = useRef(null);
  const frameRef = useRef(null);
  const frame = useMemo(() => nameFrame({ project, source, game }), [project, source, game]);
  /* Образец «Аа» (для съёмки обложки): режим держится, пока его не выключат, и переживает перерисовку при смене размера. */
  const specimen = useRef(false);
  const repaint = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const box = frameRef.current;
    if (!canvas || !box) return undefined;
    /* Кадр неподвижен: рисуется сразу при правке и при смене размера, без
       кадрового цикла (в спрятанном окне его кадры не идут). */
    const paint = () => {
      const context = canvas.getContext?.("2d");
      if (!context) return;
      const rect = box.getBoundingClientRect();
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round((rect.width || 960) * ratio));
      const height = Math.max(1, Math.round((rect.height || 540) * ratio));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, width, height);
      if (specimen.current) drawFontSpecimen(context, frame.set, { width, height, fallback: frame.fallback });
      else drawFontName(context, frame.set, frame.name, { width, height, fallback: frame.fallback });
    };
    repaint.current = paint;
    paint();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(paint) : null;
    observer?.observe(box);
    return () => {
      observer?.disconnect();
      if (repaint.current === paint) repaint.current = null;
    };
  }, [frame]);

  /* Для песочницы и проверок: кадр отдаётся снимком. */
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    /* `specimen(on)` — кадр образцом «Аа» вместо названия: так снимается обложка плитки (`scripts/stock-covers-live/recipes.mjs`). */
    const handle = {
      canvas: () => canvasRef.current,
      specimen: (on = true) => {
        specimen.current = Boolean(on);
        repaint.current?.();
        return specimen.current;
      },
    };
    window.__astralFontsStage = handle;
    return () => {
      if (window.__astralFontsStage === handle) delete window.__astralFontsStage;
    };
  }, []);

  return (
    <div className="fx-stage recolor-stage fonts-stage is-studio">
      <div ref={frameRef} className="model-stage-frame fonts-frame">
        <canvas ref={canvasRef} className="fonts-canvas" role="img" aria-label={`Название шрифта его буквами: ${frame.name}`} />
      </div>
      {fontsNotes({ project, game, own: frame.own }).map((item) => (
        <StageNote key={item.text} tone={item.warn ? "warning" : undefined}>
          {item.text}
        </StageNote>
      ))}
    </div>
  );
}
