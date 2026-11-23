/*
 * Замена моделей сервера в зале Majestic (ТЗ 11.10.2026, ночь, задача 2):
 * «в Majestic арене тоже сделай, чтобы человек мог сразу заменить всякие
 * модели по типу эйрдропа, машин летающих».
 *
 * Своя модель (картинка — плашкой, объёмом, кубом… или своя модель из
 * файла — как в «Моделях» мест) встаёт файлом `.ydr` под именем модели
 * сервера: игра сама ставит её во все места прежней, с её наклоном и
 * поворотом (сервер расставляет, Astral меняет только саму модель). Модель
 * вписывается в рамку прежней (`bounds` описи — в её осях): тот же центр,
 * длинная сторона — по рамке, свой поворот вокруг вертикали модели и
 * размер — долей. «Убрать» — прежняя модель без треугольников.
 *
 * Опись — `inventory/arena-replace.js` (`scripts/prepare-arena-replace.mjs`):
 * рамка модели и её расстановки в сцене «внутри» — кадр ставит туда же.
 * Чистые функции без DOM и Node.
 */

import REPLACE_INVENTORY from "./inventory/arena-replace.js";
import { panelAxes } from "./arena-panels.js";
import { normalizeRecolourHex } from "./colour.js";
import { emblemTextFilled, normalizeEmblemText } from "./emblems.js";
import { normalizePlaceModel } from "./place-models.js";

/*
 * Мониторы зала Majestic (задача 10 ТЗ 18.10.2026, вечер): корпус и экран правятся порознь — картинка
 * на экране плашкой («Экраны»), сам монитор — убрать или заменить своей моделью, как аирдроп.
 * Файл модели монитора едет в набор Astral, а материалы сцены у этих моделей свои (`model`): кадр
 * прячет одну модель, не задевая соседей по общему листу пластика. В список «Замены моделей»
 * они не входят (`listed: false`): их карточка — в «Предметах зала», у выбранного монитора.
 */
const MONITOR_MODELS = Object.freeze([
  ...["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"].map((letter) => `int3_rm1_longscreen_${letter}`),
  "int3_rm2_screen_touch",
  "int23_rm13_festival_monitor_modified",
  "int3_rm2_circle_screen",
  "int2_rm1_fake_screen_a",
  "int3_rm2_fake_screen_b",
  "int3_rm3_screen",
  "int3_rm3_screen_rnx",
  "int3_rm3_screen_tnt",
  "int3_rm3_gamingmonitor_solo",
  "int3_rm4_tv_a",
  "int3_rm4_tv_b",
  "int3_rm4_tv_c",
  "int3_rm4_tv_d",
]);
const MONITORS = Object.freeze(
  MONITOR_MODELS.map((short) =>
    Object.freeze({ id: `monitor.${short}`, model: `mj_ma_${short}`, label: "Монитор", hint: "Корпус монитора вместе с экраном", monitor: true, listed: false }),
  ),
);

/* Что можно заменить: модели зала сервера, что лежат в наборе Astral. */
export const ARENA_REPLACEABLE = Object.freeze({
  majestic: Object.freeze([
    Object.freeze({ id: "airdrop", model: "mj_ma_int3_rm3_airdrop_main_prop", label: "Аирдропы над залом", hint: "Ящики с маскировочной сеткой, что висят в воздухе" }),
    Object.freeze({ id: "racecar", model: "mj_ma_int3_rm4_opwhl2_prop", label: "Болид над гоночной зоной", hint: "Летающая машина над гоночной зоной" }),
    Object.freeze({ id: "racer", model: "mj_ma_int3_rm4_racer", label: "Фигура гонщика", hint: "Гонщик в комбинезоне у гоночной зоны" }),
    Object.freeze({ id: "house", model: "mj_ma_int3_rm3_mn_house", label: "Домик Cube World", hint: "Кубический домик у стены зала, на крыше — надпись CUBE WORLD" }),
    Object.freeze({
      id: "stand",
      model: "mj_ma_int3_rm3_brstand",
      label: "Домик Battle Royale",
      hint: "Белый домик-стенд вокруг стола с картой, надпись BATTLE ROYALE на трёх стенах",
    }),
    ...MONITORS,
  ]),
});

/* ------------------------------------------------------------------ *
 * Надпись на домике (ТЗ 12.10.2026)
 * ------------------------------------------------------------------ */

