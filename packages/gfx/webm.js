/*
 * Писатель WebM — одна видеодорожка, без звука (25.10.2026).
 *
 * Петля карточки таймцикла (`features/catalog/part-covers/sky-clip.js`)
 * кодируется в окне через WebCodecs (`VideoEncoder`, VP9/VP8): он отдаёт
 * кадры-«чанки», а контейнера не делает. ffmpeg на машине выпуска не
 * обязателен, поэтому контейнер пишет эта малая модель: заголовок EBML,
 * Segment с SeekHead, Info, Tracks, Cues и кластерами по ключевым кадрам.
 * Всё собирается в памяти: петля — сотни килобайт.
 *
 *   const writer = createWebmWriter({ width, height, codec: "V_VP9" });
 *   writer.add({ data, timestampMs, keyFrame });   // по порядку
 *   const bytes = writer.finish({ durationMs });   // Uint8Array
 *
 * Положения в SeekHead и Cues пишутся числами фиксированной ширины (4 байта),
 * поэтому длины частей известны до того, как известны сами положения.
 */

const bytesOf = (...values) => Uint8Array.from(values);

const concat = (parts) => {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

/** Идентификаторы элементов Matroska (как записаны, со своей меткой длины). */
const ID = Object.freeze({
  ebml: [0x1a, 0x45, 0xdf, 0xa3],
  ebmlVersion: [0x42, 0x86],
  ebmlReadVersion: [0x42, 0xf7],
  ebmlMaxIdLength: [0x42, 0xf2],
  ebmlMaxSizeLength: [0x42, 0xf3],
  docType: [0x42, 0x82],
  docTypeVersion: [0x42, 0x87],
  docTypeReadVersion: [0x42, 0x85],
  segment: [0x18, 0x53, 0x80, 0x67],
  seekHead: [0x11, 0x4d, 0x9b, 0x74],
  seek: [0x4d, 0xbb],
  seekId: [0x53, 0xab],
  seekPosition: [0x53, 0xac],
  info: [0x15, 0x49, 0xa9, 0x66],
  timecodeScale: [0x2a, 0xd7, 0xb1],
  duration: [0x44, 0x89],
  muxingApp: [0x4d, 0x80],
  writingApp: [0x57, 0x41],
  tracks: [0x16, 0x54, 0xae, 0x6b],
  trackEntry: [0xae],
  trackNumber: [0xd7],
  trackUid: [0x73, 0xc5],
  trackType: [0x83],
  flagLacing: [0x9c],
  defaultDuration: [0x23, 0xe3, 0x83],
  codecId: [0x86],
  video: [0xe0],
  pixelWidth: [0xb0],
  pixelHeight: [0xba],
  cues: [0x1c, 0x53, 0xbb, 0x6b],
  cuePoint: [0xbb],
  cueTime: [0xb3],
  cueTrackPositions: [0xb7],
  cueTrack: [0xf7],
  cueClusterPosition: [0xf1],
  cluster: [0x1f, 0x43, 0xb6, 0x75],
  timecode: [0xe7],
  simpleBlock: [0xa3],
});
export const WEBM_IDS = ID;

/** Длина элемента — «vint» кратчайшей записи. */
function sizeOf(length) {
  for (let width = 1; width <= 8; width += 1) {
    const room = 2 ** (7 * width) - 1;
    if (length < room) {
      const out = new Uint8Array(width);
      let rest = length;
      for (let index = width - 1; index >= 0; index -= 1) {
        out[index] = rest % 256;
        rest = Math.floor(rest / 256);
      }
      out[0] |= 1 << (8 - width);
      return out;
    }
  }
  throw new Error("Элемент WebM слишком велик.");
}

const element = (id, payload) =>
  concat([bytesOf(...id), sizeOf(payload.length), payload]);

/** Целое без знака кратчайшей записью. */
function uint(value) {
  const out = [];
  let rest = Math.max(0, Math.floor(value));
  do {
    out.unshift(rest % 256);
    rest = Math.floor(rest / 256);
  } while (rest > 0);
  return Uint8Array.from(out);
}

/** Целое без знака в `width` байт, старшим вперёд. */
function fixedUint(value, width) {
  const out = new Uint8Array(width);
  let rest = Math.max(0, Math.floor(value));
  for (let index = width - 1; index >= 0; index -= 1) {
    out[index] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  return out;
}

function float64(value) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, value, false);
  return out;
}

const ascii = (text) => Uint8Array.from([...text].map((char) => char.charCodeAt(0) & 0x7f));

const HEADER = element(
  ID.ebml,
  concat([
    element(ID.ebmlVersion, uint(1)),
    element(ID.ebmlReadVersion, uint(1)),
    element(ID.ebmlMaxIdLength, uint(4)),
    element(ID.ebmlMaxSizeLength, uint(8)),
    element(ID.docType, ascii("webm")),
    element(ID.docTypeVersion, uint(4)),
    element(ID.docTypeReadVersion, uint(2)),
  ]),
);

