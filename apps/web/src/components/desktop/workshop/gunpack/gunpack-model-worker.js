import { parseWeaponModel } from "./gunpack-model-parse.js";

const BUFFERED_FIELDS = ["positions", "normals", "uvs", "colours", "indices"];

// Буферы без повторов в порядке первого появления: сначала меши, затем пиксели.
const bufferList = ({ meshes, images }) => {
  const fromMeshes = meshes
    .flatMap((mesh) => BUFFERED_FIELDS.map((field) => mesh[field]?.buffer))
    .filter(Boolean);
  const fromImages = images.map((image) => image.rgba.buffer);
  return [...new Set([...fromMeshes, ...fromImages])];
};

const describeFailure = (thrown) => ({
  code: thrown?.code || "",
  message: String(thrown?.message || thrown),
});

const attempt = (task, onFailure) => {
  try {
    return task();
  } catch (thrown) {
    return onFailure(thrown);
  }
};

function deliver(id, data) {
  const parsed = parseWeaponModel(data);
  const buffers = bufferList(parsed);
  self.postMessage({ id, ok: true, ...parsed }, buffers);
}

function relay(data) {
  const { id } = data;
  attempt(
    () => deliver(id, data),
    (failure) => self.postMessage({ id, ok: false, ...describeFailure(failure) }),
  );
}

self.onmessage = (event) => relay(event.data);
