// Порядок важен: если в названии есть несколько слов, побеждает первое.
const LOGO_BY_KEYWORD = [
  ["steam", "/brands/steam.svg"],
  ["epic", "/brands/epic-games.svg"],
  ["rockstar", "/brands/rockstar-games.svg"],
];

export function storeLogo(store) {
  const name = (store ? String(store) : "").toLowerCase();
  const match = LOGO_BY_KEYWORD.find(([keyword]) => name.includes(keyword));
  return match ? match[1] : "";
}
