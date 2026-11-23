import { ACTION, classTapes } from "@modovik/gfx";

// Игровые данные hudcolor.dat: цвета, которыми мини-карта красит полосы.
const PALETTE_ROWS = [
  ["HUD_COLOUR_GREEN", [114, 204, 114]],
  ["HUD_COLOUR_BLUE", [93, 182, 229]],
  ["HUD_COLOUR_RED", [224, 50, 50]],
  ["HUD_COLOUR_WHITE", [240, 240, 240]],
];

export const HUD_PALETTE = Object.freeze(Object.fromEntries(PALETTE_ROWS.map(([name, rgb]) => [name, Object.freeze(rgb)])));

// Кода действия new (0x53) в ACTION нет.
const OP_NEW = 83;
const WHITE = [255, 255, 255];
const SETUP = "SETUP_HEALTH_ARMOUR";
const PLAYER_HEALTH = "SET_PLAYER_HEALTH";
const PALETTE_PREFIX = "HUD_COLOUR_";

// Окна поиска назад и вперёд, в токенах.
const HUD_SPAN = 31;
const COM_SPAN = 15;
const FIELD_SPAN = 12;
const ARGS_SPAN = 15;
const CHANNEL_SPAN = 13;
const THRESHOLD_SPAN = 8;

// Лента токенов с короткими чтениями; индексы вне ленты дают undefined.
class Tape {
  constructor(tokens) {
    this.tokens = tokens;
  }

  value(at) {
    return this.tokens[at]?.value;
  }

  method(at) {
    return this.tokens[at]?.method;
  }

  isOp(at, code) {
    return this.tokens[at]?.op === code;
  }

  // Ближайший назад от from (не дальше span шагов) индекс, где test истинно; иначе null.
  backTo(from, span, test) {
    for (let at = from - 1; at >= from - span; at -= 1) if (test(at)) return at;
    return null;
  }
}

const isRegister = (value) => typeof value?.register === "number";

const isPaletteName = (value) => typeof value === "string" && value.startsWith(PALETTE_PREFIX);

const paletteTriple = (name) => (Object.hasOwn(HUD_PALETTE, name) ? [...HUD_PALETTE[name]] : null);

const DIGIT_SIDES = new Map([
  ["currentHealthValue", "health"],
  ["currentArmourValue", "armour"],
]);

export function readDigitFields(tokens) {
  const found = { health: null, armour: null };
  tokens.forEach((token, at) => {
    const field = tokens[at - 2]?.value;
    if (token.value !== "text" || tokens[at - 1]?.op !== ACTION.GET_MEMBER || typeof field !== "string") return;
    // Просмотр: пять токенов после text, до первого SET_MEMBER.
    const reach = tokens.slice(at + 1, at + 6);
    const stop = reach.findIndex((next) => next?.op === ACTION.SET_MEMBER);
    const seen = stop < 0 ? reach : reach.slice(0, stop);
    for (const side of seen.map((next) => DIGIT_SIDES.get(next?.value))) {
      if (side && found[side] === null) found[side] = field;
    }
  });
  return Object.values(found).every((one) => one === null) ? null : found;
}

export function readGaugePlace(tokens) {
  const tape = new Tape(tokens);
  for (let at = 0; at + 7 <= tokens.length; at += 1) {
    const [name, fieldX, x, fieldY, y] = [0, 1, 2, 3, 4].map((step) => tape.value(at + step));
    const shaped = name === "DEPTHGUAGE" && fieldX === "_x" && fieldY === "_y";
    if (shaped && typeof x === "number" && typeof y === "number" && tape.isOp(at + 6, ACTION.INIT_OBJECT)) return { x, y };
  }
  return null;
}

export function readArmourScale(tokens) {
  const written = [];
  tokens.forEach((token, at) => {
    const amount = tokens[at + 1]?.value;
    if (token.value === "multiplayerScaleModifier" && typeof amount === "number" && tokens[at + 2]?.op === ACTION.SET_MEMBER) written.push(amount);
  });
  return written.length === 0 ? null : Math.round(Math.max(0, ...written) * 1000) / 1000;
}

// Вызовы палитры: setHudColour + CALL_METHOD → { at, method, target, hud }.
function paletteCalls(tape) {
  const calls = [];
  tape.tokens.forEach((token, at) => {
    if (token.value !== "setHudColour" || !tape.isOp(at + 1, ACTION.CALL_METHOD)) return;
    const hudAt = tape.backTo(at, HUD_SPAN, (i) => isPaletteName(tape.value(i)));
    if (hudAt === null) return;
    const comAt = tape.backTo(hudAt, COM_SPAN, (i) => tape.value(i) === "com") ?? hudAt - 16;
    const target = tape.isOp(comAt - 1, ACTION.GET_MEMBER) ? tape.value(comAt - 2) : tape.value(comAt - 1);
    calls.push({ at, method: token.method, target, hud: tape.value(hudAt) });
  });
  return calls;
}

