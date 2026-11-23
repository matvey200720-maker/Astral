/*
 * Панель инструмента «Рисунок» (задача 3 ТЗ 17.10.2026): чем рисовать на
 * полотне — кисть, ластик, заливка, текст — и их настройки. Холст — в
 * середине (`BillboardsCanvas.jsx`). Отмена — общая у редактора: «↶» в
 * полосе и Ctrl+Z, своей кнопки «Отмена» у панели нет (мастерская «как в
 * Photoshop»).
 */

import { useState } from "react";
import {
  BILLBOARD_BRUSH,
  BILLBOARD_DRAWING_FONTS,
  BILLBOARD_DRAWING_LIMITS,
  BILLBOARD_DRAWING_TOOLS,
  billboard,
  billboardDrawingHas,
  billboardDrawingRoom,
  billboardIsOwn,
  billboardLookOf,
} from "@modovik/climb-contract/recolor/billboards";
import { normalizeRecolourHex } from "@modovik/climb-contract/recolor/colour";
import FontSources from "../emblem/FontSources.jsx";
import { isWorkshopFontAsset } from "../emblem/emblem-fonts.js";
import { useOwnFontReady } from "../emblem/own-font.js";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import SectionHeading from "../section-help.jsx";
import ColorField from "../../../components/ui/ColorField.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import Select from "../../../components/ui/Select.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import Switch from "../../../components/ui/Switch.jsx";
import TextField from "../../../components/ui/TextField.jsx";
import { drawingSizeOf } from "./BillboardsCanvas.jsx";
import { BILLBOARD_SWATCHES, percentText, trFill } from "./billboards-text.js";
import { tr, useTr } from "../../../locales/ui.js";

/** Кисть по умолчанию: белая, средняя, почти жёсткая. */
export const DEFAULT_BRUSH = Object.freeze({
  tool: "brush",
  colour: "#ffffff",
  size: BILLBOARD_BRUSH.size.standard,
  hardness: BILLBOARD_BRUSH.hardness.standard,
  opacity: BILLBOARD_BRUSH.opacity.standard,
  tolerance: BILLBOARD_BRUSH.tolerance.standard,
  text: "",
  textSize: BILLBOARD_BRUSH.textSize.standard,
  font: "sans",
  bold: true,
});

const clamp = (value, { min, max, standard }) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.min(max, Math.max(min, number))) : standard;
};

/** Настройки кисти из памяти окна — в пределах. */
export function normalizeBrush(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    tool: BILLBOARD_DRAWING_TOOLS.includes(source.tool) ? source.tool : DEFAULT_BRUSH.tool,
    colour: normalizeRecolourHex(source.colour, DEFAULT_BRUSH.colour),
    size: clamp(source.size, BILLBOARD_BRUSH.size),
    hardness: clamp(source.hardness, BILLBOARD_BRUSH.hardness),
    opacity: clamp(source.opacity, BILLBOARD_BRUSH.opacity),
    tolerance: clamp(source.tolerance, BILLBOARD_BRUSH.tolerance),
    text: String(source.text ?? "").slice(0, BILLBOARD_DRAWING_LIMITS.text),
    textSize: clamp(source.textSize, BILLBOARD_BRUSH.textSize),
    font: source.font === "custom" && isWorkshopFontAsset(source.fontAsset) ? "custom" : BILLBOARD_DRAWING_FONTS.includes(source.font) ? source.font : DEFAULT_BRUSH.font,
    ...(isWorkshopFontAsset(source.fontAsset) ? { fontAsset: source.fontAsset, fontName: String(source.fontName ?? "").slice(0, 60) } : {}),
    bold: source.bold !== false,
  };
}

/* Подписи — переводятся в месте отрисовки. */
const TOOL_LABELS = Object.freeze({ brush: "Кисть", eraser: "Ластик", fill: "Заливка", text: "Текст" });
const FONT_LABELS = Object.freeze({ sans: "Без засечек", serif: "С засечками", mono: "Моноширинный", display: "Плакатный" });
const pixelsValue = (value) => `${Math.round(value)} px`;

/* Пояснения — под «?» у заголовка (`help`), короткая строка состояния — `note` (ТЗ 29.10.2026). */
function Section({ id, title, note = "", help = null, children }) {
  return (
    <section className="ui-panel fx-section recolor-section" aria-label={title} data-billboards-section={id}>
      <SectionHeading title={title} note={note} help={help} />
      {children}
    </section>
  );
}

