import { heavyWork } from "./heavy-work.js";

const PAYLOAD_FIELDS = ["width", "height", "format", "mipLevels", "rgba"];

// Буфер можно отдать потоку целиком, только если вид занимает его от начала до конца;
// иначе потоку уходит копия, и ничего не передаётся.
export async function encodeDdsPooled(job) {
  const payload = Object.fromEntries(PAYLOAD_FIELDS.map((field) => [field, job[field]]));
  const view = payload.rgba;
  const transfer = [];
  if (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) transfer.push(view.buffer);
  else payload.rgba = view.slice();
  return heavyWork.run("encode-dds", payload, { transfer });
}
