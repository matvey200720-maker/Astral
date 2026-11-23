import * as assortment from "@modovik/clothing/game-assortment";
import * as looks from "@modovik/clothing/game-looks";
import * as models from "./clothing-models.js";
import { readGameClothingIndex } from "./game-clothing-index.js";

const REASON_LIMIT = 200;

// Память ответов: по корню игры хранится одна пара «отпечаток оглавления → ответ».
const answersByRoot = new Map();

function cachedAnswer(root, index) {
  const entry = answersByRoot.get(root);
  const { fingerprint } = index;
  if (fingerprint && entry?.fingerprint === fingerprint) {
    return entry.answer;
  }
  return undefined;
}

function rememberAnswer(root, index, answer) {
  answersByRoot.set(root, { fingerprint: index.fingerprint, answer });
  return answer;
}

function reasonOf(failure) {
  return String(failure?.message || failure).slice(0, REASON_LIMIT);
}

// Правило «строка → крой»: ключ вид|папка|номер, крой только у мужских вещей.
const shapeKeyOf = (row) => ["component", "folder", "drawable"].map((field) => String(row[field])).join("|");

function shapedRows(rows, shapes) {
  return rows.map((row) => {
    if (row.gender !== "male") return row;
    const key = shapeKeyOf(row);
    return shapes.has(key) ? { ...row, shape: shapes.get(key) } : row;
  });
}

// Строки окна: сначала таблица одинаковых вещей, затем сами строки, затем крой.
async function rowsOf(index) {
  const table = await models.readGameLooks().catch(() => null);
  const rows = await assortment.gameAssortmentRows(index, table ? looks.looksIndex(table) : null);
  const shapes = await models.gameShapeIndex().catch(() => new Map());
  return shapes.size ? shapedRows(rows, shapes) : rows;
}

function isLegacy(game) {
  return game.edition === "Legacy";
}

export function pickGameRoot(games) {
  const chosen = games.find(isLegacy) || games[0];
  return chosen?.path || "";
}

export async function listGameClothingItems(options) {
  const { stateDir, keysDirectory } = options;
  const gameRoot = options.gameRoot === undefined ? "" : options.gameRoot;
  const discover = options.discover === undefined ? async () => [] : options.discover;
  const readIndex = options.readIndex === undefined ? readGameClothingIndex : options.readIndex;

  let root;
  if (gameRoot) {
    root = String(gameRoot);
  } else {
    const games = await discover().catch(() => []);
    root = pickGameRoot(games);
  }
  if (!root) return { status: "no-game", rows: [] };

  try {
    const index = await readIndex({ gameRoot: root, stateDir, keysDirectory });
    const known = cachedAnswer(root, index);
    if (known !== undefined && known !== null) return known;
    const rows = await rowsOf(index);
    return rememberAnswer(root, index, { status: "ready", rows });
  } catch (failure) {
    return { status: "unreadable", reason: reasonOf(failure), rows: [] };
  }
}

export function listGameClothingItemsInThread(request, context, deps = {}) {
  const keysDirectory = request?.keys || null;
  return listGameClothingItems({
    stateDir: deps.stateDir,
    keysDirectory,
    gameRoot: request?.gameRoot,
  });
}
