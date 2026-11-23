/*
 * Заголовок звукового объекта dat54: громкость, тон, дальность, категория.
 *
 * У каждого звука (лист, мультитрек, случайный выбор…) после байта типа
 * лежат u32 флагов и поля, чьи биты в флагах выставлены, — строго по
 * порядку битов и каждое своего размера. Сразу за заголовком начинаются
 * данные своего типа: у листа — банк и дорожка, у мультитрека — число детей
 * и их имена.
 *
 * Звук без полей игра пишет с флагами 0. Флагов 0xAAAAAAAA и вообще байта
 * 0xAA во флагах у звуков игры нет — ни у одного из 125 900 звуков всей
 * очереди загрузки Legacy (сверено 27.09.2026; с флагами 0 — 37 517). Такие
 * четыре байта бывают только у объектов других видов — наборов звуков,
 * категорий, — где это тристейты по два бита, а не флаги полей. CodeWalker
 * читает байт 0xAA как «в этом байте полей нет», читатель по битам — как
 * четыре поля; как читает игра, по её файлам не узнать, и Astral таких
 * заголовков не пишет.
 *
 * Размеры полей — раскладка CodeWalker (`Dat54SoundHeader`), сверенная с
 * игрой 26.09.2026: у всех 45 347 листьев всех файлов звуков Legacy поле
 * банка стоит ровно там, где кончается заголовок по этой таблице, а у всех
 * 15 279 мультитреков там стоит число детей.
 *
 * Модуль только для главного процесса (подпуть `@modovik/sound-studio/sound-header`).
 */

/* [имя, размер в байтах, со знаком ли]. Бит поля — его место в списке. */
const FIELDS = Object.freeze([
  ["flags2", 4, false],
  ["maxHeaderSize", 2, false],
  /* Сотые доли децибела. */
  ["volume", 2, true],
  ["volumeVariance", 2, false],
  /* Центы: +1200 — октава вверх и вдвое быстрее. */
  ["pitch", 2, true],
  ["pitchVariance", 2, false],
  ["pan", 2, false],
  ["panVariance", 2, false],
  /* Миллисекунды. */
  ["preDelay", 2, true],
  ["preDelayVariance", 2, false],
  ["startOffset", 4, true],
  ["startOffsetVariance", 4, true],
  ["attackTime", 2, false],
  ["releaseTime", 2, false],
  ["dopplerFactor", 2, false],
  ["category", 4, false],
  ["lpfCutoff", 2, false],
  ["lpfCutoffVariance", 2, false],
  ["hpfCutoff", 2, false],
  ["hpfCutoffVariance", 2, false],
  ["volumeCurve", 4, false],
  /* Растяжение кривой затухания с расстоянием, сотые: 200 — вдвое дальше. */
  ["volumeCurveScale", 2, false],
  /* Метры, в которых звук не затухает вовсе. */
  ["volumeCurvePlateau", 1, false],
  ["speakerMask", 1, false],
  ["effectRoute", 1, false],
  ["preDelayVariable", 4, false],
  ["startOffsetVariable", 4, false],
  ["smallReverbSend", 2, false],
  ["mediumReverbSend", 2, false],
  ["largeReverbSend", 2, false],
  ["unknown30", 2, false],
  ["unknown31", 2, false],
]);

const BIT = new Map(FIELDS.map(([name], bit) => [name, bit]));
/* Байт флагов, который CodeWalker пропускает целиком (см. выше). */
const SKIPPED_BYTE = 0xaa;
const HEADER_START = 5;

const skippedBytes = (flags) =>
  [0, 8, 16, 24].filter((shift) => ((flags >>> shift) & 0xff) === SKIPPED_BYTE);

function readValue(bytes, at, size, signed) {
  if (size === 4) return signed ? bytes.readInt32LE(at) : bytes.readUInt32LE(at);
  if (size === 2) return signed ? bytes.readInt16LE(at) : bytes.readUInt16LE(at);
  return bytes[at];
}

function writeValue(bytes, at, size, signed, value) {
  if (size === 4) {
    if (signed) bytes.writeInt32LE(value, at);
    else bytes.writeUInt32LE(value >>> 0, at);
  } else if (size === 2) {
    if (signed) bytes.writeInt16LE(value, at);
    else bytes.writeUInt16LE(value, at);
  } else bytes[at] = value;
}

/**
 * Поля заголовка объекта. Байт флагов 0xAA читается, как его читает
 * CodeWalker, — полей этого байта нет (так записаны слои удара Astral до
 * 27.09.2026; у игры таких нет).
 *
 * @param {Buffer} bytes объект целиком, с байтом типа
 * @returns {{flags: number, end: number, fields: Map<string, {bit: number, at: number, size: number, value: number}>}}
 */
export function readSoundHeader(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < HEADER_START)
    throw new Error("Звуковой объект обрезан: нет заголовка.");
  const flags = bytes.readUInt32LE(1);
  const fields = new Map();
  const skipped = skippedBytes(flags);
  let at = HEADER_START;
  FIELDS.forEach(([name, size, signed], bit) => {
    if (!(flags & (1 << bit)) || skipped.includes(bit & ~7)) return;
    if (at + size > bytes.length)
      throw new Error("Заголовок звукового объекта выходит за объект.");
    fields.set(name, { bit, at, size, value: readValue(bytes, at, size, signed) });
    at += size;
  });
  return { flags, end: at, fields };
}

