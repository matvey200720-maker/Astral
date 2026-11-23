/*
 * Шаблоны рамки мини-карты (ТЗ 22.10.2026, владелец: «рамка — добавь несколько шаблонов рамок, и он там выбирает у них
 * цвет»). Рамка — четыре линии снаружи радара (`frame.outline`), и шаблон — готовый набор её полей: включена ли, цвет,
 * толщина, непрозрачность и какие стороны. Дальше цвет и всё остальное правятся ниже, как и раньше: шаблон — быстрый
 * старт, а не отдельная запись в проект.
 *
 * Подписи русские: окно переводит их при показе (`tr`), как у раскладок и шаблонов мини-карты.
 */

const ALL = Object.freeze({ top: true, right: true, bottom: true, left: true });

export const MINIMAP_FRAME_TEMPLATES = Object.freeze([
  Object.freeze({
    id: "none",
    label: "Без рамки",
    note: "Карта как в игре",
    outline: Object.freeze({ enabled: false }),
  }),
  Object.freeze({
    id: "thin",
    label: "Тонкая",
    note: "Белая линия вокруг карты",
    outline: Object.freeze({ enabled: true, color: "#ffffff", width: 1, opacity: 100, ...ALL }),
  }),
  Object.freeze({
    id: "bold",
    label: "Толстая",
    note: "Чёрная, хорошо видна на светлом",
    outline: Object.freeze({ enabled: true, color: "#000000", width: 4, opacity: 100, ...ALL }),
  }),
  Object.freeze({
    id: "neon",
    label: "Неон",
    note: "Яркая голубая линия",
    outline: Object.freeze({ enabled: true, color: "#38bdf8", width: 2, opacity: 100, ...ALL }),
  }),
  Object.freeze({
    id: "soft",
    label: "Мягкая",
    note: "Широкая и полупрозрачная",
    outline: Object.freeze({ enabled: true, color: "#ffffff", width: 3, opacity: 40, ...ALL }),
  }),
  Object.freeze({
    id: "bottom",
    label: "Снизу",
    note: "Одна линия под картой",
    outline: Object.freeze({ enabled: true, color: "#ffffff", width: 2, opacity: 100, top: false, right: false, bottom: true, left: false }),
  }),
]);

const SIDES = Object.freeze(["top", "right", "bottom", "left"]);

/** Какому шаблону соответствует рамка сейчас: `null`, если она подправлена руками. */
export function matchingFrameTemplate(outline) {
  if (!outline) return null;
  if (outline.enabled !== true) return "none";
  return (
    MINIMAP_FRAME_TEMPLATES.find(
      (template) =>
        template.outline.enabled === true &&
        template.outline.color === outline.color &&
        template.outline.width === outline.width &&
        template.outline.opacity === outline.opacity &&
        SIDES.every((side) => template.outline[side] === outline[side]),
    )?.id ?? null
  );
}
