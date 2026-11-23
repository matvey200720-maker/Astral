// Знаковое поле расстояний для маски глифа (точное евклидово, метод Фельзенсвальба и Хуттенлохера).

// Квадрат расстояния для «источника нет»: большое число вместо бесконечности.
const FAR = 1e20;

// Состояния пикселя маски: буква, фон или «за концом маски» (не буква и не фон).
const LETTER = 1;
const BACKGROUND = 2;
const UNKNOWN = 0;

// Рабочие массивы одной строки или столбца: создаются один раз на вызов.
// steps хранит пары «вершина параболы, левая граница» подряд.
function makeLane(longest) {
  const room = Math.ceil(longest) + 2;
  return {
    input: new Float64Array(room),
    output: new Float64Array(room),
    steps: new Float64Array(2 * room + 2),
  };
}

// Абсцисса пересечения парабол с вершинами в p и q.
function meetAt(input, q, p) {
  return (input[q] + q * q - (input[p] + p * p)) / (2 * q - 2 * p);
}

// Нижняя огибающая парабол по одной линии длиной n: output[q] = min_p ((q - p)^2 + input[p]).
function transformLine(lane, n) {
  const { steps } = lane;
  [steps[0], steps[1], steps[3]] = [0, -Infinity, Infinity];

  let top = 0;
  let q = 1;
  while (q < n) {
    let crossing;
    for (;;) {
      crossing = meetAt(lane.input, q, steps[2 * top]);
      if (!(crossing <= steps[2 * top + 1])) break;
      top -= 1;
    }
    top += 1;
    steps[2 * top] = q;
    steps[2 * top + 1] = crossing;
    steps[2 * top + 3] = Infinity;
    q += 1;
  }

  top = 0;
  q = 0;
  while (q < n) {
    while (steps[2 * top + 3] < q) top += 1;
    const p = steps[2 * top];
    lane.output[q] = (q - p) * (q - p) + lane.input[p];
    q += 1;
  }
}

// Линия сетки <-> буфер линии: gather читает сетку в буфер, иначе буфер пишется обратно.
function moveLine(grid, buffer, { offset, stride, length }, gather) {
  for (let k = 0; k < length; k += 1) {
    const at = offset + k * stride;
    if (gather) buffer[k] = grid[at];
    else grid[at] = buffer[k];
  }
}

// Проходы по сетке: сначала столбцы, затем строки.
const passesFor = (width, height) => [
  { lines: width, length: height, stride: width, offsetOf: (line) => line },
  { lines: height, length: width, stride: 1, offsetOf: (line) => line * width },
];

// Сетка квадратов расстояний до ближайшего нулевого пикселя.
function squaredDistances(grid, width, height, lane) {
  passesFor(width, height).forEach(({ lines, length, stride, offsetOf }) => {
    for (let line = 0; line < lines; line += 1) {
      const place = { offset: offsetOf(line), stride, length };
      moveLine(grid, lane.input, place, true);
      transformLine(lane, length);
      moveLine(grid, lane.output, place, false);
    }
  });
}

const stateAt = (mask, known, at) => {
  if (at >= known) return UNKNOWN;
  return mask[at] ? LETTER : BACKGROUND;
};

// Байт поля по знаковому расстоянию: 128 на границе, 255 и 0 на расстоянии радиуса.
const byteOf = (signed, span) => {
  const level = 0.5 + signed / span;
  if (level < 0) return 0;
  if (level > 1) return 255;
  return (level * 255 + 0.5) | 0;
};

export const signedDistanceField = (mask, width, height, radius) => {
  const known = mask.length;
  const size = height * width;
  const [toLetter, toBackground] = [new Float64Array(size), new Float64Array(size)];

  let y = 0;
  while (y < height) {
    let x = 0;
    while (x < width) {
      const at = y * width + x;
      const state = stateAt(mask, known, at);
      toLetter[at] = state === LETTER ? 0 : FAR;
      toBackground[at] = state === BACKGROUND ? 0 : FAR;
      x += 1;
    }
    y += 1;
  }

  const lane = makeLane(Math.max(width, height));
  [toLetter, toBackground].forEach((grid) => squaredDistances(grid, width, height, lane));

  const field = new Uint8Array(size);
  let i = 0;
  while (i < size) {
    const inside = Boolean(mask[i]);
    const root = Math.sqrt(inside ? toBackground[i] : toLetter[i]);
    field[i] = byteOf(inside ? root : -root, 2 * radius);
    i += 1;
  }
  return field;
};
