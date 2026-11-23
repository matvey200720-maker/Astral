// Звуковые контейнеры .awc (GTA V): оглавление банка, сборка банка из выбранных потоков,
// звук потока (PCM и IMA ADPCM), WAV и пики для формы волны. Импортов нет, побочных действий нет.
// Банки игры зашифрованы: такой банк модуль не расшифровывает, а сообщает «encrypted: true».

export const AWC_MAGIC = 0x54414441; // байты «ADAT»
export const AWC_MAGIC_BIG = 0x41444154; // «ADAT» в обратном порядке байтов (консольный банк)

export const AWC_CHUNK = Object.freeze({
  data: 0x55,
  format: 0xfa,
  animation: 0x5c,
  peak: 0x36,
  mid: 0x68,
  gesture: 0x2b,
  granulargrains: 0x5a,
  granularloops: 0xd9,
  markers: 0xbd,
  streamformat: 0x48,
  seektable: 0xa3,
});

export const AWC_CODEC = Object.freeze({ pcm: 0, adpcm: 4 });

const MAX_STREAMS = 4096;
const MAX_BANK_BYTES = 0x0fffffff;
const HEADER_BYTES = 16;
const CHUNK_RECORD_BYTES = 8;
const ID_MASK = 0x1fffffff;
const FLAG_INDEX = 1;
const FLAG_ENCRYPTED = 2;
const FLAG_MULTICHANNEL = 4;
const FLAG_MULTICHANNEL_ENCRYPTED = 8;
const ADPCM_BLOCK = 2048;
const ADPCM_BLOCK_HEADER = 4;
const HOST_IS_LITTLE_ENDIAN = new Uint8Array(Uint16Array.of(1).buffer)[0] === 1;

// ---------------------------------------------------------------- ошибки и входные байты

function awcError(code, message) {
  return Object.assign(new Error(message), { code });
}

// Uint8Array берётся как есть, ArrayBuffer оборачивается, остальное читается через buffer/byteOffset/byteLength
// (у обычного массива, строки и числа их нет — это пустые байты; null и undefined дают TypeError платформы).
function bytesOf(input) {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (input instanceof Uint8Array) return input;
  const storage = input.buffer;
  return new Uint8Array(storage, input.byteOffset, input.byteLength);
}

// ---------------------------------------------------------------- курсоры по байтам

// Тип поля -> часть имени метода DataView и размер в байтах. Все числа little-endian.
const FIELD_TYPES = {
  u8: ["Uint8", 1],
  u16: ["Uint16", 2],
  i16: ["Int16", 2],
  u32: ["Uint32", 4],
  i32: ["Int32", 4],
};

// Схемы записей идут подряд; число вместо типа — пропуск стольких байт.
const HEADER_SCHEMA = [
  ["magic", "u32"],
  ["version", "u16"],
  ["flags", "u16"],
  ["streamCount", "i32"],
  ["dataStart", "i32"],
];
// Формат читается по первым 20 байтам от начала чанка, даже если чанк короче.
const FORMAT_SCHEMA = [
  ["samples", "u32"],
  ["loopPoint", "i32"],
  ["sampleRate", "u16"],
  ["headroom", "i16"],
  [null, 7],
  ["codec", "u8"],
];

class Cursor {
  constructor(bytes) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.position = 0;
  }

  seek(position) {
    this.position = position;
    return this;
  }

  take(type) {
    const [kind, size] = FIELD_TYPES[type];
    const value = this.view[`get${kind}`](this.position, true);
    this.position += size;
    return value;
  }

  fields(schema) {
    const record = {};
    for (const [name, type] of schema) {
      if (name === null) this.position += type;
      else record[name] = this.take(type);
    }
    return record;
  }
}

class Sink {
  constructor(size) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
    this.position = 0;
  }

  put(type, value) {
    const [kind, size] = FIELD_TYPES[type];
    this.view[`set${kind}`](this.position, value, true);
    this.position += size;
    return this;
  }

  fields(schema, record) {
    for (const [name, type] of schema) {
      if (name === null) this.position += type;
      else this.put(type, record[name]);
    }
    return this;
  }

  ascii(text) {
    for (let i = 0; i < text.length; i += 1) this.put("u8", text.charCodeAt(i));
    return this;
  }
}

