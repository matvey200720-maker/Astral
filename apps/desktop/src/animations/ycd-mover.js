/*
 * Корневое движение клипа («мувер»): куда сам идёт и как поворачивается тело (14.11.2026, «анимации один в один»).
 *
 * В клипе игры у корня две особые дорожки: 5 — сдвиг тела, 6 — его поворот. Читатели `sample-anim-pose` (Rust-движок и C#-хост на CodeWalker) отдают
 * только дорожки 0 (смещение кости) и 1 (поворот кости) и эти две пропускают, поэтому просмотр шёл на месте. Движок пересобрать здесь нельзя
 * (Rust собирается на Mac, готовый модуль едет из git), а разбор каналов у дорожек одинаковый — отличается только то, как читатель называет дорожку.
 *
 * Поэтому для чтения делается временная копия словаря, в которой записи дорожек 5 и 6 названы дорожками 0 и 1 несуществующей кости `MOVER_ALIAS`:
 * те же блоки данных, тот же разбор, тот же ответ движка — но под тегом `MOVER_ALIAS`. Файл остаётся только для чтения (как слои, `layerDictionary`):
 * в игру он не ставится, исходный словарь не меняется.
 */

import zlib from "node:zlib";
import { listClips, parseDictionary, readClip, TRACK } from "./ycd-graft.js";

/** Тег кости, под которым временная копия отдаёт корневое движение: такой кости в скелете человека нет (сверено по дампам проектов). */
export const MOVER_ALIAS = 0xfffd;

const HEADER_BYTES = 16;
const TRACK_TRANSLATION = 0;
const TRACK_ROTATION = 1;

/** Есть ли у клипа (любой записи) корневое движение — дорожки 5 или 6. */
export function clipHasMover(read) {
  return read.entries.some((entry) =>
    entry.animation.bones.some(
      (item) =>
        item.track === TRACK.moverTranslation ||
        item.track === TRACK.moverRotation,
    ),
  );
}

/**
 * Копия словаря для чтения корневого движения: дорожки 5 и 6 всех клипов названы дорожками 0 и 1 кости `MOVER_ALIAS`. Если корневого движения нет —
 * те же байты (копировать нечего).
 */
export function aliasMovers(bytes) {
  const dictionary = parseDictionary(bytes);
  const sys = Buffer.from(dictionary.sys);
  const copy = { ...dictionary, sys };
  const visited = new Set();
  let changed = 0;
  for (const clip of listClips(copy)) {
    let read;
    try {
      read = readClip(copy, clip);
    } catch {
      continue;
    }
    for (const entry of read.entries) {
      const animation = entry.animation;
      if (visited.has(animation.at) || animation.bonesAt === null) continue;
      visited.add(animation.at);
      for (let index = 0; index < animation.boneCount; index += 1) {
        const base = animation.bonesAt + index * 4;
        const track = sys[base + 3];
        if (track !== TRACK.moverTranslation && track !== TRACK.moverRotation)
          continue;
        sys.writeUInt16LE(MOVER_ALIAS, base);
        sys[base + 3] =
          track === TRACK.moverTranslation ? TRACK_TRANSLATION : TRACK_ROTATION;
        changed += 1;
      }
    }
  }
  if (!changed) return bytes;
  return Buffer.concat([
    bytes.subarray(0, HEADER_BYTES),
    zlib.deflateRawSync(sys, { level: 6 }),
  ]);
}
