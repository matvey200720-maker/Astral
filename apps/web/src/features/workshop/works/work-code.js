/*
 * Код работы мастерской — работа целиком одной строкой.
 *
 * Код несёт саму работу, а не ссылку на неё: ни аккаунта, ни сервера, ни
 * срока годности. Друг вставляет его на своём компьютере, и работа
 * открывается, даже если его Astral никогда не видел автора. Прежние коды
 * мини-карты, прицела и большой карты (`MMAP-…`, `SIGHT-…`, `WMAP-…`) были
 * ссылками в хранилище на машине автора — на чужом компьютере им нечего
 * было открывать.
 *
 * ЧТО ВНУТРИ
 *
 *   ASTRAL-<ВИД><версия>-<base64url( deflate( {"v":1,"n":имя,"d":данные} ) )>
 *
 * Вид в приставке читается глазами: человек видит, что ему прислали, ещё до
 * вставки, а окно — до разбора. Данные сжаты: код набора эффектов без сжатия
 * весил 2,5–4,8 тысячи символов и не влезал в одно сообщение Discord (2000),
 * сжатый — 600–900. Сжатие zlib, а не голый deflate: в хвосте у него
 * контрольная сумма, и оборванный при копировании код называется
 * повреждённым, а не открывается мусором.
 *
 * КОРОТКИЙ КОД (владелец 01.11.2026). Работа с картинками — десятки и сотни
 * тысяч символов, и сжатие не уложит их в сообщение Discord (2000). Для них
 * есть вторая форма — адрес записи на сервере:
 *
 *   ASTRAL-<10 знаков алфавита SHORT_CODE_ALPHABET>
 *
 * В отличие от кода работы у неё нет ни вида, ни дефиса после цифр, поэтому с
 * `ASTRAL-SKY1-…` она не путается. Прежним `MMAP-…` она не родня: те вели в
 * хранилище на машине автора, а эта — на общий сервер. Модуль только узнаёт её
 * в тексте; скачивает запись `work-code-share.js`, и скачанное идёт тем же
 * разбором, что вставленный текст: сервер доверенным не считается.
 *
 * Модуль лёгкий нарочно: он знает про строки и байты, но не про то, что за
 * ними лежит. Проверка данных — у тех, кто их открывает (`work-transfer.js`):
 * там свой разбор у каждого редактора, и тащить все их в окно ради
 * распознавания приставки незачем.
 */

/* Вид работы → слово в приставке. Слова — английские и короткие: код
   ходит между людьми с разными языками интерфейса. Таблица живёт в
   договоре каталога (`@modovik/publishing`, work.js): по ней же сервер
   принимает работу мастерской как мод каталога. */
import { WORK_CODE_KINDS } from "@modovik/publishing";

export { WORK_CODE_KINDS };

const CODE_VERSION = 1;
const KIND_BY_WORD = Object.freeze(
  Object.fromEntries(
    Object.entries(WORK_CODE_KINDS).map(([kind, word]) => [word, kind]),
  ),
);

/* Прежний код набора эффектов: весь набор, JSON без сжатия. Открывается и
   теперь — такие коды уже разошлись по чатам. */
const LEGACY_EFFECTS = /ASTRAL-FX1-/i;
/* Прежние коды студии — ссылки на запись в хранилище автора. */
const LEGACY_CLOUD =
  /(?<![A-Za-z0-9-])(MMAP|SIGHT|WMAP)-([A-Za-z0-9]{10})(?![A-Za-z0-9_-])/i;
const LEGACY_CLOUD_KIND = Object.freeze({
  MMAP: "minimap",
  SIGHT: "reticle",
  WMAP: "world-map",
});

/* Короткий код: 32 знака без O/0/I/1 — их путают, когда код диктуют или
   перепечатывают. Длина и алфавит — те же, что в
   `backend/internal/platform/workshare`: 10 знаков — 50 бит, перебором по
   лимиту запросов не набрать. */
export const SHORT_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const SHORT_CODE_LENGTH = 10;
const SHORT = new RegExp(
  `(?<![A-Za-z0-9_-])ASTRAL-([${SHORT_CODE_ALPHABET}]{${SHORT_CODE_LENGTH}})(?![A-Za-z0-9_-])`,
  "i",
);

const CURRENT = new RegExp(
  `ASTRAL-(${Object.values(WORK_CODE_KINDS).join("|")})(\\d{1,3})-`,
  "i",
);

/* Разумные потолки: самый тяжёлый код — небо всех пятнадцати погод, около
   тридцати тысяч символов. Потолки на порядки выше и нужны против мусора,
   а не против работ: вставленный по ошибке мегабайт не должен вешать окно. */
const MAX_INPUT = 2_000_000;
const MAX_DATA_BYTES = 4 * 1024 * 1024;

