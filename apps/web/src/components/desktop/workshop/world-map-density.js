// Тесные подписи большой карты: сколько потеряно и пора ли предупредить.

/** С такого числа потерянных подписей предупреждение включается. */
export const CROWDED_FROM = 10;

const EXAMPLES_SHOWN = 3;
/** Ярус -1: регион над своим районом, это иерархия, а не теснота. */
const HIERARCHY_TIER = -1;

export function labelCrowding(scene) {
  const dropped = scene?.droppedLabels || [];
  const crowdedOut = dropped.filter((label) => label.blockedBy !== HIERARCHY_TIER);
  const lost = crowdedOut.length;
  const examples = crowdedOut.slice(0, EXAMPLES_SHOWN).map((label) => label.value);
  return { crowded: lost >= CROWDED_FROM, lost, examples };
}
