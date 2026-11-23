import { tr, useTr } from "../../../../locales/ui.js";
import PresetShelf from "../../../ui/PresetShelf.jsx";
import ChoiceTile from "../../../ui/ChoiceTile.jsx";
import { generatePattern } from "./gun-patterns-core.js";
import { DiceFive, Storefront } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import { TEMPLATES } from "@modovik/gun-studio";
import Kbd from "../../../ui/Kbd.jsx";
import { emblemMarkup } from "./gun-emblems.js";
import { textFont } from "./gun-canvas.js";
import { fill, tl, trKey } from "./gun-copy.js";
import { Fragment, createElement as h, useEffect, useRef } from "react";

// ---------- миниатюра на холсте ----------

class ThumbPainter {
  constructor(ctx, palette) {
    this.ctx = ctx;
    this.palette = palette;
    this.stage = null;
    this.stageCtx = null;
    this.timer = 0;
    this.live = true;
  }

  paint(template) {
    this.ground(template.backdrop);
    this.layers(template);
    this.mark(template.stickers?.[0]);
  }

  dispose() {
    this.live = false;
    clearTimeout(this.timer);
  }

  // Присваивания идут в порядке ключей: так их видит холст.
  set(state) {
    Object.assign(this.ctx, state);
  }

  colour(spec) {
    return typeof spec === "number" ? this.palette[spec % this.palette.length] : spec;
  }

  ground(backdrop) {
    this.set({ globalCompositeOperation: "source-over", globalAlpha: 1, fillStyle: backdrop || THUMB.ground });
    this.ctx.fillRect(0, 0, THUMB.w, THUMB.h);
  }

  layers(template) {
    for (const layer of template.body) {
      const zone = ZONES.get(layer.zone) ?? WHOLE;
      switch (layer.kind) {
        case "shade":
          break;
        case "fill":
          this.tune(layer);
          this.solid(layer, zone);
          break;
        default:
          this.tune(layer);
          this.texture(layer, zone);
      }
    }
    this.set({ globalAlpha: 1, globalCompositeOperation: "source-over" });
  }

  tune({ opacity, blend }) {
    const mode = blend && blend !== "color" ? blend : "source-over";
    this.set({ globalAlpha: (opacity ?? 100) / 100, globalCompositeOperation: mode });
  }

  solid(layer, zone) {
    this.set({ fillStyle: this.colour(layer.colour) });
    this.ctx.fillRect(...zone);
  }

  texture(layer, zone) {
    const pixels = generatePattern(
      {
        pattern: layer.pattern,
        colours: layer.colours.map((c) => this.colour(c)),
        scale: layer.scale ?? 100,
        rotation: layer.rotation ?? 0,
        seed: layer.seed ?? 0,
      },
      THUMB.w,
      THUMB.h,
    );
    this.stageContext().putImageData(new ImageData(pixels, THUMB.w, THUMB.h), 0, 0);
    this.ctx.drawImage(this.stage, ...zone, ...zone);
  }

  // Вспомогательный холст создаётся один раз на рисование и на странице не показывается.
  stageContext() {
    if (this.stage === null) {
      this.stage = Object.assign(document.createElement("canvas"), { width: THUMB.w, height: THUMB.h });
      this.stageCtx = this.stage.getContext("2d");
    }
    return this.stageCtx;
  }

  mark(sticker) {
    if (!sticker) return;
    if (sticker.text) this.caption(sticker);
    else this.timer = setTimeout(() => this.loadEmblem(sticker), 0);
  }

  caption({ text, font, colour }) {
    const { ctx } = this;
    this.set({ font: textFont(font, CAPTION.start) });
    const width = ctx.measureText?.(text)?.width ?? 0;
    const shrunk = Math.max(CAPTION.floor, Math.floor((CAPTION.start * CAPTION.fit) / width));
    const size = width > CAPTION.fit ? shrunk : CAPTION.start;
    this.set({
      font: textFont(font, size),
      fillStyle: this.colour(colour),
      textAlign: "center",
      textBaseline: "middle",
    });
    ctx.fillText(text, THUMB.w / 2, THUMB.h / 2);
  }

