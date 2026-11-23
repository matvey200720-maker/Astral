// Обёртка над общей частью чтения ресурсов RSC7: подставляет родной распаковщик.
import { inflateRawBounded } from "@modovik/native-rs";
import { openResourceWith } from "./resource-core.js";

export {
  GRAPHICS_BASE,
  MAX_RESOURCE_BYTES,
  RSC7_HEADER_BYTES,
  RSC7_MAGIC,
  SYSTEM_BASE,
  YPT_VERSION_LEGACY,
  isResource,
  pageFlagSize,
  pointerAt,
  readCString,
  readPointerList,
  readResourceHeader,
  resourceFromData,
  resourceVersion,
} from "./resource-core.js";

// Байты не копируются: Buffer смотрит на ту же память, длина берётся в байтах.
export function inflateRawNode(bytes, size = null) {
  const { buffer, byteOffset, byteLength } = bytes;
  return inflateRawBounded(Buffer.from(buffer, byteOffset, byteLength), size);
}

export function openResource(input) {
  return openResourceWith(input, inflateRawNode);
}
