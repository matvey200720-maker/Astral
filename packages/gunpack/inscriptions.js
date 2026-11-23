/*
 * Надписи оружия (ТЗ 12.10.2026, ночь): заводские надписи на штатных стволах —
 * прочь.
 *
 * Владелец: на револьвере «Hawk & Little», калибр, номер и ещё куча цифр, и
 * когда человек красит ствол, этого на нём быть не должно — ни на каком.
 *
 * Где они живут (разбор моделей и словарей игры, 102 ствола Astral): у 58
 * огнестрельных стволов (и у канистр, мачете, фонаря) надписи — не в
 * картинке корпуса, а отдельной геометрией-наклейкой поверх него. Это меши на шейдерах наклеек игры (`normal_spec_decal`,
 * `normal_decal`, `decal_normal_only`, `spec_decal`, `normal_spec_decal_tnt`,
 * корзина отрисовки 2) с листом-атласом: `W_PI_RevolverDecals_02_D…_A` у
 * револьвера — «Hawk&Little», «CAL. MM», «2810749.503», вырез — в альфе, рельеф
 * — в своей карте нормалей. Краска корпуса под наклейку не попадает, поэтому
 * надпись остаётся поверх любой покраски.
 *
 * Но на тех же листах — винты, заклёпки и точки мушки (у пистолета зелёная и
 * красная): их убирать нельзя, иначе ствол перестанет быть штатным. Поэтому
 * правило не «все наклейки прочь», а:
 *
 *  1. лист наклеек делится на пятна чернил (альфа ≥ 128);
 *  2. пятно остаётся, если оно круглое и сплошное — винт, заклёпка, точка
 *     (вписанный круг закрыт ≥ 88 %, за кругом ≤ 12 %, без дыр; ряд
 *     соприкасающихся винтов — по клеткам с «талией» между ними); буквы,
 *     цифры, логотипы, штрихкоды и плашки с номером круглыми не бывают. Точка
 *     в строке надписи («U.S.A.», «CAL.50») — круглая, но стоит вплотную к
 *     букве на её строке и мельче её — она тоже надпись;
 *  3. каждый кусок наклейки на модели (связные треугольники — у текста это
 *     обычно буква или слово) смотрит, что под ним на листе: больше надписи,
 *     чем винтов, — кусок убирается целиком.
 *
 * Одно правило на студию и на игру: в студии треугольники надписей не
 * попадают в модель (`gameWeaponModel`), в пакете скина они сводятся в точку
 * в моделях игрока (`apps/desktop/src/weapon-inscriptions.js`). Кисть,
 * заливка и наклейки студии ложатся на корпус под бывшей надписью — краску
 * больше не режет по форме букв.
 *
 * Меши на обычных шейдерах, что берут цвет с того же листа (винты-геометрия
 * у ПП и пулемётов, штифт у PDW), не трогаются: это детали, а не надписи.
 *
 * У девяти стволов надпись ещё и нарисована прямо в картинке корпуса — это
 * `PAINTED_INSCRIPTIONS` и `clearPaintedInscriptions` ниже.
 */

const INK = 128;
/* Мельче — не пятно, а пыль края. */
const MIN_AREA = 5;

/** Шейдер наклейки игры (`normal_spec_decal`, `decal_normal_only`…). */
export const isDecalShader = (material) =>
  /decal/i.test(String(material?.shader || "")) ||
  /decal/i.test(String(material?.shaderFile || ""));

/* Пятна чернил листа: площадь, рамка, дыры и насколько пятно — круг. */
function inkComponents(alpha, width, height) {
  const label = new Int32Array(width * height).fill(-1);
  const spots = [];
  const stack = [];
  for (let start = 0; start < label.length; start += 1) {
    if (alpha[start] < INK || label[start] >= 0) continue;
    const id = spots.length;
    const spot = { area: 0, x0: width, y0: height, x1: -1, y1: -1 };
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const at = stack.pop();
      const x = at % width;
      const y = (at - x) / width;
      spot.area += 1;
      if (x < spot.x0) spot.x0 = x;
      if (x > spot.x1) spot.x1 = x;
      if (y < spot.y0) spot.y0 = y;
      if (y > spot.y1) spot.y1 = y;
      for (let dy = -1; dy <= 1; dy += 1)
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= width || ny >= height)
            continue;
          const next = ny * width + nx;
          if (alpha[next] < INK || label[next] >= 0) continue;
          label[next] = id;
          stack.push(next);
        }
    }
    measureSpot(spot, id, label, width, height);
    spots.push(spot);
  }
  return { label, spots };
}

