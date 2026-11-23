import { ACTION, classTapes } from "@modovik/gfx";

// Цвета смены цели штатного файла по порядку случаев; враг — индекс 3.
export const STOCK_LOCK_ON = Object.freeze(
  [
    [255, 255, 255],
    [208, 255, 176],
    [255, 142, 60],
    [255, 28, 33],
    [255, 255, 255],
  ].map((colour) => Object.freeze(colour)),
);

const ENEMY_INDEX = 3;
const STOCK_CASES = 5;

// Узоры по токенам ленты: каждый элемент — проверка одного токена.
const value = (expected) => (token) => token.value === expected;
const operation = (code) => (token) => token.op === code;
const number = (token) => typeof token.value === "number";
const registerRef = (token) =>
  token.value !== null && typeof token.value === "object" && "register" in token.value;

const COLOUR_PATTERN = [
  value("DEFAULT_COLOUR"),
  number,
  number,
  number,
  number,
  value(4),
  operation(ACTION.INIT_ARRAY),
];
const LOCK_ON_PATTERN = [number, number, number, number, registerRef, value("reticleMC")];
const FORCED_VISIBLE_PATTERN = [
  value("CONTENT"),
  operation(ACTION.GET_MEMBER),
  value("_visible"),
  value(true),
  operation(ACTION.SET_MEMBER),
];
const DIM_PATTERN = [value("_alpha"), number, operation(ACTION.SET_MEMBER)];

function* matchesOf(tokens, pattern) {
  for (let start = 0; start + pattern.length <= tokens.length; start++) {
    if (pattern.every((test, offset) => test(tokens[start + offset]))) yield start;
  }
}

const methodTokens = (tape, name) => tape.filter((token) => token.method === name);

function readColour(tokens) {
  for (const at of matchesOf(tokens, COLOUR_PATTERN)) {
    // В коде числа идут в обратном порядке: прозрачность, синий, зелёный, красный.
    const [alpha, blue, green, red] = tokens.slice(at + 1, at + 5).map((token) => token.value);
    return { colour: [red, green, blue], alpha };
  }
  return { colour: null, alpha: null };
}

function readLockOn(tokens) {
  return [...matchesOf(tokens, LOCK_ON_PATTERN)].map((at) => {
    const [, blue, green, red] = tokens.slice(at, at + 4).map((token) => token.value);
    return [red, green, blue];
  });
}

function readDimAlpha(tokens) {
  for (const at of matchesOf(tokens, DIM_PATTERN)) return tokens[at + 1].value;
  return null;
}

export function readReticleScript(gfx) {
  const [tape] = classTapes(gfx, ["SET_RETICLE_LOCKON_TYPE", "HUD_RETICLE"]);
  if (!tape) return null;

  const { colour, alpha } = readColour(methodTokens(tape, "HUD_RETICLE"));
  const lockOn = readLockOn(methodTokens(tape, "SET_RETICLE_LOCKON_TYPE"));
  const forced = methodTokens(tape, "SET_RETICLE_VISIBLE");
  const alwaysVisible = !matchesOf(forced, FORCED_VISIBLE_PATTERN).next().done;
  const dimAlpha = readDimAlpha(methodTokens(tape, "START_DIM_RETICLE"));
  return { colour, alpha, lockOn, alwaysVisible, dimAlpha };
}

// Читаются только length и индексы: строка и объект «как массив» тоже проходят.
export function enemyColour(lockOn = []) {
  return lockOn.length === STOCK_CASES ? lockOn[ENEMY_INDEX] : null;
}

export function customLockOn(lockOn = []) {
  if (lockOn.length !== STOCK_CASES) return lockOn.length > 0;
  return lockOn.some(
    (colour, index) =>
      index !== ENEMY_INDEX &&
      colour.some((channel, at) => channel !== STOCK_LOCK_ON[index][at]),
  );
}
