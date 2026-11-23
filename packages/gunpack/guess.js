// Игровые имена для файлов с произвольными именами, когда канал говорит ровно об одном стволе.
import { weaponById } from "@modovik/rpf-inspector/weapon-identity";

const GAME_NAME = /^w_[a-z]{2}_/i;
const MODEL_FILE = { suffix: /\.ydr$/i, extension: ".ydr", separators: ["_"] };
const TEXTURE_FILE = { suffix: /\.ytd$/i, extension: ".ytd", separators: ["+", "_"] };

function describeFile({ path }) {
  const text = String(path || "");
  return { path, text, name: text.slice(text.lastIndexOf("/") + 1) };
}

const stemOf = (file, kind) => file.name.slice(0, -kind.extension.length).toLowerCase();

// Первая из самых коротких основ, если остальные от неё производны; иначе набор спорный.
function baseOfSet(stems, separators) {
  const base = stems.reduce((shortest, stem) => (stem.length < shortest.length ? stem : shortest));
  const related = stems.every(
    (stem) => stem === base || separators.some((mark) => stem.startsWith(base + mark)),
  );
  return related ? base : null;
}

// Пары «исходный путь — новое имя» для одного вида файлов или null, если набор спорный.
function renamesOfKind(described, kind, gameModel) {
  const files = described.filter((file) => kind.suffix.test(file.text));
  if (files.length === 0) return [];
  const stems = files.map((file) => stemOf(file, kind));
  const base = baseOfSet(stems, kind.separators);
  if (base === null) return null;
  return files.map((file, index) => [
    file.path,
    `${gameModel}${stems[index].slice(base.length)}${kind.extension}`,
  ]);
}

export function guessRenamed(files, channel) {
  const weapons = channel?.weapons;
  if (weapons?.length !== 1) return null;
  const gameModel = weaponById(weapons[0])?.model;
  if (!gameModel) return null;

  const described = (files || []).map(describeFile);
  if (described.some((file) => GAME_NAME.test(file.name))) return null;

  const models = renamesOfKind(described, MODEL_FILE, gameModel);
  if (!models || models.length === 0) return null;
  const textures = renamesOfKind(described, TEXTURE_FILE, gameModel);
  if (!textures) return null;
  return new Map([...models, ...textures]);
}

function renamedEntry(entry, rename) {
  const target = rename.get(entry.path);
  if (!target) return entry;
  const source = String(entry.path || "");
  const folder = source.slice(0, Math.max(source.lastIndexOf("/"), 0));
  return {
    ...entry,
    path: folder ? `${folder}/${target}` : String(target),
    renamedFrom: entry.path,
    read: () => entry.read(),
  };
}

export function renamedTree(tree, rename) {
  const files = (tree?.files || []).map((entry) => renamedEntry(entry, rename));
  return { ...tree, files };
}
