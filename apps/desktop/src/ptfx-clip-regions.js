/*
 * Таблица сеток кадров частиц: `common/data/effects/ptxclipregions.dat`.
 *
 * Сетку листа игра хранит не в core.ypt. Сколько на текстуре столбцов и
 * строк кадров и где в каждом кадре непрозрачная часть, она читает отсюда —
 * по имени текстуры. Текстуру, которой в таблице нет, игра рисует одним
 * кадром. Поэтому нейтральная копия листа кровяной пыли (7×7 кадров) без
 * своей строки вспыхнула бы в игре всеми сорока девятью кадрами разом, одной
 * картинкой, — её строка копируется со штатной `ptfx_blood_spray` дословно.
 *
 * Формат сверен с живым update.rpf Legacy (39 080 байт, 164 текстуры):
 *
 *   164                              ← строк текстур
 *   1114                             ← кадров во всех строках
 *   имя столбцы строки u0 u1 v0 v1 … ← четыре числа на кадр, пробел в конце
 *
 * Строки разделены CRLF, файл заканчивается переводом строки. Правка трогает
 * только строки текстур Astral и два счётчика; всё остальное остаётся байт в
 * байт, а без изменений возвращается тот же самый текст.
 */

export const PTX_CLIP_REGIONS_ENTRY =
  "update:/common/data/effects/ptxclipregions.dat";
export const MAX_CLIP_REGIONS_BYTES = 1024 * 1024;

const TEXTURE_NAME = /^[a-z0-9_]{1,64}$/i;
const MAX_SHEET_EDGE = 16;
/* Кадр целиком: слот рисует лист без обрезки, как штатные 1×1 и 1×2. */
const FULL_FRAME = "0 1 0 1";

function damaged(reason) {
  return new Error(`ptxclipregions.dat в архиве игры повреждён: ${reason}.`);
}

/**
 * Метка отказа «счётчик в заголовке не сходится с телом» (22.11.2026): окно по ней (`utils/installFailure.js`, семейство `clip-table-counts`) говорит человеку, что таблицу изменил другой мод (редукс),
 * а не что файл игры повреждён. Счётчиков два — число текстур и число кадров: у таблиц авторов врёт то один (sad redux: 181 текстура в заголовке, в теле 163), то другой (тестер beta.109: 1212 кадров, в теле 277),
 * игра такие таблицы принимает; слово одно на оба. В тексте — числа каждого несошедшегося счётчика для поддержки. Исключение из IPC приходит строкой, поэтому метка вписана в сообщение.
 */
export const CLIP_TABLE_COUNTS_CODE = "ASTRAL_CLIP_TABLE_COUNTS";

function mismatchedCounts({ declaredEntries, entries, declaredFrames, frames }) {
  const parts = [];
  if (entries !== declaredEntries) parts.push(`в заголовке ${declaredEntries} текстур, в таблице ${entries}`);
  if (frames !== declaredFrames) parts.push(`в заголовке ${declaredFrames} кадров, в таблице ${frames}`);
  const error = new Error(
    `ptxclipregions.dat записан другим модом с неверными счётчиками в заголовке: ${parts.join("; ")} (${CLIP_TABLE_COUNTS_CODE}). Строки таблицы целы, а писать в неё Astral не станет.`,
  );
  error.code = CLIP_TABLE_COUNTS_CODE;
  return error;
}

function count(value, label) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) throw damaged(`${label} — не число`);
  return Number(text);
}

/**
 * Разбирает таблицу, не теряя ни байта: строки хранятся как есть, рядом —
 * их смысл. Несходящиеся счётчики — это отказ, а не догадка: игра выделяет
 * память по ним, и дописывать строки к такой таблице нельзя. Расхождение
 * любого из двух счётчиков заголовка чужой таблицы (число текстур, число
 * кадров) называется своим отказом (`CLIP_TABLE_COUNTS_CODE`): строки при этом
 * читаются без ошибок, а повреждение — это обрыв строки, пустой файл, нет
 * заголовка, не число. `own` — разбор нашего же результата: там расхождение —
 * наша ошибка, и это повреждение.
 */