/*
 * «Сделай, чтобы можно было менять текст на домике». Надписи на домиках
 * зала Majestic двух видов:
 *
 *   `lines` — белый домик-стенд у стола с картой (`stand`): светящаяся
 *     надпись BATTLE ROYALE на трёх стенах буквами листа шрифта
 *     `fontatlas_headlinerno` (своя плашка на букву, их не переставить в
 *     другие слова). Своя надпись: буквы сводятся в точку (`texture`), на
 *     место каждой строки встаёт плашка с надписью; «Убрать» — без букв.
 *   `board` — домик Cube World (`house`): объёмные буквы CUBE WORLD на его
 *     крыше — отдельная модель сервера, которой нет в наборе Astral, и
 *     свести её буквы нельзя. Своя надпись — брусок-табличка ровно поверх
 *     прежних букв (они остаются внутри него) со словами с двух сторон и
 *     своим цветом фона; убрать прежние буквы без таблички нельзя.
 *
 * Надпись рисует окно (шрифт, цвет, обводка — как у надписей эмблем); одна и
 * та же картинка и сетка у кадра и у установщика (`arenaSignFaces`,
 * `arenaSignMesh`). В игре сетка вшивается в модель самого домика
 * (`graft-drawable`), и домик со своей надписью встаёт во все свои места.
 *
 * Места — в осях модели домика (Z вверх), м. Сняты 12.10.2026: строки
 * стенда — рамки вершин его букв по стенам (задняя стена снаружи и две
 * стены у стола с картой), брусок домика — рамка букв CUBE WORLD из сцены
 * зала, переведённая в оси домика его расстановкой (буквы стоят вдоль Y,
 * лицом в ±X).
 */
const signLine = (point, normal, width, height) => Object.freeze({ point: Object.freeze(point), normal: Object.freeze(normal), width, height });

export const ARENA_REPLACE_SIGNS = Object.freeze({
  majestic: Object.freeze({
    stand: Object.freeze({
      kind: "lines",
      texture: "fontatlas_headlinerno",
      value: "BATTLE ROYALE",
      lines: Object.freeze([
        signLine([-2.683, 4.591, 1.709], [0, 1, 0], 1.916, 0.355),
        signLine([0.131, 0.044, 1.123], [1, 0, 0], 1.916, 0.354),
        signLine([-5.064, -0.093, 1.123], [-1, 0, 0], 1.916, 0.354),
      ]),
    }),
    house: Object.freeze({
      kind: "board",
      value: "CUBE WORLD",
      board: Object.freeze({ ...signLine([-1.7315, -0.16, 1.6825], [1, 0, 0], 4.456, 0.529), depth: 0.121 }),
      background: "#6b4a2b",
    }),
  }),
});

export const ARENA_SIGN_MODES = Object.freeze(["standard", "text", "hidden"]);
export const ARENA_SIGN_MODE_LABELS = Object.freeze({ standard: "Как на сервере", text: "Свой текст", hidden: "Убрать" });
/* Режимы надписи модели: брусок поверх чужих букв не убирает их. */
export const arenaSignModes = (spec) => (spec?.kind === "board" ? ARENA_SIGN_MODES.filter((mode) => mode !== "hidden") : ARENA_SIGN_MODES);
/* Размер строки — доля прежней (с запасом по краям), свечение — как у своих моделей. */
export const ARENA_SIGN_LIMITS = Object.freeze({ size: [0.6, 1.8], glow: [0, 100] });
/* Плашка чуть шире и выше строки букв: слова длиннее BATTLE ROYALE не мельчат. */
const SIGN_MARGIN = Object.freeze([1.12, 1.4]);
/* Плашка — в сантиметре перед стеной. */
const SIGN_OFFSET = 0.012;
/* Брусок — с запасом вокруг прежних букв, м: по длине, высоте и толщине. */
const BOARD_MARGIN = Object.freeze([0.3, 0.18, 0.08]);

/** Надпись модели сервера, если она у неё есть: `{ kind, value, lines | board, texture?, background? }` или `null`. */
export const arenaReplaceSign = (server, id) => ARENA_REPLACE_SIGNS[server]?.[id] || null;

/* Надпись по умолчанию — светлые буквы без обводки, как светится штатная. */
const SIGN_TEXT = Object.freeze({ font: "block", colour: "#e8ece8", outline: "none" });