/**
 * Ошибка разбора кода. `reason` — для окна, которое скажет её своими словами
 * на языке интерфейса: `unknown` (это не код Astral), `damaged` (код
 * оборван или испорчен), `newer` (код из более новой версии), `too-large`.
 */
export class WorkCodeError extends Error {
  constructor(reason, message = reason) {
    super(message);
    this.name = "WorkCodeError";
    this.reason = reason;
  }
}

export const workCodePrefix = (kind) => {
  const word = WORK_CODE_KINDS[kind];
  if (!word) throw new Error(`Неизвестный вид кода работы: ${kind}`);
  return `ASTRAL-${word}${CODE_VERSION}-`;
};

/* Невидимые символы, которые мессенджеры вставляют в длинные строки:
   пробелы нулевой ширины, соединители, BOM и мягкий перенос. Собраны из
   кодов, а не вписаны буквами: в исходнике их не видно глазом. */
const INVISIBLE = new RegExp(
  `[${[0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x00ad]
    .map((code) => String.fromCharCode(code))
    .join("")}]`,
  "g",
);
const PAYLOAD = /^[A-Za-z0-9_-]+/;
/* Кусков у разбитого кода — по строке мессенджера на кусок; больше этого
   в одном сообщении кода не бывает. */
const MAX_PIECES = 64;

/*
 * Хвост кода после приставки — варианты от длинного к короткому.
 *
 * Код, который мессенджер разбил на строки, склеивается из идущих подряд
 * кусков из символов кода. Следом в сообщении бывает слово латиницей
 * («thanks») — оно тоже похоже на кусок кода, и по виду его не отличить.
 * Поэтому вариантов несколько: все куски, все без последнего, … один первый.
 * Какой верный, решает разбор: у сжатых данных контрольная сумма, и
 * сходится ровно один.
 */
function payloadCandidates(tail) {
  const pieces = [];
  for (const word of tail.trimStart().split(/\s+/)) {
    if (pieces.length >= MAX_PIECES) break;
    const piece = word.match(PAYLOAD)?.[0] || "";
    if (!piece) break;
    pieces.push(piece);
    /* После символов кода в слове идёт что-то ещё — точка, кавычка, буква
       кириллицы: дальше уже текст сообщения. */
    if (piece.length !== word.length) break;
  }
  const candidates = [];
  for (let count = pieces.length; count > 0; count -= 1)
    candidates.push(pieces.slice(0, count).join(""));
  return candidates;
}

/**
 * Код в тексте — без разбора данных.
 *
 * Текст бывает любым: сообщение целиком («держи: ASTRAL-SKY1-…»), код в
 * кавычках, код с переносами. Возвращает `{ kind, format, code, version }`
 * или `null`, если кода Astral в тексте нет. `format`: `v1` — нынешний код,
 * `fx1` — прежний код набора эффектов, `cloud` — прежняя ссылка студии,
 * `short` — адрес записи на сервере (вид станет известен, когда запись скачают,
 * и `kind` у такой находки пустой; `id` — десять знаков адреса).
 */
export function findWorkCode(input) {
  const text = String(input ?? "")
    .slice(0, MAX_INPUT)
    .replace(INVISIBLE, "");
  const current = CURRENT.exec(text);
  if (current) {
    const kind = KIND_BY_WORD[current[1].toUpperCase()];
    const version = Number(current[2]);
    const tail = text.slice(current.index + current[0].length);
    const [payload = ""] = payloadCandidates(tail);
    return {
      kind,
      format: "v1",
      version,
      code: `ASTRAL-${current[1].toUpperCase()}${current[2]}-${payload}`,
    };
  }
  const legacy = LEGACY_EFFECTS.exec(text);
  if (legacy) {
    const tail = text.slice(legacy.index + legacy[0].length);
    const [payload = ""] = payloadCandidates(tail);
    return {
      kind: "effects",
      format: "fx1",
      version: 1,
      code: `ASTRAL-FX1-${payload}`,
    };
  }
  const cloud = LEGACY_CLOUD.exec(text);
  if (cloud) {
    const word = cloud[1].toUpperCase();
    return {
      kind: LEGACY_CLOUD_KIND[word],
      format: "cloud",
      version: 0,
      code: `${word}-${cloud[2].toUpperCase()}`,
    };
  }
  const short = SHORT.exec(text);
  if (short) {
    const id = short[1].toUpperCase();
    return { kind: "", format: "short", version: 0, id, code: `ASTRAL-${id}` };
  }
  return null;
}

