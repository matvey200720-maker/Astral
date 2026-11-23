/*
 * Кадр редактора «Флаги»: полотнище взятого флага на древке, развевается.
 *
 * На полотнище — лист вида в облике работы той же функцией, что у
 * установщика (`flags-art.js`): что видно, то и уедет в игру. Волна —
 * постановка кадра (полоски листа со светом и тенью), а не ткань игры: в
 * игре флаг развевает ветер игры своей физикой ткани, и её Astral не трогает.
 *
 * Кадр рисуется сразу при правке и при смене размера; волна идёт кадровым
 * циклом, пока включён «Ветер» и пока на кадр смотрят (`watchFrameGate`: окно
 * без внимания или кадр за краем — волна стоит, первый кадр уже нарисован).
 */

import { useEffect, useRef } from "react";
import { Pause, Play } from "../../../components/ui/icons.jsx";
import Button from "../../../components/ui/Button.jsx";
import { StageBar, StageNote } from "../../../components/ui/StageOverlay.jsx";
import { watchFrameGate } from "../../../attention.js";
import { useRememberedState } from "../../../section-memory.js";
import { textureAvailable } from "../model-stage/scene-textures.js";
import { drawWavingFlag, useFlagSheet } from "./flags-art.js";
import { flagsText, frameKindOf, kindModelsText, lookText, targetLabel } from "./flags-text.js";
import { tr, useTr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";

/* Строки состояния кадра — в панели редактора, не на картинке: что на полотнище, что в игре и откуда лист флага. */
function notesOf({ kind, target, look, sheet }) {
  const where =
    target === "all"
      ? trFill("На полотнище — облик «Всех флагов» на флаге «{0}»: {1}.", tr(kind.label), lookText(look))
      : trFill("«{0}»: {1} на карте ({2}), сейчас — {3}.", tr(kind.label), flagsText(kind.count), kindModelsText(kind), lookText(look));
  const game = sheet.real
    ? { text: tr("Лист флага — из вашей GTA V.") }
    : textureAvailable({ game: kind.files[0].at })
      ? { text: tr("Лист игры ещё читается — пока на полотнище похожий флаг или средний цвет листа.") }
      : /* Служебное, исправить нечем — по «?», не жёлтой строкой (`design-qa.md`, п. 14). */
        { text: tr("Без Astral Desktop лист игры не прочитать: «как в игре» здесь — похожий флаг страны или средний цвет листа, у древка — рукав-заглушка.") };
  return [
    { text: where },
    { text: `${tr("В игре флаг развевает ветер, ткань и физика модели остаются штатными.")} ${trFill("Лист в игре — {0} × {1}.", kind.width, kind.height)}` },
    game,
    ...(sheet.missing ? [{ text: tr("Своя картинка пропала из хранилища окна — загрузите её ещё раз."), warn: true }] : []),
  ];
}
export default function FlagsStage({ target, look }) {
  useTr();
  const canvasRef = useRef(null);
  const frameRef = useRef(null);
  const [wind, setWind] = useRememberedState("flags:wind", true);
  const kind = frameKindOf(target);
  const sheet = useFlagSheet(kind, look);

  useEffect(() => {
    const canvas = canvasRef.current;
    const box = frameRef.current;
    if (!canvas || !box) return undefined;
    const context = canvas.getContext?.("2d");
    if (!context) return undefined;
    let raf = 0;
    let started = 0;
    /* Размер кадра — с наблюдателя размера, а не чтением на каждой волне: `getBoundingClientRect` 30 раз в секунду
       раскладывал окно, если в нём было что раскладывать (21.10.2026). */
    let rect = box.getBoundingClientRect();
    const paint = (time = 0) => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round((rect.width || 960) * ratio));
      const height = Math.max(1, Math.round((rect.height || 540) * ratio));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      drawWavingFlag(context, sheet.canvas, { width, height, time });
    };
    const quiet = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    /* Волне хватает 30 кадров в секунду: кадр окна не тратит видеочип на лишние. */
    let last = 0;
    const loop = (now) => {
      if (!started) started = now;
      if (now - last >= 32) {
        last = now;
        paint((now - started) / 1000);
      }
      raf = window.requestAnimationFrame(loop);
    };
    const stop = () => {
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
    };
    paint(0.6);
    /* Волна — только при внимании, как остальное живое в окне: без ворот она шла 30 кадров в секунду и в окне на заднем
       плане (21.10.2026). */
    const stopGate =
      wind && !quiet && typeof window.requestAnimationFrame === "function"
        ? watchFrameGate(box, (open) => {
            if (!open) stop();
            else if (!raf) raf = window.requestAnimationFrame(loop);
          })
        : () => {};
    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            rect = box.getBoundingClientRect();
            paint(0.6);
          })
        : null;
    observer?.observe(box);
    return () => {
      stop();
      stopGate();
      observer?.disconnect();
    };
  }, [sheet, wind]);

  /* Для песочницы и проверок: кадр отдаётся снимком. */
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handle = { canvas: () => canvasRef.current, sheet: () => sheet.canvas };
    window.__astralFlagsStage = handle;
    return () => {
      if (window.__astralFlagsStage === handle) delete window.__astralFlagsStage;
    };
  }, [sheet]);

  return (
    <div className="fx-stage recolor-stage is-studio flags-stage">
      <div ref={frameRef} className="model-stage-frame">
        <canvas
          ref={canvasRef}
          className="model-stage-canvas"
          style={{ cursor: "default" }}
          role="img"
          aria-label={`${targetLabel(target)}: полотнище на древке в облике работы — ${lookText(look)}`}
        />
      </div>
      <StageBar>
        <Button
          size="sm"
          variant="ghost"
          icon={wind ? <Pause /> : <Play />}
          aria-pressed={wind}
          title={wind ? tr("Остановить волну в кадре") : tr("Пустить волну по полотнищу")}
          onClick={() => setWind(!wind)}
        >
          {wind ? tr("Стоп") : tr("Ветер")}
        </Button>
      </StageBar>
      {notesOf({ kind, target, look, sheet }).map((item) => (
        <StageNote key={item.text} tone={item.warn ? "warning" : undefined}>
          {item.text}
        </StageNote>
      ))}
    </div>
  );
}
