// Страж для слота `berd` (маски): борода и усы привязаны к костям головы, всё остальное в слоте масок (вещь на груди, ключице, руке) — нет (решение ведущей 16.11.2026,
// случай berd052 Majestic: коричневая палочка длиной 7 см, кости SKEL_Spine3, SKEL_L_Clavicle, RB_L_ArmRoll; на обложке с головой-манекеном вещь «уехала» под подбородок, подвид `beard` был неверным).
//
//   berdHeadVerdict(meshes, { minShare }) → { headBound: true | false | null, share, weight, bones: [{ index, name, share }] }
//
// `meshes` — сетки модели из `readDrawable(bytes, { skin: true })`: у скиннинговой `skin.weights` (по четыре веса на вершину) и `skin.joints` (по четыре индекса кости скелета педа), у жёсткой — `boneIndex`.
// Индексы костей скелета `mp_m_freemode_01.yft` и `mp_f_freemode_01.yft` одинаковы (128 костей, у женского другой только суффикс имён лицевых костей `_000` вместо `_045`): голова — SKEL_Neck_1 (97), SKEL_Head (98)
// и потомки до FB_Tongue (99–123). `headBound`: доля веса на этих костях не меньше `minShare` (по умолчанию 0,5); меньше — вещь не на голове (false); нет ни весов, ни кости — не знаем (null: не отсекать).

/** SKEL_Neck_1, SKEL_Head и всё, что от неё идёт: IK_Head, MH_Hair_*, FACIAL_facialRoot, FB_* (лицо, челюсть, губы, язык). */
export const HEAD_BONES = Object.freeze(
  Array.from({ length: 123 - 97 + 1 }, (_, index) => 97 + index),
);

/** Имена костей, которыми привязываются вещи слота масок (для отчёта; полная таблица — скелет педа). */
export const BONE_NAMES = Object.freeze({
  0: "SKEL_ROOT",
  37: "SKEL_Spine2",
  38: "SKEL_Spine3",
  39: "SKEL_L_Clavicle",
  66: "RB_L_ArmRoll",
  97: "SKEL_Neck_1",
  98: "SKEL_Head",
  118: "FB_Jaw",
});

const HEAD = new Set(HEAD_BONES);

export const isHeadBone = (index) => HEAD.has(index);

export function berdHeadVerdict(meshes, { minShare = 0.5 } = {}) {
  const byBone = new Map();
  let total = 0;
  const add = (bone, weight) => {
    if (!(weight > 0)) return;
    byBone.set(bone, (byBone.get(bone) ?? 0) + weight);
    total += weight;
  };
  for (const mesh of meshes ?? []) {
    const skin = mesh?.skin;
    if (skin?.weights && skin?.joints) {
      for (let at = 0; at < skin.weights.length; at += 1)
        add(skin.joints[at], skin.weights[at]);
    } else if (Number.isInteger(mesh?.boneIndex)) {
      add(mesh.boneIndex, (mesh.positions?.length ?? 3) / 3);
    }
  }
  if (!(total > 0))
    return { headBound: null, share: null, weight: 0, bones: [] };
  let head = 0;
  for (const [bone, weight] of byBone) if (HEAD.has(bone)) head += weight;
  const share = head / total;
  const bones = [...byBone]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([index, weight]) => ({
      index,
      name: BONE_NAMES[index] ?? `кость ${index}`,
      share: weight / total,
    }));
  return { headBound: share >= minShare, share, weight: total, bones };
}
