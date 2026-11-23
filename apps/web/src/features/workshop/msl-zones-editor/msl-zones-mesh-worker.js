import { mslZonesMesh } from "@modovik/climb-contract/recolor/msl-zones";

// Буферы трёх массивов без повторов: общий буфер переходит один раз.
function uniqueBuffers(arrays) {
  const buffers = arrays.filter((array) => ArrayBuffer.isView(array)).map((array) => array.buffer);
  return Array.from(new Set(buffers));
}

function buildReply({ id, source, project }) {
  try {
    const { positions, uvs, indices } = mslZonesMesh(source, project);
    return [{ id, positions, uvs, indices }, uniqueBuffers([positions, uvs, indices])];
  } catch (failure) {
    return [{ id, error: String(failure?.message || failure) }];
  }
}

self.onmessage = ({ data }) => {
  self.postMessage(...buildReply(data || {}));
};
