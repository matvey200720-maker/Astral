import { createElement as el, useId } from "react";
import { tr, useTr } from "../../../../locales/ui.js";

// ---------- общие куски ----------

const LAND = "#4c5449";
const ROAD = "#9aa0a6";
const TILE_BOX = "0 0 56 36";
const TILE_ZONE = { x: 10, y: 6, width: 36, height: 24, rx: 4 };
const SAMPLE_ZONE = { x: 30, y: 12, width: 100, height: 40, rx: 8 };

// id для clipPath/filter: только буквы, цифры, «_» и «-»
const cleanId = (raw) => raw.replace(/[^A-Za-z0-9_-]/g, "");

const refTo = (id) => `url(#${id})`;

// «кусок карты»: суша и две дороги нужного размера
function groundPieces(w, ht) {
  const bend = `M0 ${ht * 0.72} C${w * 0.25} ${ht * 0.55} ${w * 0.45} ${ht * 0.85} ${w} ${ht * 0.38}`;
  const straight = `M${w * 0.32} 0 L${w * 0.43} ${ht}`;
  return [
    el("rect", { key: "land", width: w, height: ht, fill: LAND }),
    el("path", { key: "bend", d: bend, stroke: ROAD, strokeWidth: 3, fill: "none" }),
    el("path", { key: "straight", d: straight, stroke: ROAD, strokeWidth: 2, fill: "none" }),
  ];
}

function tileSvg(...parts) {
  return el("svg", { viewBox: TILE_BOX, "aria-hidden": "true" }, ...parts);
}

// ---------- картинки на плитках ----------

export function FillPicture({ mode, color }) {
  const uid = cleanId(useId());
  const clipId = `fill-${uid}`;
  const clip = el("defs", null, el("clipPath", { id: clipId }, el("rect", TILE_ZONE)));
  const border = el("rect", { ...TILE_ZONE, fill: "none", stroke: color, strokeWidth: 1.6 });

  const overlays = {
    flat: () => el("rect", { ...TILE_ZONE, fill: color, fillOpacity: 0.45 }),
    recolor: () => {
      const curve = "M0 25.9 C14 19.8 25.2 30.6 56 13.7";
      const white = { stroke: "#fff", strokeOpacity: 0.55 };
      return el(
        "g",
        { clipPath: refTo(clipId) },
        el("rect", { width: 56, height: 36, fill: color }),
        el("rect", { width: 56, height: 36, fill: "#000", fillOpacity: 0.35 }),
        el("path", { d: curve, stroke: color, strokeWidth: 3, fill: "none" }),
        el("path", { d: curve, ...white, strokeWidth: 3, fill: "none" }),
        el("path", { d: "M17.9 0 L24.1 36", ...white, strokeWidth: 2, fill: "none" }),
      );
    },
  };
  const make = Object.hasOwn(overlays, mode) ? overlays[mode] : null;

  return tileSvg(clip, groundPieces(56, 36), make && make(), border);
}

export function AlignPicture({ align, color }) {
  const band =
    align === "inside"
      ? { x: 13, y: 9, width: 30, height: 18, rx: 1 }
      : { ...TILE_ZONE };
  return tileSvg(
    groundPieces(56, 36),
    el("rect", { ...TILE_ZONE, fill: color, fillOpacity: 0.18 }),
    el("rect", { ...band, fill: "none", stroke: color, strokeWidth: 6, strokeOpacity: 0.9 }),
    el("rect", { ...TILE_ZONE, fill: "none", stroke: "#fff", strokeWidth: 0.8, strokeDasharray: "2 1.6" }),
  );
}

const LINE_DASH = new Map([
  ["dashed", "7 5"],
  ["dotted", "0 6"],
]);

export function LinePicture({ line, color = "#ffffff" }) {
  return tileSvg(
    el("path", {
      d: "M6 26 C18 6 36 32 50 10",
      fill: "none",
      stroke: color,
      strokeWidth: line === "dotted" ? 4 : 3,
      strokeLinecap: "round",
      strokeDasharray: LINE_DASH.get(line),
    }),
  );
}

// ---------- группа плиток ----------

function tileOf(option, selected, onChange) {
  const classes = selected ? "wmc-picture-option is-active" : "wmc-picture-option";
  return el(
    "button",
    {
      key: option.value,
      type: "button",
      role: "radio",
      "aria-checked": selected,
      className: classes,
      title: option.hint || option.label,
      onClick: () => onChange(option.value),
    },
    el("span", { className: "wmc-picture-media" }, option.picture),
    el("small", null, option.label),
    option.detail ? el("small", { className: "wmc-picture-detail" }, option.detail) : null,
  );
}

export function PictureChoice({ label, value, options, onChange }) {
  return el(
    "div",
    {
      className: "wmc-picture-choice",
      role: "radiogroup",
      "aria-label": label,
      style: { "--columns": options.length },
    },
    options.map((option) => tileOf(option, option.value === value, onChange)),
  );
}

