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

export const SHARED_DATA_DIR_NAME = "Astral";

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

export const shortcutName = (branch) => `${branch.product}.lnk`;

function withoutTrailingSeparators(text) {
  let end = text.length;
  while (end > 0 && (text[end - 1] === "\\" || text[end - 1] === "/")) {
    end -= 1;
  }
  return text.slice(0, end);
}

export function siblingRootsOf(root) {
  const own = withoutTrailingSeparators(win.normalize(String(root)));
  const parent = win.dirname(own);
  if (parent === own) {
    return [];
  }
  const ownKey = own.toLowerCase();
  const found = [];
  for (const branch of BRANCHES) {
    const candidate = win.join(parent, branch.product);
    if (candidate.toLowerCase() !== ownKey) {
      found.push(candidate);
    }
  }
  return found;
}