/** Значение поля заголовка или `null`, если поля нет. */
export const soundHeaderValue = (bytes, name) =>
  readSoundHeader(bytes).fields.get(name)?.value ?? null;

/**
 * Заголовок с новыми значениями полей. Поле, которого не было, добавляется
 * на своё место, `null` поле убирает; данные за заголовком сдвигаются
 * целиком, и `shift` говорит, на сколько байт — на столько же сдвигаются
 * смещения ссылок и полей банка объекта.
 *
 * @param {Buffer} bytes
 * @param {Record<string, number|null>} changes
 * @returns {{bytes: Buffer, shift: number}}
 */
export function writeSoundHeader(bytes, changes) {
  const header = readSoundHeader(bytes);
  const values = new Map(
    [...header.fields].map(([name, field]) => [name, field.value]),
  );
  for (const [name, value] of Object.entries(changes || {})) {
    if (!BIT.has(name)) throw new Error(`У звукового объекта нет поля ${name}.`);
    if (value === null || value === undefined) values.delete(name);
    else if (!Number.isFinite(value)) throw new Error(`Поле ${name}: не число.`);
    else values.set(name, Math.round(value));
  }
  let flags = 0;
  let size = 0;
  FIELDS.forEach(([name, fieldSize], bit) => {
    if (!values.has(name)) return;
    flags |= 1 << bit;
    size += fieldSize;
  });
  /* Набор полей, дающий байт флагов 0xAA, CodeWalker и читатель по битам
     прочли бы по-разному, и у игры таких заголовков нет — он не пишется. */
  if (skippedBytes(flags).length)
    throw new Error(
      `Поля ${[...values.keys()].join(", ")} не записать: байт флагов вышел бы 0xAA — у звуков игры такого нет.`,
    );
  const rest = bytes.subarray(header.end);
  const out = Buffer.alloc(HEADER_START + size + rest.length);
  out[0] = bytes[0];
  /* Без полей — флаги 0, как пишет игра. */
  out.writeUInt32LE(flags >>> 0, 1);
  let at = HEADER_START;
  FIELDS.forEach(([name, fieldSize, signed]) => {
    if (!values.has(name)) return;
    writeValue(out, at, fieldSize, signed, values.get(name));
    at += fieldSize;
  });
  rest.copy(out, at);
  return { bytes: out, shift: at - header.end };
}

/*
 * Флаги поведения — поле `flags2`: тристейты по два бита (10 — не задано,
 * 00 и 01 — явно выключено и включено). Rockstar пишет его не всякому звуку,
 * но у части видов оно есть всегда — сверено 27.09.2026 по всей очереди
 * загрузки Legacy, база и все пакеты дополнений: у 9 183 мультитреков из
 * 9 183, у 5 050 огибающих из 5 050, у каждого петлевого, двойной петли,
 * последовательного, потокового, наложенного, синтезатора, гранулярного,
 * кинетического, переключателя, условия, выражения и автоматики.
 *
 * 27.09.2026 слой удара Astral по телу ронял GTA при попадании: три дампа
 * подряд (дважды ERR_MEM_EMBEDDEDALLOC_FREE_2 и 0xC0000005) падали в одном
 * месте, на удалении детей звука, и во всех трёх на стеке лежали указатели
 * на удар по телу 0x17F64522 и его слой 0x601EC7DB — ровно по раскладке
 * файла пакета той сессии. У этого слоя было два отличия от звуков игры
 * сразу: флаги 0xAAAAAAAA вместо 0 (читатель по битам видит в них
 * шестнадцать полей и берёт число детей из чужих байт) и нет `flags2`.
 * Слой головы и подмена выстрела карабина — флаги честные, но без `flags2`
 * — в дампах не встречались. Какое из двух роняло игру, по дампам не
 * разделить; Astral не пишет ни того, ни другого (`soundHeaderProblem`).
 */
export const FLAGS2_TYPES = Object.freeze([1, 2, 3, 7, 8, 13, 17, 18, 19, 21, 22, 26, 27, 30]);

/** Флаги поведения мультитрека — как у 7 883 из 9 183 мультитреков игры. */
export const MULTITRACK_FLAGS2 = 0xaaa0aaaa;

/* Виды звуков dat54; у объектов с байтом типа 32 и выше (наборы звуков и
   подобное) заголовка звука нет. */
const LAST_SOUND_TYPE = 31;

/**
 * Чем звуковой объект не похож на звуки игры того же вида, или `null`.
 *
 * @param {Buffer} bytes объект целиком, с байтом типа
 * @returns {string|null}
 */
export function soundHeaderProblem(bytes) {
  const type = bytes[0];
  if (type < 1 || type > LAST_SOUND_TYPE) return null;
  const flags = bytes.readUInt32LE(1);
  if (skippedBytes(flags).length)
    return `флаги полей 0x${flags.toString(16).toUpperCase().padStart(8, "0")} с байтом 0xAA — у звуков игры таких нет, пустой заголовок игра пишет нулём`;
  if (!FLAGS2_TYPES.includes(type)) return null;
  return readSoundHeader(bytes).fields.has("flags2")
    ? null
    : `звук вида ${type} без флагов поведения (flags2) — у игры таких нет`;
}
