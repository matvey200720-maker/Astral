/*
 * Ворота обложки (ТЗ 24.10.2026, план Б, п. 1): часть редукса без хорошей обложки не идёт к публикации.
 *
 * «Обложка есть» не значит «обложка хорошая»: окно без WebGL (xvfb без mesa) рисует чёрное, рисовальщик без листов игры
 * — пустую сцену, ошибка рамки — текстуру на весь кадр вместо модели, а серый кадр 120×90 у пропавшего ролика — вообще
 * не картинку. Раньше всё это считалось обложкой (`policy.js`: «готова» = обложка есть). Здесь решение по самим
 * пикселям, один раз и для разбора, и для этапа обложек:
 *
 *   • размер — короче 160 px по короткой стороне это значок или заглушка, не обложка;
 *   • одноцветный кадр — разброс яркости и число цветов у нуля;
 *   • чёрный кадр — средняя и почти вся яркость у нуля (окно без WebGL);
 *   • пустой кадр — содержимое (всё, что не фон по краю кадра) занимает меньше сотой доли;
 *   • модель в кадре — только у видов, где обложка — одна вещь на фоне (`FRAMED_KINDS`): содержимое не касается трёх
 *     краёв, его центр — в средней части кадра, рамка занимает не меньше 6 % площади; кадр, целиком забитый
 *     содержимым без полей, — текстура, а не модель.
 *
 *   • предмет в середине кадра — у видов компонентов с предметом (`SUBJECT_MODES`: «мир» — объект спереди и круг мира, «модели» — на нейтральной сцене; план обложки `component-cover-plan.js`, Р6):
 *     в средней части кадра (40 % по сторонам) содержимого не меньше `SUBJECT_MIN` — пустая середина при полном крае значит, что камера смотрит мимо предмета.
 *
 * Сцены, карты и экраны (небо, мини-карта, прицел, арена…) заполняют кадр по замыслу — к ним применяются только
 * общие проверки. Разбор пикселей — чистая функция `analyzePixels` (тесты без картинок), чтение файла — `inspectCover`.
 */

import sharp from "sharp";

/** Короче этого по короткой стороне — не обложка (серый кадр ролика 120×90). */
export const MIN_SIDE = 160;
/** Сторона уменьшенной копии, по которой считается всё остальное. */
const SAMPLE = 128;
/** Разница с фоном (по каналу), с которой точка уже содержимое. */
const BACKGROUND_DELTA = 28;
/**
 * Большая карта автора бывает почти чёрной (GODMODE, HALLOWEN 240: тёмно-серый остров с тонкими линиями), и осветлять её нельзя
 * (владелец, 12.11.2026). У таких кадров содержимым считается и слабое отличие от фона. Замер 13.11.2026 на копии 128 px: фон
 * студии сам даёт до 7–10 единиц (виньетка 12 → 19), карта HALLOWEN — 2,6 % кадра при 16 и 0,4 % при 28; пустая сцена при 16 — ноль.
 */
const DARK_MAP_KINDS = Object.freeze(new Set(["large-map", "big-map"]));
const DARK_MAP_DELTA = 16;
/** Содержимое меньше этой доли кадра — кадр пустой. */
const EMPTY_SHARE = 0.01;
/**
 * Яркость (0–255): средняя ниже этой, 99-й процентиль ниже второй и разброс меньше третьей — чёрный кадр. Тёмная сцена
 * со структурой (зоны на тёмной карте: средняя 5, разброс 8) не чёрная; окно без WebGL рисует нули.
 */
const BLACK_MEAN = 8;
const BLACK_PEAK = 40;
const BLACK_DEVIATION = 4;
/** Выжженный кадр (ветка Хелпера 3 `h3-planb-spare`): средняя выше первой границы, разброс ниже второй. */
const WHITE_MEAN = 248;
const WHITE_DEVIATION = 6;
/** Разброс яркости и число цветов, ниже которых кадр — заливка. */
const FLAT_DEVIATION = 2.5;
const FLAT_COLOURS = 3;
/** Доля длины края, занятая содержимым, с которой край считается «задетым». */
const EDGE_TOUCH = 0.08;
/** Центр содержимого дальше этой доли стороны от центра кадра — модель не по центру. */
const CENTRE_OFFSET = 0.28;
/** Площадь рамки содержимого меньше этой доли кадра — модель крошечная. */
const MIN_FRAME_AREA = 0.06;