/** Кластер: метка времени и блоки; время блока — смещение от метки (int16). */
function clusterBytes(start, blocks) {
  const parts = [element(ID.timecode, uint(start))];
  for (const block of blocks) {
    const header = new Uint8Array(4);
    header[0] = 0x81; // дорожка 1
    new DataView(header.buffer).setInt16(1, block.timestampMs - start, false);
    header[3] = block.keyFrame ? 0x80 : 0;
    parts.push(element(ID.simpleBlock, concat([header, block.data])));
  }
  return element(ID.cluster, concat(parts));
}

/**
 * Писатель WebM. `codec` — `V_VP9` или `V_VP8`; `frameRate` (необязателен)
 * записывается как длительность кадра по умолчанию.
 */
export function createWebmWriter({
  width,
  height,
  codec = "V_VP9",
  frameRate = 0,
  app = "Astral",
} = {}) {
  if (!(width > 0) || !(height > 0))
    throw new Error("У видео нет размера кадра.");
  const blocks = [];
  return {
    add({ data, timestampMs, keyFrame = false }) {
      if (!(data instanceof Uint8Array) || !data.length)
        throw new Error("Пустой кадр видео.");
      const last = blocks[blocks.length - 1];
      const at = Math.max(0, Math.round(timestampMs));
      if (last && at < last.timestampMs)
        throw new Error("Кадры видео идут не по порядку.");
      blocks.push({ data, timestampMs: at, keyFrame: Boolean(keyFrame) });
    },
    finish({ durationMs } = {}) {
      if (!blocks.length) throw new Error("В видео нет ни одного кадра.");
      if (!blocks[0].keyFrame)
        throw new Error("Видео должно начинаться с ключевого кадра.");
      /* Кластер на каждый ключевой кадр: у блока смещение от метки — int16. */
      const groups = [];
      for (const block of blocks) {
        const current = groups[groups.length - 1];
        if (!current || block.keyFrame || block.timestampMs - current.start > 30000)
          groups.push({ start: block.timestampMs, blocks: [block] });
        else current.blocks.push(block);
      }
      const clusters = groups.map((group) =>
        clusterBytes(group.start, group.blocks),
      );
      const offsets = [];
      let running = 0;
      for (const cluster of clusters) {
        offsets.push(running);
        running += cluster.length;
      }
      const last = blocks[blocks.length - 1];
      const total =
        durationMs ??
        last.timestampMs + (frameRate > 0 ? Math.round(1000 / frameRate) : 0);

      const info = element(
        ID.info,
        concat([
          element(ID.timecodeScale, uint(1_000_000)),
          element(ID.duration, float64(total)),
          element(ID.muxingApp, ascii(app)),
          element(ID.writingApp, ascii(app)),
        ]),
      );
      const tracks = element(
        ID.tracks,
        element(
          ID.trackEntry,
          concat([
            element(ID.trackNumber, uint(1)),
            element(ID.trackUid, uint(1)),
            element(ID.trackType, uint(1)),
            element(ID.flagLacing, uint(0)),
            ...(frameRate > 0
              ? [element(ID.defaultDuration, uint(Math.round(1e9 / frameRate)))]
              : []),
            element(ID.codecId, ascii(codec)),
            element(
              ID.video,
              concat([
                element(ID.pixelWidth, uint(width)),
                element(ID.pixelHeight, uint(height)),
              ]),
            ),
          ]),
        ),
      );
      const cuesOf = (base) =>
        element(
          ID.cues,
          concat(
            groups.map((group, index) =>
              element(
                ID.cuePoint,
                concat([
                  element(ID.cueTime, fixedUint(group.start, 4)),
                  element(
                    ID.cueTrackPositions,
                    concat([
                      element(ID.cueTrack, uint(1)),
                      element(
                        ID.cueClusterPosition,
                        fixedUint(base + offsets[index], 4),
                      ),
                    ]),
                  ),
                ]),
              ),
            ),
          ),
        );
      const seekOf = (id, position) =>
        element(
          ID.seek,
          concat([
            element(ID.seekId, bytesOf(...id)),
            element(ID.seekPosition, fixedUint(position, 4)),
          ]),
        );
      const seekHeadOf = (at) =>
        element(
          ID.seekHead,
          concat([
            seekOf(ID.info, at.info),
            seekOf(ID.tracks, at.tracks),
            seekOf(ID.cues, at.cues),
          ]),
        );
      /* Длины не зависят от значений (фиксированная ширина): считаем по нулям. */
      const seekLength = seekHeadOf({ info: 0, tracks: 0, cues: 0 }).length;
      const cuesLength = cuesOf(0).length;
      const at = {
        info: seekLength,
        tracks: seekLength + info.length,
        cues: seekLength + info.length + tracks.length,
      };
      const base = at.cues + cuesLength;
      const segment = concat([
        seekHeadOf(at),
        info,
        tracks,
        cuesOf(base),
        ...clusters,
      ]);
      return concat([HEADER, element(ID.segment, segment)]);
    },
  };
}
