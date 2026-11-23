/*
 * Клип человека или не человека (14.11.2026, «анимации один в один»): в словарях проектов рядом с эмоциями лежат клипы предметов (дверь, оружие, ящик), камеры, животных и
 * лица. Их кости — не скелет человека, и показывать такие клипы эмоциями, а тем более ставить вместо эмоции, нельзя (у GTA 5 RP это 21 из 764 клипов `gta5rp_anim` и 94 из `gta5rp_wanim`).
 *
 * Признак тот же, что у проверки замены (`checkGraft`, `bodyBones`): у клипа тела есть не меньше `MIN_BODY_BONES` костей с поворотом, кроме корня (тег 0). Если известен
 * скелет человека (`pedBones` — теги костей `mp_m_freemode_01`), хотя бы `ON_SKELETON` из них должны быть костями этого скелета.
 */

import { listClips, parseDictionary, readClip, TRACK } from "./ycd-graft.js";

export const MIN_BODY_BONES = 8;
export const ON_SKELETON = 0.8;

/** Кости с поворотом по всем записям клипа, кроме корня: теги. */
export function bodyBoneTags(read) {
  const seen = new Set();
  for (const entry of read.entries)
    for (const item of entry.animation.bones)
      if (item.track === TRACK.rotation && item.bone !== 0) seen.add(item.bone);
  return [...seen];
}

/** `{ human, bones }` для прочитанного клипа (`readClip`). Без `pedBones` — только число костей. */
export function kindOfRead(read, pedBones = null) {
  const tags = bodyBoneTags(read);
  let human = tags.length >= MIN_BODY_BONES;
  if (human && pedBones) {
    const known = new Set(pedBones);
    human =
      tags.filter((tag) => known.has(tag)).length / tags.length >= ON_SKELETON;
  }
  return { human, bones: tags.length };
}

/**
 * Словарь целиком: короткое имя клипа → `{ human, bones }`. Клип, который не читается, в карту не попадает (его судьба — у вызывающего).
 */
export function clipKinds(bytes, pedBones = null) {
  const kinds = new Map();
  const dictionary = parseDictionary(bytes);
  for (const clip of listClips(dictionary)) {
    try {
      kinds.set(
        clip.short || clip.name,
        kindOfRead(readClip(dictionary, clip), pedBones),
      );
    } catch {
      /* клип не читается нашим разбором */
    }
  }
  return kinds;
}