function normalizeSign(spec, input) {
  const source = plain(input);
  const modes = arenaSignModes(spec);
  return {
    mode: modes.includes(source.mode) ? source.mode : "standard",
    text: normalizeEmblemText(source.text ?? { ...SIGN_TEXT, value: spec.value }),
    size: clamp(source.size, ARENA_SIGN_LIMITS.size, 1),
    /* Строки стенда светились у сервера — и своя светится; брусок — нет. */
    glow: clamp(source.glow, ARENA_SIGN_LIMITS.glow, spec.kind === "board" ? 0 : 60, 0),
    ...(spec.kind === "board" ? { background: normalizeRecolourHex(source.background, spec.background) } : {}),
  };
}

/** Надпись меняет файлы: модель на месте («Как на сервере»), своя надпись со словами или «Убрать». */
const signActive = (entry) =>
  Boolean(entry?.sign) && entry.mode === "standard" && (entry.sign.mode === "hidden" || (entry.sign.mode === "text" && emblemTextFilled(entry.sign.text)));

/** Меняет ли файлы одна запись замены: своя модель, «Убрать» или своя надпись. */
export const arenaReplaceEntryChanged = (entry) => entry?.mode === "hidden" || (entry?.mode === "model" && Boolean(entry.model)) || signActive(entry);

/** Надписи, что работа меняет: `[{ id, sign, spec, replacement }]`. */
export function activeArenaSigns(server, replacements) {
  return Object.entries(replacements || {})
    .filter(([, entry]) => signActive(entry))
    .map(([id, entry]) => ({ id, sign: entry.sign, spec: arenaReplaceSign(server, id), replacement: arenaReplaceable(server, id) }))
    .filter((item) => item.spec && item.replacement);
}

const round3 = (value) => Math.round(value * 1000) / 1000 + 0;
const along = (point, direction, distance) => point.map((value, axis) => Math.round((value + direction[axis] * distance) * 10000) / 10000 + 0);

/**
 * Грани своей надписи в осях модели: `[{ point, normal, up, right, width,
 * height, edge? }]` (`panelAxes`: правая рука смотрящего — `right`). У
 * строк — по плашке на строку, лицом от стены, размер — строка × запас ×
 * `sign.size`. У бруска — лицо и спина со словами (каждая читается со своей
 * стороны) и четыре кромки (`edge`: цвет фона, без слов).
 */
export function arenaSignFaces(spec, sign) {
  const size = sign?.size ?? 1;
  if (spec.kind === "board") {
    const { board } = spec;
    const width = (board.width + BOARD_MARGIN[0]) * size;
    const height = (board.height + BOARD_MARGIN[1]) * size;
    const depth = board.depth + BOARD_MARGIN[2];
    const front = panelAxes(board.normal);
    const back = panelAxes(board.normal.map((value) => -value));
    const face = (axes, distance, w, h, edge = false) => ({ point: along(board.point, axes.normal, distance), ...axes, width: round3(w), height: round3(h), ...(edge ? { edge } : {}) });
    const side = (normal, up) => ({ normal, up, right: [up[1] * normal[2] - up[2] * normal[1], up[2] * normal[0] - up[0] * normal[2], up[0] * normal[1] - up[1] * normal[0]] });
    return [
      face(front, depth / 2, width, height),
      face(back, depth / 2, width, height),
      /* Верх и низ — вверх смотрит «назад» бруска; торцы — вертикально. */
      face(side(front.up, back.normal), height / 2, width, depth, true),
      face(side(front.up.map((value) => -value), front.normal), height / 2, width, depth, true),
      face(side(front.right, front.up), width / 2, depth, height, true),
      face(side(front.right.map((value) => -value), front.up), width / 2, depth, height, true),
    ];
  }
  return spec.lines.map((line) => {
    const axes = panelAxes(line.normal);
    return { point: along(line.point, axes.normal, SIGN_OFFSET), ...axes, width: round3(line.width * SIGN_MARGIN[0] * size), height: round3(line.height * SIGN_MARGIN[1] * size) };
  });
}

/* Кромка бруска берёт угол листа — там фон (цвет бруска), без слов. */
const EDGE_UV = 0.004;

