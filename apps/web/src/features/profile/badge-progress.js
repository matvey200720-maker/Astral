/*
 * Цифры значков по тому, что окно знает о человеке (`profile-facts.js`).
 * Значки, у которых окну цифры неоткуда взять (`source: "none"` в `badge-defs.js`),
 * здесь не считаются: у них `badgeInfo` отвечает «скоро».
 */
import { BADGE_GROUPS, badgeInfo } from "./badge-defs.js";

const WORK_KINDS_OF_RADAR = ["minimap", "world-map", "gps"];

const has = (tiles, test) => tiles.some(test);
const workIs =
  (...kinds) =>
  (tile) =>
    tile.kind === "work" && kinds.includes(tile.workKind);
const slotIs = (slot) => (tile) => tile.mod?.catalogSlot === slot;

/**
 * @param {object} input
 * @param {ReturnType<import("./profile-facts.js").installedTiles>} input.tiles что стоит в игре
 * @param {{ gunpacks: number, redux: number, clothing: number }} input.counts
 * @param {string[]} input.installed id профиля движка (в нём есть и установки мастерской: `local-…`)
 * @param {number} input.builds сколько сборок
 * @param {number} input.favorites сколько избранного
 * @param {{ channel: string, state: string }[]} input.access строки «Доступа»
 * @param {boolean} input.discord аккаунт привязан к Discord
 * @param {boolean} input.optimizer стоит оптимизация раздела «Оптимизация»
 * @returns {Record<string, number>} id значка → сколько уже набрано
 */
export function badgeProgress({
  tiles,
  counts,
  installed,
  builds,
  favorites,
  access,
  discord,
  optimizer,
}) {
  const categories = new Set(
    tiles
      .filter((tile) => tile.mod)
      .map(
        (tile) =>
          tile.mod.catalogCategory || tile.mod.catalogSection || "other",
      ),
  );
  const open = (channel) =>
    access.some((row) => row.channel === channel && row.state === "open");
  const flag = (value) => (value ? 1 : 0);
  return {
    "first-mod": flag(tiles.length > 0),
    discord: flag(discord),
    build: flag(builds > 0),
    fav: favorites,
    collector: tiles.length,
    redux: counts.redux,
    guns: counts.gunpacks,
    wardrobe: counts.clothing,
    night:
      flag(
        has(tiles, (tile) => workIs("lamps")(tile) || slotIs("lights")(tile)),
      ) +
      flag(
        has(tiles, (tile) => workIs("sky")(tile) || slotIs("timecycle")(tile)),
      ),
    explorer: categories.size,
    "own-gunpack": flag(
      installed.some((id) => id.startsWith("local-gunpack-")),
    ),
    fitting: flag(
      installed.some((id) => id.startsWith("local-clothing-replace-")),
    ),
    optimizer: flag(optimizer || has(tiles, workIs("optimization"))),
    radar: flag(has(tiles, workIs(...WORK_KINDS_OF_RADAR))),
    alpha: flag(open("alpha")),
    beta: flag(open("beta")),
  };
}

/** Все 21 значок с состоянием: `{ badge, info }` по группам. */
export function badgeGroups(progress) {
  return BADGE_GROUPS.map((group) => ({
    ...group,
    items: group.items.map((badge) => ({
      badge,
      info: badgeInfo(badge, progress[badge.id] || 0),
    })),
  }));
}

export function badgeSummary(groups) {
  const all = groups.flatMap((group) => group.items);
  const count = (state) =>
    all.filter((item) => item.info.state === state).length;
  return {
    got: count("got"),
    prog: count("prog"),
    lock: count("lock") + count("soon"),
    total: all.length,
  };
}

/* Ближайшие к получению: у ступенчатого — до следующей ступени; чем ближе, тем раньше. */
export function nearestBadges(groups) {
  return groups
    .flatMap((group) => group.items)
    .filter(
      ({ badge, info }) =>
        !(info.state === "got" && !(badge.steps && info.next)) &&
        info.pct > 0 &&
        info.pct < 1,
    )
    .sort((a, b) => b.info.pct - a.info.pct);
}