// Покраски: Colourise + CALL_METHOD → { at, method, source, target }.
function colouriseCalls(tape) {
  const calls = [];
  tape.tokens.forEach((token, at) => {
    if (token.value !== "Colourise" || !tape.isOp(at + 1, ACTION.CALL_METHOD)) return;
    const fiveAt = tape.backTo(at, ARGS_SPAN, (i) => tape.value(i) === 5 && tape.value(i + 1) === "com");
    if (fiveAt === null) return;
    const redAt = tape.backTo(fiveAt, CHANNEL_SPAN, (i) => tape.value(i) === "r" && tape.isOp(i + 1, ACTION.GET_MEMBER));
    if (redAt === null) return;
    const holder = tape.tokens[redAt - 1];
    const viaName = holder?.op === ACTION.GET_MEMBER || holder?.op === ACTION.GET_VARIABLE;
    const source = viaName ? tape.value(redAt - 2) : holder?.value;
    const targetAt = tape.backTo(fiveAt, fiveAt - redAt - 2, (i) => typeof tape.value(i) === "string");
    calls.push({ at, method: token.method, source, target: targetAt === null ? undefined : tape.value(targetAt) });
  });
  return calls;
}

// Литерал {r, g, b} после имени: три пары «ключ, число», число полей 3, INIT_OBJECT.
function literalColour(tape, at) {
  if (tape.value(at + 7) !== 3 || !tape.isOp(at + 8, ACTION.INIT_OBJECT)) return null;
  const rgb = [undefined, undefined, undefined];
  for (const pair of [0, 1, 2]) {
    const slot = ["r", "g", "b"].indexOf(tape.value(at + 1 + pair * 2));
    const amount = tape.value(at + 2 + pair * 2);
    if (slot < 0 || typeof amount !== "number") return null;
    rgb[slot] = amount;
  }
  return { rgb, hud: null };
}

// new HudColour(): после имени 0, затем в пределах окна HudColour и сразу за ним код new.
function constructedColour(tape, at) {
  if (tape.value(at + 1) !== 0) return null;
  const window = Array.from({ length: FIELD_SPAN }, (_, step) => at + 2 + step);
  const classAt = window.find((i) => tape.value(i) === "HudColour");
  return classAt !== undefined && tape.isOp(classAt + 1, OP_NEW) ? { rgb: [...WHITE], hud: null } : null;
}

const paletteColour = (hud) => ({ rgb: paletteTriple(hud), hud });

// Цвет члена: побеждает последняя запись; записи SETUP_HEALTH_ARMOUR идут после остальных.
function memberColour(tape, name, palette) {
  const written = tape.tokens.flatMap((token, at) => {
    const colour = token.value === name ? literalColour(tape, at) ?? constructedColour(tape, at) : null;
    return colour ? [{ at, method: token.method, colour }] : [];
  });
  const called = palette.filter((call) => call.target === name).map(({ at, method, hud }) => ({ at, method, colour: paletteColour(hud) }));
  const strength = (record) => (record.method === SETUP ? 1 : 0);
  const ranked = [...written, ...called].sort((a, b) => strength(a) - strength(b) || a.at - b.at);
  return ranked.at(-1)?.colour ?? null;
}

// Полоса HP при малом запасе: чем красят цель HEALTH.
function lowHealthPaint(colourises) {
  const onHealth = colourises.filter((call) => call.target === "HEALTH");
  if (onHealth.length === 0) return null;
  return onHealth.some((call) => call.source === "colourRed") ? "colourRed" : "colourHealth";
}

// Порог «мало HP»: число после регистра и перед GREATER внутри SET_PLAYER_HEALTH, дальше healthLow.
function lowHealthThreshold(tape) {
  const hit = tape.tokens.findIndex((token, at) => {
    if (token.method !== PLAYER_HEALTH || typeof token.value !== "number") return false;
    if (!isRegister(tape.value(at - 1)) || !tape.isOp(at + 1, ACTION.GREATER)) return false;
    return Array.from({ length: THRESHOLD_SPAN }, (_, step) => tape.value(at + 2 + step)).includes("healthLow");
  });
  return hit < 0 ? null : tape.value(hit);
}

// Вспышка урона: последняя палитра в регистр или переменную перед первой покраской healthHitMC.
function damageFlash(palette, colourises) {
  const flash = colourises.find((call) => call.method === SETUP && call.target === "healthHitMC");
  if (!flash) return null;
  const named = (target) => typeof target === "string" && target.startsWith("colour");
  const before = palette.filter((call) => call.method === SETUP && call.at < flash.at && !named(call.target));
  return before.length > 0 ? paletteColour(before.at(-1).hud) : null;
}

export function readMinimapScript(gfx) {
  const [tokens] = classTapes(gfx, [SETUP, PLAYER_HEALTH]);
  if (!tokens) return null;

  const tape = new Tape(tokens);
  const palette = paletteCalls(tape);
  const colourises = colouriseCalls(tape);
  const answers = [
    ["health", () => memberColour(tape, "colourHealth", palette)],
    ["armour", () => memberColour(tape, "colourArmour", palette)],
    ["red", () => memberColour(tape, "colourRed", palette)],
    ["ability", () => memberColour(tape, "colourAbility", palette)],
    ["low", () => lowHealthPaint(colourises)],
    ["threshold", () => lowHealthThreshold(tape)],
    ["digits", () => readDigitFields(tokens)],
    ["gauge", () => readGaugePlace(tokens)],
    ["armourScale", () => readArmourScale(tokens)],
    ["damage", () => damageFlash(palette, colourises)],
  ];
  return Object.fromEntries(answers.map(([key, derive]) => [key, derive()]));
}
