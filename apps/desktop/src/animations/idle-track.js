/*
 * Дорожка покоя свободного персонажа (ТЗ 29.10.2026-e): клип `idle` из ходьбы игры — мужской `move_m@generic`, женский `move_f@generic`.
 * Руки опущены и расслаблены, а грудь, плечи и голова еле заметно ходят: клип зациклен самой игрой (стык круга — доли градуса), так что
 * «лёгкое дыхание по кругу» — это его собственное движение, а не придуманное окном.
 *
 * Дорожка — та же, что у окна «Анимации» (`animation-track.js`): `{ fps, duration, frames, tags, rotations }`, повороты костей по кадрам
 * (`Float32Array`, `frames × tags × 4`, оси RAGE). Мувера (куда идёт персонаж) здесь нет: персонаж стоит. Первый кадр дорожки — та самая поза покоя,
 * в которую персонаж встаёт без движения (`pose: "idle"`), так что стоячая и дышащая позы совпадают. Снимается один раз на игру и пол, кэш — на диске.
 */

import {
  bakeTrack,
  dictionaryFile,
  readCachedTrack,
  writeCachedTrack,
} from "./animation-track.js";

const DIRECTORY = "anim/ingame/clip_move_.rpf";
export const IDLE_CLIPS = Object.freeze({
  male: Object.freeze({
    source: "game",
    archive: "x64c.rpf",
    entry: `${DIRECTORY}/move_m@generic.ycd`,
    clip: "idle",
  }),
  female: Object.freeze({
    source: "game",
    archive: "x64c.rpf",
    entry: `${DIRECTORY}/move_f@generic.ycd`,
    clip: "idle",
  }),
});

/* Версия дорожки в ключе кэша: другая — снимается заново. */
const IDLE_BUILD = "i2";

const building = new Map();

/**
 * Дорожка покоя пола: `{ gender, fps, duration, frames, tags, rotations }`. `tools` — `read` и `native` (как у `animation-track.js`).
 */
export async function readIdleTrack(
  { gameRoot, gender },
  stateDir,
  context,
  tools,
) {
  const sex = gender === "female" ? "female" : "male";
  const key = `idle:${IDLE_BUILD}:${sex}`;
  const cached = await readCachedTrack(stateDir, gameRoot, key);
  if (cached)
    return {
      gender: sex,
      fps: cached.fps,
      duration: cached.duration,
      frames: cached.frames,
      tags: cached.tags,
      rotations: cached.rotations,
    };
  const lock = `${stateDir}|${gameRoot}|${key}`.toLowerCase();
  if (!building.has(lock))
    building.set(
      lock,
      (async () => {
        const entry = IDLE_CLIPS[sex];
        const file = await dictionaryFile(
          entry,
          { gameRoot, stateDir },
          context,
          tools,
        );
        /* Без корневого движения: покою оно не нужно, а копия словаря с ним — перепаковка и лишние байты в кэше (ревью 14.11, п. 9). */
        const baked = await bakeTrack(file, entry.clip, context, tools, {
          travel: false,
        });
        /* Мувер дорожке покоя не нужен: он занял бы место и поменял бы кэш зря. */
        const track = { ...baked, mover: new Float32Array(baked.frames * 7) };
        await writeCachedTrack(stateDir, gameRoot, key, track).catch(() => {});
        return {
          gender: sex,
          fps: track.fps,
          duration: track.duration,
          frames: track.frames,
          tags: track.tags,
          rotations: track.rotations,
        };
      })().finally(() => building.delete(lock)),
    );
  return building.get(lock);
}
