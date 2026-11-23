import * as glyphs from "./attachment-art.jsx";
import useTabListKeys from "../../../ui/useTabListKeys.js";
import { createElement as h } from "react";

// Схема места крепления: рисунок ствола и закладки поверх него.
export default function AttachmentScheme(props) {
  const points = props.points;
  const pending = props.pending ?? false;
  const { active, state, onPick } = props;
  const keys = useTabListKeys({ options: points.map(toOption), value: active, onChange: onPick });

  const scene = pickScene(props.outline || null, pending, props.family);
  const picture = scene ? scene.draw() : null;
  const seats = scene && !pending ? scene.seat(points) : [];
  const marks = pending ? [] : points.map((spot) => state(spot.bone));
  const make = spotMaker({ active, panelId: props.panelId, onPick }, seats, marks);

  const frame = {
    className: pending ? "gun-attach-scheme is-pending" : "gun-attach-scheme",
    role: "tablist",
    "aria-label": props.label,
    "aria-busy": pending ? String(pending) : undefined,
    ref: keys.listRef,
    onKeyDown: keys.onKeyDown,
  };
  return h("div", frame, picture, pending ? null : points.map(make));
}

function toOption(spot) {
  const value = spot.bone;
  return { value };
}

const share = (value, whole) => `${(value / whole) * 100}%`;

// Закладка места: выбранная получает tabindex 0, метка состояния — свой класс.
function spotMaker(host, seats, marks) {
  const { active, panelId, onPick } = host;
  return function spotNode(spot, index) {
    const bone = spot.bone;
    const picked = bone === active;
    const classes = ["gun-attach-spot", picked && "is-active", marks[index] && `is-${marks[index]}`];
    const [x, y] = seats[index];
    return h(
      "button",
      {
        key: bone ?? `#${index}`,
        type: "button",
        role: "tab",
        id: `gun-attach-spot-${bone}`,
        "aria-selected": picked,
        "aria-controls": panelId,
        "aria-label": spot.label,
        title: spot.label,
        tabIndex: picked ? 0 : -1,
        className: classes.filter(Boolean).join(" "),
        style: { left: share(x, FIELD_W), top: share(y, FIELD_H) },
        onClick: () => onPick(bone),
      },
      h(glyphs.SlotGlyph, { kind: spot.kind }),
    );
  };
}

// Контур настоящей модели, ожидание контура или заранее нарисованный силуэт.
const pickScene = (outline, pending, family) => {
  if (outline) return new ContourScene(outline);
  return pending ? null : new SilhouetteScene(family);
};

// Имена костей сравниваются без регистра и без подчёркиваний.
const boneKey = (name) => String(name ?? "").replace(/_/g, "").toLowerCase();

const roomPer = (whole, pad, size) => (whole - 2 * pad) / size;
const centred = (whole, size, scale) => (whole - size * scale) / 2;
const fitScale = ({ width, height }) => Math.min(roomPer(FIELD_W, PAD_X, width), roomPer(FIELD_H, PAD_Y, height));
const placement = ([sx, sy], scale) => `translate(${sx.toFixed(2)} ${sy.toFixed(2)}) scale(${scale.toFixed(5)})`;

class ContourScene {
  constructor(outline) {
    this.outline = outline;
    this.scale = fitScale(outline);
    this.shift = [centred(FIELD_W, outline.width, this.scale), centred(FIELD_H, outline.height, this.scale)];
  }

  draw() {
    const transform = placement(this.shift, this.scale);
    const path = h("path", { d: this.outline.path, transform, vectorEffect: "non-scaling-stroke" });
    return h("svg", { viewBox: VIEWBOX, className: "gun-attach-scheme-gun is-real", "aria-hidden": "true" }, path);
  }

  seat(points) {
    const bones = new Map();
    for (const [name, at] of Object.entries(this.outline.spots)) bones.set(boneKey(name), at);
    const middle = [this.outline.width / 2, this.outline.height / 2];
    const packer = new Packer();
    const out = [];
    for (const spot of points) {
      const at = bones.get(boneKey(spot.bone)) || middle;
      out.push(packer.settle(this.project(at)));
    }
    return out;
  }

  project([bx, by]) {
    return [this.shift[0] + bx * this.scale, this.shift[1] + by * this.scale];
  }
}

// Раздвигает места на контуре: первая проба, до которой от соседей не меньше GAP.
class Packer {
  constructor() {
    this.taken = [];
  }

  settle(base) {
    let pick = base;
    for (const [dx, dy] of NUDGES) {
      const probe = [pin(base[0] + dx, EDGE_X), pin(base[1] + dy, EDGE_Y)];
      if (this.roomFor(probe)) {
        pick = probe;
        break;
      }
    }
    this.taken.push(pick);
    return pick;
  }

  roomFor(probe) {
    for (const other of this.taken) {
      if (!(Math.hypot(probe[0] - other[0], probe[1] - other[1]) >= GAP)) return false;
    }
    return true;
  }
}

function pin(value, [low, high]) {
  if (value < low) return low;
  return value > high ? high : value;
}

