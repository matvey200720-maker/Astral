/*
 * Редактор эмблемы в 3D-кадре — одно управление у всех редакторов мест.
 *
 * Пока он включён: левая кнопка ставит эмблему щелчком и ведёт её по
 * поверхности под курсором (эмблема «липнет» к стене, крыше, земле — нормаль
 * берётся из попадания луча, стена — отвесно, `snapWallNormal`), правая
 * кнопка поворачивает камеру, колесо — размер, Q и E (или [ и ]) — поворот на
 * 15° (с Shift — на 5°), плюс и минус — размер, Esc или «Готово» — выйти.
 * Колесо с Ctrl — приблизить камеру. Кадр (`orbit-stage.js`) переводит мышь в
 * `onPlace` и `onAdjust`; здесь — их перевод в правку работы.
 */

import { useCallback, useEffect } from "react";
import { normalizeDecalAngle, snapWallNormal } from "@modovik/climb-contract/recolor/decal";
import Button from "../../../components/ui/Button.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { StageCorner } from "../../../components/ui/StageOverlay.jsx";

export const EMBLEM_PLACING_HINT = "Левая кнопка — поставить и вести · правая — камера · колесо — размер · Q и E — поворот";

/**
 * `active` — редактор включён; `onPlace({ point, normal })` — новое место;
 * `onAdjust(update, label)` — размер и поворот: `update(эмблема)` → новые
 * поля или `null` считается от той эмблемы, что в работе сейчас (два быстрых
 * нажатия Q — два шага, а не один); `sizeRange` — пределы высоты;
 * `onDone()` — выйти (Esc). `accept(hit)` — можно ли ставить на эту
 * поверхность (ангар — только корпус); `rotatable: false` — без поворота
 * (надпись ангара). Возвращает обработчики кадра `{ onPlace, onAdjust }`.
 */
export function useEmblemPlacement({ active, onPlace, onAdjust, sizeRange, onDone, accept = null, rotatable = true }) {
  const place = useCallback(
    (hit, phase) => {
      if (!active) return;
      /* Конец ведения — редактор отпускает взятую плашку. */
      if (phase === "end" || !hit) {
        if (phase === "end") onPlace?.({ phase: "end" });
        return;
      }
      if (accept && !accept(hit)) return;
      /* `pick` — щёлкнули по плашке эмблемы или надписи: её и берут. */
      onPlace?.({
        point: hit.point.map((value) => Math.round(value * 100) / 100),
        normal: snapWallNormal(hit.normal),
        phase,
        ...(hit.pick ? { pick: hit.pick } : {}),
      });
    },
    [active, accept, onPlace],
  );

  const adjust = useCallback(
    (step) => {
      if (!active || !onAdjust) return;
      if (step.kind === "size" && sizeRange)
        onAdjust((current) => {
          const next = Math.round(Math.min(sizeRange[1], Math.max(sizeRange[0], current.size * step.factor)) * 10) / 10;
          return next !== current.size ? { size: next } : null;
        }, "Размер эмблемы");
      else if (step.kind === "rotate" && rotatable)
        onAdjust((current) => ({ angle: normalizeDecalAngle((current.angle || 0) + step.delta) }), "Поворот эмблемы");
    },
    [active, onAdjust, sizeRange, rotatable],
  );

  useEffect(() => {
    if (!active) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") onDone?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onDone]);

  return { onPlace: place, onAdjust: adjust };
}

/**
 * Плашка редактора эмблемы поверх кадра и кнопка «Готово». `label` — что в
 * руке («Эмблема в руке»), `text` — клавиши. В мастерской «как в Photoshop»
 * клавиши говорит строка подсказок внизу кадра, и плашка показывает только
 * `label` (клавиши остаются в разметке — для читалки экрана).
 */
export function EmblemPlacingBar({ text = EMBLEM_PLACING_HINT, label = "Эмблема в руке", onDone }) {
  useTr();
  return (
    <StageCorner className="recolor-stage-placing" role="status">
      <b className="recolor-stage-placing-label">{label}</b>
      <span className="recolor-stage-placing-keys" data-audit-ignore="clipped-text">
        {text}
      </span>
      <Button size="sm" variant="secondary" onClick={() => onDone?.()}>
        {tr("Готово")}
      </Button>
    </StageCorner>
  );
}