// Часть слова: width бит, начиная с бита shift (shift + width не больше 32).
const bitsOf = (word, shift, width) => (word >>> shift) & (2 ** width - 1);

// Запись чанка — два слова: смещение (28 бит) и младшие 4 бита размера; размер >> 4 (24 бита) и тип.
function unpackChunk(low, high) {
  return {
    type: bitsOf(high, 24, 8),
    size: bitsOf(high, 0, 24) * 16 + bitsOf(low, 28, 4),
    offset: bitsOf(low, 0, 28),
  };
}

function packChunk({ type, size, offset }) {
  return [offset + bitsOf(size, 0, 4) * 2 ** 28, bitsOf(size, 4, 24) + type * 2 ** 24];
}

// ---------------------------------------------------------------- порядок и выравнивание чанков при сборке

// Тип чанка -> [порядок в данных, выравнивание начала данных].
const CHUNK_LAYOUT = new Map(
  Object.entries({
    format: [0, 0],
    peak: [0, 0],
    streamformat: [0, 0],
    seektable: [1, 0],
    markers: [2, 4],
    granulargrains: [2, 4],
    granularloops: [2, 4],
    animation: [2, 0],
    gesture: [2, 0],
    data: [3, 16],
    mid: [3, 16],
  }).map(([name, layout]) => [AWC_CHUNK[name], layout]),
);
const UNKNOWN_LAYOUT = [0, 0];

export function awcSortOrder(type) {
  return (CHUNK_LAYOUT.get(type) ?? UNKNOWN_LAYOUT)[0];
}

export function awcAlign(type) {
  return (CHUNK_LAYOUT.get(type) ?? UNKNOWN_LAYOUT)[1];
}

// ---------------------------------------------------------------- имена потоков