  loadEmblem(sticker) {
    if (!this.live) return;
    const markup = emblemMarkup(sticker.source);
    if (typeof markup !== "string") return;
    const ink = this.colour(sticker.colour);
    const picture = new Image();
    picture.onload = () => {
      if (this.live) this.ctx.drawImage(picture, EMBLEM.x, EMBLEM.y, EMBLEM.side, EMBLEM.side);
    };
    picture.src = SVG_URI + encodeURIComponent(markup.replace(/#ffffff/gi, () => ink));
  }
}

// Возвращает снятие отложенной работы либо ничего, если рисовать нечем.
function startPainting(canvas, template, chroma) {
  const ctx = canvas?.getContext("2d");
  if (!ctx || typeof ImageData === "undefined") return undefined;
  const painter = new ThumbPainter(ctx, chroma.palette);
  painter.paint(template);
  return () => painter.dispose();
}

function ThumbCanvas({ template, chroma }) {
  const canvasRef = useRef(null);
  useEffect(() => startPainting(canvasRef.current, template, chroma), [template, chroma]);
  return h("canvas", { ref: canvasRef, width: THUMB.w, height: THUMB.h, "aria-hidden": "true" });
}

// ---------- ячейки ----------

const cellClass = (selected) => (selected ? `${CELL} is-selected` : CELL);

// Расцветка на плитке: названная снаружи (если шаблон выбран и такая есть) либо первая.
function shownChroma(chromas, selected, wantedId) {
  const first = chromas[0];
  if (!selected) return first;
  return chromas.find((c) => c.id === wantedId) ?? first;
}

function ChromaDots({ template, name, current, onApply }) {
  const dot = (chroma) => {
    const chromaName = tl(chroma.label.ru);
    const { palette } = chroma;
    const active = chroma === current;
    return h("button", {
      key: chroma.id,
      type: "button",
      className: active ? "is-active" : undefined,
      title: chromaName,
      "aria-label": `${name}: ${chromaName}`,
      "aria-pressed": active,
      style: { "--chroma": `linear-gradient(135deg, ${palette[1]} 0 50%, ${palette[0]} 50% 100%)` },
      onClick: () => onApply(template.id, chroma.id),
    });
  };
  const groupLabel = fill(tr(COPY.chromasOf), { name });
  return h(
    "span",
    { className: "gun-preset-chromas", role: "group", "aria-label": groupLabel },
    template.chromas.map(dot),
  );
}

function TemplateCell({ template, activeTemplate, activeChroma, onApply }) {
  const selected = template.id === activeTemplate;
  const name = tl(template.label.ru);
  const hint = tl(template.hint.ru);
  const shown = shownChroma(template.chromas, selected, activeChroma);
  const tile = h(ChoiceTile, {
    className: "gun-preset",
    selected,
    media: h(ThumbCanvas, { template, chroma: shown }),
    title: name,
    tooltip: hint,
    onClick: () => onApply(template.id, shown.id),
  });
  const dots = h(ChromaDots, { template, name, current: selected ? shown : null, onApply });
  return h("div", { className: cellClass(selected) }, tile, dots);
}

function RollCell({ onRoll }) {
  const tile = h(ChoiceTile, {
    className: "gun-preset gun-preset-roll",
    media: h(DiceFive, GLYPH),
    title: tr(COPY.roll),
    tooltip: `${tr(COPY.rollHead)}: ${tr(COPY.rollTail)}`,
    onClick: onRoll,
  });
  const caption = h("span", { className: KEY_CAPTION }, h(Kbd, null, "D"), ` ${tr(COPY.hotkey)}`);
  return h("div", { className: CELL }, tile, caption);
}

function SkinCell({ skin, picked, onPickModel }) {
  const media = skin.preview ? h("img", { alt: "", loading: "lazy", src: skin.preview }) : h(Storefront, GLYPH);
  const tile = h(ChoiceTile, {
    className: "gun-preset gun-preset-skin",
    selected: picked,
    media,
    title: skin.name,
    tooltip: tr(COPY.skinHint),
    onClick: () => onPickModel(skin),
  });
  return h("div", { className: cellClass(picked) }, tile, h("span", { className: KEY_CAPTION }, tr(COPY.catalog)));
}

function AsInGame({ standard }) {
  const label = tr(COPY.asInGame);
  const button = h(
    Button,
    {
      size: "sm",
      variant: "secondary",
      disabled: Boolean(standard.disabled),
      title: tr(standard.installed ? COPY.hintInstalled : COPY.hintFactory),
      onClick: standard.onClick,
    },
    label,
  );
  return h("section", { className: "ui-panel gun-panel gun-standard", "aria-label": label }, button);
}

// Заменяется только undefined: null, пустая строка и ноль остаются как есть.
function withDefaults(props) {
  const resolved = { ...props };
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    if (resolved[key] === undefined) resolved[key] = fallback;
  }
  return resolved;
}

// ---------- полка ----------

export default function GunPresetShelf(props) {
  useTr();
  const settings = withDefaults(props);
  const { templates, fitted, title, fittedTitle } = settings;
  const { activeTemplate, activeChroma, onApply } = settings;
  const { onRoll, catalogSkins, onPickModel, activeModelId, standard } = settings;

  const hasFitted = fitted.length > 0;
  const skins = onPickModel ? catalogSkins : [];
  const total = templates.length + skins.length;

  const templateCell = (template) =>
    h(TemplateCell, { key: template.id, template, activeTemplate, activeChroma, onApply });
  const skinCell = (skin) => h(SkinCell, { key: skin.id, skin, picked: skin.id === activeModelId, onPickModel });

  const fittedShelf = hasFitted
    ? h(
        PresetShelf,
        { title: tr(fittedTitle), count: fitted.length, className: SHELF_CLASS.fitted, collapsible: false },
        fitted.map(templateCell),
      )
    : null;
  const mainShelf = h(
    PresetShelf,
    {
      title: tr(hasFitted ? COPY.generalTitle : title),
      count: total,
      className: SHELF_CLASS.main,
      collapsible: false,
    },
    onRoll ? h(RollCell, { onRoll }) : null,
    skins.map(skinCell),
    templates.map(templateCell),
  );

  return h(Fragment, null, standard ? h(AsInGame, { standard }) : null, fittedShelf, mainShelf);
}

// ---------- таблицы ----------

const CELL = "gun-preset-cell";
const KEY_CAPTION = "gun-preset-chromas gun-preset-key";
const GLYPH = { weight: "duotone", "aria-hidden": "true" };
const SHELF_CLASS = { main: "gun-presets", fitted: "gun-presets gun-presets-fitted" };
const SVG_URI = "data:image/svg+xml;charset=utf-8,";

const THUMB = { w: 192, h: 108, ground: "#34373d" };
const CAPTION = { start: 40, fit: 153.6, floor: 12 };
const EMBLEM = { side: 75.6, x: 58.2, y: 16.2 };

// Прямоугольники зон на холсте миниатюры: x, y, ширина, высота.
const WHOLE = [0, 0, 192, 108];
const ZONES = new Map([
  ["top", [0, 0, 192, 48.6]],
  ["bottom", [0, 48.6, 192, 59.4]],
  ["stripe", [0, 43.2, 192, 17.28]],
  ["front", [119.04, 0, 72.96, 108]],
  ["rear", [0, 0, 72.96, 108]],
]);

const COPY = {
  title: trKey("Готовые скины"),
  fittedTitle: trKey("Под этот ствол"),
  generalTitle: trKey("Общие — на любое оружие"),
  asInGame: trKey("Как в игре"),
  hintInstalled: trKey(
    "Ствол как в игре одним шагом: покраска, узоры, наклейки и потёртость снимаются. Скин сейчас стоит в игре — после «Как в игре» «Применить» снимет его, и в игре снова заводской ствол.",
  ),
  hintFactory: trKey(
    "Ствол как в игре одним шагом: покраска, узоры, наклейки и потёртость снимаются. В игре и так заводской ствол.",
  ),
  chromasOf: trKey("Расцветки: {name}"),
  roll: trKey("Случайный"),
  rollHead: trKey("Случайный скин (D)"),
  rollTail: trKey("Шаблон, расцветка и рисунок — жми, пока не понравится"),
  hotkey: trKey("горячая клавиша"),
  skinHint: trKey("Скин из каталога — основа: поменяй цвета, дорисуй своё"),
  catalog: trKey("Каталог"),
};

const DEFAULTS = {
  templates: TEMPLATES,
  title: COPY.title,
  catalogSkins: [],
  activeModelId: "",
  onPickModel: null,
  standard: null,
  fitted: [],
  fittedTitle: COPY.fittedTitle,
};
