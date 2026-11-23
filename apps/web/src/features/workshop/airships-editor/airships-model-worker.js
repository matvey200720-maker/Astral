import { airshipModel } from "@modovik/climb-contract/recolor/airship-models";

// Массивы части, чьи буферы уходят переносом, строго в этом порядке.
const PART_ARRAYS = ["positions", "normals", "uvs", "indices", "flex"];

// Лист соседа живёт в его кэше, поэтому отдаётся копией.
function copyAtlas(atlas) {
  const { width, height } = atlas;
  return { width, height, rgba: new Uint8ClampedArray(atlas.rgba) };
}

// Части создаются заново на каждую модель и уходят как есть.
function packModel(built) {
  return {
    parts: built.parts,
    atlas: copyAtlas(built.atlas),
    regions: built.regions,
    skin: built.skin,
    bounds: built.bounds,
    radius: built.radius,
  };
}

// Сначала буфер листа, затем по частям их массивы (у кого есть buffer).
function transferList(model) {
  const buffers = [model.atlas.rgba.buffer];
  for (const part of model.parts) {
    for (const name of PART_ARRAYS) {
      const array = part[name];
      if (array?.buffer) buffers.push(array.buffer);
    }
  }
  return buffers;
}

// [сообщение, список переноса?]: у вида без модели ответ идёт без списка.
function buildReply(data) {
  const built = airshipModel(data.kindId, data.project, { atlasSize: data.atlasSize });
  if (!built) return [{ id: data.id, model: null }];
  const model = packModel(built);
  return [{ id: data.id, model }, transferList(model)];
}

const scope = self;

function post(message, transfer) {
  if (transfer) scope.postMessage(message, transfer);
  else scope.postMessage(message);
}

scope.onmessage = (event) => {
  const data = event.data ?? {};
  try {
    post(...buildReply(data));
  } catch (thrown) {
    post({ id: data.id, error: String(thrown?.message || thrown) });
  }
};
