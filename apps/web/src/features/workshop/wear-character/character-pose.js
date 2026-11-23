/*
 * Поза персонажа мастерской одежды (ТЗ 29.10.2026-e): кости скинованного GLB встают в кадр клипа покоя игры, и персонаж стоит, не раскинув
 * руки, а при `animated` ещё и «дышит» — клип `idle` идёт по кругу (он зациклен самой игрой, стык круга — доли градуса).
 *
 * Дорожка — от Astral Desktop (`idle-track.js`, тот же вид, что у окна «Анимации»): повороты костей по кадрам, теги костей. Кость находится по имени узла
 * GLB (`bone_<номер>_<тег>`, `ped-skeleton.js`); кость без дорожки остаётся в позе привязки. Скинингом занимается видеокарта: на кадр — только
 * установка кватернионов 26 костей, вершины на процессоре не пересчитываются, контекст WebGL один (`docs/3D.md`).
 *
 * Точка подключения в кадре — `scene.load(url, { pose })` (`gun-scene.js`): сцена зовёт `apply` перед каждым кадром, а `animated`
 * держит кадры идущими. Здесь — только сама поза, без привязки к студии.
 *
 * Между кадрами дорожки — кривая Катмулла — Рома по кватернионам (`cubicInto`), как у окна «Анимации»: дорожка снята 15–30 раз в секунду, и по дуге между двумя кадрами
 * (slerp) скорость поворота рвётся на каждом кадре — на глаз это ступеньки в плавном движении груди и плеч. Кривая даёт одну скорость на стыке отрезков.
 */

import { boneName, cubicInto, frameAround, sceneQuaternion } from "../animations-editor/animation-pose.js";

/**
 * Поза по дорожке покоя. `track` — `{ fps, duration, frames, tags, rotations }`; `animated: false` — одна неподвижная поза (кадр 0, как в
 * сборке без дыхания), `true` — клип по кругу.
 */
export function createCharacterPose(track, { animated = true } = {}) {
  const count = track?.tags?.length || 0;
  const scratch = { before: [0, 0, 0, 1], a: [0, 0, 0, 1], b: [0, 0, 0, 1], after: [0, 0, 0, 1], out: [0, 0, 0, 1] };
  /* Кости каждого персонажа в кадре: находятся один раз на корень. */
  const known = new WeakMap();

  function bonesOf(root) {
    if (known.has(root)) return known.get(root);
    let skinned = null;
    root.traverse?.((object) => {
      if (!skinned && object.isSkinnedMesh && object.skeleton?.bones?.length) skinned = object;
    });
    let state = null;
    if (skinned) {
      const byTag = new Map();
      skinned.skeleton.bones.forEach((bone) => {
        const parsed = boneName(bone.name);
        if (parsed) byTag.set(parsed.tag, bone);
      });
      state = { slots: track.tags.map((tag) => byTag.get(tag) || null) };
    }
    known.set(root, state);
    return state;
  }

  /** Поставить кости в позу момента `seconds`. Корень без скинованного меша — ничего не делает (персонаж без скелета). */
  function apply(root, seconds = 0) {
    if (!count || !root) return false;
    const state = bonesOf(root);
    if (!state) return false;
    const { before, first, second, after, alpha } = frameAround(track, animated ? seconds : 0);
    const blend = animated && alpha > 0.001 && track.frames > 1;
    for (let slot = 0; slot < count; slot += 1) {
      const bone = state.slots[slot];
      if (!bone) continue;
      sceneQuaternion(scratch.a, track.rotations, (first * count + slot) * 4);
      if (blend) {
        sceneQuaternion(scratch.before, track.rotations, (before * count + slot) * 4);
        sceneQuaternion(scratch.b, track.rotations, (second * count + slot) * 4);
        sceneQuaternion(scratch.after, track.rotations, (after * count + slot) * 4);
        cubicInto(scratch.out, scratch.before, scratch.a, scratch.b, scratch.after, alpha);
        bone.quaternion.set(scratch.out[0], scratch.out[1], scratch.out[2], scratch.out[3]);
      } else bone.quaternion.set(scratch.a[0], scratch.a[1], scratch.a[2], scratch.a[3]);
    }
    return true;
  }

  return Object.freeze({ animated, duration: track?.duration || 0, apply });
}