const bodyPath = (d, index) => h("path", { key: index, d });

class SilhouetteScene {
  constructor(family) {
    this.art = SILHOUETTES[family] || SILHOUETTES.rifle;
  }

  draw() {
    const rail = h("path", { d: this.art.rail, className: "gun-attach-scheme-rail" });
    const body = this.art.parts.map(bodyPath);
    return h("svg", { viewBox: VIEWBOX, className: "gun-attach-scheme-gun", "aria-hidden": "true" }, body, rail);
  }

  seat(points) {
    const tally = new Map();
    const out = [];
    for (const spot of points) out.push(crowded(this.art.anchors[spot.kind] ?? this.art.anchors.other, tally));
    return out;
  }
}

// Одинаковые якоря: каждое следующее место уезжает влево.
function crowded([ax, ay], tally) {
  const mark = `${ax}/${ay}`;
  tally.set(mark, (tally.get(mark) ?? -1) + 1);
  return [ax - SPACING.repeat * tally.get(mark), ay];
}

// Строка таблицы силуэтов; номер строки совпадает с колонкой в таблице якорей.
function readShape(row, column) {
  const [family, ...paths] = row.trim().split("|");
  const rail = paths.pop();
  const anchors = Object.fromEntries(
    ANCHOR_ROWS.map(([kind, ...cells]) => [kind, cells[column].split(",").map(Number)]),
  );
  return [family, { parts: paths, rail, anchors }];
}

const [FIELD_W, FIELD_H] = [320, 110];
const [PAD_X, PAD_Y] = [16, 14];
const VIEWBOX = "0 0 320 110";
const SPACING = { gap: 26, repeat: 30 };
const GAP = SPACING.gap;
const [EDGE_X, EDGE_Y] = [[13, 307], [13, 97]];
// Пробы в шагах GAP: на месте, влево, вправо, вверх, вниз, на два шага по горизонтали.
const NUDGES = "0,0 -1,0 1,0 0,-1 0,1 -2,0 2,0".split(" ").map((pair) => pair.split(",").map((n) => n * GAP));

// Силуэты: класс|части тела...|рельса
const SHAPE_TABLE = `
pistol|M70 26h178a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H70z|M78 52h150v12H78z|M84 64h46l-6 34a5 5 0 0 1-5 4H88a4 4 0 0 1-4-4.5z|M130 64h30v6q-2 10-14 10h-16z|M100 24h120
smg|M30 44q0-4 4-4h56v18l-52 8a4 4 0 0 1-8-3z|M90 35h112a3 3 0 0 1 3 3v21a3 3 0 0 1-3 3H90z|M205 44h36v8h-36z|M106 62h16l-5 28a3 3 0 0 1-3 2.5h-11z|M138 62h13l3 36h-13z|M100 33h96
rifle|M12 44q0-4 4-4l50 2 4 2v20l-12 2-38 10a4 4 0 0 1-8-3z|M70 37h102v27H70z|M172 41h87a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-87z|M262 47h36v6h-36z|M98 64h17l-6 26a3 3 0 0 1-3 2.5h-11z|M128 64h22l6 16 4 16-20 3-5-17z|M86 32h10v5H86zM244 33h6v8h-6z|M100 35h140
shotgun|M12 46q0-4 4-4l60 2 4 2v20l-60 9a4 4 0 0 1-8-3z|M80 39h70a3 3 0 0 1 3 3v19a3 3 0 0 1-3 3H80z|M153 42h147v7H153z|M153 51h117v6H153z|M188 51h54a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-54z|M96 64h16l-6 24a3 3 0 0 1-3 2.5H92z|M90 37h56
sniper|M12 44q0-4 4-4l70 2 4 2v22l-70 10a4 4 0 0 1-8-3z|M90 40h80a3 3 0 0 1 3 3v16a3 3 0 0 1-3 3H90z|M173 46h138v6H173z|M108 62h16l-6 26a3 3 0 0 1-3 2.5h-11z|M134 62h18l3 18h-20z|M112 26h66v9h-66zM104 24h8v13h-8zM178 23h10v15h-10z|M100 38h80
`;

// Якоря по виду места: x,y для каждого силуэта по порядку таблицы выше.
const ANCHOR_TABLE = `
scope   168,14 146,18 142,18 118,20 146,12
supp    270,39 262,48 304,50 306,46 312,49
muzzle  270,39 262,48 304,50 306,46 312,49
barrel  270,39 236,48 270,50 276,46 280,49
flash   200,78 216,70 234,74 272,72 240,68
grip    200,78 190,76 200,80 214,80 224,80
clip    106,84 146,88 148,86 132,80 144,86
camo    164,39 118,48 110,50 112,52 126,51
cover   168,14 146,18 200,20 118,20 146,12
other   164,39 146,48 142,50 118,52 146,51
`;

const ANCHOR_ROWS = ANCHOR_TABLE.trim().split("\n").map((row) => row.trim().split(/\s+/));
const SILHOUETTES = Object.fromEntries(SHAPE_TABLE.trim().split("\n").map(readShape));
