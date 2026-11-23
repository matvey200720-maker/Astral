/*
 * Правая колонка студии: настройки взятого инструмента, цвета, свойства
 * выбранного слоя (надпись, фигура, заливка, коррекция), выделение, фильтры
 * (ТЗ 18.10.2026, Session 1, задача 6). Органы — из словаря `components/ui`.
 * Правка свойств слоя — шаг истории; перетаскивание ползунка склеивается в
 * один шаг (`mergeKey`).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowsLeftRight } from "../../../components/ui/icons.jsx";
import { ADJUST_LABELS, lutCurves } from "./engine/adjust.js";
import { layerOf } from "./engine/document.js";
import { FILTER_KINDS, FILTER_LABELS, FILTER_LIMITS, normalizeFilterParams } from "./engine/filters.js";
import { toolOf } from "./engine/tools.js";
import { KIND_LABELS, SELECTION_OP_LABELS, TONE_RANGES, effectiveOptions } from "./studio-options.js";
import { TEXT_FONT_STACKS } from "./compositor.js";
import FontSources from "../emblem/FontSources.jsx";
import Button from "../../../components/ui/Button.jsx";
import ColorField from "../../../components/ui/ColorField.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import Select from "../../../components/ui/Select.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import Switch from "../../../components/ui/Switch.jsx";
import TextField from "../../../components/ui/TextField.jsx";
import { tr, useTr } from "../../../locales/ui.js";

const SWATCHES = Object.freeze(["#ffffff", "#000000", "#e30613", "#ffd400", "#3ae464", "#2f80ed", "#9b51e0", "#ff7a00", "#8a8f96", "#d4a72c"]);
const FONT_LABELS = Object.freeze({ sans: "Гротеск", serif: "Антиква", mono: "Моно", stencil: "Трафарет", script: "Рукопись", block: "Плакатный" });
const percent = (value) => `${Math.round(value)} %`;
/* Настройки, у которых в разделе инструмента есть орган; у руки, масштаба и перемещения их нет. */
const SETTING_OPTIONS = new Set(["size", "hardness", "opacity", "flow", "amount", "range", "tolerance", "contiguous", "sampleAll", "aligned", "selectionOp", "feather", "text", "shape"]);
const SELECTING = new Set(["marquee", "lasso", "wand"]);
const px = (value) => `${Math.round(value)} px`;

