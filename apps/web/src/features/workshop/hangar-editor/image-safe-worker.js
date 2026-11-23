const AS_IS_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];
const PROBE = { side: 512, opaqueFrom: 250 };

const failureText = (failure) => String((failure && failure.message) || failure);

const openBitmap = (blob) => createImageBitmap(blob, { imageOrientation: "from-image" });

// Размеры, вписанные в сторону side без увеличения; каждая не меньше 1.
// Если side не число, остаётся NaN: проверок нет.
const within = (dims, side) => {
  const k = Math.min(1, side / Math.max(...dims));
  return dims.map((n) => Math.max(1, Math.round(n * k)));
};

// Холст нужного размера с картинкой; prepare настраивает контекст до рисования.
function drawBitmap(bitmap, [width, height], contextOptions, prepare) {
  const canvas = new OffscreenCanvas(width, height);
  const context = contextOptions ? canvas.getContext("2d", contextOptions) : canvas.getContext("2d");
  prepare?.(context);
  context.drawImage(bitmap, 0, 0, width, height);
  return { canvas, context };
}

const readBack = (context, [width, height]) => context.getImageData(0, 0, width, height).data;

// Прозрачность смотрим по уменьшенной пробе, а не по всей картинке.
function hasTranslucency(bitmap, dims) {
  const probeDims = within(dims, PROBE.side);
  const { context } = drawBitmap(bitmap, probeDims, { willReadFrequently: true });
  const data = readBack(context, probeDims);
  for (let at = data.length - 1; at > 0; at -= 4) {
    if (data[at] < PROBE.opaqueFrom) return true;
  }
  return false;
}

function finish(bitmap, out) {
  bitmap.close();
  return { out, transfer: [] };
}

async function makeSafeCopy({ blob, extension, limits }) {
  const bitmap = await openBitmap(blob);
  const dims = [bitmap.width, bitmap.height];
  if (dims.some((n) => !n)) return finish(bitmap, { empty: true });

  // годится как есть, если выполнены все правила; считаются по порядку и лениво
  const asIsRules = [
    () => Math.max(...dims) <= limits.side,
    () => AS_IS_EXTENSIONS.includes(extension),
    () => (Number(blob.size) || 0) <= limits.bytes,
  ];
  if (asIsRules.every((rule) => rule())) return finish(bitmap, { keep: true, width: dims[0], height: dims[1] });

  const size = within(dims, limits.side);
  const { canvas } = drawBitmap(bitmap, size, undefined, (context) => {
    context.imageSmoothingQuality = "high";
  });
  const translucent = hasTranslucency(bitmap, size);
  bitmap.close();

  const attempts = [
    [translucent ? "image/png" : "image/jpeg", 0.92],
    ["image/webp", 0.9],
  ];
  for (const [type, quality] of attempts) {
    const encoded = await canvas.convertToBlob({ type, quality });
    if (encoded && !(encoded.size > limits.bytes)) {
      return { out: { blob: encoded, type, width: size[0], height: size[1], from: dims }, transfer: [] };
    }
  }
  return { out: { tooLarge: true }, transfer: [] };
}

async function readPixels({ blob, side }) {
  const bitmap = await openBitmap(blob);
  const size = within([bitmap.width, bitmap.height], side);
  const { context } = drawBitmap(bitmap, size, { willReadFrequently: true });
  bitmap.close();
  const rgba = readBack(context, size);
  return { out: { rgba, width: size[0], height: size[1] }, transfer: [rgba.buffer] };
}

const JOBS = new Map([["pixels", readPixels]]);

self.onmessage = async (event) => {
  const request = event.data || {};
  try {
    if (typeof OffscreenCanvas !== "function" || typeof createImageBitmap !== "function") {
      throw new Error("offscreen");
    }
    const { out, transfer } = await (JOBS.get(request.op) ?? makeSafeCopy)(request);
    self.postMessage({ id: request.id, out }, transfer);
  } catch (failure) {
    self.postMessage({ id: request.id, error: failureText(failure) });
  }
};