export function parseClipRegions(text, { own = false } = {}) {
  if (typeof text !== "string" || !text.length) throw damaged("файл пуст");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(eol);
  const finalNewline = lines.at(-1) === "";
  if (finalNewline) lines.pop();
  if (lines.length < 2) throw damaged("нет заголовка");
  const declaredEntries = count(lines[0], "число текстур");
  const declaredFrames = count(lines[1], "число кадров");
  const entries = [];
  let frames = 0;
  for (let index = 2; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      throw damaged(`пустая строка ${index + 1}`);
    }
    const tokens = line.trim().split(/\s+/);
    const [name, columnsText, rowsText, ...numbers] = tokens;
    const columns = count(columnsText, `столбцы ${name}`);
    const rows = count(rowsText, `строки ${name}`);
    if (!name || !columns || !rows) throw damaged(`строка ${index + 1}`);
    if (numbers.length !== columns * rows * 4) {
      throw damaged(`у ${name} не хватает прямоугольников кадров`);
    }
    if (!numbers.every((value) => Number.isFinite(Number(value)))) {
      throw damaged(`у ${name} прямоугольник кадра — не число`);
    }
    entries.push({ name, columns, rows, line: index });
    frames += columns * rows;
  }
  if (entries.length !== declaredEntries || frames !== declaredFrames) {
    if (!own) throw mismatchedCounts({ declaredEntries, entries: entries.length, declaredFrames, frames });
    if (entries.length !== declaredEntries) {
      throw damaged(
        `в заголовке ${declaredEntries} текстур, в таблице ${entries.length}`,
      );
    }
    throw damaged(`в заголовке ${declaredFrames} кадров, в таблице ${frames}`);
  }
  return { eol, finalNewline, lines, entries, frames };
}

/**
 * Сетки листов для окон и съёмщика: `Map(имя текстуры строчными → { columns, rows })`; `names` — только эти листы (нет — все). Единое правило чтения таблицы автора:
 * истина — тело, строка за строкой (`имя столбцы строки …`), а счётчики заголовка могут врать, и игру это не смущает (у sad redux — 181 текстура при 163 в теле, у тестера
 * beta.109 — 1212 кадров при 277). Строка, что не читается, пропускается, у повторного имени побеждает последняя. Это правило съёмщика обложек (`cover-stage.js: clipGridsOf`
 * зовёт эту функцию), его же читают окна колёс, фонарей и эффектов. Запись так не читают: `parseClipRegions` и `upsertClipRegions` строгие.
 */
export function readClipGrids(text, names = null) {
  const wanted = names ? new Set([...names].map((name) => String(name).toLowerCase())) : null;
  const grids = new Map();
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const [name, columnsText, rowsText] = line.trim().split(/\s+/);
    const key = String(name || "").toLowerCase();
    if (!key || (wanted && !wanted.has(key)) || !/^\d+$/.test(columnsText || "") || !/^\d+$/.test(rowsText || "")) continue;
    const columns = Number(columnsText);
    const rows = Number(rowsText);
    if (columns > 0 && rows > 0 && columns <= MAX_SHEET_EDGE && rows <= MAX_SHEET_EDGE) grids.set(key, { columns, rows });
  }
  return grids;
}

function sheetLine({ texture, columns, rows }) {
  const regions = Array.from({ length: columns * rows }, () => FULL_FRAME);
  // Пробел в конце строки — как у всех 164 штатных строк.
  return `${texture} ${columns} ${rows} ${regions.join(" ")} `;
}

/*
 * Строка листа-копии: сетка и прямоугольники кадров — дословно из строки
 * образца, меняется только имя. Так у нейтральной копии кровяной пыли обрезка
 * каждого кадра по непрозрачной части совпадает со штатной до знака.
 */
const LINE_TAIL = /^\s*\S+(\s+\d+\s+\d+\s.*)$/;

function copiedLine(texture, sourceLine) {
  const tail = LINE_TAIL.exec(sourceLine);
  if (!tail) throw damaged(`строка образца для ${texture} не читается`);
  return `${texture}${tail[1]}`;
}

function normalizeSheet(sheet) {
  const texture = String(sheet?.texture || "").trim();
  if (!TEXTURE_NAME.test(texture)) {
    throw new TypeError(
      `Имя текстуры для ptxclipregions.dat некорректно: ${texture}`,
    );
  }
  /* Строка листа из таблицы автора редукса («наш Core», свои частицы): сетка и кадры как у него, имя — наше. */
  if (typeof sheet?.line === "string") {
    const tail = LINE_TAIL.exec(sheet.line);
    if (!tail || sheet.line.length > 8192) throw new TypeError(`Строка кадров листа ${texture} не читается.`);
    const [columns, rows] = tail[1].trim().split(/\s+/).map(Number);
    for (const value of [columns, rows])
      if (!Number.isInteger(value) || value < 1 || value > MAX_SHEET_EDGE)
        throw new RangeError(`Сетка листа ${texture}: допустимо от 1 до ${MAX_SHEET_EDGE}.`);
    return { texture, columns, rows, line: `${texture}${tail[1]}` };
  }
  if (sheet?.copyFrom !== undefined && sheet?.copyFrom !== null) {
    const copyFrom = String(sheet.copyFrom).trim();
    if (!TEXTURE_NAME.test(copyFrom)) {
      throw new TypeError(
        `Имя текстуры-образца для ptxclipregions.dat некорректно: ${copyFrom}`,
      );
    }
    return { texture, copyFrom };
  }
  const columns = Number(sheet?.columns);
  const rows = Number(sheet?.rows);
  for (const [label, value] of [
    ["столбцов", columns],
    ["строк", rows],
  ]) {
    if (!Number.isInteger(value) || value < 1 || value > MAX_SHEET_EDGE) {
      throw new RangeError(
        `Число ${label} листа ${texture}: допустимо от 1 до ${MAX_SHEET_EDGE}.`,
      );
    }
  }
  return { texture, columns, rows };
}

