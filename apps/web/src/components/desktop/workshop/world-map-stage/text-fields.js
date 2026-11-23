// Свойства полей правки надписей в точках экрана: подпись зоны/точки и поле печати надписи.
import { sceneTextBox, emblemTextMetrics, EMBLEM_LINE_STEP, emblemTextStyle } from "@modovik/vector-map";

const isCaps = (text) => String(text) === String(text).toUpperCase();

// Подпись зоны/точки из сцены: положение, поворот, перенос и вид букв
class LabelMetrics {
  constructor({ label, opened }, frame, scale) {
    this.label = label;
    this.opened = opened;
    this.frame = frame;
    this.scale = scale;
  }

  scaled(value) {
    return value * this.scale;
  }

  get lines() {
    const own = this.label.lines;
    return own && own.length ? own : [this.label.value];
  }

  get folded() {
    return this.label.lines?.length > 1 && !this.opened.includes("\n");
  }

  get font() {
    const { label } = this;
    return {
      family: label.family,
      weight: label.weight,
      size: this.scaled(label.size),
      lineHeight: this.scaled(label.lineStep || label.size * 1.12),
      spacing: this.scaled(label.letterSpacing || 0),
      color: label.fill,
      stroke: label.stroke,
      strokeWidth: this.scaled(label.strokeWidth),
      upper: this.lines.every(isCaps) && !isCaps(this.opened),
    };
  }

  get props() {
    const { label, frame } = this;
    const wrap = this.scaled(sceneTextBox(label).width) + this.font.size * 0.6;
    return {
      left: this.scaled(label.x - frame.x),
      top: this.scaled(label.y - frame.y),
      rotation: label.rotation || 0,
      wrapWidth: this.folded ? wrap : null,
      font: this.font,
    };
  }
}

export const labelFieldProps = (edit, frame, scale) => new LabelMetrics(edit, frame, scale).props;

// Поле печати надписи: размеры из ширины надписи и замера текста
class TypeMetrics {
  constructor(textEdit, env, scale) {
    this.edit = textEdit;
    this.env = env;
    this.scale = scale;
    this.look = textEdit.emblem || textEdit.look;
    const { advance } = emblemTextMetrics(this.look, env.textAdvance);
    this.size = (env.projector.length(this.look.width) / advance) * scale;
    this.lineHeight = this.size * EMBLEM_LINE_STEP;
  }

  get rows() {
    return String(this.edit.draft ?? "").split("\n").length;
  }

  get ownWidth() {
    const { emblem } = this.edit;
    return emblem ? this.env.projector.length(emblem.width) * this.scale : 0;
  }

  get props() {
    const { edit, env, look, size, lineHeight, scale } = this;
    const { x, y } = env.projector.point(edit.emblem || edit.world);
    const { family, weight } = emblemTextStyle(look);
    return {
      left: (x - env.frame.x) * scale,
      top: (y - env.frame.y) * scale,
      width: this.ownWidth + size * 0.34,
      height: this.rows * lineHeight,
      rotation: look.rotation || 0,
      font: { family, weight, size, lineHeight, spacing: (size * (look.letterSpacing || 0)) / 100 },
    };
  }
}

export const typeFieldProps = (textEdit, env, scale) => new TypeMetrics(textEdit, env, scale).props;

// Примитивы слоя «emblems» сцены: из них поле табло берёт кегль и цвет букв
export function emblemItems({ layers }) {
  const found = (layers ?? []).find(({ id }) => id === "emblems");
  return found?.items ?? [];
}