/**
 * Сетка надписи в осях модели — одна у кадра и у установщика: по
 * четырёхугольнику на грань (обход против часовой, если смотреть на лицо),
 * развёртка граней со словами — лист целиком (v вниз, как у листов игры),
 * кромок — угол листа. `{ positions, normals, uvs, indices, bounds }`.
 */
export function arenaSignMesh(faces) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (const face of faces) {
    const base = positions.length / 3;
    const corners = [
      [-1, -1, 0, 1],
      [1, -1, 1, 1],
      [1, 1, 1, 0],
      [-1, 1, 0, 0],
    ];
    for (const [x, y, u, v] of corners) {
      for (let axis = 0; axis < 3; axis += 1) positions.push(face.point[axis] + (face.right[axis] * x * face.width) / 2 + (face.up[axis] * y * face.height) / 2);
      normals.push(...face.normal);
      uvs.push(face.edge ? EDGE_UV : u, face.edge ? EDGE_UV : v);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let at = 0; at < positions.length; at += 3)
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[at + axis]);
      max[axis] = Math.max(max[axis], positions[at + axis]);
    }
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), uvs: Float32Array.from(uvs), indices: Uint32Array.from(indices), bounds: { min, max } };
}

export const ARENA_REPLACE_MODES = Object.freeze(["standard", "model", "hidden"]);
export const ARENA_REPLACE_MODE_LABELS = Object.freeze({ standard: "Как на сервере", model: "Своя модель", hidden: "Убрать" });
/* Размер своей модели — доля рамки прежней, поворот — вокруг её вертикали. */
export const ARENA_REPLACE_LIMITS = Object.freeze({ scale: [0.2, 3], turn: [-180, 180] });

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const clamp = (value, [low, high], fallback, digits = 2) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.min(high, Math.max(low, number)) * 10 ** digits) / 10 ** digits;
};

/** Модель сервера по ключу: `{ id, model, label, hint, bounds, placements }` или `null`. */
export function arenaReplaceable(server, id) {
  const item = (ARENA_REPLACEABLE[server] || []).find((entry) => entry.id === id);
  const found = REPLACE_INVENTORY?.[server]?.[id];
  return item && found ? { ...item, bounds: found.bounds, placements: found.placements } : null;
}

/** Все заменяемые модели сервера (что есть в описи). */
export const arenaReplaceables = (server) => (ARENA_REPLACEABLE[server] || []).map((item) => arenaReplaceable(server, item.id)).filter(Boolean);

/*
 * Своя модель — та же запись, что у «Моделей» мест (картинка и её форма или
 * сетка из файла), без места: место — у прежней модели.
 */
export function normalizeArenaReplacementModel(input) {
  const item = normalizePlaceModel({ ...plain(input), position: [0, 0, 0], rotation: [0, 0, 0], scene: "", motion: "none" });
  if (!item) return null;
  const { id: _id, scene: _scene, position: _position, rotation: _rotation, motion: _motion, speed: _speed, lift: _lift, distance: _distance, hidden: _hidden, ...rest } = item;
  return rest;
}

/**
 * Замены сервера: `{ <id>: { mode, model?, sign?, scale, turn } }` — только
 * известные модели; `sign` — у моделей с надписью (`ARENA_REPLACE_SIGNS`).
 */
export function normalizeArenaReplacements(server, input) {
  const source = plain(input);
  const out = {};
  for (const item of ARENA_REPLACEABLE[server] || []) {
    const raw = plain(source[item.id]);
    if (!Object.keys(raw).length) continue;
    const model = raw.model ? normalizeArenaReplacementModel(raw.model) : null;
    const spec = arenaReplaceSign(server, item.id);
    const sign = spec && raw.sign ? normalizeSign(spec, raw.sign) : null;
    let mode = ARENA_REPLACE_MODES.includes(raw.mode) ? raw.mode : "standard";
    if (mode === "model" && !model) mode = "standard";
    if (mode === "standard" && !model && !sign) continue;
    out[item.id] = {
      mode,
      ...(model ? { model } : {}),
      ...(sign ? { sign } : {}),
      scale: clamp(raw.scale, ARENA_REPLACE_LIMITS.scale, 1),
      turn: clamp(raw.turn, ARENA_REPLACE_LIMITS.turn, 0, 1),
    };
  }
  return out;
}