function measureSpot(spot, id, label, width, height) {
  const own = (x, y) =>
    x >= 0 && y >= 0 && x < width && y < height && label[y * width + x] === id;
  /* Дыры: фон внутри рамки, до которого не дойти от её края. */
  const boxWidth = spot.x1 - spot.x0 + 3;
  const boxHeight = spot.y1 - spot.y0 + 3;
  const seen = new Uint8Array(boxWidth * boxHeight);
  const queue = [0];
  seen[0] = 1;
  let outside = 0;
  while (queue.length) {
    const at = queue.pop();
    outside += 1;
    const bx = at % boxWidth;
    const by = (at - bx) / boxWidth;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = bx + dx;
      const ny = by + dy;
      if (nx < 0 || ny < 0 || nx >= boxWidth || ny >= boxHeight) continue;
      const next = ny * boxWidth + nx;
      if (seen[next] || own(nx + spot.x0 - 1, ny + spot.y0 - 1)) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  spot.holes = boxWidth * boxHeight - outside - spot.area;

  /* Пятно, срезанное краем листа, достраивается до круга за краем. */
  const realWidth = spot.x1 - spot.x0 + 1;
  const realHeight = spot.y1 - spot.y0 + 1;
  let x0 = spot.x0;
  let x1 = spot.x1;
  let y0 = spot.y0;
  let y1 = spot.y1;
  if (realHeight > realWidth && spot.x0 === 0) x0 = spot.x1 + 1 - realHeight;
  else if (realHeight > realWidth && spot.x1 === width - 1)
    x1 = spot.x0 + realHeight - 1;
  if (realWidth > realHeight && spot.y0 === 0) y0 = spot.y1 + 1 - realWidth;
  else if (realWidth > realHeight && spot.y1 === height - 1)
    y1 = spot.y0 + realWidth - 1;
  spot.circleWidth = x1 - x0 + 1;
  spot.circleHeight = y1 - y0 + 1;
  const cx = (x0 + x1 + 1) / 2;
  const cy = (y0 + y1 + 1) / 2;
  let inside = 0;
  let inked = 0;
  for (let y = spot.y0; y <= spot.y1; y += 1)
    for (let x = spot.x0; x <= spot.x1; x += 1) {
      const ex = (x + 0.5 - cx) / (spot.circleWidth / 2);
      const ey = (y + 0.5 - cy) / (spot.circleHeight / 2);
      if (ex * ex + ey * ey > 1) continue;
      inside += 1;
      if (label[y * width + x] === id) inked += 1;
    }
  spot.coverage = inside ? inked / inside : 0;
  spot.spill = spot.area ? (spot.area - inked) / spot.area : 1;
  spot.discs = spot.holes ? 0 : touchingDiscs(spot, own);
}

/*
 * Ряд соприкасающихся винтов (у дробовика MK2 и тяжёлой снайперской два
 * винта касаются) — одно пятно 2:1. Оно делится на клетки по длинной
 * стороне: в каждой — круг, а между клетками — узкая «талия». У плашки-
 * капсулы того же размера талии нет: её граница клеток во всю высоту.
 */
function touchingDiscs(spot, own) {
  const realWidth = spot.x1 - spot.x0 + 1;
  const realHeight = spot.y1 - spot.y0 + 1;
  const wide = realWidth >= realHeight;
  const long = wide ? realWidth : realHeight;
  const short = wide ? realHeight : realWidth;
  const count = Math.round(long / short);
  if (count < 2 || count > 4 || Math.abs(long / short - count) > 0.15 * count)
    return 0;
  const ink = (along, across) =>
    wide
      ? own(spot.x0 + along, spot.y0 + across)
      : own(spot.x0 + across, spot.y0 + along);
  const step = long / count;
  for (let cell = 0; cell < count; cell += 1) {
    const from = Math.round(cell * step);
    const to = Math.round((cell + 1) * step) - 1;
    const radiusAlong = (to - from + 1) / 2;
    const radiusAcross = short / 2;
    const middle = (from + to + 1) / 2;
    let inside = 0;
    let inked = 0;
    let total = 0;
    for (let along = from; along <= to; along += 1)
      for (let across = 0; across < short; across += 1) {
        const ea = (along + 0.5 - middle) / radiusAlong;
        const eb = (across + 0.5 - radiusAcross) / radiusAcross;
        const has = ink(along, across);
        if (has) total += 1;
        if (ea * ea + eb * eb > 1) continue;
        inside += 1;
        if (has) inked += 1;
      }
    if (
      !inside ||
      inked / inside < 0.85 ||
      (total - inked) / Math.max(1, total) > 0.12
    )
      return 0;
    if (cell > 0) {
      let neck = 0;
      for (let across = 0; across < short; across += 1)
        if (ink(from, across)) neck += 1;
      if (neck > 0.5 * short) return 0;
    }
  }
  return count;
}

/** Круглое сплошное пятно: винт, заклёпка, точка мушки. */
export function isRoundSpot(spot) {
  if (spot.area < MIN_AREA) return false;
  if (spot.discs > 1) return true;
  const aspect = spot.circleWidth / spot.circleHeight;
  if (aspect < 0.8 || aspect > 1.25 || spot.holes > spot.area * 0.02)
    return false;
  return spot.coverage >= 0.88 && spot.spill <= 0.12;
}

/**
 * Разбор листа наклеек: какие пятна — надписи. `image` — `{ width, height,
 * rgba }` (картинка цвета наклейки; вырез — в альфе). Возвращает `{ width,
 * height, label, text }`: `label` — номер пятна у каждого пикселя (−1 —
 * пусто), `text[номер]` — 1 у надписи, 0 у винта.
 */
export function readInscriptionSheet(image) {
  const width = Number(image?.width) || 0;
  const height = Number(image?.height) || 0;
  const rgba = image?.rgba;
  if (!width || !height || !rgba || rgba.length < width * height * 4)
    return null;
  const alpha = new Uint8Array(width * height);
  for (let at = 0; at < alpha.length; at += 1) alpha[at] = rgba[at * 4 + 3];
  const { label, spots } = inkComponents(alpha, width, height);
  const gap = Math.max(2, Math.round(Math.min(width, height) * 0.012));
  const round = spots.map(isRoundSpot);
  /* Точка в строке надписи: на строке соседней буквы (по низу или по
     середине), вплотную к ней и заметно мельче. Винт рядом с крупным
     логотипом стоит вне его строки или крупнее точки — он остаётся. */
  const dotOfLine = (spot, letter, size) => {
    const dx = Math.max(
      0,
      Math.max(spot.x0, letter.x0) - Math.min(spot.x1, letter.x1) - 1,
    );
    const dy = Math.max(
      0,
      Math.max(spot.y0, letter.y0) - Math.min(spot.y1, letter.y1) - 1,
    );
    const letterHeight = letter.y1 - letter.y0 + 1;
    const onLine =
      Math.abs(spot.y1 - letter.y1) <= gap ||
      Math.abs(spot.y0 + spot.y1 - letter.y0 - letter.y1) <= 2 * gap;
    return (
      dy === 0 &&
      dx <= gap &&
      onLine &&
      spot.y0 >= letter.y0 - gap &&
      spot.y1 <= letter.y1 + gap &&
      size < 0.6 * letterHeight &&
      letterHeight <= 8 * size
    );
  };
  const text = new Uint8Array(spots.length);
  /* Пыль края (мельче пяти пикселей) не голосует ни за надпись, ни за винт. */
  const dust = Uint8Array.from(spots, (spot) => (spot.area < MIN_AREA ? 1 : 0));
  spots.forEach((spot, index) => {
    if (!round[index]) {
      text[index] = 1;
      return;
    }
    const size = Math.max(spot.x1 - spot.x0, spot.y1 - spot.y0) + 1;
    for (let other = 0; other < spots.length; other += 1)
      if (
        !round[other] &&
        spots[other].area >= MIN_AREA &&
        dotOfLine(spot, spots[other], size)
      ) {
        text[index] = 1;
        return;
      }
  });
  return {
    width,
    height,
    label,
    text,
    dust,
    stamp: new Int32Array(width * height).fill(-1),
    mark: 0,
  };
}

/* Куски наклейки: треугольники, связанные общими вершинами. */
function piecesOf(indices) {
  let count = 0;
  for (let at = 0; at < indices.length; at += 1)
    if (indices[at] + 1 > count) count = indices[at] + 1;
  const parent = new Int32Array(count);
  for (let at = 0; at < count; at += 1) parent[at] = at;
  const find = (value) => {
    let root = value;
    while (parent[root] !== root) root = parent[root];
    while (parent[value] !== root) {
      const next = parent[value];
      parent[value] = root;
      value = next;
    }
    return root;
  };
  const join = (a, b) => {
    const left = find(a);
    const right = find(b);
    if (left !== right) parent[left] = right;
  };
  for (let at = 0; at + 2 < indices.length; at += 3) {
    join(indices[at], indices[at + 1]);
    join(indices[at], indices[at + 2]);
  }
  const pieces = new Map();
  for (let at = 0; at + 2 < indices.length; at += 3) {
    const a = indices[at];
    if (a === indices[at + 1] && a === indices[at + 2]) continue;
    const root = find(a);
    if (!pieces.has(root)) pieces.set(root, []);
    pieces.get(root).push(at / 3);
  }
  return [...pieces.values()];
}

/**
 * Треугольники меша наклейки, что ложатся на надписи листа: номера по
 * порядку (треугольник `n` — индексы `3n…3n+2`).
 */
export function inscriptionTriangles(mesh, sheet) {
  const indices = mesh?.indices;
  const uvs = mesh?.uvs;
  if (!sheet || !indices || !uvs) return [];
  const { width, height, label, text, dust, stamp } = sheet;
  const removed = [];
  for (const piece of piecesOf(indices)) {
    sheet.mark += 1;
    const mark = sheet.mark;
    let letters = 0;
    let screws = 0;
    const count = (at) => {
      const spot = label[at];
      if (spot < 0 || dust[spot]) return;
      if (text[spot]) letters += 1;
      else screws += 1;
    };
    /* Середины треугольников — на случай кусков мельче пикселя листа: такой
       кусок не накрывает ни одного центра пикселя, а на стволе показывает
       один тексель во всю свою площадь. */
    const centres = [];
    for (const triangle of piece) {
      const ids = [
        indices[triangle * 3],
        indices[triangle * 3 + 1],
        indices[triangle * 3 + 2],
      ];
      const us = ids.map((id) => uvs[id * 2]);
      const vs = ids.map((id) => uvs[id * 2 + 1]);
      /* Развёртка за краем листа — повтор листа: треугольник сдвигается
         целиком (по своей середине), как его видит игра. */
      const shiftU = Math.floor((us[0] + us[1] + us[2]) / 3);
      const shiftV = Math.floor((vs[0] + vs[1] + vs[2]) / 3);
      const points = ids.map((_, at) => [
        (us[at] - shiftU) * width,
        (vs[at] - shiftV) * height,
      ]);
      const [a, b, c] = points;
      const cx = Math.floor((a[0] + b[0] + c[0]) / 3);
      const cy = Math.floor((a[1] + b[1] + c[1]) / 3);
      if (cx >= 0 && cy >= 0 && cx < width && cy < height)
        centres.push(cy * width + cx);
      const area =
        (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
      if (!Number.isFinite(area) || Math.abs(area) < 1e-9) continue;
      const left = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
      const right = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const top = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
      const bottom = Math.min(
        height - 1,
        Math.ceil(Math.max(a[1], b[1], c[1])),
      );
      for (let y = top; y <= bottom; y += 1)
        for (let x = left; x <= right; x += 1) {
          const px = x + 0.5;
          const py = y + 0.5;
          const w0 =
            ((b[0] - px) * (c[1] - py) - (c[0] - px) * (b[1] - py)) / area;
          const w1 =
            ((c[0] - px) * (a[1] - py) - (a[0] - px) * (c[1] - py)) / area;
          if (w0 < -0.02 || w1 < -0.02 || 1 - w0 - w1 < -0.02) continue;
          const at = y * width + x;
          if (stamp[at] === mark) continue;
          stamp[at] = mark;
          count(at);
        }
    }
    if (!letters && !screws) for (const at of centres) count(at);
    if (letters > screws) removed.push(...piece);
  }
  return removed.sort((left, right) => left - right);
}

/**
 * Надписи модели: `meshes` — меши `readDrawable` (или переставленные на
 * кость), `texture(name)` — картинка `{ width, height, rgba }` по имени
 * текстуры (лучшая, что есть: из «+hi»). Возвращает `{ meshes: Map<меш,
 * номера треугольников>, triangles }`. Лист разбирается один раз на все
 * меши, что его берут.
 */
export function findInscriptions(meshes, texture) {
  const sheets = new Map();
  const found = new Map();
  let triangles = 0;
  for (const mesh of meshes || []) {
    if (!isDecalShader(mesh?.material)) continue;
    const name = String(mesh.material?.textures?.diffuse || "");
    if (!name) continue;
    const key = name.toLowerCase();
    if (!sheets.has(key)) {
      let sheet = null;
      try {
        sheet = readInscriptionSheet(texture(name));
      } catch {
        sheet = null;
      }
      sheets.set(key, sheet);
    }
    const removed = inscriptionTriangles(mesh, sheets.get(key));
    if (!removed.length) continue;
    found.set(mesh, removed);
    triangles += removed.length;
  }
  return { meshes: found, triangles };
}

/** Меш без этих треугольников; `null`, если от него ничего не осталось. */
export function withoutTriangles(mesh, removed) {
  const drop = new Set(removed);
  const kept = [];
  for (
    let triangle = 0;
    triangle * 3 + 2 < mesh.indices.length;
    triangle += 1
  ) {
    if (drop.has(triangle)) continue;
    kept.push(
      mesh.indices[triangle * 3],
      mesh.indices[triangle * 3 + 1],
      mesh.indices[triangle * 3 + 2],
    );
  }
  if (!kept.length) return null;
  const Indices = mesh.indices.constructor || Uint16Array;
  return { ...mesh, indices: new Indices(kept) };
}

/*
 * Надписи, нарисованные прямо в картинке корпуса (без наклейки).
 *
 * У части стволов клеймо — не наклейка, а пиксели самой текстуры: «VOM
 * FEUER» на рукояти керамического пистолета и на тяжёлой снайперской MK2,
 * «9 MM x 19 MADE IN LC» на затворе XM3, «HAWK & LITTLE» на донце гильз
 * револьвера. Узнать текст в картинке, не тронув насечки, винты и
 * вентиляцию, общим правилом нельзя: у прорези и у буквы одни и те же
 * пиксели. Поэтому места таких надписей записаны по разбору всех 151
 * текстуры цвета стволов Astral в игре (12.10.2026) — рамкой в долях ширины
 * и высоты текстуры (так рамка годится и обычному словарю, и «+hi»), а
 * внутри рамки буквы находит и стирает `clearPaintedInscriptions`. Ключ —
 * имя текстуры строчными; карта нормалей — со своими рамками, если буквы
 * выдавлены и в ней.
 *
 * Надпись может жить и не в цвете, а в альфе — номере столбца палитры
 * оттенков (затвор керамического пистолета, «COIL» тазера): такие рамки
 * помечены пятым `"alpha"`.
 *
 * Не записаны намеренно: кровавые надписи флотского револьвера («YOU'RE
 * NEXT», зарубки) — это рисунок ствола, а не клеймо, и пятна крови вокруг
 * остались бы; дальние модели (`_L1`) — надпись там в несколько пикселей.
 */
const VOM_FEUER_PLATE = [0.048, 0.727, 0.218, 0.779];
const HEAVY_SNIPER_MK2_MAG = [[0.31, 0.56, 0.8, 0.695]];
const HAWK_HEADSTAMP = [
  [0.715, 0.008, 0.935, 0.052],
  [0.885, 0.078, 0.975, 0.118],
  [0.675, 0.118, 0.73, 0.152],
  [0.71, 0.135, 0.765, 0.172],
  [0.755, 0.145, 0.885, 0.178],
];
const HAWK_LITTLE_MK2 = [[0.43, 0.205, 0.605, 0.242]];
const GUSENBERG_STAMPS = [
  [0.135, 0.732, 0.305, 0.785],
  [0.3, 0.74, 0.5, 0.764],
  [0.135, 0.898, 0.305, 0.942],
  [0.3, 0.922, 0.5, 0.944],
];
const MIT_OFFENEN_ARMEN = [[0.15, 0.1, 0.6, 0.15]];
export const PAINTED_INSCRIPTIONS = Object.freeze({
  /* Керамический пистолет: «VOM FEUER GUN MANUFACTURERS» на рукояти. */
  w_pi_ceramic_pistol: [
    [0.792, 0.508, 0.9, 0.543],
    [0.885, 0.005, 0.985, 0.04],
    /* затвор: «VOM FEUER», «9 MM x 6 MADE IN LC 678-435-83C» — в альфе */
    [0.59, 0.69, 0.93, 0.735, "alpha"],
    [0.59, 0.905, 0.93, 0.955, "alpha"],
  ],
  /* Тазер: логотип «COIL» со щитом — в столбце палитры. */
  w_pi_stungun: [
    [0.14, 0.385, 0.35, 0.49, "alpha"],
    [0.165, 0.455, 0.315, 0.64, "alpha"],
  ],
  /* Пистолет XM3: «9 MM x 19 MADE IN LC 768-513-35F», «ZNH MBT78». */
  w_pi_pistol_xm3: [
    [0.12, 0.735, 0.36, 0.765],
    [0.14, 0.918, 0.365, 0.941],
    [0.77, 0.705, 0.925, 0.74],
    [0.8, 0.937, 0.92, 0.968],
  ],
  /* Тяжёлая снайперская MK2: «READ MANUAL… SER. XAF-…», плашка «VOM
     FEUER», она же на магазине. */
  w_sr_heavysnipermk2: [[0.41, 0.25, 0.575, 0.295], VOM_FEUER_PLATE],
  w_sr_heavysnipermk2_n: [VOM_FEUER_PLATE],
  w_sr_heavysnipermk2_mag1: HEAVY_SNIPER_MK2_MAG,
  w_sr_heavysnipermk2_mag1_n: HEAVY_SNIPER_MK2_MAG,
  /* Револьвер MK2: «Hawk & Little» на рамке. */
  w_pi_heavyrevolver_mk2: HAWK_LITTLE_MK2,
  w_pi_heavyrevolver_mk2_n: HAWK_LITTLE_MK2,
  /* Гильзы револьвера и револьвера MK2: «HAWK & LITTLE» на донце. */
  w_pi_revolver_mag: HAWK_HEADSTAMP,
  w_pi_revolver_mag_n: HAWK_HEADSTAMP,
  /* «Гусенберг»: «CALIBRE .45 AUTOMATIC», «EDINBURGH», номер — с двух сторон. */
  w_sb_gusenberg: GUSENBERG_STAMPS,
  w_sb_gusenberg_n: GUSENBERG_STAMPS,
  /* Однозарядный пистолет (H4): «MIT OFFENEN ARMEN». */
  w_pi_singleshoth4_dm: MIT_OFFENEN_ARMEN,
  w_pi_singleshoth4_nm: MIT_OFFENEN_ARMEN,
  /* Двухзарядный револьвер: медальон «D.D.P REPEATING ARMS CO.» на щёчке
     рукояти (рельеф медальона в карте нормалей во всю рамку — его медиана
     не вычистит, поэтому только цвет). */
  w_pi_wep1_gun_grip: [[0.3, 0.03, 0.63, 0.35]],
});

/** Рамки нарисованных надписей текстуры (или `null`). */
export const paintedInscriptionsOf = (name) =>
  PAINTED_INSCRIPTIONS[String(name || "").toLowerCase()] || null;

/*
 * Медиана окна по каналу — гистограммой, что скользит по строке (Huang):
 * фон под буквами. Окно шире штриха букв, поэтому медиана — это фон, а
 * края деталей (обод гильзы, рамка плашки) она сохраняет. `skip` — маска
 * рамки (1 — пиксель не считать): на втором заходе буквы из медианы
 * исключаются, и крупные буквы не тянут фон в свой цвет.
 */
function medianBackground(rgba, width, height, area, radius, skip = null) {
  const { left, top, right, bottom } = area;
  const boxWidth = right - left + 1;
  const boxHeight = bottom - top + 1;
  const out = new Uint8Array(boxWidth * boxHeight * 4);
  const histogram = new Uint32Array(256);
  const skipped = (x, y) =>
    skip &&
    x >= left &&
    x <= right &&
    y >= top &&
    y <= bottom &&
    skip[(y - top) * boxWidth + (x - left)];
  for (let channel = 0; channel < 4; channel += 1)
    for (let y = top; y <= bottom; y += 1) {
      histogram.fill(0);
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(height - 1, y + radius);
      let count = 0;
      const column = (x, step) => {
        if (x < 0 || x >= width) return;
        for (let row = y0; row <= y1; row += 1) {
          if (skipped(x, row)) continue;
          histogram[rgba[(row * width + x) * 4 + channel]] += step;
          count += step;
        }
      };
      for (let x = left - radius; x <= left + radius; x += 1) column(x, 1);
      for (let x = left; x <= right; x += 1) {
        if (x > left) {
          column(x - radius - 1, -1);
          column(x + radius, 1);
        }
        const at = ((y - top) * boxWidth + (x - left)) * 4 + channel;
        if (!count) {
          out[at] = rgba[(y * width + x) * 4 + channel];
          continue;
        }
        let seen = 0;
        let value = 0;
        while (value < 255 && seen + histogram[value] <= count >> 1)
          seen += histogram[value++];
        out[at] = value;
      }
    }
  return out;
}

/* Насколько пиксель отличается от фона: по цвету или, у надписей в
   столбце палитры (`alpha`), по альфе. */
function deviationOf(rgba, pixel, background, at, alpha) {
  if (alpha) return Math.abs(rgba[pixel + 3] - background[at * 4 + 3]);
  return Math.max(
    Math.abs(rgba[pixel] - background[at * 4]),
    Math.abs(rgba[pixel + 1] - background[at * 4 + 1]),
    Math.abs(rgba[pixel + 2] - background[at * 4 + 2]),
  );
}

/* Буквы рамки: пиксели, что отличаются от фона сильнее порога, с каймой в
   два пикселя (сглаженный край буквы, светлый рельеф вокруг). */
function inkMask(rgba, width, area, background, threshold, alpha = false) {
  const { left, top, right, bottom } = area;
  const boxWidth = right - left + 1;
  const boxHeight = bottom - top + 1;
  const ink = new Uint8Array(boxWidth * boxHeight);
  for (let y = top; y <= bottom; y += 1)
    for (let x = left; x <= right; x += 1) {
      const at = (y - top) * boxWidth + (x - left);
      const pixel = (y * width + x) * 4;
      if (deviationOf(rgba, pixel, background, at, alpha) <= threshold)
        continue;
      for (let dy = -2; dy <= 2; dy += 1)
        for (let dx = -2; dx <= 2; dx += 1) {
          const nx = x - left + dx;
          const ny = y - top + dy;
          if (nx >= 0 && ny >= 0 && nx < boxWidth && ny < boxHeight)
            ink[ny * boxWidth + nx] = 1;
        }
    }
  return ink;
}

/*
 * Альфа буквы — самая частая альфа ближайших пикселей не-букв: у оружия в
 * ней номер столбца палитры, и буква на плашке берёт столбец плашки, а не
 * соседней детали за краем рамки (медиана окна их смешала бы).
 */
function nearestAlpha(rgba, width, height, x, y, letter) {
  for (let radius = 1; radius <= 32; radius += 1) {
    const counts = new Map();
    for (let dy = -radius; dy <= radius; dy += 1)
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || letter(nx, ny))
          continue;
        const alpha = rgba[(ny * width + nx) * 4 + 3];
        counts.set(alpha, (counts.get(alpha) || 0) + 1);
      }
    let best = -1;
    let most = 0;
    for (const [alpha, count] of counts)
      if (count > most) {
        most = count;
        best = alpha;
      }
    if (best >= 0) return best;
  }
  return rgba[(y * width + x) * 4 + 3];
}