// ---------- готовые выборы ----------

export function FillChoice({ label, value, color, onChange, none = true }) {
  useTr();
  const tiles = [
    {
      value: "flat",
      label: tr("Плёнка"),
      hint: tr("Цвет зоны прозрачной плёнкой поверх карты"),
      picture: el(FillPicture, { mode: "flat", color }),
    },
    {
      value: "recolor",
      label: tr("Перекраска"),
      hint: tr("Карта под зоной перекрашена в цвет зоны"),
      picture: el(FillPicture, { mode: "recolor", color }),
    },
  ];
  if (none) {
    tiles.unshift({
      value: "none",
      label: tr("Нет"),
      hint: tr("Только граница — карта под зоной как есть"),
      picture: el(FillPicture, { mode: "none", color }),
    });
  }
  return el(PictureChoice, { label, value, options: tiles, onChange });
}

export function AlignChoice({ label, value, color, onChange }) {
  useTr();
  const sides = [
    ["center", tr("По контуру"), tr("Граница поровну по обе стороны края зоны")],
    ["inside", tr("Внутрь"), tr("Граница целиком внутри зоны — соседние зоны не наезжают")],
  ];
  const options = sides.map(([kind, name, hint]) => ({
    value: kind,
    label: name,
    hint,
    picture: el(AlignPicture, { align: kind, color }),
  }));
  return el(PictureChoice, { label, value, options, onChange });
}

export function LineChoice({ label, value, color, onChange }) {
  useTr();
  const kinds = [
    ["solid", tr("Сплошная")],
    ["dashed", tr("Пунктир")],
    ["dotted", tr("Точки")],
  ];
  const options = kinds.map(([kind, name]) => ({
    value: kind,
    label: name,
    picture: el(LinePicture, { line: kind, color }),
  }));
  return el(PictureChoice, { label, value, options, onChange });
}

// ---------- живой образец зоны ----------

const toNumber = (raw) => Number(raw) || 0;
const atLeastZero = (raw) => Math.max(0, toNumber(raw));

const SAMPLE_DASH = new Map([
  ["dashed", (t) => `${t * 2.6 + 4} ${t * 1.8 + 3}`],
  ["dotted", (t) => `0 ${t * 2 + 3}`],
]);

export function ZoneSample({ look, line = "solid", color, filled = true }) {
  const uid = cleanId(useId());
  const clipId = `zs-${uid}`;
  const blurId = `zg-${uid}`;

  const thickness = atLeastZero(look.strokeWidth) * 1.3;
  const glow = atLeastZero(look.glow);
  const density = Math.min(100, atLeastZero(look.fillOpacity)) / 100;
  const dash = SAMPLE_DASH.get(line)?.(thickness);
  const inside = look.strokeAlign === "inside";

  const outlined = (extra) => el("rect", { ...SAMPLE_ZONE, fill: "none", stroke: color, ...extra });

  const fillLayer = () =>
    look.fillMode === "recolor"
      ? el(
          "g",
          { clipPath: refTo(clipId), opacity: density },
          el("rect", { width: 160, height: 64, fill: color }),
          el("rect", { width: 160, height: 64, fill: "#000", fillOpacity: 0.35 }),
          el("path", {
            d: "M0 46 C40 35 72 54 160 24",
            stroke: "#fff",
            strokeOpacity: 0.55,
            strokeWidth: 3,
            fill: "none",
          }),
        )
      : el("rect", { ...SAMPLE_ZONE, fill: color, fillOpacity: density });

  const blur = glow > 0
    ? el(
        "filter",
        { id: blurId, x: "-40%", y: "-80%", width: "180%", height: "260%" },
        el("feGaussianBlur", { stdDeviation: 1 + glow / 12 }),
      )
    : null;

  const drawn = [];
  if (filled) drawn.push(fillLayer());
  if (thickness > 0 && glow > 0) {
    drawn.push(
      outlined({
        strokeWidth: thickness + 2 + glow / 20,
        opacity: 0.25 + glow / 160,
        filter: refTo(blurId),
      }),
    );
  }
  if (thickness > 0) {
    drawn.push(
      outlined({
        strokeWidth: inside ? thickness * 2 : thickness,
        strokeDasharray: dash,
        strokeLinecap: line === "dotted" ? "round" : "butt",
        clipPath: inside ? refTo(clipId) : undefined,
      }),
    );
  }

  return el(
    "div",
    { className: "wmc-zone-sample", "aria-hidden": "true" },
    el(
      "svg",
      { viewBox: "0 0 160 64", preserveAspectRatio: "xMidYMid slice" },
      el("defs", null, el("clipPath", { id: clipId }, el("rect", SAMPLE_ZONE)), blur),
      groundPieces(160, 64),
      ...drawn,
    ),
  );
}
