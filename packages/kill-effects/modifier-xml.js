// Печать элемента <modifier> в формате игры: тот же текст пишет установщик
// и показывает окно для ручной вставки.
import { KILL_MODIFIER_NAME } from "./game-contract.js";
import { resolveKillEffectFields } from "./project.js";

const SCALE = 1e6;
const MIN_FRACTION_DIGITS = 3;

export function formatModifierValue(value) {
  let number = Number(value);
  if (Number.isNaN(number)) number = 0;
  if (!Number.isFinite(number)) return number > 0 ? "Infinity" : "-Infinity";
  // Сначала округление (так малое отрицательное становится нулём без знака), затем печать.
  const printed = (Math.round(number * SCALE) / SCALE).toFixed(6);
  const dot = printed.indexOf(".");
  if (dot < 0) return printed; // экспонента у чисел от 1e21
  let end = printed.length;
  while (end > dot + 1 + MIN_FRACTION_DIGITS && printed[end - 1] === "0") end -= 1;
  return printed.slice(0, end);
}

export function serializeKillModifierNode(fields, { newline = "\n", indent = "  " } = {}) {
  const outer = String(indent);
  const inner = outer + outer;
  const rows = fields.map(([name, first, second]) => {
    return `${inner}<${name}>${formatModifierValue(first)} ${formatModifierValue(second)}</${name}>`;
  });
  const opening = `${outer}<modifier name="${KILL_MODIFIER_NAME}" numMods="${fields.length}" userFlags="0">`;
  return [opening, ...rows, `${outer}</modifier>`, ""].join(newline);
}

export function killEffectModifierSnippet(project) {
  return serializeKillModifierNode(resolveKillEffectFields(project)).trimEnd();
}