function Section({ title, children, id }) {
  return (
    <section className="ui-panel fx-section txs-section" aria-label={title} data-studio-section={id}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

/* Кривая коррекции «Кривые»: точки тянутся мышью, двойной щелчок убирает точку. */
function CurvesEditor({ points, onChange }) {
  useTr();
  const ref = useRef(null);
  const dragging = useRef(-1);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext?.("2d");
    if (!context) return;
    const size = canvas.width;
    context.clearRect(0, 0, size, size);
    context.fillStyle = "rgba(255,255,255,0.04)";
    context.fillRect(0, 0, size, size);
    context.strokeStyle = "rgba(255,255,255,0.12)";
    for (let step = 1; step < 4; step += 1) {
      context.beginPath();
      context.moveTo((step * size) / 4, 0);
      context.lineTo((step * size) / 4, size);
      context.moveTo(0, (step * size) / 4);
      context.lineTo(size, (step * size) / 4);
      context.stroke();
    }
    const lut = lutCurves(points);
    context.strokeStyle = "#fff";
    context.lineWidth = 2;
    context.beginPath();
    for (let value = 0; value < 256; value += 1) {
      const x = (value / 255) * size;
      const y = size - (lut[value] / 255) * size;
      if (value === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
    context.fillStyle = "#4da3ff";
    for (const [x, y] of points) {
      context.beginPath();
      context.arc((x / 255) * size, size - (y / 255) * size, 5, 0, Math.PI * 2);
      context.fill();
    }
  }, [points]);
  const toCurve = (event) => {
    const rect = ref.current.getBoundingClientRect();
    return [Math.round(Math.min(255, Math.max(0, ((event.clientX - rect.left) / rect.width) * 255))), Math.round(Math.min(255, Math.max(0, 255 - ((event.clientY - rect.top) / rect.height) * 255)))];
  };
  const nearest = (point) => {
    let best = -1;
    let gap = 14;
    points.forEach(([x, y], index) => {
      const d = Math.hypot(x - point[0], y - point[1]);
      if (d < gap) {
        gap = d;
        best = index;
      }
    });
    return best;
  };
  return (
    <canvas
      ref={ref}
      className="txs-curves"
      width={256}
      height={256}
      role="img"
      aria-label={tr("Кривая: точки тянутся мышью, двойной щелчок убирает точку")}
      onPointerDown={(event) => {
        const point = toCurve(event);
        let at = nearest(point);
        if (at < 0) {
          const next = [...points, point].sort((a, b) => a[0] - b[0]);
          onChange(next, true);
          at = next.findIndex((item) => item[0] === point[0] && item[1] === point[1]);
        }
        dragging.current = at;
        ref.current.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (dragging.current < 0) return;
        const point = toCurve(event);
        const next = points.map((item, index) => (index === dragging.current ? point : item)).sort((a, b) => a[0] - b[0]);
        dragging.current = next.findIndex((item) => item[0] === point[0] && item[1] === point[1]);
        onChange(next, false);
      }}
      onPointerUp={() => {
        dragging.current = -1;
      }}
      onDoubleClick={(event) => {
        const at = nearest(toCurve(event));
        if (at > 0 && at < points.length - 1) onChange(points.filter((_, index) => index !== at), true);
      }}
    />
  );
}

/* Параметры корректирующего слоя: каждый ползунок — своё поле параметров, перетаскивание склеивается в один шаг. */
function AdjustControls({ session, layer }) {
  useTr();
  const params = layer.params;
  const set = (patch, label) => session.patchLayer(layer.id, { params: { ...params, ...patch } }, label, `adjust:${layer.id}`);
  const slider = (key, label, min, max, step = 1, format = (value) => `${Math.round(value)}`) => (
    <Slider key={key} label={tr(label)} ariaLabel={`${tr(ADJUST_LABELS[layer.kind])}: ${tr(label)}`} value={params[key]} min={min} max={max} step={step} format={format} onChange={(value) => set({ [key]: value }, ADJUST_LABELS[layer.kind])} />
  );
  switch (layer.kind) {
    case "levels":
      return (
        <>
          {slider("inLow", "Вход: чёрное", 0, 253)}
          {slider("gamma", "Середина", 0.1, 9.99, 0.01, (value) => value.toFixed(2))}
          {slider("inHigh", "Вход: белое", 2, 255)}
          {slider("outLow", "Выход: чёрное", 0, 255)}
          {slider("outHigh", "Выход: белое", 0, 255)}
        </>
      );
    case "curves":
      return <CurvesEditor points={params.points} onChange={(points, final) => session.patchLayer(layer.id, { params: { points } }, "Кривые", final ? `curves:${layer.id}:${Date.now()}` : `curves:${layer.id}`)} />;
    case "hue-saturation":
      return (
        <>
          {slider("hue", "Цветовой тон", -180, 180, 1, (value) => `${Math.round(value)}°`)}
          {slider("saturation", "Насыщенность", -100, 100)}
          {slider("lightness", "Светлота", -100, 100)}
        </>
      );
    case "color-balance":
      return ["shadows", "midtones", "highlights"].map((range) => (
        <div key={range} className="txs-balance" role="group" aria-label={tr({ shadows: "Тени", midtones: "Полутона", highlights: "Света" }[range])}>
          <b>{tr({ shadows: "Тени", midtones: "Полутона", highlights: "Света" }[range])}</b>
          {[
            ["Голубой — красный", 0],
            ["Пурпурный — зелёный", 1],
            ["Жёлтый — синий", 2],
          ].map(([label, channel]) => (
            <Slider
              key={label}
              label={tr(label)}
              ariaLabel={`${tr({ shadows: "Тени", midtones: "Полутона", highlights: "Света" }[range])}: ${tr(label)}`}
              value={params[range][channel]}
              min={-100}
              max={100}
              step={1}
              format={(value) => `${Math.round(value)}`}
              onChange={(value) => set({ [range]: params[range].map((item, at) => (at === channel ? value : item)) }, "Цветовой баланс")}
            />
          ))}
        </div>
      ));
    case "brightness-contrast":
      return (
        <>
          {slider("brightness", "Яркость", -100, 100)}
          {slider("contrast", "Контраст", -100, 100)}
        </>
      );
    case "black-white":
      return (
        <>
          {slider("red", "Красные", -200, 300)}
          {slider("green", "Зелёные", -200, 300)}
          {slider("blue", "Синие", -200, 300)}
        </>
      );
    case "threshold":
      return slider("level", "Порог", 1, 255);
    case "posterize":
      return slider("levels", "Уровни", 2, 32);
    default:
      return <p className="fx-hint">{tr("У этой коррекции настроек нет: она действует на всё, что под ней.")}</p>;
  }
}

/* Шрифты в списке: шрифты студии, а свой — когда он уже выбран (новый берут кнопками под списком). */
const fontOptions = (source) => [
  ...Object.keys(TEXT_FONT_STACKS).map((id) => [id, tr(FONT_LABELS[id])]),
  ...(source.fontAsset ? [["custom", `${tr("Свой шрифт")}: ${source.fontName || tr("шрифт")}`]] : []),
];

/* Свойства надписи. */
function TextProps({ session, layer }) {
  useTr();
  const set = (patch, label) => session.patchLayer(layer.id, { ...patch, ...(patch.value !== undefined ? { name: patch.value.split("\n")[0] || "Текст" } : {}) }, label, `text:${layer.id}:${Object.keys(patch).join(",")}`);
  return (
    <>
      <TextField label={tr("Текст")} multiline rows={2} value={layer.value} maxLength={400} onChange={(value) => set({ value }, "Текст")} />
      <Select label={tr("Шрифт")} ariaLabel={tr("Шрифт надписи")} value={layer.font} options={fontOptions(layer)} onChange={(font) => set({ font }, "Шрифт")} />
      <FontSources onFont={(font) => set({ font: "custom", ...font }, "Шрифт")} />
      <Slider label={tr("Размер")} value={layer.size} min={4} max={Math.max(512, session.height)} step={1} format={px} onChange={(size) => set({ size }, "Размер текста")} />
      <ColorField label={tr("Цвет")} value={layer.colour} swatches={SWATCHES} editable onChange={(colour) => set({ colour }, "Цвет текста")} />
      <SegmentedControl label={tr("Выравнивание")} size="sm" options={[["left", tr("Слева")], ["center", tr("По центру")], ["right", tr("Справа")]].map(([value, label]) => ({ value, label }))} value={layer.align} onChange={(align) => set({ align }, "Выравнивание")} />
      <Slider label={tr("Поворот")} value={layer.rotate} min={-180} max={180} step={1} format={(value) => `${Math.round(value)}°`} onChange={(rotate) => set({ rotate }, "Поворот текста")} />
    </>
  );
}

function ShapeProps({ session, layer }) {
  useTr();
  const set = (patch, label) => session.patchLayer(layer.id, patch, label, `shape:${layer.id}:${Object.keys(patch).join(",")}`);
  const closed = layer.shape === "rect" || layer.shape === "ellipse";
  return (
    <>
      <ColorField label={tr("Обводка")} value={layer.stroke} swatches={SWATCHES} editable onChange={(stroke) => set({ stroke }, "Цвет фигуры")} />
      <Slider label={tr("Толщина")} value={layer.strokeWidth} min={0} max={200} step={1} format={px} onChange={(strokeWidth) => set({ strokeWidth }, "Толщина фигуры")} />
      {closed && (
        <>
          <label className="fx-switch">
            <span>
              <b>{tr("Заливка")}</b>
            </span>
            <Switch checked={Boolean(layer.fill)} label={tr("Заливка фигуры")} onChange={(on) => set({ fill: on ? "#ffffff" : null }, "Заливка фигуры")} />
          </label>
          {layer.fill && <ColorField label={tr("Цвет заливки")} value={layer.fill} swatches={SWATCHES} editable onChange={(fill) => set({ fill }, "Цвет заливки")} />}
        </>
      )}
    </>
  );
}

function FillProps({ session, layer }) {
  useTr();
  const set = (patch, label) => session.patchLayer(layer.id, patch, label, `fill:${layer.id}`);
  const gradient = layer.gradient;
  return (
    <>
      <label className="fx-switch">
        <span>
          <b>{tr("Градиент")}</b>
        </span>
        <Switch checked={Boolean(gradient)} label={tr("Градиент")} onChange={(on) => set({ gradient: on ? { kind: "linear", angle: 90, stops: [{ at: 0, colour: layer.colour, alpha: 1 }, { at: 1, colour: "#000000", alpha: 1 }] } : null }, "Градиент слоя")} />
      </label>
      {!gradient ? (
        <ColorField label={tr("Цвет")} value={layer.colour} swatches={SWATCHES} editable onChange={(colour) => set({ colour }, "Цвет заливки")} />
      ) : (
        <>
          <SegmentedControl label={tr("Вид градиента")} size="sm" options={[{ value: "linear", label: tr("Линейный") }, { value: "radial", label: tr("Радиальный") }]} value={gradient.kind} onChange={(kind) => set({ gradient: { ...gradient, kind } }, "Градиент слоя")} />
          <ColorField label={tr("Начало")} value={gradient.stops[0].colour} swatches={SWATCHES} editable onChange={(colour) => set({ gradient: { ...gradient, stops: gradient.stops.map((stop, at) => (at === 0 ? { ...stop, colour } : stop)) } }, "Градиент слоя")} />
          <ColorField label={tr("Конец")} value={gradient.stops.at(-1).colour} swatches={SWATCHES} editable onChange={(colour) => set({ gradient: { ...gradient, stops: gradient.stops.map((stop, at) => (at === gradient.stops.length - 1 ? { ...stop, colour } : stop)) } }, "Градиент слоя")} />
          <Slider label={tr("Угол")} value={gradient.angle} min={-180} max={180} step={1} format={(value) => `${Math.round(value)}°`} onChange={(angle) => set({ gradient: { ...gradient, angle } }, "Градиент слоя")} />
        </>
      )}
    </>
  );
}

function ImageProps({ session, layer }) {
  useTr();
  return (
    <>
      <Slider label={tr("Поворот")} value={layer.rotate} min={-180} max={180} step={1} format={(value) => `${Math.round(value)}°`} onChange={(rotate) => session.patchLayer(layer.id, { rotate }, "Поворот картинки", `image:${layer.id}:rotate`)} />
      <Slider
        label={tr("Размер")}
        value={Math.round((layer.width / session.width) * 100)}
        min={2}
        max={400}
        step={1}
        format={percent}
        onChange={(value) => {
          const k = (session.width * value) / 100 / layer.width;
          const cx = layer.x + layer.width / 2;
          const cy = layer.y + layer.height / 2;
          session.patchLayer(layer.id, { width: layer.width * k, height: layer.height * k, x: cx - (layer.width * k) / 2, y: cy - (layer.height * k) / 2 }, "Размер картинки", `image:${layer.id}:size`);
        }}
      />
      <div className="recolor-actions">
        <Button size="sm" variant="secondary" title={tr("Пока слой не растрирован, картинку можно двигать, вертеть и менять её размер без потерь.")} onClick={() => session.rasterize(layer.id)}>
          {tr("Растрировать")}
        </Button>
      </div>
    </>
  );
}

/* Фильтры слоя: вид, параметры, «Применить» — в потоке, окно не подвисает. */
function FilterSection({ session, busy }) {
  useTr();
  const [kind, setKind] = useState("blur");
  const [params, setParams] = useState(() => normalizeFilterParams("blur"));
  const limits = FILTER_LIMITS[kind] || {};
  const choose = (next) => {
    setKind(next);
    setParams(normalizeFilterParams(next));
  };
  const LABELS = { radius: "Радиус", distance: "Расстояние", angle: "Угол", amount: "Сила", size: "Размер клетки", x: "Сдвиг по X", y: "Сдвиг по Y" };
  return (
    <Section title={tr("Фильтры")} id="filters">
      <Select label={tr("Фильтр")} ariaLabel={tr("Вид фильтра")} value={kind} options={FILTER_KINDS.map((id) => [id, tr(FILTER_LABELS[id])])} onChange={choose} />
      {Object.entries(limits).map(([key, [low, high]]) => (
        <Slider key={key} label={tr(LABELS[key] || key)} ariaLabel={`${tr(FILTER_LABELS[kind])}: ${tr(LABELS[key] || key)}`} value={params[key]} min={low} max={high} step={high - low > 50 ? 1 : 0.5} format={(value) => `${Math.round(value * 10) / 10}`} onChange={(value) => setParams({ ...params, [key]: value })} />
      ))}
      {kind === "noise" && (
        <label className="fx-switch">
          <span>
            <b>{tr("Одноцветный шум")}</b>
          </span>
          <Switch checked={Boolean(params.mono)} label={tr("Одноцветный шум")} onChange={(mono) => setParams({ ...params, mono })} />
        </label>
      )}
      <div className="recolor-actions">
        <Button size="sm" variant="secondary" disabled={Boolean(busy)} title={tr("Фильтр действует на выбранный растровый слой, в пределах выделения. «Убрать фон» стирает цвет краёв картинки.")} onClick={() => session.filter(kind, params)}>
          {tr("Применить фильтр")}
        </Button>
        <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => session.removeBackground({ tolerance: 40, feather: 1 })}>
          {tr("Убрать фон")}
        </Button>
      </div>
    </Section>
  );
}

/**
 * Колонка: `options` — состояние настроек, `setOptions(patch)` — правка,
 * `session` и `snapshot` — документ, `onInsert()` — «Вставить картинку».
 */
export default function StudioInspector({ session, snapshot, options, setOptions }) {
  useTr();
  const effective = useMemo(() => effectiveOptions(options), [options]);
  const tool = toolOf(options.tool);
  const layer = layerOf(snapshot.doc, snapshot.doc.active);
  const has = (name) => tool.options.includes(name);
  const kinds = tool.kinds;
  return (
    <>
      <Section title={tr("Цвета")} id="colours">
        <div className="txs-colours">
          <ColorField label={tr("Цвет")} value={options.foreground} swatches={SWATCHES} editable onChange={(foreground) => setOptions({ foreground })} />
          <Button className="txs-swap" size="sm" variant="ghost" icon={<ArrowsLeftRight />} aria-label={tr("Цвет и фон местами")} title={tr("Цвет и фон местами (X)")} onClick={() => setOptions({ foreground: options.background, background: options.foreground })} />
          <ColorField label={tr("Фон")} value={options.background} editable onChange={(background) => setOptions({ background })} />
        </div>
      </Section>
      <Section title={tr(tool.label)} id="tool">
        {kinds.length > 0 && (
          <SegmentedControl label={tr("Вид инструмента")} size="sm" options={kinds.map((value) => ({ value, label: tr(KIND_LABELS[value]) }))} value={effective.kind} onChange={(kind) => setOptions({ kind })} />
        )}
        {has("size") && <Slider label={tr("Размер")} value={options.size} min={1} max={Math.min(2000, Math.max(200, session.height))} step={1} format={px} onChange={(size) => setOptions({ size })} />}
        {has("hardness") && <Slider label={tr("Жёсткость")} value={options.hardness} min={0} max={100} step={1} format={percent} onChange={(hardness) => setOptions({ hardness })} />}
        {has("opacity") && <Slider label={tr("Непрозрачность")} value={options.opacity} min={1} max={100} step={1} format={percent} onChange={(opacity) => setOptions({ opacity })} />}
        {has("flow") && <Slider label={tr("Нажим")} value={options.flow} min={1} max={100} step={1} format={percent} onChange={(flow) => setOptions({ flow })} />}
        {has("amount") && <Slider label={tr("Сила")} value={options.amount} min={1} max={100} step={1} format={percent} onChange={(amount) => setOptions({ amount })} />}
        {has("range") && <Select label={tr("Тона")} ariaLabel={tr("Тона")} value={options.range} options={TONE_RANGES.map(([value, label]) => [value, tr(label)])} onChange={(range) => setOptions({ range })} />}
        {has("tolerance") && effective.kind !== "linear" && effective.kind !== "radial" && <Slider label={tr("Допуск")} value={options.tolerance} min={0} max={255} step={1} format={(value) => `${Math.round(value)}`} onChange={(tolerance) => setOptions({ tolerance })} />}
        {has("contiguous") && effective.kind !== "linear" && effective.kind !== "radial" && (
          <label className="fx-switch" title={tr("Пиксели, связанные с точкой, а не все похожие")}>
            <span>
              <b>{tr("Только смежные")}</b>
            </span>
            <Switch checked={options.contiguous} label={tr("Только смежные")} onChange={(contiguous) => setOptions({ contiguous })} />
          </label>
        )}
        {has("sampleAll") && (
          <label className="fx-switch" title={tr("Брать цвет с собранного холста, а не с выбранного слоя")}>
            <span>
              <b>{tr("По всем слоям")}</b>
            </span>
            <Switch checked={options.sampleAll} label={tr("По всем слоям")} onChange={(sampleAll) => setOptions({ sampleAll })} />
          </label>
        )}
        {has("aligned") && (
          <label className="fx-switch" title={tr("Образец движется вместе с кистью и между мазками")}>
            <span>
              <b>{tr("Выровнено")}</b>
            </span>
            <Switch checked={options.aligned} label={tr("Выровнено")} onChange={(aligned) => setOptions({ aligned })} />
          </label>
        )}
        {has("selectionOp") && (
          <SegmentedControl label={tr("Выделение")} size="sm" options={Object.entries(SELECTION_OP_LABELS).map(([value, label]) => ({ value, label: tr(label) }))} value={options.selectionOp} onChange={(selectionOp) => setOptions({ selectionOp })} />
        )}
        {has("feather") && <Slider label={tr("Растушёвка")} value={options.feather} min={0} max={200} step={1} format={px} onChange={(feather) => setOptions({ feather })} />}
        {options.tool === "shape" && (
          <>
            <Slider label={tr("Толщина")} value={options.shape.strokeWidth} min={0} max={200} step={1} format={px} onChange={(strokeWidth) => setOptions({ shape: { ...options.shape, strokeWidth } })} />
            {effective.kind !== "line" && effective.kind !== "arrow" && (
              <label className="fx-switch" title={tr("Цветом фона")}>
                <span>
                  <b>{tr("Заливка")}</b>
                </span>
                <Switch checked={options.shape.fill} label={tr("Заливка фигуры")} onChange={(fill) => setOptions({ shape: { ...options.shape, fill } })} />
              </label>
            )}
          </>
        )}
        {options.tool === "text" && (
          <>
            <Select label={tr("Шрифт")} ariaLabel={tr("Шрифт нового текста")} value={options.text.font} options={fontOptions(options.text)} onChange={(font) => setOptions({ text: { ...options.text, font } })} />
            <FontSources onFont={(font) => setOptions({ text: { ...options.text, font: "custom", ...font } })} />
            <Slider label={tr("Размер")} value={options.text.size} min={8} max={Math.max(512, session.height)} step={1} format={px} onChange={(size) => setOptions({ text: { ...options.text, size } })} />
          </>
        )}
        {(options.tool === "marquee" || options.tool === "lasso" || options.tool === "wand") && (
          <div className="recolor-actions">
            <Button size="sm" variant="secondary" onClick={() => session.selectAll()}>
              {tr("Всё")}
            </Button>
            <Button size="sm" variant="secondary" disabled={!snapshot.selection} onClick={() => session.deselect()}>
              {tr("Снять")}
            </Button>
            <Button size="sm" variant="secondary" disabled={!snapshot.selection} onClick={() => session.invertSelection()}>
              {tr("Обратить")}
            </Button>
            <Button size="sm" variant="secondary" disabled={!snapshot.selection} onClick={() => session.fillSelection(options.foreground, options.opacity / 100)}>
              {tr("Залить")}
            </Button>
            <Button size="sm" variant="secondary" disabled={!snapshot.selection} onClick={() => session.clearSelection()}>
              {tr("Стереть")}
            </Button>
          </div>
        )}
        {!kinds.length && !tool.options.some((name) => SETTING_OPTIONS.has(name)) && !SELECTING.has(options.tool) && <p className="fx-hint">{tr("У инструмента нет настроек")}</p>}
      </Section>
      {layer?.type === "text" && (
        <Section title={tr("Текст слоя")} id="text">
          <TextProps session={session} layer={layer} />
        </Section>
      )}
      {layer?.type === "shape" && (
        <Section title={tr("Фигура слоя")} id="shape">
          <ShapeProps session={session} layer={layer} />
        </Section>
      )}
      {layer?.type === "fill" && (
        <Section title={tr("Заливка слоя")} id="fill">
          <FillProps session={session} layer={layer} />
        </Section>
      )}
      {layer?.type === "image" && (
        <Section title={tr("Картинка слоя")} id="image">
          <ImageProps session={session} layer={layer} />
        </Section>
      )}
      {layer?.type === "adjust" && (
        <Section title={tr(ADJUST_LABELS[layer.kind])} id="adjust">
          <AdjustControls session={session} layer={layer} />
        </Section>
      )}
      {layer && (layer.type === "raster" || layer.type === "base") && <FilterSection session={session} busy={snapshot.busy} />}
    </>
  );
}
