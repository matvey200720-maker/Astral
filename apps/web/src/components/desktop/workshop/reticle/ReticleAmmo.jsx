import { memo, useEffect, useRef, useState } from "react";
import { ArrowCounterClockwise } from "../../../ui/icons.jsx";
import {
  AMMO_ALIGNS,
  AMMO_COUNTER_STOCK,
  AMMO_FIELD_GUTTER,
  AMMO_FONTS,
  AMMO_FORMATS,
  AMMO_HUD_STAGE,
  AMMO_ICON,
  AMMO_ICONS,
  AMMO_LIMITS,
  AMMO_PLATE_LIMITS,
  AMMO_TEXT_SIZE,
  AMMO_VISIBILITY,
  ammoCounterIsStock,
  ammoCounterLayout,
  ammoCounterParts,
  ammoFont,
  ammoIconPolygons,
  normalizeAmmoCounter,
} from "@modovik/reticle-contract";
import Button from "../../../ui/Button.jsx";
import Checkbox from "../../../ui/Checkbox.jsx";
import NavRow from "../../../ui/NavRow.jsx";
import PanelPage from "../../../ui/PanelPage.jsx";
import ChoiceRadioGroup from "../../../ui/ChoiceRadioGroup.jsx";
import ColorField from "../../../ui/ColorField.jsx";
import SegmentedControl from "../../../ui/SegmentedControl.jsx";
import Slider from "../../../ui/Slider.jsx";
import Switch from "../../../ui/Switch.jsx";
import GameFontsLink from "../../../../features/workshop/emblem/GameFontsLink.jsx";
import { RETICLE_SWATCHES } from "./ReticleInspector.jsx";
import { grabFrame } from "./reticle-grab.js";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * Счётчик патронов (задача 12 ТЗ 10.10.2026) — инструмент «Патроны»
 * редактора прицела: панель настроек и счётчик в кадре.
 *
 * Сколько патронов в обойме и в запасе, считает сама игра — для любого
 * ствола; Astral ставит её блок оружия (`hud.gfx`) своим видом: где стоит,
 * каким шрифтом игры, какого цвета и размера, порядок цифр и значок. Как
 * это устроено в файле — `apps/desktop/src/hud-ammo-gfx-compiler.js`, общая
 * арифметика кадра и файла — `@modovik/reticle-contract` (`ammo.js`).
 *
 * Кадр рисует счётчик буквами шрифта из игры игрока (раздел «Шрифты» читает
 * их оттуда же); пока игра не прочитана — шрифтом окна, и подпись кадра это
 * говорит. Числа в кадре — для примера (обойма 25, запас 671, всего 696: «25 / 696»,
 * как показывают серверы), в игре — патроны ствола в руках. Счётчик в кадре тянут мышью.
 */

/** Пример для кадра: в обойме и в запасе (вторая цифра «обойма / всего» — их сумма). */
export const AMMO_SAMPLE = Object.freeze({ clip: "25", reserve: "671" });

/* ------------------------- шрифты игры ------------------------- */

/* Шрифты игры читает раздел «Шрифты»; кусок с разбором шрифтов приезжает
   только к кадру со счётчиком, а не с общим куском мастерской. */
let gameFontsPromise = null;
function loadAmmoFonts() {
  gameFontsPromise ||= import("../../../../features/workshop/fonts-editor/font-sources.js")
    .then((module) => module.loadGameFonts())
    .catch(() => null);
  return gameFontsPromise;
}

/* Шрифты игры нужны и полоске над игроком (редактор «Полоска HP»,
   `features/workshop/target-hp-editor/target-hp-art.jsx`). */