export function awcStreamName(id) {
  return `0X${(id >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

export function awcStreamId(value) {
  if (typeof value !== "number") {
    const written = /^0x([0-9a-f]+)$/i.exec(String(value || "").trim());
    return written ? parseInt(written[1], 16) & ID_MASK : null;
  }
  return value & ID_MASK;
}

// ---------------------------------------------------------------- оглавление

function parseBank(bytes) {
  if (bytes.length < HEADER_BYTES) throw awcError("AWC_SHORT", "Файл короче заголовка AWC.");
  const cursor = new Cursor(bytes);
  const { magic, version, flags, streamCount } = cursor.fields(HEADER_SCHEMA);
  if (magic === AWC_MAGIC_BIG) throw awcError("AWC_BIG_ENDIAN", "Банк консольной версии игры (big-endian).");
  if (magic !== AWC_MAGIC) return { encrypted: true, version: 0, flags: 0, streams: [] };
  if (streamCount < 0 || streamCount > MAX_STREAMS) {
    throw awcError("AWC_BROKEN", `Невозможное число потоков: ${streamCount}.`);
  }

  // Таблицы читаются подряд без проверки границ: короткий файл даёт RangeError платформы.
  if (flags & FLAG_INDEX) cursor.seek(HEADER_BYTES + 2 * streamCount);
  const declared = [];
  const streams = Array.from({ length: streamCount }, () => {
    const word = cursor.take("u32");
    declared.push(bitsOf(word, 29, 3));
    return { id: bitsOf(word, 0, 29), chunks: [] };
  });

  streams.forEach((stream, n) => {
    while (stream.chunks.length < declared[n]) {
      if (cursor.position + CHUNK_RECORD_BYTES > bytes.length) {
        throw awcError("AWC_BROKEN", "Оглавление чанков обрывается.");
      }
      stream.chunks.push(unpackChunk(cursor.take("u32"), cursor.take("u32")));
    }
  });

  for (const stream of streams) {
    const beyond = stream.chunks.find((chunk) => chunk.offset + chunk.size > bytes.length);
    if (beyond) throw awcError("AWC_BROKEN", `Чанк потока ${awcStreamName(stream.id)} выходит за конец файла.`);
    const described = stream.chunks.find((chunk) => chunk.type === AWC_CHUNK.format);
    if (described) stream.format = cursor.seek(described.offset).fields(FORMAT_SCHEMA);
  }

  const multiChannel = (flags & FLAG_MULTICHANNEL) !== 0;
  return { encrypted: false, version, flags, multiChannel, streams };
}

export function readAwc(input) {
  return parseBank(bytesOf(input));
}

// Банк игры и банки с флагами шифрования/многоканальности для сборки и звука не годятся.
const REFUSALS = [
  [(info) => info.encrypted, "AWC_ENCRYPTED", "Банк зашифрован — это штатный банк игры."],
  [(info) => info.flags & (FLAG_ENCRYPTED | FLAG_MULTICHANNEL_ENCRYPTED), "AWC_ENCRYPTED", "Данные потоков банка зашифрованы."],
  [(info) => info.flags & FLAG_MULTICHANNEL, "AWC_MULTICHANNEL", "Многоканальный банк (музыка, радио) — не звук ствола."],
];

function assertPlainBank(info) {
  const refusal = REFUSALS.find(([applies]) => applies(info));
  if (refusal) throw awcError(refusal[1], refusal[2]);
}

// ---------------------------------------------------------------- сборка банка из выбранных потоков

// Потоки по идентификаторам из ids в порядке исходного банка; недостающие названы в порядке запроса.
function selectStreams(info, ids) {
  const wanted = new Set([...ids].map(awcStreamId));
  const present = new Set(info.streams.map((stream) => stream.id));
  const absent = [...wanted].filter((id) => !present.has(id));
  if (absent.length > 0) {
    throw awcError("AWC_STREAM_MISSING", `В банке нет потоков ${absent.map(awcStreamName).join(", ")}.`);
  }
  return info.streams.filter((stream) => wanted.has(stream.id));
}

// Раскладка: таблицы, затем данные чанков устойчиво по порядку типа; каждый чанк выравнивается от начала файла.
function planLayout(picked, hasIndex) {
  const chunks = picked.flatMap((stream) => stream.chunks);
  const tableBytes =
    HEADER_BYTES + (hasIndex ? 2 : 0) * picked.length + 4 * picked.length + CHUNK_RECORD_BYTES * chunks.length;
  const offsets = new Map();
  let end = tableBytes;
  const dataOrder = chunks.sort((left, right) => awcSortOrder(left.type) - awcSortOrder(right.type));
  for (const chunk of dataOrder) {
    const align = awcAlign(chunk.type);
    if (align > 0) end += (align - (end % align)) % align;
    offsets.set(chunk, end);
    end += chunk.size;
  }
  return { tableBytes, offsets, end };
}

export function pickAwcStreams(input, ids) {
  const bytes = bytesOf(input);
  const info = parseBank(bytes);
  assertPlainBank(info);
  const picked = selectStreams(info, ids);
  const hasIndex = (info.flags & FLAG_INDEX) !== 0;
  const plan = planLayout(picked, hasIndex);
  if (plan.end > MAX_BANK_BYTES) throw awcError("AWC_TOO_BIG", "Банк из выбранных потоков больше 256 МБ.");

  const sink = new Sink(plan.end).fields(HEADER_SCHEMA, {
    magic: AWC_MAGIC,
    version: info.version,
    flags: info.flags,
    streamCount: picked.length,
    dataStart: plan.tableBytes,
  });
  if (hasIndex) {
    picked.reduce((first, stream) => {
      sink.put("u16", first);
      return first + stream.chunks.length;
    }, 0);
  }
  for (const stream of picked) sink.put("u32", (stream.chunks.length << 29) | stream.id);
  for (const stream of picked) {
    for (const chunk of stream.chunks) {
      const [low, high] = packChunk({ ...chunk, offset: plan.offsets.get(chunk) });
      sink.put("u32", low).put("u32", high);
    }
  }
  for (const [chunk, offset] of plan.offsets) {
    sink.bytes.set(bytes.subarray(chunk.offset, chunk.offset + chunk.size), offset);
  }
  return sink.bytes;
}

// ---------------------------------------------------------------- звук потока

const STEP_TABLE = Int16Array.of(
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97,
  107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796,
  876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428,
  4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350,
  22385, 24623, 27086, 29794, 32767,
);
const INDEX_ADJUST = Int8Array.of(-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8);
const LAST_STEP = STEP_TABLE.length - 1;

// IMA ADPCM, моно: блоки по 2048 байт (заголовок 4 байта + 2044 байта кодов, младший полубайт первым).
// Результат всегда ровно samples отсчётов: недостающий хвост нулевой, лишнее отброшено.
function decodeAdpcm(data, samples) {
  let filled = 0;
  const out = new Int16Array(samples);
  for (let start = 0; filled < samples && start + ADPCM_BLOCK_HEADER <= data.length; start += ADPCM_BLOCK) {
    let stepIndex = Math.min(data[start], LAST_STEP);
    let level = ((data[start + 2] | (data[start + 3] << 8)) << 16) >> 16;
    const codesAt = start + ADPCM_BLOCK_HEADER;
    const available = Math.min(ADPCM_BLOCK, data.length - start) - ADPCM_BLOCK_HEADER;
    const nibbles = Math.min(samples - filled, available * 2);
    for (let n = 0; n < nibbles; n += 1) {
      const code = (data[codesAt + (n >> 1)] >> ((n & 1) * 4)) & 15;
      let delta = (((code & 7) * 2 + 1) * STEP_TABLE[stepIndex]) >> 3;
      if (code & 8) delta = -delta;
      level = Math.max(-32768, Math.min(32767, level + delta));
      stepIndex = Math.max(0, Math.min(LAST_STEP, stepIndex + INDEX_ADJUST[code]));
      out[filled + n] = level;
    }
    filled += nibbles;
  }
  return out;
}

function readPcm16(data, count) {
  const out = new Int16Array(count);
  if (HOST_IS_LITTLE_ENDIAN) {
    new Uint8Array(out.buffer).set(data.subarray(0, count * 2));
    return out;
  }
  const cursor = new Cursor(data);
  return out.map(() => cursor.take("i16"));
}

export function awcStreamPcm(input, id) {
  const bytes = bytesOf(input);
  const info = parseBank(bytes);
  assertPlainBank(info);

  const wanted = awcStreamId(id);
  const stream = info.streams.find((candidate) => candidate.id === wanted);
  if (!stream) throw awcError("AWC_STREAM_MISSING", `В банке нет потока ${awcStreamName(wanted)}.`);

  const { format } = stream;
  const dataChunk = stream.chunks.find((chunk) => chunk.type === AWC_CHUNK.data);
  if (!format || !dataChunk) throw awcError("AWC_NO_AUDIO", "У потока нет звука (только метки).");

  const data = bytes.subarray(dataChunk.offset, dataChunk.offset + dataChunk.size);
  const decoders = {
    [AWC_CODEC.adpcm]: () => decodeAdpcm(data, format.samples),
    [AWC_CODEC.pcm]: () => readPcm16(data, Math.min(format.samples, data.length >> 1)),
  };
  const decode = decoders[format.codec];
  if (!decode) throw awcError("AWC_CODEC", `Неизвестный кодек потока: ${format.codec}.`);
  return { sampleRate: format.sampleRate, pcm: decode() };
}

// ---------------------------------------------------------------- WAV и пики

export function wavBytes({ sampleRate, pcm }) {
  const count = pcm.length;
  const sink = new Sink(44 + 2 * count)
    .ascii("RIFF")
    .put("u32", 36 + 2 * count)
    .ascii("WAVE")
    .ascii("fmt ")
    .put("u32", 16)
    .put("u16", 1)
    .put("u16", 1)
    .put("u32", sampleRate)
    .put("u32", sampleRate * 2)
    .put("u16", 2)
    .put("u16", 16)
    .ascii("data")
    .put("u32", 2 * count);
  if (HOST_IS_LITTLE_ENDIAN) {
    // Приведение элементов такое же, как у setInt16: дробная часть отбрасывается, остальное по модулю 65536.
    new Int16Array(sink.bytes.buffer, 44, count).set(pcm);
  } else {
    for (let i = 0; i < count; i += 1) sink.put("i16", pcm[i]);
  }
  return sink.bytes;
}

// Наибольший модуль отсчётов окна [from, to); «не числа» пик не меняют.
function loudest(samples, from, to) {
  let top = 0;
  let i = from;
  while (i < to) {
    const magnitude = Math.abs(samples[i++]);
    top = magnitude > top ? magnitude : top;
  }
  return top;
}

export function pcmPeaks(pcm, buckets = 240) {
  const peaks = new Float32Array(buckets);
  const length = pcm.length;
  if (!length) return peaks;
  const perBucket = length / buckets;
  const edge = (n) => Math.floor(n * perBucket);
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const first = edge(bucket);
    const last = Math.min(length, Math.max(first + 1, edge(bucket + 1)));
    peaks[bucket] = loudest(pcm, first, last) / 32768;
  }
  return peaks;
}