/*
 * Заплатка фактурой (13.10.2026). Ровная заливка фоном оставляла на месте
 * надписи гладкое пятно её же формы: медальон двухзарядного револьвера — на
 * мраморе рукояти, «VOM FEUER» — на исцарапанной плашке снайперской MK2.
 * Теперь буквы закрываются пикселями того же листа со сдвигом — оттуда, где
 * фактура вокруг надписи совпадает лучше всего (царапины металла, разводы
 * дерева и мрамора), — а тон заплатки сводится к соседям уравнением Лапласа
 * (бесшовная вставка): разница «вокруг надписи — вокруг донора» гладко
 * растекается внутрь. Донор не берётся из других надписей листа.
 */

/* Маска рамки, расширенная на `grow` пикселей (в пределах рамки). */
function grownMask(mask, boxWidth, boxHeight, grow) {
  let current = mask;
  for (let step = 0; step < grow; step += 1) {
    const next = Uint8Array.from(current);
    for (let y = 0; y < boxHeight; y += 1)
      for (let x = 0; x < boxWidth; x += 1) {
        if (!current[y * boxWidth + x]) continue;
        if (x > 0) next[y * boxWidth + x - 1] = 1;
        if (x + 1 < boxWidth) next[y * boxWidth + x + 1] = 1;
        if (y > 0) next[(y - 1) * boxWidth + x] = 1;
        if (y + 1 < boxHeight) next[(y + 1) * boxWidth + x] = 1;
      }
    current = next;
  }
  return current;
}

