/*
 * Инструмент «Модели» — один у всех мест мастерской (задача 1 ТЗ 11.10.2026,
 * вечер): «Завод», «Ангар», «Маппинг», «Арена», «Мегамолл», «Ашан / Икея»,
 * «Вайнвуд», «Интерьеры магазинов». Свои модели — отдельным инструментом, а
 * не ещё одним разделом в чужом: слева в колонке инструментов, справа —
 * список-слои (`ModelsPanel`), в кадре — ручки выбранной и плашка «что в
 * руке».
 *
 * Управление облегчено (ТЗ 11.10.2026, ночь, задача 1): модель тянут мышью
 * прямо по полу, стенам и другим моделям, крутят одним кольцом; точные ручки
 * осей — клавишами G · R · S.
 */

import { Cube } from "../../../components/ui/icons.jsx";
import { placeModelTitle } from "@modovik/climb-contract/recolor/place-models";
import Button from "../../../components/ui/Button.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import { StageCorner } from "../../../components/ui/StageOverlay.jsx";

export const MODELS_TOOL_ID = "models";

/* Род ручек: главный — «Ставить» (кольцо и размер), точные — G · R · S. */
export const GIZMO_OPTIONS = Object.freeze([
  {
    value: "place",
    label: "Ставить",
    title: "Тянуть по полу и стенам, крутить кольцом",
  },
  { value: "move", label: "Оси", title: "Стрелки по осям — G" },
  { value: "rotate", label: "Наклон", title: "Кольца трёх осей — R" },
  { value: "scale", label: "Размер", title: "Размер кубиками — T" },
]);

/** Инструмент для колонки слева: `where` — где («на заводе»), `shortcut` — цифра. */
export function modelsTool({ where = "", shortcut = "" } = {}) {
  return {
    id: MODELS_TOOL_ID,
    label: "Модели",
    icon: <Cube />,
    ...(shortcut ? { shortcut } : {}),
    group: "models",
    note: `Свои модели ${where}`.trim(),
    hint: "Добавьте картинку, гифку или модель справа — она встанет на поверхность под прицелом. Тяните её мышью, W и S — дальше и ближе, с Shift — по полу, стенам и другим моделям, крутите кольцом",
  };
}

/** Строка подсказок внизу кадра, пока взят инструмент «Модели». */
export function modelsGuide(cameraMode, { selected = false } = {}) {
  if (cameraMode === "fly")
    return [
      { keys: ["W", "A", "S", "D"], text: "полёт" },
      { keys: ["Q", "E"], text: "вниз и вверх" },
      { keys: "ЛКМ", text: "по модели — тянуть, мимо — осмотреться" },
      { keys: "Колесо (нажать)", text: "выбрать модель" },
      { keys: "ПКМ", text: "щелчок — выйти из полёта" },
    ];
  if (!selected)
    return [
      { keys: "ЛКМ", text: "по модели — выбрать и тянуть, мимо — камера" },
      { keys: "Колесо (нажать)", text: "выбрать модель" },
      { keys: ["W", "A", "S", "D"], text: "лететь: подлетел — тянешь" },
    ];
  return [
    { keys: "ЛКМ", text: "тянуть за курсором" },
    { keys: ["W", "S"], text: "дальше и ближе, пока тянете" },
    { keys: "Shift", text: "тянуть по полу, стенам и моделям" },
    { keys: "Кольцо", text: "крутить, с Ctrl — по 15°" },
    { keys: ["G", "R", "T"], text: "точные ручки" },
    { keys: "Del", text: "убрать" },
    { keys: "Esc", text: "снять выбор" },
  ];
}

/**
 * Плашка над кадром: какая модель в руке, род ручек и «Готово». Только
 * пока взят инструмент и выбрана модель.
 */
export function ModelsStageBar({ edit }) {
  if (!edit.selected) return null;
  return (
    <StageCorner className="recolor-stage-placing place-models-stagebar" role="status">
      <b className="recolor-stage-placing-label" data-audit-ignore="caps">
        {placeModelTitle(edit.selected)}
      </b>
      <SegmentedControl
        label="Ручки модели"
        size="sm"
        options={GIZMO_OPTIONS}
        value={edit.mode}
        onChange={edit.setMode}
      />
      <Button size="sm" variant="secondary" onClick={edit.deselect}>
        Готово
      </Button>
    </StageCorner>
  );
}
