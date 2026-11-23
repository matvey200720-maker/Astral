// Решает, какие поля настроек звука ствола перевести на деревья глушителя,
// и пишет это в копию байтов. Файлы и слияние аудио делает вызывающий.
import { joaat } from './rel-edit.js';
import { WEAPON_SOUND_FIELDS } from './weapon-voice-plan.js';

export const NULL_SOUND = joaat('null_sound');

// Заморожен только внешний массив: внутренние пары читаются в момент вызова (контракт).
export const SILENCER_LINK_PAIRS = Object.freeze([
  ['FireSound', 'SuppressedFireSound'],
  ['SlowMoFireSound', 'SlowMoSuppressedFireSound'],
  ['SlowMoFireSoundPresuck', 'SlowMoSuppressedFireSoundPresuck'],
  ['SuperSlowMoFireSound', 'SuperSlowMoSuppressedFireSound'],
  ['SuperSlowMoFireSoundPresuck', 'SuperSlowMoSuppressedFireSoundPresuck'],
  ['EchoSound', 'SuppressedEchoSound'],
]);

const FIELD_OFFSETS = new Map(WEAPON_SOUND_FIELDS);

const KIND_QUEUE = 9;
const KIND_WRAPPER = 6;
const PASS_THROUGH_KINDS = new Set([2, 6, 25, 26, 27, 28]);

// План переводов как последовательность [поле, новый хеш]; лишнее отсеет silencerLinkFields.
function* retargetPlan(roots, shapeOf) {
  const shape = (hash) => {
    if (!hash) return null;
    return shapeOf ? shapeOf(hash) : 'once';
  };
  const silencer = roots.SuppressedFireSound;
  const silencerShape = shape(silencer);
  if (!silencerShape || silencerShape === 'empty') return;

  if (silencerShape === 'loop') {
    if (shape(roots.AutoSound) === 'loop') yield ['AutoSound', silencer];
    if (roots.FireSound) yield ['FireSound', NULL_SOUND];
  } else if (shape(roots.FireSound) !== 'loop') {
    yield ['FireSound', silencer];
  }

  // Пара 0 — основная, она разобрана выше по именам и из таблицы не читается.
  for (const [plain, source] of SILENCER_LINK_PAIRS.slice(1)) {
    const target = roots[source];
    const targetShape = shape(target);
    const isUsable = targetShape && targetShape !== 'empty' && targetShape === shape(roots[plain]);
    if (isUsable) yield [plain, target];
  }

  if (roots.ReportSound) yield ['ReportSound', NULL_SOUND];
}

export function silencerLinkFields({ roots, embedded, ownVoice = false, shapeOf = null }) {
  if (!embedded || ownVoice) return [];
  const known = roots ?? {};
  return [...retargetPlan(known, shapeOf)]
    .map(([field, to]) => ({ field, offset: FIELD_OFFSETS.get(field), from: known[field] ?? 0, to }))
    .filter(({ field, from, to }) => from !== to && FIELD_OFFSETS.has(field));
}

export function applySilencerLink(settingsBytes, links) {
  const settings = Buffer.from(settingsBytes);
  for (const { to, offset } of links) settings.writeUInt32LE(to >>> 0, offset);
  return settings;
}

const childHashAt = (node, offset) => node.bytes.readUInt32LE(offset);

// Ленивый обход в глубину: ссылка читается, только когда поиск до неё дошёл,
// поэтому битая ссылка за найденной очередью ошибки не даёт.
function* passThroughTree(merged, node, seen) {
  yield node;
  if (PASS_THROUGH_KINDS.has(node.type)) {
    for (const offset of node.links) {
      const hash = childHashAt(node, offset);
      const child = hash !== 0 && !seen.has(hash) ? merged.sound(hash) : null;
      seen.add(hash);
      if (child) yield* passThroughTree(merged, child, seen);
    }
  }
}

function reachesQueue(merged, root, rootHash) {
  for (const node of passThroughTree(merged, root, new Set([rootHash]))) {
    if (node.type === KIND_QUEUE) return true;
  }
  return false;
}

// Пустота смотрится только у корня и только по первой ссылке.
const isHollowWrapper = (root) => root.type === KIND_WRAPPER
  && (root.links.length === 0 || childHashAt(root, root.links[0]) === 0);

export function soundShape(merged, hash) {
  const id = Number(hash) >>> 0;
  const root = id === 0 || id === NULL_SOUND ? null : merged.sound(id);
  if (!root) return null;
  if (isHollowWrapper(root)) return 'empty';
  return reachesQueue(merged, root, id) ? 'loop' : 'once';
}