/* Если буквы заняли почти всю рамку (медальон), заплатка — вся рамка: остатки
   рисунка между буквами иначе остались бы обрывками. */
const WHOLE_BOX_SHARE = 0.45;
/* Сдвиги донора — в размерах рамки: за её пределы, но рядом. */
const DONOR_STEPS = Object.freeze([
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [2, 0],
  [-2, 0],
  [0, 2],
  [0, -2],
]);

/*
 * Заплатка маски `mask` (рамка `area`) фактурой листа: цвет (RGB) — донор
 * со сдвигом плюс гладкая поправка тона; альфа — от ближайшей не-заплатки
 * (столбец палитры, маска блеска). `avoid` — рамки надписей листа, донор
 * их не задевает. `false` — подходящего донора нет.
 */
function patchWithTexture(rgba, width, height, area, mask, avoid) {
  const { left, top, right, bottom } = area;
  const boxWidth = right - left + 1;
  const boxHeight = bottom - top + 1;
  const index = new Int32Array(boxWidth * boxHeight).fill(-1);
  const inside = [];
  for (let at = 0; at < mask.length; at += 1)
    if (mask[at]) {
      index[at] = inside.length;
      const bx = at % boxWidth;
      inside.push((top + (at - bx) / boxWidth) * width + left + bx);
    }
  if (!inside.length) return true;
  const slotOf = (pixel) => {
    const x = pixel % width;
    const y = (pixel - x) / width;
    return x >= left && x <= right && y >= top && y <= bottom
      ? index[(y - top) * boxWidth + (x - left)]
      : -1;
  };
  const neighbours = (pixel) => {
    const x = pixel % width;
    const list = [];
    if (x > 0) list.push(pixel - 1);
    if (x + 1 < width) list.push(pixel + 1);
    if (pixel >= width) list.push(pixel - width);
    if (pixel + width < width * height) list.push(pixel + width);
    return list;
  };
  /* Кайма вокруг заплатки (до двух пикселей) — по ней выбирается донор. */
  const ring = [];
  const seen = new Uint8Array(width * height);
  for (const pixel of inside) {
    const x = pixel % width;
    const y = (pixel - x) / width;
    for (let dy = -2; dy <= 2; dy += 1)
      for (let dx = -2; dx <= 2; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const at = ny * width + nx;
        if (seen[at] || slotOf(at) >= 0) continue;
        seen[at] = 1;
        ring.push(at);
      }
  }
  if (!ring.length) return false;
  /* Рельеф пикселя — квадрат перепада к соседям справа и снизу. Донор с
     деталями резче обычной фактуры вокруг надписи (рёбра, рамки, полосы
     соседней детали) переносил бы их в заплатку: штраф — за его самые
     резкие перепады (99-й процентиль) сверх обычных у каймы (медиана). */
  const reliefs = (pixels, offset) => {
    const list = [];
    for (const pixel of pixels) {
      const at = pixel + offset;
      if ((at % width) + 1 >= width || at + width >= width * height) continue;
      let peak = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        const across = rgba[at * 4 + channel] - rgba[(at + 1) * 4 + channel];
        const down = rgba[at * 4 + channel] - rgba[(at + width) * 4 + channel];
        peak = Math.max(peak, across * across + down * down);
      }
      list.push(peak);
    }
    return list.sort((a, b) => a - b);
  };
  const quantile = (sorted, share) =>
    sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] : 0;
  const ringRelief = quantile(reliefs(ring, 0), 0.5);
  let best = null;
  for (const [sx, sy] of DONOR_STEPS) {
    const dx = sx * (boxWidth + 4);
    const dy = sy * (boxHeight + 4);
    const x0 = left - 2 + dx;
    const x1 = right + 2 + dx;
    const y0 = top - 2 + dy;
    const y1 = bottom + 2 + dy;
    if (x0 < 0 || y0 < 0 || x1 >= width || y1 >= height) continue;
    if (
      avoid.some(
        (other) =>
          x0 <= other.right &&
          x1 >= other.left &&
          y0 <= other.bottom &&
          y1 >= other.top,
      )
    )
      continue;
    /* Сходство фактуры: разброс разницы «кайма — кайма донора» (ровный
       сдвиг тона не в счёт — его снимает поправка). */
    const shift = dy * width + dx;
    let score = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      let sum = 0;
      let squares = 0;
      for (const at of ring) {
        const delta =
          rgba[at * 4 + channel] - rgba[(at + shift) * 4 + channel];
        sum += delta;
        squares += delta * delta;
      }
      const mean = sum / ring.length;
      score += squares / ring.length - mean * mean;
    }
    score += Math.max(0, quantile(reliefs(inside, shift), 0.99) - 4 * ringRelief);
    if (!best || score < best.score) best = { shift, score };
  }
  if (!best) return false;
  const { shift } = best;
  /* Порядок от края внутрь (обход в ширину от каймы): начальная поправка —
     среднее уже известных соседей, дальше — итерации Гаусса — Зейделя. */
  const order = [];
  const depth = new Int32Array(inside.length).fill(-1);
  for (let item = 0; item < inside.length; item += 1)
    if (neighbours(inside[item]).some((pixel) => slotOf(pixel) < 0)) {
      depth[item] = 0;
      order.push(item);
    }
  for (let head = 0; head < order.length; head += 1)
    for (const pixel of neighbours(inside[order[head]])) {
      const other = slotOf(pixel);
      if (other >= 0 && depth[other] < 0) {
        depth[other] = depth[order[head]] + 1;
        order.push(other);
      }
    }
  let deepest = 0;
  for (const value of depth) deepest = Math.max(deepest, value);
  const sweeps = Math.min(2500, 40 + deepest * 10);
  const values = new Float32Array(inside.length);
  for (let channel = 0; channel < 3; channel += 1) {
    const correction = new Float32Array(inside.length);
    const known = new Uint8Array(inside.length);
    const boundary = (pixel) =>
      rgba[pixel * 4 + channel] - rgba[(pixel + shift) * 4 + channel];
    for (const item of order) {
      let sum = 0;
      let count = 0;
      for (const pixel of neighbours(inside[item])) {
        const other = slotOf(pixel);
        if (other < 0) {
          sum += boundary(pixel);
          count += 1;
        } else if (known[other]) {
          sum += correction[other];
          count += 1;
        }
      }
      correction[item] = count ? sum / count : 0;
      known[item] = 1;
    }
    for (let sweep = 0; sweep < sweeps; sweep += 1) {
      let change = 0;
      for (const item of order) {
        let sum = 0;
        let count = 0;
        for (const pixel of neighbours(inside[item])) {
          const other = slotOf(pixel);
          sum += other < 0 ? boundary(pixel) : correction[other];
          count += 1;
        }
        const next =
          correction[item] + 1.85 * (sum / count - correction[item]);
        change = Math.max(change, Math.abs(next - correction[item]));
        correction[item] = next;
      }
      if (change < 0.25) break;
    }
    for (let item = 0; item < inside.length; item += 1)
      values[item] = rgba[(inside[item] + shift) * 4 + channel] + correction[item];
    /* Запись — после расчёта канала: донор вне рамки, кайма своя. */
    for (let item = 0; item < inside.length; item += 1)
      rgba[inside[item] * 4 + channel] = Math.max(
        0,
        Math.min(255, Math.round(values[item])),
      );
  }
  /* Резкие черты донора (полоса соседней детали, кромка) сильнее обычной
     фактуры каймы — к медиане окна 5 × 5: зерно металла и мрамора остаётся,
     чужие линии — нет. */
  const typical = Math.sqrt(ringRelief) || 1;
  const cleaned = [];
  for (const pixel of inside) {
    const x = pixel % width;
    const y = (pixel - x) / width;
    const value = [];
    let outlier = false;
    for (let channel = 0; channel < 3; channel += 1) {
      const window = [];
      for (let dy = -2; dy <= 2; dy += 1)
        for (let dx = -2; dx <= 2; dx += 1) {
          const nx = Math.min(width - 1, Math.max(0, x + dx));
          const ny = Math.min(height - 1, Math.max(0, y + dy));
          window.push(rgba[(ny * width + nx) * 4 + channel]);
        }
      window.sort((a, b) => a - b);
      value.push(window[12]);
      if (Math.abs(rgba[pixel * 4 + channel] - window[12]) > 3 * typical) outlier = true;
    }
    if (outlier) cleaned.push([pixel, value]);
  }
  for (const [pixel, value] of cleaned) rgba.set(value, pixel * 4);
  /* Альфа заплатки — от ближайшей не-заплатки по тому же обходу: у оружия в
     ней номер столбца палитры или маска блеска, и надпись не должна
     проступать ни оттенком, ни блеском. */
  for (const item of order) {
    const pixel = inside[item];
    for (const near of neighbours(pixel)) {
      const other = slotOf(near);
      if (other < 0 || depth[other] < depth[item]) {
        rgba[pixel * 4 + 3] = rgba[near * 4 + 3];
        break;
      }
    }
  }
  return true;
}

