import fsp from "node:fs/promises";

const SEVEN_ZIP_SIGNATURE = [55, 122, 188, 175, 39, 28];
const RAR5_SIGNATURE = [82, 97, 114, 33, 26, 7, 1, 0];
const RAR4_SIGNATURE = [82, 97, 114, 33, 26, 7, 0];
const SEVEN_ZIP_AES_ID = [6, 241, 7, 1];
const ENCODED_HEADER_BYTE = 23;
const MAX_HEADER_PROBE = 65536;

const PROBE_LENGTH = 32;
const SEVEN_ZIP_START_HEADER = 32;
const VARINT_MAX_BYTES = 10;
const RAR5_ENCRYPTION_BLOCK = 4;
const RAR4_MAIN_HEADER = 0x73;
const RAR4_HEADER_PASSWORD_FLAG = 0x80;

const hasPrefix = (bytes, signature) => signature.every((byte, index) => bytes[index] === byte);

// Число переменной длины RAR: по семь бит на байт, старший бит — «есть ещё».
const readVarint = (bytes, from) => {
  let value = 0;
  for (let step = 0; step < VARINT_MAX_BYTES; step += 1) {
    const byte = bytes[from + step];
    if (byte === undefined) return null;
    value += (byte & 0x7f) * 2 ** (7 * step);
    if (!(byte & 0x80)) return { value, next: from + step + 1 };
  }
  return null;
};

const probeRar5 = (head) => {
  const size = readVarint(head, 12);
  const type = size && readVarint(head, size.next);
  return Boolean(type) && type.value === RAR5_ENCRYPTION_BLOCK;
};

const probeRar4 = (head) =>
  head.length >= 12 &&
  head[9] === RAR4_MAIN_HEADER &&
  (head[10] & RAR4_HEADER_PASSWORD_FLAG) !== 0;

const probeSevenZip = async (head, handle) => {
  if (head.length < PROBE_LENGTH) return false;
  const next = { offset: head.readBigUInt64LE(12), size: head.readBigUInt64LE(20) };
  const reachable = next.offset <= BigInt(Number.MAX_SAFE_INTEGER - SEVEN_ZIP_START_HEADER);
  if (next.size === 0n || next.size > BigInt(MAX_HEADER_PROBE) || !reachable) return false;
  const buffer = Buffer.alloc(Number(next.size));
  const position = SEVEN_ZIP_START_HEADER + Number(next.offset);
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
  const header = buffer.subarray(0, bytesRead);
  return header[0] === ENCODED_HEADER_BYTE && header.includes(Uint8Array.from(SEVEN_ZIP_AES_ID));
};

const FORMATS = [
  { signature: SEVEN_ZIP_SIGNATURE, probe: probeSevenZip },
  { signature: RAR5_SIGNATURE, probe: probeRar5 },
  { signature: RAR4_SIGNATURE, probe: probeRar4 },
];

export const hasEncryptedHeaders = async (file) => {
  const handle = await fsp.open(file, "r");
  try {
    const head = Buffer.alloc(PROBE_LENGTH);
    const { bytesRead } = await handle.read(head, 0, PROBE_LENGTH, 0);
    const probed = head.subarray(0, bytesRead);
    const format = FORMATS.find(({ signature }) => hasPrefix(probed, signature));
    return format ? await format.probe(probed, handle) : false;
  } finally {
    await handle.close();
  }
};