export function useAmmoFonts() {
  const [game, setGame] = useState(null);
  useEffect(() => {
    let alive = true;
    loadAmmoFonts().then((value) => {
      if (alive) setGame(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return game;
}

const glyphMaps = new WeakMap();
const kerningMaps = new WeakMap();
const glyphPaths = new WeakMap();

function glyphOf(font, code) {
  if (!glyphMaps.has(font)) glyphMaps.set(font, new Map(font.glyphs.map((glyph) => [glyph.code, glyph])));
  return glyphMaps.get(font).get(code) || null;
}

function kerningOf(font, left, right) {
  if (!kerningMaps.has(font))
    kerningMaps.set(font, new Map((font.kerning || []).map((pair) => [pair.a * 65536 + pair.b, pair.advance])));
  return kerningMaps.get(font).get(left * 65536 + right) || 0;
}

/* Контуры буквы — путь SVG в единицах шрифта (ось Y вниз, как у игры). */
function pathOf(font, code) {
  if (!glyphPaths.has(font)) glyphPaths.set(font, new Map());
  const cache = glyphPaths.get(font);
  if (!cache.has(code)) {
    const glyph = glyphOf(font, code);
    const d = glyph
      ? glyph.contours
          .map(
            (contour) =>
              `M${contour.start.x} ${contour.start.y}${contour.segments
                .map((segment) => ("cx" in segment ? `Q${segment.cx} ${segment.cy} ${segment.x} ${segment.y}` : `L${segment.x} ${segment.y}`))
                .join("")}Z`,
          )
          .join("")
      : null;
    cache.set(code, glyph ? { d, advance: glyph.advance } : null);
  }
  return cache.get(code);
}

/*
 * Строка счётчика буквами шрифта игры: `[{ d, x, role }]` в точках сцены HUD
 * при штатном кегле, ширина и масштаб единиц шрифта. Символа, которого в
 * шрифте игры нет, игра не покажет — кадр тоже.
 */
export function glyphLine(font, parts) {
  const scale = AMMO_TEXT_SIZE / (font.nominal || 256);
  const runs = [];
  let pen = 0;
  let previous = 0;
  for (const part of parts)
    for (const char of part.text) {
      const code = char.codePointAt(0);
      if (previous) pen += kerningOf(font, previous, code);
      const glyph = pathOf(font, code);
      if (glyph) {
        if (glyph.d) runs.push({ d: glyph.d, x: pen * scale, role: part.role });
        pen += glyph.advance;
      }
      previous = glyph ? code : 0;
    }
  return { runs, width: pen * scale, scale, ascent: font.ascent * scale };
}

/* Шрифт окна вместо шрифта игры — приближение, кадр его называет. */
export const FALLBACK_FAMILY = Object.freeze({
  cash: "Impact, 'Arial Black', sans-serif",
  main: "'Segoe UI', Arial, sans-serif",
  condensed: "'Arial Narrow', 'Segoe UI', sans-serif",
  script: "'Segoe Script', cursive",
});
const FALLBACK_WIDTH = Object.freeze({ cash: 0.5, main: 0.56, condensed: 0.44, script: 0.5 });

/* ----------------------- счётчик в кадре ----------------------- */

const colourOf = (counter, role) => (role === "clip" ? counter.clipColor : counter.reserveColor);
/* Обводка поля игры — около точки сцены HUD. */
const TEXT_OUTLINE = 1.1;

function AmmoCounterArtView({ counter: input, editing = false, onMove = null, sample = AMMO_SAMPLE }) {
  useTr();
  const counter = normalizeAmmoCounter(input);
  const game = useAmmoFonts();
  const font = ammoFont(counter.font);
  const record = game?.fonts?.get(font.face) || null;
  const parts = ammoCounterParts(counter, sample);
  /* Пути букв помнятся по шрифту (`pathOf`), строка из нескольких цифр
     собирается заново за доли миллисекунды. */
  const line = record ? glyphLine(record, parts) : null;
  const fallbackWidth = parts.reduce((sum, part) => sum + part.text.length, 0) * AMMO_TEXT_SIZE * FALLBACK_WIDTH[font.id];
  const textWidth = line ? line.width : fallbackWidth;
  const layout = ammoCounterLayout(counter, { textWidth });
  const scaleUnits = AMMO_TEXT_SIZE / font.metrics.nominal;
  const baseline = layout.fieldTop + AMMO_FIELD_GUTTER + (line ? line.ascent : font.metrics.ascent * scaleUnits);
  const svgRef = useRef(null);
  const drag = useRef(null);

  /* Точка экрана под указателем — в долях сцены HUD. */
  const pointAt = (event) => {
    const svg = svgRef.current?.ownerSVGElement;
    const matrix = svg?.getScreenCTM?.();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    return {
      x: (local.x + AMMO_HUD_STAGE.width / 2) / AMMO_HUD_STAGE.width,
      y: (local.y + AMMO_HUD_STAGE.height / 2) / AMMO_HUD_STAGE.height,
    };
  };
  const onPointerDown = (event) => {
    if (!editing || !onMove) return;
    const point = pointAt(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { dx: counter.x - point.x, dy: counter.y - point.y };
  };
  const onPointerMove = (event) => {
    if (!drag.current) return;
    const point = pointAt(event);
    if (!point) return;
    const clamp = (value) => Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
    onMove({ x: clamp(point.x + drag.current.dx), y: clamp(point.y + drag.current.dy) });
  };
  const onPointerUp = (event) => {
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const plate = layout.plate;
  const left = Math.min(layout.textX, layout.icon ? layout.iconX : layout.textX, plate ? plate.x : Infinity) - 4;
  const right =
    Math.max(
      layout.textX + textWidth,
      layout.icon ? layout.iconX + AMMO_ICON.count * AMMO_ICON.width + (AMMO_ICON.count - 1) * AMMO_ICON.gap : 0,
      plate ? plate.x + plate.width : -Infinity,
    ) + 4;
  /* Рамка перетаскивания охватывает и подложку. */
  const frameTop = plate ? Math.min(-AMMO_TEXT_SIZE * 0.7, plate.top - 2) : -AMMO_TEXT_SIZE * 0.7;
  const frameHeight = plate ? Math.max(AMMO_TEXT_SIZE * 1.4, plate.height + 4) : AMMO_TEXT_SIZE * 1.4;
  const frame = grabFrame({ x: left, y: frameTop, width: right - left, height: frameHeight }, layout.scale);
  const iconPoints = (grow) =>
    ammoIconPolygons(grow).map((points) => points.map(([x, y]) => `${(layout.iconX + x).toFixed(2)},${y.toFixed(2)}`).join(" "));

  return (
    <g
      ref={svgRef}
      className={`reticle-ammo-art${editing ? " is-editing" : ""}${counter.enabled ? "" : " is-off"}`}
      transform={`translate(${layout.x - AMMO_HUD_STAGE.width / 2} ${layout.y - AMMO_HUD_STAGE.height / 2}) scale(${layout.scale})`}
      aria-label={`${tr("Счётчик патронов")}: ${parts.map((part) => part.text).join("")}`}
    >
      {editing && (
        <rect
          className="reticle-ammo-frame"
          x={frame.x}
          y={frame.y}
          width={frame.width}
          height={frame.height}
          rx={3}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      )}
      <g pointerEvents="none">
        {plate && (
          <rect
            className="reticle-ammo-plate"
            x={plate.x}
            y={plate.top}
            width={plate.width}
            height={plate.height}
            rx={plate.radius}
            ry={plate.radius}
            fill={counter.plateColor}
            fillOpacity={counter.plateOpacity / 100}
          />
        )}
        {line ? (
          <g transform={`translate(${layout.textX} ${baseline})`}>
            {counter.outline &&
              line.runs.map((run, index) => (
                <path
                  key={`o${index}`}
                  d={run.d}
                  transform={`translate(${run.x} 0) scale(${line.scale})`}
                  fill="#000"
                  stroke="#000"
                  strokeWidth={(TEXT_OUTLINE * 2) / line.scale}
                  strokeLinejoin="round"
                />
              ))}
            {line.runs.map((run, index) => (
              <path
                key={`f${index}`}
                d={run.d}
                transform={`translate(${run.x} 0) scale(${line.scale})`}
                fill={colourOf(counter, run.role)}
                fillRule="evenodd"
              />
            ))}
          </g>
        ) : (
          <text
            x={layout.textX}
            y={baseline}
            fontFamily={FALLBACK_FAMILY[font.id]}
            fontSize={AMMO_TEXT_SIZE}
            stroke={counter.outline ? "#000" : "none"}
            strokeWidth={counter.outline ? TEXT_OUTLINE * 2 : 0}
            paintOrder="stroke"
          >
            {parts.map((part, index) => (
              <tspan
                key={index}
                fill={colourOf(counter, part.role)}
                /* Цифры патронов — рисунок кадра (счётчик игры в единицах холста), а не текст интерфейса: их кегль
                   не из шкалы продукта и не должен быть. Тот же приём, что у надписей карты и полоски HP. */
                data-audit-ignore="type-scale"
              >
                {part.text.replace(/ /g, " ")}
              </tspan>
            ))}
          </text>
        )}
        {layout.icon && (
          <g>
            {counter.outline && iconPoints(AMMO_ICON.outline).map((points, index) => <polygon key={`o${index}`} points={points} fill="#000" />)}
            {iconPoints(0).map((points, index) => (
              <polygon key={`f${index}`} points={points} fill={counter.clipColor} />
            ))}
          </g>
        )}
      </g>
    </g>
  );
}

export const AmmoCounterArt = memo(AmmoCounterArtView);

/** Прочитаны ли шрифты игры для кадра (строка состояния говорит, если нет). */
export function useAmmoFontsReady() {
  const game = useAmmoFonts();
  return Boolean(game?.fonts?.size);
}

/* --------------------------- панель --------------------------- */

const percent = (value) => Math.round(value * 1000) / 10;

/* Раздел счётчика — своя страница панели: имя уже стоит в шапке колонки,
   второй раз его не пишут. */
function Section({ title, children }) {
  return (
    <section className="ui-panel fx-section reticle-ammo-section" aria-label={title}>
      {children}
    </section>
  );
}

const labelOf = (list, id) => tr(list.find((item) => item.id === id)?.label || "");

/* Что стоит в разделе — подписью его строки на первой странице. */
function sectionCaptions(counter) {
  return {
    visibility: [labelOf(AMMO_VISIBILITY, counter.visibility), counter.showOverHide ? tr("поверх скрытия") : ""]
      .filter(Boolean)
      .join(" · "),
    place: `${percent(counter.x)} · ${percent(counter.y)} ${tr(AMMO_LIMITS.x.unit)} · ${labelOf(AMMO_ALIGNS, counter.align)}`,
    look: `${ammoFont(counter.font).label} · ${counter.size} ${tr(AMMO_LIMITS.size.unit)}`,
    colour: `${counter.clipColor.toUpperCase()} · ${counter.reserveColor.toUpperCase()}${counter.outline ? ` · ${tr("обводка")}` : ""}`,
    plate: counter.plate ? `${counter.plateColor.toUpperCase()} · ${counter.plateOpacity} ${tr(AMMO_PLATE_LIMITS.opacity.unit)}` : tr("Нет"),
  };
}

const AMMO_PAGES = Object.freeze([
  { id: "visibility", title: "Когда виден" },
  { id: "place", title: "Где" },
  { id: "look", title: "Вид" },
  { id: "colour", title: "Цвет" },
  { id: "plate", title: "Подложка" },
]);

/**
 * Панель инструмента «Патроны». `onPatch(change, label, property)` —
 * правка счётчика (`change` — поля счётчика), счётчик один на все стволы.
 */
export function ReticleAmmoPanel({ counter: input, onPatch }) {
  useTr();
  /*
   * Панель как у «Большой карты» (18.10.2026, владелец: «перегружены»):
   * на первой странице — счётчик в игре и «Стандарт», ниже пять строк
   * «Когда виден», «Где», «Вид», «Цвет», «Подложка» с тем, что стоит;
   * строка открывает свою страницу, шапка колонки ведёт назад.
   */
  const [page, setPage] = useState("");
  const counter = normalizeAmmoCounter(input);
  const stock = ammoCounterIsStock(counter);
  const set = (field, label) => (value) => onPatch({ [field]: value }, label, field);
  function ammoPage(id) {
    if (id === "visibility")
      return (
        <Section title={tr("Когда виден")}>
          <SegmentedControl
            label={tr("Когда виден счётчик")}
            size="sm"
            value={counter.visibility}
            onChange={set("visibility", tr("Счётчик патронов: когда виден"))}
            options={AMMO_VISIBILITY.map((item) => ({ value: item.id, label: tr(item.label), title: tr(item.note) }))}
          />
          <Checkbox
            label={tr("Поверх скрытия сервером")}
            hint={tr("Сервер или игра прячет штатный блок оружия — счётчик всё равно виден")}
            checked={counter.showOverHide}
            onChange={set("showOverHide", tr("Счётчик патронов: поверх скрытия"))}
          />
        </Section>
      );
    if (id === "place")
      return (
        <Section title={tr("Где")}>
          <p className="fx-hint">{tr("Перетащите счётчик в кадре — или задайте точку числами.")}</p>
          <Slider
            editable
            label={tr(AMMO_LIMITS.x.label)}
            value={percent(counter.x)}
            min={AMMO_LIMITS.x.min}
            max={AMMO_LIMITS.x.max}
            step={AMMO_LIMITS.x.step}
            unit={tr(AMMO_LIMITS.x.unit)}
            onChange={(value) => onPatch({ x: value / 100 }, tr("Счётчик патронов: место"), "position")}
          />
          <Slider
            editable
            label={tr(AMMO_LIMITS.y.label)}
            value={percent(counter.y)}
            min={AMMO_LIMITS.y.min}
            max={AMMO_LIMITS.y.max}
            step={AMMO_LIMITS.y.step}
            unit={tr(AMMO_LIMITS.y.unit)}
            onChange={(value) => onPatch({ y: value / 100 }, tr("Счётчик патронов: место"), "position")}
          />
          <SegmentedControl
            label={tr("Куда растёт строка")}
            size="sm"
            value={counter.align}
            onChange={set("align", tr("Счётчик патронов: выравнивание"))}
            options={AMMO_ALIGNS.map((item) => ({ value: item.id, label: tr(item.label), title: tr(item.note) }))}
          />
        </Section>
      );
    if (id === "look")
      return (
        <Section title={tr("Вид")}>
          <ChoiceRadioGroup
            label={tr("Шрифт счётчика")}
            className="reticle-ammo-fonts"
            value={counter.font}
            onChange={set("font", tr("Счётчик патронов: шрифт"))}
            options={AMMO_FONTS.map((item) => ({ value: item.id, title: item.label, description: item.note }))}
          />
          <p className="fx-hint">
            {tr("Шрифты игры. Свой шрифт — разделом «Шрифты»: он встаёт на место шрифтов игры, и счётчик возьмёт его.")}
          </p>
          <GameFontsLink />
          <Slider
            editable
            label={tr(AMMO_LIMITS.size.label)}
            value={counter.size}
            min={AMMO_LIMITS.size.min}
            max={AMMO_LIMITS.size.max}
            step={AMMO_LIMITS.size.step}
            unit={tr(AMMO_LIMITS.size.unit)}
            onChange={set("size", tr("Счётчик патронов: размер"))}
          />
          <SegmentedControl
            label={tr("Порядок цифр")}
            size="sm"
            value={counter.format}
            onChange={set("format", tr("Счётчик патронов: порядок цифр"))}
            options={AMMO_FORMATS.map((item) => ({ value: item.id, label: tr(item.label), title: tr(item.note) }))}
          />
          <SegmentedControl
            label={tr("Значок патронов")}
            size="sm"
            value={counter.icon}
            onChange={set("icon", tr("Счётчик патронов: значок"))}
            options={AMMO_ICONS.map((item) => ({ value: item.id, label: tr(item.label), title: tr(item.note) }))}
          />
        </Section>
      );
    if (id === "colour")
      return (
        <Section title={tr("Цвет")}>
          <ColorField
            label={tr("В обойме")}
            value={counter.clipColor}
            swatches={RETICLE_SWATCHES}
            editable
            onChange={set("clipColor", tr("Счётчик патронов: цвет обоймы"))}
          />
          <ColorField
            label={tr("В запасе")}
            value={counter.reserveColor}
            swatches={RETICLE_SWATCHES}
            editable
            onChange={set("reserveColor", tr("Счётчик патронов: цвет запаса"))}
          />
          <label className="ui-field reticle-toggle">
            <span>{tr("Обводка")}</span>
            <Switch
              checked={counter.outline}
              label={counter.outline ? tr("Убрать обводку счётчика") : tr("Обвести счётчик")}
              onChange={set("outline", tr("Счётчик патронов: обводка"))}
            />
          </label>
        </Section>
      );
    if (id === "plate")
      return (
        <Section title={tr("Подложка")}>
          <label className="ui-field reticle-toggle">
            <span>{tr("Подложка под счётчиком")}</span>
            <Switch
              checked={counter.plate}
              label={counter.plate ? tr("Убрать подложку") : tr("Поставить подложку")}
              onChange={set("plate", tr("Счётчик патронов: подложка"))}
            />
          </label>
          {counter.plate ? (
            <>
              <ColorField
                label={tr("Цвет подложки")}
                value={counter.plateColor}
                swatches={RETICLE_SWATCHES}
                editable
                onChange={set("plateColor", tr("Счётчик патронов: цвет подложки"))}
              />
              <Slider
                editable
                label={tr(AMMO_PLATE_LIMITS.opacity.label)}
                value={counter.plateOpacity}
                min={AMMO_PLATE_LIMITS.opacity.min}
                max={AMMO_PLATE_LIMITS.opacity.max}
                step={AMMO_PLATE_LIMITS.opacity.step}
                unit={tr(AMMO_PLATE_LIMITS.opacity.unit)}
                onChange={set("plateOpacity", tr("Счётчик патронов: непрозрачность подложки"))}
              />
              <Slider
                editable
                label={tr(AMMO_PLATE_LIMITS.padX.label)}
                value={counter.platePadX}
                min={AMMO_PLATE_LIMITS.padX.min}
                max={AMMO_PLATE_LIMITS.padX.max}
                step={AMMO_PLATE_LIMITS.padX.step}
                unit={tr(AMMO_PLATE_LIMITS.padX.unit)}
                onChange={set("platePadX", tr("Счётчик патронов: отступ подложки по горизонтали"))}
              />
              <Slider
                editable
                label={tr(AMMO_PLATE_LIMITS.padY.label)}
                value={counter.platePadY}
                min={AMMO_PLATE_LIMITS.padY.min}
                max={AMMO_PLATE_LIMITS.padY.max}
                step={AMMO_PLATE_LIMITS.padY.step}
                unit={tr(AMMO_PLATE_LIMITS.padY.unit)}
                onChange={set("platePadY", tr("Счётчик патронов: отступ подложки по вертикали"))}
              />
              <Slider
                editable
                label={tr(AMMO_PLATE_LIMITS.radius.label)}
                value={counter.plateRadius}
                min={AMMO_PLATE_LIMITS.radius.min}
                max={AMMO_PLATE_LIMITS.radius.max}
                step={AMMO_PLATE_LIMITS.radius.step}
                unit={tr(AMMO_PLATE_LIMITS.radius.unit)}
                onChange={set("plateRadius", tr("Счётчик патронов: скругление подложки"))}
              />
              <p className="fx-hint">{tr("Ширина подложки следует за цифрами и значком — растёт и сжимается вместе с числом цифр. Скругление не заходит за середину самой короткой строки.")}</p>
            </>
          ) : (
            <p className="fx-hint">{tr("Как в игре — без подложки: цифры прямо на экране. Включите — под цифрами и значком встанет плашка.")}</p>
          )}
        </Section>
      );
    return null;
  }
  const open = AMMO_PAGES.find((item) => item.id === page);
  if (open)
    return (
      <PanelPage label={tr(open.title)} note={tr("Счётчик патронов")} backLabel={tr("Патроны")} onBack={() => setPage("")}>
        {ammoPage(open.id)}
      </PanelPage>
    );
  const captions = sectionCaptions(counter);
  return (
    <>
      <section className="ui-panel fx-section reticle-ammo-head" aria-label={tr("Счётчик патронов")}>
        <label className="ui-field reticle-toggle">
          <span>{tr("Счётчик в игре")}</span>
          <Switch
            checked={counter.enabled}
            label={counter.enabled ? tr("Убрать счётчик патронов") : tr("Поставить счётчик патронов")}
            onChange={(on) => onPatch({ enabled: on }, on ? tr("Счётчик патронов включён") : tr("Счётчик патронов выключен"), "enabled")}
          />
        </label>
        {counter.enabled ? (
          <p className="fx-hint">
            {tr("Сколько патронов в обойме и в запасе — числа считает сама игра, для любого ствола и дополнений. Счётчик один на все стволы и ставится тем же «Применить», что и прицел.")}
          </p>
        ) : (
          <p className="fx-hint reticle-ammo-off" role="status">
            {tr("Выключен: «Применить» поставит прицел без счётчика, а в кадре он бледный. Любая настройка ниже включит его.")}
          </p>
        )}
        <div className="reticle-ammo-actions">
          <Button
            variant="secondary"
            size="sm"
            icon={<ArrowCounterClockwise />}
            disabled={stock}
            title={tr("Вид и место блока патронов игры: правый верхний угол, Pricedown")}
            onClick={() => onPatch({ ...AMMO_COUNTER_STOCK }, tr("Счётчик патронов: стандарт"), "standard")}
          >
            {tr("Стандарт")}
          </Button>
        </div>
      </section>
      <section className="ui-panel fx-section reticle-ammo-pages" aria-label={tr("Настройки счётчика")}>
        <div className="fx-nav-rows">
          {AMMO_PAGES.map((item) => (
            <NavRow
              key={item.id}
              title={tr(item.title)}
              caption={captions[item.id]}
              data-ammo-page={item.id}
              onOpen={() => setPage(item.id)}
            />
          ))}
        </div>
      </section>
    </>
  );
}