/**
 * Стирает нарисованные надписи в рамках `boxes` (`[x0, y0, x1, y1]`, доли
 * 0…1; пятым — `"alpha"`, если надпись не в цвете, а в столбце палитры:
 * затвор керамического пистолета, «COIL» тазера). Фон под рамкой — медиана окна чуть больше половины высоты рамки
 * (`medianBackground`); буквы — пиксели, что отличаются от фона сильнее
 * обычного шума рамки (`inkMask`). Второй заход считает фон уже без букв
 * и находит их остатки тем же порогом; буквы получают цвет этого фона —
 * рамка детали, обод гильзы, царапины вокруг и плавный блик остаются
 * своими. Буквы ищутся по цвету, а альфа у них — от ближайших не-букв
 * (`nearestAlpha`): у оружия в ней номер столбца палитры или маска блеска,
 * и надпись не должна проступать оттенком. Альфа вне букв не меняется. То же годится для карты нормалей: выдавленная
 * надпись становится ровной. Возвращает новую картинку `{ width, height,
 * rgba }`.
 */
export function clearPaintedInscriptions(image, boxes) {
  const { width, height } = image;
  const rgba = new Uint8Array(image.rgba);
  const avoid = (boxes || []).map((box) => ({
    left: Math.max(0, Math.floor(box[0] * width)),
    top: Math.max(0, Math.floor(box[1] * height)),
    right: Math.min(width - 1, Math.ceil(box[2] * width) - 1),
    bottom: Math.min(height - 1, Math.ceil(box[3] * height) - 1),
  }));
  for (const box of boxes || []) {
    const area = {
      left: Math.max(0, Math.floor(box[0] * width)),
      top: Math.max(0, Math.floor(box[1] * height)),
      right: Math.min(width - 1, Math.ceil(box[2] * width) - 1),
      bottom: Math.min(height - 1, Math.ceil(box[3] * height) - 1),
    };
    if (area.right < area.left || area.bottom < area.top) continue;
    const boxWidth = area.right - area.left + 1;
    const boxHeight = area.bottom - area.top + 1;
    const radius = Math.max(4, Math.ceil(boxHeight / 2.5));
    const alpha = box[4] === "alpha";
    const first = medianBackground(rgba, width, height, area, radius);
    /* Шум рамки — медиана отклонений: большинство пикселей рамки — фон. */
    const deviation = new Uint8Array(boxWidth * boxHeight);
    for (let at = 0; at < deviation.length; at += 1) {
      const bx = at % boxWidth;
      const pixel =
        ((area.top + (at - bx) / boxWidth) * width + area.left + bx) * 4;
      deviation[at] = deviationOf(rgba, pixel, first, at, alpha);
    }
    const noise = Uint8Array.from(deviation).sort()[deviation.length >> 1];
    /* Соседние столбцы палитры — через 2 единицы альфы. У цвета порог ниже
       прежних 10 (13.10.2026): тёмная надпись магазина снайперской MK2
       отличалась от фона на 5–8 единиц и оставалась; лишнее, что поймает
       низкий порог, закрывает фактура листа (`patchWithTexture`), а не пятно. */
    const threshold = alpha ? Math.max(3, 2 * noise) : Math.max(4, 2 * noise);
    const ink = inkMask(rgba, width, area, first, threshold, alpha);
    const background = medianBackground(rgba, width, height, area, radius, ink);
    const rest = inkMask(rgba, width, area, background, threshold, alpha);
    /* Надпись в цвете — заплатка фактурой листа (выше); в столбце палитры
       цвет ровный, и хватает фона. */
    if (!alpha) {
      let mask = grownMask(
        ink.map((value, at) => value || rest[at]),
        boxWidth,
        boxHeight,
        2,
      );
      let covered = 0;
      for (const value of mask) covered += value;
      if (covered > mask.length * WHOLE_BOX_SHARE)
        mask = new Uint8Array(mask.length).fill(1);
      if (patchWithTexture(rgba, width, height, area, mask, avoid)) continue;
    }
    const letter = (x, y) =>
      x >= area.left &&
      x <= area.right &&
      y >= area.top &&
      y <= area.bottom &&
      (ink[(y - area.top) * boxWidth + (x - area.left)] ||
        rest[(y - area.top) * boxWidth + (x - area.left)]);
    for (let at = 0; at < ink.length; at += 1) {
      if (!ink[at] && !rest[at]) continue;
      const bx = at % boxWidth;
      const x = area.left + bx;
      const y = area.top + (at - bx) / boxWidth;
      const pixel = (y * width + x) * 4;
      rgba[pixel] = background[at * 4];
      rgba[pixel + 1] = background[at * 4 + 1];
      rgba[pixel + 2] = background[at * 4 + 2];
      /* Соседи-не-буквы этим циклом не меняются — читать их можно на месте. */
      rgba[pixel + 3] = nearestAlpha(rgba, width, height, x, y, letter);
    }
  }
  return { width, height, rgba };
}