function toBase64Url(bytes) {
  let binary = "";
  /* Кусками: `fromCharCode` с сотней тысяч аргументов роняет стек. */
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(index, index + 0x8000),
    );
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(text) {
  if (text.length % 4 === 1) throw new WorkCodeError("damaged");
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  let binary;
  try {
    binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  } catch {
    throw new WorkCodeError("damaged");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/* Байты через поток сжатия или распаковки — с потолком на выход, чтобы
   маленький код не развернулся в гигабайт. */
async function throughStream(bytes, transform, limit = Infinity) {
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const reader = source.pipeThrough(transform).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new WorkCodeError("too-large");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/**
 * Код работы вида `kind`.
 *
 * `data` — то, что откроет редактор этого вида (см. `work-transfer.js`),
 * `name` — имя, под которым работа ляжет у получателя.
 */
export async function encodeWorkCode(kind, { name = "", data }) {
  const prefix = workCodePrefix(kind);
  const json = JSON.stringify({
    v: CODE_VERSION,
    n: String(name || "").slice(0, 120),
    d: data,
  });
  const packed = await throughStream(
    new TextEncoder().encode(json),
    new CompressionStream("deflate"),
  );
  return `${prefix}${toBase64Url(packed)}`;
}

/* Контрольная сумма zlib (Adler-32) распакованных байтов. */
function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let index = 0; index < bytes.length; index += 5552) {
    const end = Math.min(index + 5552, bytes.length);
    for (let cursor = index; cursor < end; cursor += 1) {
      a += bytes[cursor];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

async function unpack(payload) {
  const packed = fromBase64Url(payload);
  let bytes;
  try {
    bytes = await throughStream(
      packed,
      new DecompressionStream("deflate"),
      MAX_DATA_BYTES,
    );
  } catch (error) {
    if (error instanceof WorkCodeError) throw error;
    throw new WorkCodeError("damaged");
  }
  /*
   * Поток zlib кончается суммой Adler-32 распакованного — последние четыре
   * байта кода. Хвост после неё (лишний символ при копировании) браузер
   * отвергает сам, а распаковщик Node молча отбрасывает: сверяем сумму
   * здесь, чтобы «повреждён» значило одно и то же везде.
   */
  const tail = packed.length - 4;
  const stored =
    tail >= 2
      ? ((packed[tail] << 24) |
          (packed[tail + 1] << 16) |
          (packed[tail + 2] << 8) |
          packed[tail + 3]) >>>
        0
      : -1;
  if (stored !== adler32(bytes)) throw new WorkCodeError("damaged");
  let envelope;
  try {
    envelope = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new WorkCodeError("damaged");
  }
  if (!envelope || typeof envelope !== "object" || !("d" in envelope))
    throw new WorkCodeError("damaged");
  if (Number(envelope.v) > CODE_VERSION) throw new WorkCodeError("newer");
  return {
    name: typeof envelope.n === "string" ? envelope.n.slice(0, 120) : "",
    data: envelope.d,
  };
}

function unpackLegacyEffects(payload) {
  try {
    const bytes = fromBase64Url(payload);
    if (bytes.length > MAX_DATA_BYTES) throw new WorkCodeError("too-large");
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof WorkCodeError) throw error;
    throw new WorkCodeError("damaged");
  }
}

/**
 * Разбор кода: `{ kind, format, code, name, data }`.
 *
 * Прежняя ссылка студии (`format: "cloud"`) и короткий код (`format: "short"`)
 * данных не несут — их достаёт тот, кто открывает (`work-transfer.js`), и он
 * же говорит, если достать не из чего.
 */
export async function decodeWorkCode(input) {
  const found = findWorkCode(input);
  if (!found) throw new WorkCodeError("unknown");
  if (found.format === "cloud" || found.format === "short")
    return { ...found, name: "", data: null };
  if (found.version > CODE_VERSION) throw new WorkCodeError("newer");

  const text = String(input ?? "")
    .slice(0, MAX_INPUT)
    .replace(INVISIBLE, "");
  const marker = found.format === "fx1" ? LEGACY_EFFECTS : CURRENT;
  const match = marker.exec(text);
  const candidates = payloadCandidates(
    text.slice(match.index + match[0].length),
  );
  if (!candidates.length) throw new WorkCodeError("damaged");

  let failure = new WorkCodeError("damaged");
  for (const payload of candidates) {
    try {
      if (found.format === "fx1") {
        const data = unpackLegacyEffects(payload);
        return {
          ...found,
          code: `ASTRAL-FX1-${payload}`,
          name: typeof data?.name === "string" ? data.name.slice(0, 120) : "",
          data,
        };
      }
      const { name, data } = await unpack(payload);
      return {
        ...found,
        code: `${workCodePrefix(found.kind)}${payload}`,
        name,
        data,
      };
    } catch (error) {
      /* «Новее» и «слишком большой» — ответ окончательный; «повреждён» —
         повод попробовать второй вариант хвоста. */
      if (error instanceof WorkCodeError && error.reason !== "damaged")
        throw error;
      failure = error instanceof WorkCodeError ? error : failure;
    }
  }
  throw failure;
}
