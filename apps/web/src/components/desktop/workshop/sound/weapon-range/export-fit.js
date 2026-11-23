// Правка выгрузки эффектов игрока для стрельбища: одна гильза на выстрел и сетки гильз в единичной рамке.

const RATE_TRACK_SUFFIX = "m_spawnRateOverTimeKFP";
const SINGLE_PARTICLE = Object.freeze([0, 1, 1, 0, 0]);
const SIDE_FLOOR = 1e-6;

const isEmptyTrack = (frames) => !(frames && frames.length);

// Дорожка частоты разового эмиттера гильзы без кадров получает одну частицу.
const mendEmitter = (emitter) => {
  const tracks = emitter.KeyframeProps;
  const at = tracks ? tracks.findIndex((track) => String(track?.Name).endsWith(RATE_TRACK_SUFFIX)) : -1;
  if (at < 0 || !isEmptyTrack(tracks[at].Keyframes)) return emitter;
  const KeyframeProps = tracks.map((track, index) =>
    index === at ? { ...track, Keyframes: [[...SINGLE_PARTICLE]] } : track,
  );
  return { ...emitter, KeyframeProps };
};

const needsMending = (name, emitter) =>
  name.startsWith("eject_") && Number(emitter?.IsOneShot) === 1;

export const withOneCasing = (exported) => ({
  ...exported,
  emitters: Object.fromEntries(
    Object.entries(exported.emitters || {}).map(([name, emitter]) => [
      name,
      needsMending(name, emitter) ? mendEmitter(emitter) : emitter,
    ]),
  ),
});

// ---------- сетки гильз ----------

const boxesByName = (particles) => {
  const found = new Map();
  Object.values(particles || {}).forEach((particle) => {
    for (const { Name, BoundBoxWidth, BoundBoxHeight, BoundBoxDepth } of particle?.Drawables || []) {
      const sides = [BoundBoxWidth, BoundBoxHeight, BoundBoxDepth].map(Number);
      if (sides.every((side) => side > SIDE_FLOOR)) found.set(String(Name).toLowerCase(), sides);
    }
  });
  return found;
};

// Нормали умножаются на рамку покомпонентно и нормируются; нулевая длина считается единицей.
const reshapeNormals = (normals, box) => {
  const shaped = [];
  for (let from = 0; from < normals.length; from += 3) {
    const scaled = box.map((side, axis) => normals[from + axis] * side);
    const norm = Math.hypot(...scaled) || 1;
    shaped.push(...scaled.map((value) => value / norm));
  }
  return shaped;
};

const fitPart = (part, box) => ({
  ...part,
  positions: part.positions.map((value, index) => value / box[index % 3]),
  normals: part.normals ? reshapeNormals(part.normals, box) : part.normals,
});

export const unitMeshes = (exported) => {
  const boxes = boxesByName(exported.particles);
  return Object.fromEntries(
    Object.entries(exported.meshes || {}).map(([name, mesh]) => {
      const box = boxes.get(name.toLowerCase());
      return [name, box ? { ...mesh, parts: (mesh.parts || []).map((part) => fitPart(part, box)) } : mesh];
    }),
  );
};
