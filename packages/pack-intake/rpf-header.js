export const RPF7_MAGIC = 1380992567;

const HEADER_LENGTH = 16;
const ENCRYPTION_NAMES = new Map([
  [0, "none"],
  [1313165391, "open"],
  [268435449, "aes"],
  [267386879, "ng"],
]);

const asBytes = (input) => (input instanceof Uint8Array ? input : new Uint8Array(input || 0));

export const readRpfHeader = (input) => {
  const bytes = asBytes(input);
  if (bytes.length < HEADER_LENGTH) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, HEADER_LENGTH);
  const field = (at) => view.getUint32(at, true);
  const [magic, entryCount, namesLength, encryptionCode] = [0, 4, 8, 12].map(field);
  if (magic !== RPF7_MAGIC) return null;
  return {
    entryCount,
    namesLength,
    encryption: ENCRYPTION_NAMES.get(encryptionCode) ?? "unknown",
    encryptionCode,
  };
};