export default function BillboardsDrawTool({ project, boardId, brush, onBrush, onClear }) {
  useTr();
  /* Свой шрифт кисти из памяти окна — холст пишет им, когда он в наборе шрифтов документа. */
  useOwnFontReady(brush.font === "custom" ? brush.fontAsset : "");
  const [fontError, setFontError] = useState("");
  const board = billboard(boardId);
  if (!board) return <p className="fx-hint">{tr("Щит не найден — выберите другой над кадром.")}</p>;
  const look = billboardLookOf(project, boardId);
  const own = billboardIsOwn(project, boardId);
  const [width, height] = drawingSizeOf(board, look);
  const drawn = billboardDrawingHas(look.drawing);
  const room = billboardDrawingRoom(look.drawing);
  const set = (patch) => onBrush({ ...brush, ...patch });
  /* Сегменты — словами (`design-qa.md`, п. 13): четыре слова встают в одну строку колонки, значки с ними переносили «Текст» вниз. */
  const tools = BILLBOARD_DRAWING_TOOLS.map((tool) => ({ value: tool, label: tr(TOOL_LABELS[tool]) }));
  return (
    <>
      {/* Заголовка с именем щита нет: щит назван под именем панели; холст, «свой облик» и отмена — по «?» «Чем рисовать». */}
      <Section
        id="draw-tool"
        title={tr("Чем рисовать")}
        help={[
          brush.tool === "brush" || brush.tool === "eraser"
            ? tr("Клавиши [ и ] — кисть меньше и больше. Жёсткость 100 % — ровный край, меньше — мягкий.")
            : brush.tool === "fill"
              ? tr("Заливка — по рисунку: замкнутый контур держит цвет внутри, пустое полотно заливается целиком. Щёлкните по полотну.")
              : brush.text.trim()
                ? tr("Щёлкните по полотну — надпись встанет туда серединой.")
                : tr("Наберите надпись — потом щёлкните по полотну."),
          trFill("Холст {0} × {1} px — полотно в его пропорции. Рисунок ложится поверх облика щита (своя картинка, цвет, градиент или реклама игры) и уедет в игру вместе с ним.", width, height),
          own ? null : tr("Первый штрих сделает облик этого щита своим: «Все щиты» его больше не трогают."),
          tr("Отменить шаг — «↶» в полосе редактора или Ctrl+Z."),
        ]}
      >
        <SegmentedControl label={tr("Инструмент рисунка")} size="sm" options={tools} value={brush.tool} onChange={(tool) => set({ tool })} />
        {brush.tool !== "eraser" && <ColorField label={tr("Цвет")} value={brush.colour} swatches={BILLBOARD_SWATCHES} editable onChange={(colour) => set({ colour })} />}
        {(brush.tool === "brush" || brush.tool === "eraser") && (
          <>
            <Slider
              label={brush.tool === "eraser" ? tr("Размер ластика") : tr("Размер кисти")}
              value={brush.size}
              min={BILLBOARD_BRUSH.size.min}
              max={BILLBOARD_BRUSH.size.max}
              format={pixelsValue}
              onChange={(size) => set({ size })}
            />
            <Slider label={tr("Жёсткость")} value={brush.hardness} min={BILLBOARD_BRUSH.hardness.min} max={BILLBOARD_BRUSH.hardness.max} format={percentText} onChange={(hardness) => set({ hardness })} />
            <Slider label={tr("Непрозрачность")} value={brush.opacity} min={BILLBOARD_BRUSH.opacity.min} max={BILLBOARD_BRUSH.opacity.max} format={percentText} onChange={(opacity) => set({ opacity })} />
          </>
        )}
        {brush.tool === "fill" && (
          <>
            <Slider label={tr("Допуск")} value={brush.tolerance} min={BILLBOARD_BRUSH.tolerance.min} max={BILLBOARD_BRUSH.tolerance.max} format={percentText} onChange={(tolerance) => set({ tolerance })} />
          </>
        )}
        {brush.tool === "text" && (
          <>
            <TextField label={tr("Надпись")} value={brush.text} maxLength={BILLBOARD_DRAWING_LIMITS.text} placeholder={tr("Например: Мы открылись!")} onChange={(text) => set({ text })} />
            <Select
              label={tr("Шрифт")}
              value={brush.font}
              options={[...BILLBOARD_DRAWING_FONTS.map((font) => [font, tr(FONT_LABELS[font])]), ...(brush.fontAsset ? [["custom", trFill("Свой шрифт: {0}", brush.fontName || tr("шрифт"))]] : [])]}
              onChange={(font) => set({ font })}
            />
            <FontSources
              onFont={(picked) => {
                setFontError("");
                set({ font: "custom", ...picked });
              }}
              onNotice={(message) => setFontError(message)}
            />
            {fontError && <p className="fx-hint">{fontError}</p>}
            <Slider label={tr("Кегль")} value={brush.textSize} min={BILLBOARD_BRUSH.textSize.min} max={BILLBOARD_BRUSH.textSize.max} format={pixelsValue} onChange={(textSize) => set({ textSize })} />
            <label className="fx-switch">
              <span>
                <b>{tr("Жирный")}</b>
              </span>
              <Switch checked={brush.bold} label={tr("Жирный шрифт надписи")} onChange={(bold) => set({ bold })} />
            </label>
          </>
        )}
      </Section>
      {/* Пустой рисунок строкой не говорится («Пока пусто» — нечего нажать); есть рисунок — сколько шагов и, у края, что он почти полон. */}
      {drawn && (
        <Section id="draw-steps" title={tr("Рисунок")} note={trFill("Шагов: {0} из {1}.", look.drawing.ops.length, BILLBOARD_DRAWING_LIMITS.ops)}>
          {room.numbers < BILLBOARD_DRAWING_LIMITS.totalNumbers * 0.1 && <p className="fx-hint is-warning">{tr("Рисунок почти полон: длинные штрихи скоро перестанут ложиться.")}</p>}
        </Section>
      )}
      <ActionRows actions={[drawn && { id: "clear-drawing", label: tr("Очистить рисунок"), onClick: onClear }]} />
    </>
  );
}