/**
 * Виды, у которых обложка — одна вещь на фоне: по ним проверяется «модель в кадре». У сцен, карт и экранов кадр
 * заполнен по замыслу.
 */
/** Режимы плана обложки компонента, где в середине кадра обязан быть предмет (`component-cover-plan.js`). */
export const SUBJECT_MODES = Object.freeze(new Set(["world", "models"]));
/** Доля содержимого в середине кадра (40 % по сторонам), с которой предмет считается в кадре. */
export const SUBJECT_MIN = 0.12;
/*
 * Режим «высокий предмет» (фонарь целиком, 13.11.2026): один столб в середине кадра — тонкий и высокий, середина кадра (40 % по сторонам) у него по замыслу почти пуста: столб в ней —
 * полоска, а не четверть площади. Предмет — в кадре, если его рамка занимает не меньше `TALL_HEIGHT` высоты кадра, стоит по горизонтали не дальше `TALL_CENTRE` от середины и в центральной
 * полосе (`TALL_BAND`) на высоте рамки лежит не меньше `TALL_BAND_MIN` содержимого: камера смотрит на предмет, а не мимо него. Пустой кадр, предмет у края и невысокий предмет не проходят.
 */
export const TALL_MODE = "tall";
export const TALL_HEIGHT = 0.55;
export const TALL_CENTRE = 0.25;
export const TALL_BAND = [0.4, 0.6];
export const TALL_BAND_MIN = 0.03;
/* Режим «россыпь» (`cover-stage.js`: кадры зон и моделей маппинга по местам мира) и наименьшая доля содержимого в нижних двух третях кадра. */
export const SCATTER_MODE = "scatter";
export const SCATTER_MIN = 0.02;
/* Режим «полосы» (`part-covers.js: stripCover`, растительность): кадр — одна или несколько полос во всю высоту (игра | мод, дерево | куст), предмет — посередине каждой.
   Середина всего кадра при двух полосах попадает на шов и пустые поля между деревьями (vovan x obi, 14.11.2026: «в середине кадра пусто» у кадра с двумя пальмами),
   поэтому судится середина каждой полосы отдельно. */
export const STRIPS_MODE = "strips";
/* Режим «ночное небо» (`sky-objects-cover.js`: северное сияние над океаном): фон — тёмный градиент неба, предмет — светящиеся ленты. Середина кадра у них по замыслу пуста или занята небом, а «содержимое по краю»
   у градиента не считается, поэтому судится одно: доля заметно светлых точек в кадре — не меньше `SKY_MIN_SHARE`. Чёрный кадр, одна заливка и пустой кадр отсеиваются раньше, как у всех режимов. */
export const SKY_MODE = "sky";
export const SKY_LIT = 60;
export const SKY_MIN_SHARE = 0.01;
/** Середина кадра: от 30 % до 70 % по каждой стороне. */
const SUBJECT_SPAN = [0.3, 0.7];

export const FRAMED_KINDS = Object.freeze(new Set(["weapon", "attachment", "gunpack", "clothing", "outfit-pack", "vehicle"]));

const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Разбор пикселей кадра.
 *
 * @param {{ width: number, height: number, data: Uint8Array|Buffer }} frame — RGBA, строки подряд
 * @param {{ kind?: string, side?: number, mode?: string }} [options] — `kind` — вид части (`FRAMED_KINDS`), `side` — короткая сторона
 *   исходной картинки (размер проверяется по ней, а не по уменьшенной копии), `mode` — режим плана обложки компонента (`SUBJECT_MODES`)
 * @returns {{ ok: boolean, failures: { code: string, message: string }[], stats: object }}
 */