/**
 * Ставит строки листов: новую текстуру дописывает в конец, строку, которая
 * уже есть, заменяет на месте. Возвращает тот же текст и `changed: false`,
 * если таблица уже такая, как нужно.
 *
 * `reset` — приставки имён, под которыми живёт пересобираемое семейство
 * (клоны эффектов попадания): строки под ними, которых нет среди заказанных,
 * снимаются. Иначе выключенная зона оставляла бы в таблице строку текстуры,
 * которой в ядре уже нет, — безвредную, но копящуюся от установки к установке.
 */
export function upsertClipRegions(text, sheets, { reset = [] } = {}) {
  const parsed = parseClipRegions(text);
  const wanted = (Array.isArray(sheets) ? sheets : []).map(normalizeSheet);
  const names = new Set();
  for (const sheet of wanted) {
    const key = sheet.texture.toLowerCase();
    if (names.has(key)) {
      throw new Error(`Лист ${sheet.texture} заказан дважды.`);
    }
    names.add(key);
  }
  const prefixes = (Array.isArray(reset) ? reset : []).map((prefix) => {
    const value = String(prefix || "")
      .trim()
      .toLowerCase();
    if (!/^astral_[a-z0-9_]{1,48}$/.test(value)) {
      throw new TypeError(
        `Приставка семейства для ptxclipregions.dat некорректна: ${prefix}`,
      );
    }
    return value;
  });

  const source = new Map(
    parsed.entries.map((entry) => [entry.name.toLowerCase(), entry]),
  );
  /* Тело таблицы: строки игры как есть, без снятых строк семейства. */
  const removed = [];
  const body = [];
  for (const entry of parsed.entries) {
    const key = entry.name.toLowerCase();
    if (!names.has(key) && prefixes.some((prefix) => key.startsWith(prefix))) {
      removed.push(entry.name);
      continue;
    }
    body.push({
      key,
      columns: entry.columns,
      rows: entry.rows,
      text: parsed.lines[entry.line],
    });
  }

  const added = [];
  const replaced = [];
  for (const sheet of wanted) {
    let line;
    if (sheet.copyFrom) {
      const sample = source.get(sheet.copyFrom.toLowerCase());
      if (!sample) {
        throw new Error(
          `В ptxclipregions.dat игры нет строки ${sheet.copyFrom}: сетку кадров для ${sheet.texture} взять неоткуда.`,
        );
      }
      sheet.columns = sample.columns;
      sheet.rows = sample.rows;
      line = copiedLine(sheet.texture, parsed.lines[sample.line]);
    } else if (sheet.line) {
      line = sheet.line;
    } else {
      line = sheetLine(sheet);
    }
    const key = sheet.texture.toLowerCase();
    const existing = body.find((item) => item.key === key);
    if (!existing) {
      body.push({ key, columns: sheet.columns, rows: sheet.rows, text: line });
      added.push(sheet.texture);
      continue;
    }
    if (existing.text === line) continue;
    existing.text = line;
    existing.columns = sheet.columns;
    existing.rows = sheet.rows;
    replaced.push(sheet.texture);
  }
  if (!added.length && !replaced.length && !removed.length) {
    return {
      text,
      changed: false,
      added,
      replaced,
      removed,
      entries: parsed.entries.length,
    };
  }
  const frames = body.reduce(
    (total, item) => total + item.columns * item.rows,
    0,
  );
  const lines = [
    String(body.length),
    String(frames),
    ...body.map((item) => item.text),
  ];
  const next = lines.join(parsed.eol) + (parsed.finalNewline ? parsed.eol : "");
  // Перечитываем то, что собрали: счётчики и строки обязаны сойтись.
  parseClipRegions(next, { own: true });
  return {
    text: next,
    changed: true,
    added,
    replaced,
    removed,
    entries: body.length,
  };
}
