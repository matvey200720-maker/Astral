import path from "node:path";

const win = path.win32;

// Таблица веток: канал, название продукта (оно же имя папки), ключ удаления в реестре.
const BRANCH_ROWS = [
  ["release", "Astral", "Astral"],
  ["beta", "Astral Beta", "AstralBeta"],
  ["alpha", "Astral Alpha", "AstralAlpha"],
];

export const BRANCHES = Object.freeze(
  BRANCH_ROWS.map(([channel, product, uninstallKey]) => Object.freeze({ channel, product, uninstallKey })),
);

export const DEFAULT_BRANCH = BRANCHES[1];

export function branchOfFolder(name) {
  for (const branch of BRANCHES) {
    if (String(branch.product).toLowerCase() === String(name).toLowerCase()) {
      return branch;
    }
  }
  return null;
}

export function branchOfRoot(root) {
  if (typeof root !== "string") {
    return null;
  }
  return branchOfFolder(win.basename(root));
}

