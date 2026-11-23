// Контейнер RSC7: заголовок в 16 байт, размеры блоков из флагов-страниц, ресурс с переводом указателей в смещения.

const CONSTANTS = {
  RSC7_MAGIC: 927159122,
  SYSTEM_BASE: 1342177280,
  GRAPHICS_BASE: 1610612736,
  RSC7_HEADER_BYTES: 16,
  YPT_VERSION_LEGACY: 68,
  MAX_RESOURCE_BYTES: 268435456,
};

export const { RSC7_MAGIC, SYSTEM_BASE, GRAPHICS_BASE, RSC7_HEADER_BYTES, YPT_VERSION_LEGACY, MAX_RESOURCE_BYTES } =
  CONSTANTS;

const demand = (ok, ErrorClass, message) => {
  if (!ok) throw new ErrorClass(message);
};

// Поля флагов-страниц: [сдвиг, маска, вес]; размер = (0x200 << (флаги & 0xf)) × сумма полей с весами.
const PAGE_FIELDS = [
  [27, 1, 1],
  [26, 1, 2],
  [25, 1, 4],
  [24, 1, 8],
  [17, 127, 16],
  [11, 63, 32],
  [7, 15, 64],
  [5, 3, 128],
  [4, 1, 256],
];

export function pageFlagSize(flags) {
  const unsigned = flags >>> 0;
  let pages = 0;
  for (const [shift, mask, weight] of PAGE_FIELDS) pages += ((unsigned >>> shift) & mask) * weight;
  return pages * (0x200 << (unsigned & 0xf));
}

const topNibble = (flags) => (flags >>> 28) & 0xf;

export const resourceVersion = (systemFlags, graphicsFlags) => topNibble(systemFlags) * 16 + topNibble(graphicsFlags);

const memoryOf = (view) => [view.buffer, view.byteOffset, view.byteLength];

// Вход как байты: Uint8Array и Buffer как есть, другие виды — память без копии, прочее — через Uint8Array.
const asBytes = (input) => {
  if (input instanceof Uint8Array) return input;
  return ArrayBuffer.isView(input) ? new Uint8Array(...memoryOf(input)) : new Uint8Array(input || 0);
};

const viewOf = (bytes) => new DataView(...memoryOf(bytes));

// Вид на тело после заголовка: обычный Uint8Array на тот же буфер, без копии.
const bodyOf = (bytes) =>
  new Uint8Array(bytes.buffer, bytes.byteOffset + RSC7_HEADER_BYTES, bytes.length - RSC7_HEADER_BYTES);

const declaredBytes = ({ systemSize, graphicsSize }) => systemSize + graphicsSize;

// Правила заголовка по порядку: [когда нарушено, какой отказ].
const HEADER_RULES = [
  [(bytes) => bytes.length < RSC7_HEADER_BYTES, () => new Error("Ресурс короче заголовка RSC7.")],
  [(bytes, view) => view.getUint32(0, true) !== RSC7_MAGIC, () => new Error("Файл не является ресурсом RSC7.")],
  [
    (bytes, view) => {
      const [system, graphics] = [8, 12].map((at) => pageFlagSize(view.getUint32(at, true)));
      return system + graphics > MAX_RESOURCE_BYTES;
    },
    () => new RangeError("Ресурс заявляет больше 256 МБ."),
  ],
];

export const isResource = (input) => {
  const bytes = asBytes(input);
  const view = viewOf(bytes);
  return !HEADER_RULES.slice(0, 2).some(([violated]) => violated(bytes, view));
};

export function readResourceHeader(input) {
  const bytes = asBytes(input);
  const view = viewOf(bytes);
  for (const [violated, refusal] of HEADER_RULES) if (violated(bytes, view)) throw refusal();
  const [systemFlags, graphicsFlags] = [8, 12].map((at) => view.getUint32(at, true));
  return {
    systemFlags,
    graphicsFlags,
    systemSize: pageFlagSize(systemFlags),
    graphicsSize: pageFlagSize(graphicsFlags),
    version: resourceVersion(systemFlags, graphicsFlags),
    declaredVersion: view.getUint32(4, true),
  };
}

// Виртуальный адрес → смещение в данных: область выбирается по базе, результат обязан лежать внутри.
const inside = (offset, length) => offset >= 0 && offset < length;

export const resourceFromData = (data, header) => {
  const { systemSize, graphicsSize, systemFlags, graphicsFlags, version } = header;
  const bytes = asBytes(data);
  const regions = [
    [GRAPHICS_BASE, systemSize],
    [SYSTEM_BASE, 0],
  ];
  const at = (pointer) => {
    const address = Number(pointer);
    const region = Number.isFinite(address) && address > 0 ? regions.find(([base]) => address >= base) : undefined;
    if (!region) return -1;
    const offset = region[1] + (address - region[0]);
    return inside(offset, bytes.length) ? offset : -1;
  };
  const sizes = { systemSize, graphicsSize, systemFlags, graphicsFlags, version };
  return { data: bytes, view: viewOf(bytes), at, ...sizes, root: SYSTEM_BASE };
};

export const openResourceWith = (input, inflateRaw) => {
  demand(typeof inflateRaw === "function", TypeError, "Для RSC7 нужен распаковщик deflate.");
  const raw = asBytes(input);
  const header = readResourceHeader(raw);
  const inflated = inflateRaw(bodyOf(raw), declaredBytes(header));
  demand(inflated?.length, Error, "Поток ресурса пуст или не распакован.");
  const resource = resourceFromData(inflated, header);
  return Object.assign(resource, { complete: inflated.length >= declaredBytes(header) });
};

export const openResourcePlain = (input) => {
  const raw = asBytes(input);
  const header = readResourceHeader(raw);
  const payload = raw.subarray(RSC7_HEADER_BYTES);
  demand(payload.length, Error, "Ресурс без данных.");
  const resource = resourceFromData(payload, header);
  return Object.assign(resource, { complete: payload.length >= declaredBytes(header) });
};

// Байты строки до нуля, не дальше границы данных и предела.
function* cStringBytes(data, start, limit) {
  const end = Math.min(data.length, start + limit);
  for (let i = start; i < end && data[i] !== 0; i++) yield data[i];
}

export const readCString = (resource, pointer, limit = 256) => {
  const start = resource.at(pointer);
  if (start === -1) return null;
  return Array.from(cStringBytes(resource.data, start, limit), (code) => String.fromCharCode(code)).join("");
};

export const readPointerList = (resource, offset) => {
  const view = resource.view;
  return {
    entries: view.getBigUint64(offset, true),
    count: view.getUint16(offset + 8, true),
    capacity: view.getUint16(offset + 10, true),
  };
};

export const pointerAt = (resource, offset) => {
  if (offset < 0 || offset + 8 > resource.data.length) return -1;
  return resource.at(resource.view.getBigUint64(offset, true));
};
