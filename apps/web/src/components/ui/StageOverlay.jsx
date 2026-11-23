/*
 * Органы поверх кадра редактора — одни на всю мастерскую.
 *
 * В раскладке «как в Photoshop» кадр занимает середину целиком, и полосам
 * над ним и под ним места нет: всё, что раньше стояло строкой над сценой
 * (вращение, вид по умолчанию, «откуда смотреть»), ложится на сам кадр, в
 * углы, которые не заняты подсказками управления.
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ [полёт]                          [органы кадра]│  ← StageBar
 *   │                                              │
 *   │ ? ЛКМ — вращение …                           │
 *   └──────────────────────────────────────────────┘
 *
 * Подписи «это не кадр из игры» под кадром больше нет (владелец, 25.10.2026):
 * кадр говорит сам за себя. Строки состояния — «что уйдёт в игру», «игра не
 * прочиталась» — остались, но в панели редактора (`StageNote`), а не поверх кадра.
 */

import { useContext, useRef } from "react";
import { createPortal } from "react-dom";
import { tr } from "../../locales/ui.js";
import { EditorNotesContext } from "./editor-notes.js";
import useHolds from "./useHolds.js";

function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

/**
 * Органы кадра — правый верхний угол. `wide` — во всю ширину верха: у кадров
 * без полёта, которым нужна длинная лента (время суток неба, шкала
 * килл-эффекта), — левый верхний угол у них свободен.
 */
export function StageBar({ children, className = "", label = null, wide = false }) {
  return (
    <div
      className={joinClassNames("ui-stage-bar", wide && "is-wide", className)}
      role="group"
      aria-label={label ?? tr("Кадр")}
    >
      {children}
    </div>
  );
}

/**
 * То, что встаёт над кадром рядом с его органами (выбор ствола, строка «как на сервере», угол прицела): полоса
 * кадра уступает ему место. Холст узнаёт о нём меткой (`data-holds~="stage-corner"`, `useHolds.js`), а не `:has()`
 * в листах — его браузер перепроверял на каждую правку внутри кадра (подписи карты, метки, точки).
 */
export function StageCorner({ children, ...rest }) {
  const ref = useRef(null);
  useHolds(ref, "stage-corner", [".ui-editor-canvas"]);
  return (
    <div ref={ref} {...rest}>
      {children}
    </div>
  );
}

/**
 * «Обновляю…» — кадр пересобирается (19.10.2026, владелец: «всё, что связано с
 * 3D, — какую-то загрузку добавлять»). Тихая подпись в левом верхнем углу
 * кадра, как подпись кадра в правом нижнем: без затемнения, кадр под ней
 * остаётся виден. Проявляется с задержкой (~150 мс, в стилях): быстрая
 * пересборка проходит без мигания. Анимация — прозрачностью: её ведёт
 * композитор, и плашка проявляется, даже пока главный поток занят пересборкой.
 */
export function StageBusy({ busy, label = "", className = "" }) {
  if (!busy) return null;
  return (
    <p className={joinClassNames("ui-stage-busy", className)} role="status" aria-live="polite">
      <i aria-hidden="true" />
      {label || tr("Обновляю…")}
    </p>
  );
}

/**
 * Строка состояния кадра — мелко, в панели редактора (`.ui-editor-notes`), а не поверх картинки. `tone="warning"` — то,
 * что человеку нужно увидеть: игра не прочиталась, эффект не собрался. Пустое не рисуется.
 */
export function StageNote({ children, tone = "", title }) {
  const slot = useContext(EditorNotesContext);
  if (!slot || children == null || children === false || children === "") return null;
  /* Причина и подробности — в `title` (design-qa.md, п. 14): на кадре одна короткая строка. */
  return createPortal(<p className={joinClassNames("ui-editor-note", tone && `is-${tone}`)} title={title || undefined}>{children}</p>, slot);
}