export function analyzePixels({ width, height, data }, { kind = "", side = null, mode = "", lanes = 1 } = {}) {
  const failures = [];
  const fail = (code, message) => failures.push({ code, message });
  const total = width * height;
  if (!(total > 0) || data.length < total * 4) {
    fail("unreadable", "кадр не читается как картинка");
    return { ok: false, failures, stats: {} };
  }
  const shortSide = side ?? Math.min(width, height);
  if (shortSide < MIN_SIDE) fail("small", `кадр ${shortSide} px по короткой стороне — это значок или заглушка, обложка не короче ${MIN_SIDE}`);

  /* Яркость и цвета — только у видимых точек: чёрный силуэт на прозрачном фоне не «чёрный кадр», а прозрачный целиком — пустой. */
  const lum = [];
  const opaque = new Uint8Array(total);
  const palette = new Map();
  let sum = 0;
  for (let i = 0; i < total; i += 1) {
    const at = i * 4;
    if (data[at + 3] < 16) continue;
    opaque[i] = 1;
    const value = luminance(data[at], data[at + 1], data[at + 2]);
    lum.push(value);
    sum += value;
    const key = ((data[at] >> 4) << 8) | ((data[at + 1] >> 4) << 4) | (data[at + 2] >> 4);
    palette.set(key, (palette.get(key) || 0) + 1);
  }
  const seen = lum.length;
  if (!seen) {
    fail("empty", "кадр прозрачный целиком — на нём ничего нет");
    return { ok: false, failures, stats: { side: shortSide, opaque: 0 } };
  }
  const mean = sum / seen;
  let variance = 0;
  for (const value of lum) variance += (value - mean) ** 2;
  const deviation = Math.sqrt(variance / seen);
  const sorted = Float32Array.from(lum).sort();
  const peak = sorted[Math.min(seen - 1, Math.floor(seen * 0.99))];
  const colours = [...palette.values()].filter((count) => count >= seen * 0.002).length;

  /* Чёрное называется чёрным: причина у него своя (окно без WebGL), а заливку любого цвета ставит рисовальщик. */
  if (mean < BLACK_MEAN && peak < BLACK_PEAK && deviation < BLACK_DEVIATION) fail("black", "кадр чёрный — окно рисует без WebGL или сцена не собралась");
  else if (deviation < FLAT_DEVIATION && colours <= FLAT_COLOURS) fail("flat", "кадр одноцветный — рисовальщик ничего не показал");
  /* Выжженный: почти весь кадр белый и разброс мал (пересвет, сцена без теней) — модель в нём не различить. */
  else if (mean > WHITE_MEAN && deviation < WHITE_DEVIATION) fail("white", "кадр выжжен до белого — модель в нём не различить");

  /* Содержимое: точки, что отличаются от фона по краю. */
  const edge = new Map();
  const ring = (x, y) => {
    const at = (y * width + x) * 4;
    const key = opaque[y * width + x] ? `${data[at] >> 3},${data[at + 1] >> 3},${data[at + 2] >> 3}` : "clear";
    edge.set(key, (edge.get(key) || 0) + 1);
  };
  for (let x = 0; x < width; x += 1) {
    ring(x, 0);
    ring(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    ring(0, y);
    ring(width - 1, y);
  }
  const [backgroundKey] = [...edge].sort((left, right) => right[1] - left[1])[0];
  const clear = backgroundKey === "clear";
  const [br, bg, bb] = clear ? [0, 0, 0] : backgroundKey.split(",").map((value) => (Number(value) << 3) + 4);
  const delta = DARK_MAP_KINDS.has(kind) ? DARK_MAP_DELTA : BACKGROUND_DELTA;
  const content = new Uint8Array(total);
  let covered = 0;
  const columns = new Uint32Array(width);
  const rows = new Uint32Array(height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const at = i * 4;
      const differs = clear
        ? opaque[i] === 1
        : opaque[i] === 1 &&
          Math.max(Math.abs(data[at] - br), Math.abs(data[at + 1] - bg), Math.abs(data[at + 2] - bb)) > delta;
      if (!differs) continue;
      content[i] = 1;
      covered += 1;
      columns[x] += 1;
      rows[y] += 1;
    }
  const share = covered / total;
  if (share < EMPTY_SHARE && !failures.some((item) => ["flat", "black", "white"].includes(item.code)))
    fail("empty", "в кадре почти ничего нет — сцена пуста");

  /* Рамка содержимого: колонки и строки, где его не меньше доли стороны (одиночные точки не в счёт). */
  const columnEnough = Math.max(1, Math.round(height * 0.015));
  const rowEnough = Math.max(1, Math.round(width * 0.015));
  const xs = [];
  const ys = [];
  for (let x = 0; x < width; x += 1) if (columns[x] >= columnEnough) xs.push(x);
  for (let y = 0; y < height; y += 1) if (rows[y] >= rowEnough) ys.push(y);
  const box = xs.length && ys.length ? { left: xs[0], right: xs.at(-1), top: ys[0], bottom: ys.at(-1) } : null;
  const touches = { left: 0, right: 0, top: 0, bottom: 0 };
  if (box) {
    for (let y = 0; y < height; y += 1) {
      touches.left += content[y * width];
      touches.right += content[y * width + width - 1];
    }
    for (let x = 0; x < width; x += 1) {
      touches.top += content[x];
      touches.bottom += content[(height - 1) * width + x];
    }
  }
  const touched = {
    left: touches.left >= height * EDGE_TOUCH,
    right: touches.right >= height * EDGE_TOUCH,
    top: touches.top >= width * EDGE_TOUCH,
    bottom: touches.bottom >= width * EDGE_TOUCH,
  };
  const touchedCount = Object.values(touched).filter(Boolean).length;
  const area = box ? ((box.right - box.left + 1) * (box.bottom - box.top + 1)) / total : 0;
  const centre = box
    ? { x: (box.left + box.right + 1) / 2 / width - 0.5, y: (box.top + box.bottom + 1) / 2 / height - 0.5 }
    : null;

  if (FRAMED_KINDS.has(kind) && box && !failures.some((item) => ["flat", "black", "white", "empty"].includes(item.code))) {
    if (touchedCount === 4)
      fail("texture", "кадр занят содержимым до всех четырёх краёв, полей нет — вместо модели картинка листа или рамка посчитана неверно");
    else if (touchedCount === 3) fail("off-frame", "модель вылезает за три края кадра — рамка посчитана неверно");
    else if (Math.abs(centre.x) > CENTRE_OFFSET || Math.abs(centre.y) > CENTRE_OFFSET)
      fail("off-centre", "модель сдвинута к краю кадра");
    else if (area < MIN_FRAME_AREA) fail("tiny", "модель в кадре крошечная — рамка занимает меньше двадцатой доли кадра");
  }

  /* Предмет в середине кадра: содержимое средней части; без него камера смотрит мимо. */
  let centreShare = null;
  if (SUBJECT_MODES.has(mode) && !failures.some((item) => ["flat", "black", "white", "empty"].includes(item.code))) {
    const [from, to] = SUBJECT_SPAN;
    let inside = 0;
    let cells = 0;
    for (let y = Math.floor(height * from); y < Math.ceil(height * to); y += 1)
      for (let x = Math.floor(width * from); x < Math.ceil(width * to); x += 1) {
        cells += 1;
        inside += content[y * width + x];
      }
    centreShare = cells ? inside / cells : 0;
    if (centreShare < SUBJECT_MIN) fail("no-subject", "в середине кадра пусто — предмета обложки в кадре нет, камера смотрит мимо");
  }

  /* Ночное небо: светящиеся объекты на тёмном градиенте — светлых точек не меньше SKY_MIN_SHARE кадра. */
  if (mode === SKY_MODE && !failures.some((item) => ["flat", "black", "white", "empty"].includes(item.code))) {
    let lit = 0;
    for (let i = 0; i < total; i += 1) {
      const at = i * 4;
      if (opaque[i] && luminance(data[at], data[at + 1], data[at + 2]) > SKY_LIT) lit += 1;
    }
    centreShare = lit / total;
    if (centreShare < SKY_MIN_SHARE) fail("no-subject", "в ночном кадре светящихся объектов не видно — камера смотрит мимо неба с ними");
  }

  /* Полосы: в середине каждой полосы предмета не меньше SUBJECT_MIN. */
  if (mode === STRIPS_MODE && !failures.some((item) => ["flat", "black", "white", "empty"].includes(item.code))) {
    const count = Math.max(1, Math.floor(lanes));
    const [from, to] = SUBJECT_SPAN;
    const laneWidth = width / count;
    let weakest = 1;
    for (let lane = 0; lane < count; lane += 1) {
      let inside = 0;
      let cells = 0;
      for (let y = Math.floor(height * from); y < Math.ceil(height * to); y += 1)
        for (let x = Math.floor(laneWidth * (lane + from)); x < Math.ceil(laneWidth * (lane + to)); x += 1) {
          cells += 1;
          inside += content[y * width + x];
        }
      weakest = Math.min(weakest, cells ? inside / cells : 0);
    }
    centreShare = weakest;
    if (weakest < SUBJECT_MIN) fail("no-subject", "в середине полосы пусто — предмета обложки в кадре нет, камера смотрит мимо");
  }

  /* Высокий предмет: рамка содержимого высока, стоит у середины, а в центральной полосе есть сам предмет. */
  if (mode === TALL_MODE && !failures.some((item) => ["flat", "black", "white", "empty"].includes(item.code))) {
    const [from, to] = TALL_BAND;
    let inside = 0;
    let cells = 0;
    if (box) {
      for (let y = box.top; y <= box.bottom; y += 1)
        for (let x = Math.floor(width * from); x < Math.ceil(width * to); x += 1) {
          cells += 1;
          inside += content[y * width + x];
        }
    }
    centreShare = cells ? inside / cells : 0;
    const tallEnough = box && (box.bottom - box.top + 1) / height >= TALL_HEIGHT;
    const centred = box && Math.abs(centre.x) <= TALL_CENTRE;
    if (!tallEnough || !centred || centreShare < TALL_BAND_MIN) fail("no-subject", "предмет не стоит в кадре во весь рост по середине — камера смотрит мимо него или он обрезан");
  }

  /* Россыпь: объёмы компонента стоят по своим местам мира (прострелы, зоны — дома и заборы по краям кадра), а в верхнем углу — врезка карты. Предмета
     «в середине» у такого кадра нет; пусто в нём — когда в нижних двух третях (под врезкой) содержимого почти нет: тонкие линии границ, которых не видно. */
  if (mode === SCATTER_MODE && !failures.some((item) => ["flat", "black", "white", "empty"].includes(item.code))) {
    let inside = 0;
    let cells = 0;
    for (let y = Math.floor(height / 3); y < height; y += 1)
      for (let x = 0; x < width; x += 1) {
        cells += 1;
        inside += content[y * width + x];
      }
    centreShare = cells ? inside / cells : 0;
    if (centreShare < SCATTER_MIN) fail("no-subject", "в кадре почти пусто — объектов компонента под врезкой карты не видно");
  }

  return {
    ok: failures.length === 0,
    failures,
    stats: {
      side: shortSide,
      ...(centreShare === null ? {} : { centre: Math.round(centreShare * 1000) / 1000 }),
      mean: Math.round(mean * 10) / 10,
      peak: Math.round(peak),
      deviation: Math.round(deviation * 10) / 10,
      colours,
      share: Math.round(share * 1000) / 1000,
      area: Math.round(area * 1000) / 1000,
      touched: touchedCount,
    },
  };
}

/** Уменьшенная копия обложки: RGBA ≤ `SAMPLE` px и исходная короткая сторона. */
async function pixelsOf(bytes) {
  const image = sharp(Buffer.from(bytes), { failOn: "none" });
  const meta = await image.metadata();
  const { data, info } = await image
    .ensureAlpha()
    .resize({ width: SAMPLE, height: SAMPLE, fit: "inside", kernel: "nearest" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { frame: { width: info.width, height: info.height, data }, side: Math.min(meta.width || 0, meta.height || 0) };
}

/**
 * Проверка обложки — байтами файла. Не прошла — `failures` по-русски, каждая причина с кодом.
 * Файл не читается — одна причина `unreadable`, не исключение.
 */
export async function inspectCover(bytes, { kind = "", mode = "", lanes = 1 } = {}) {
  try {
    const { frame, side } = await pixelsOf(bytes);
    return analyzePixels(frame, { kind, side, mode, lanes });
  } catch (error) {
    return {
      ok: false,
      failures: [{ code: "unreadable", message: `обложка не читается как картинка (${String(error?.message || error).slice(0, 80)})` }],
      stats: {},
    };
  }
}

/** Причины одной строкой для замечания и очереди: «кадр чёрный — …; кадр 120 px…». */
export const failureText = (result) => (result?.failures || []).map((item) => item.message).join("; ");
