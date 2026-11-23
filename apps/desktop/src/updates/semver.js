const MAX_LENGTH = 64;
const CORE_NUMBER = /^(?:0|[1-9]\d*)$/;
const NUMERIC_ONLY = /^\d+$/;
// Идентификатор пререлиза: 0, число без ведущего нуля либо буквенно-цифровой с буквой или дефисом.
const PRERELEASE_ITEM = /^(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)$/;
const BUILD_ITEM = /^[0-9A-Za-z-]+$/;
const CORE_KEYS = ["major", "minor", "patch"];

// Все части списка (через точку) должны подойти под шаблон; пустая часть не подходит ни под один.
const everyDotted = (text, pattern) => text.split(".").every((item) => pattern.test(item));

export function parseVersion(text) {
  if (typeof text !== "string" || text.length > MAX_LENGTH) {
    return null;
  }

  const plus = text.indexOf("+");
  const withoutBuild = plus === -1 ? text : text.slice(0, plus);
  if (plus !== -1 && !everyDotted(text.slice(plus + 1), BUILD_ITEM)) {
    return null;
  }

  const dash = withoutBuild.indexOf("-");
  const core = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash);
  const tail = dash === -1 ? "" : withoutBuild.slice(dash + 1);
  if (dash !== -1 && !everyDotted(tail, PRERELEASE_ITEM)) {
    return null;
  }

  const numbers = core.split(".");
  if (numbers.length !== 3 || !numbers.every((item) => CORE_NUMBER.test(item))) {
    return null;
  }
  const [major, minor, patch] = numbers.map(Number);
  if (![major, minor, patch].every((value) => Number.isSafeInteger(value))) {
    return null;
  }

  return { major, minor, patch, prerelease: tail ? tail.split(".") : [] };
}

export const isValidVersion = (text) => parseVersion(text) !== null;

// Порядок двух идентификаторов пререлиза: числовые младше буквенных, буквенные — по кодам знаков.
function compareIdentifiers(x, y) {
  const xNumeric = NUMERIC_ONLY.test(x);
  const yNumeric = NUMERIC_ONLY.test(y);
  if (xNumeric && yNumeric) {
    return Number(x) < Number(y) ? -1 : 1;
  }
  if (xNumeric || yNumeric) {
    return xNumeric ? -1 : 1;
  }
  return x < y ? -1 : 1;
}

// Пары идентификаторов по позициям; у более короткого списка не хватает — на месте undefined.
const pairsOf = (left, right) =>
  Array.from({ length: Math.max(left.length, right.length) }, (_, index) => [left[index], right[index]]);

// Версия без пререлиза старше любой с пререлизом: 1, если пуст левый список, -1, если правый, иначе 0.
const releaseBias = (left, right) => Number(left.length === 0) - Number(right.length === 0);

function comparePrerelease(left, right) {
  const bias = releaseBias(left, right);
  if (bias !== 0 || left.length === 0) {
    return bias;
  }
  const differing = pairsOf(left, right).find(([x, y]) => x !== y);
  if (differing === undefined) {
    return 0;
  }
  const [x, y] = differing;
  if (x === undefined || y === undefined) {
    return x === undefined ? -1 : 1;
  }
  return compareIdentifiers(x, y);
}

export function compareVersions(a, b) {
  const given = [a, b];
  const parsed = given.map((value) => parseVersion(value));
  const rejected = parsed.findIndex((entry) => !entry);
  if (rejected !== -1) {
    throw new TypeError(`Неверная версия: ${given[rejected]}`);
  }

  const [left, right] = parsed;
  const differing = CORE_KEYS.map((key) => [left[key], right[key]]).find(([x, y]) => x !== y);
  if (differing !== undefined) {
    return differing[0] < differing[1] ? -1 : 1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}
