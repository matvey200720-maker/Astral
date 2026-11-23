// Лист эффекта главный процесс присылает байтами: строка base64 длиннее на
// треть. Строка идёт в src как есть, байты едут через blob-адрес, а если
// blob-адресов нет, собирается data-адрес. Содержимое не проверяется: битый
// лист поймает событие error у самой картинки.

const PNG_TYPE = "image/png";
const DATA_HEAD = "data:" + PNG_TYPE + ";base64,";
// Больше этого за один вызов в fromCharCode не отдаём: у вызова есть предел
// на число аргументов.
const STEP = 0x2000;
// Адрес отзывается по первому из этих событий.
const FINISH_EVENTS = ["load", "error"];

export function isPngBytes(png) {
  return png instanceof Uint8Array || png instanceof ArrayBuffer;
}

// Значение бывает строкой, байтами или чем угодно ещё. От вида зависит всё
// остальное, поэтому разбираем его один раз.
function kindOf(png) {
  if (typeof png === "string") return "text";
  return isPngBytes(png) ? "bytes" : "other";
}

// Размер берём как есть у любого объекта с byteLength, без приведения.
function bytesLength(png) {
  return png?.byteLength || 0;
}

// Строка байтов (коды 0…255) кусками, затем base64. Нужны числовая length и
// subarray; ArrayBuffer сначала оборачивается в Uint8Array.
function toDataAddress(png) {
  const view = png instanceof ArrayBuffer ? new Uint8Array(png) : png;
  let binary = "";
  for (let at = 0, count = view.length; at < count; at += STEP) {
    binary += String.fromCharCode.apply(null, view.subarray(at, at + STEP));
  }
  return DATA_HEAD + btoa(binary);
}

// Берёт у URL-API адрес для готового Blob и подписывается на конец загрузки.
// Отзыв идёт у того же API, что выдал адрес. Подписка остаётся и тогда, когда
// адрес пришёл пустым: отзыв пустого адреса безвреден.
function leaseAddress(urlApi, blob, image) {
  const address = urlApi.createObjectURL(blob);
  const release = () => urlApi.revokeObjectURL(address);
  for (const eventName of FINISH_EVENTS) {
    image.addEventListener(eventName, release, { once: true });
  }
  return address;
}

function showBinary(image, png) {
  const urlApi = globalThis.URL;
  if (typeof urlApi?.createObjectURL !== "function") {
    image.src = toDataAddress(png);
    return;
  }
  const blob = new Blob([png], { type: PNG_TYPE });
  image.src = leaseAddress(urlApi, blob, image) ?? toDataAddress(png);
}

// Что делать с каждым видом значения.
const BY_KIND = {
  text: {
    has: (png) => png !== "",
    size: (png) => png.length,
    show(image, png) {
      image.src = png;
    },
  },
  bytes: {
    has: (png) => png.byteLength > 0,
    size: bytesLength,
    show: showBinary,
  },
  other: {
    has: () => false,
    size: bytesLength,
    show: showBinary,
  },
};

export function hasPng(png) {
  return BY_KIND[kindOf(png)].has(png);
}

export function pngSize(png) {
  return BY_KIND[kindOf(png)].size(png);
}

export function setPngSource(image, png) {
  BY_KIND[kindOf(png)].show(image, png);
  return image;
}