/** Замены, что меняют файлы: «Убрать» и своя модель. `[{ id, model, mode, entry, replacement }]`. */
export function activeArenaReplacements(server, replacements) {
  return Object.entries(replacements || {})
    .filter(([, entry]) => entry.mode === "hidden" || (entry.mode === "model" && entry.model))
    .map(([id, entry]) => ({ id, entry, replacement: arenaReplaceable(server, id) }))
    .filter((item) => item.replacement);
}

/** Отпечаток замен для «Применить» (имя файла модели не меняет облика); надпись домика — своим полем. */
export const arenaReplacementsSignature = (server, replacements) => [
  ...activeArenaReplacements(server, replacements).map(({ id, entry }) => [id, entry.mode, entry.mode === "model" ? { ...entry.model, name: undefined, label: undefined } : null, entry.scale, entry.turn]),
  ...activeArenaSigns(server, replacements).map(({ id, sign }) => [id, "sign", sign.mode, sign.mode === "text" ? [sign.text, sign.size, sign.glow] : null]),
];

/** Меняет ли работа модели сервера: своя модель, «Убрать» или своя надпись. */
export const arenaReplacementsChanged = (server, replacements) => activeArenaReplacements(server, replacements).length > 0 || activeArenaSigns(server, replacements).length > 0;

/**
 * Вписать сетку своей модели (единичную: длинная сторона — 1 м, середина в
 * нуле, `placeModelUnitMesh`) в рамку прежней: поворот вокруг вертикали,
 * размер — по самой тесной оси рамки × `scale`, середина — в середину
 * рамки, сдвинутую на `offset` (метры в осях модели; замена вещи, которую
 * передвинули мышью). Ответ — сетка в осях модели сервера. Одна функция у
 * кадра и у установщика.
 */
export function fitReplacementMesh(unit, bounds, { scale = 1, turn = 0, offset = null } = {}) {
  const angle = (turn * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const count = unit.positions.length / 3;
  const turned = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < count; index += 1) {
    const x = unit.positions[index * 3];
    const y = unit.positions[index * 3 + 1];
    const p = [x * cos - y * sin, x * sin + y * cos, unit.positions[index * 3 + 2]];
    const nx = unit.normals[index * 3];
    const ny = unit.normals[index * 3 + 1];
    normals.set([nx * cos - ny * sin, nx * sin + ny * cos, unit.normals[index * 3 + 2]], index * 3);
    turned.set(p, index * 3);
    for (let axis = 0; axis < 3; axis += 1) {
      lo[axis] = Math.min(lo[axis], p[axis]);
      hi[axis] = Math.max(hi[axis], p[axis]);
    }
  }
  const size = [0, 1, 2].map((axis) => Math.max(1e-6, hi[axis] - lo[axis]));
  const room = [0, 1, 2].map((axis) => Math.max(1e-3, bounds.max[axis] - bounds.min[axis]));
  /* Самая тесная ось: модель не вылезает из места прежней ни в одном измерении. */
  const factor = Math.min(...[0, 1, 2].map((axis) => room[axis] / size[axis])) * scale;
  const centre = [0, 1, 2].map((axis) => (bounds.min[axis] + bounds.max[axis]) / 2 + (Number(offset?.[axis]) || 0));
  const middle = [0, 1, 2].map((axis) => (lo[axis] + hi[axis]) / 2);
  const positions = new Float32Array(count * 3);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < count; index += 1)
    for (let axis = 0; axis < 3; axis += 1) {
      const value = centre[axis] + (turned[index * 3 + axis] - middle[axis]) * factor;
      positions[index * 3 + axis] = value;
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  return { positions, normals, uvs: unit.uvs, indices: unit.indices, bounds: { min, max } };
}

/** Точка в осях модели → сцена по расстановке (`rotation` — кватернион оси → сцена). */
export function replacementToScene(placement) {
  const [x, y, z, w] = placement.rotation;
  const t = placement.position;
  return (p) => {
    const tx = 2 * (y * p[2] - z * p[1]);
    const ty = 2 * (z * p[0] - x * p[2]);
    const tz = 2 * (x * p[1] - y * p[0]);
    return [t[0] + p[0] + w * tx + (y * tz - z * ty), t[1] + p[1] + w * ty + (z * tx - x * tz), t[2] + p[2] + w * tz + (x * ty - y * tx)];
  };
}
