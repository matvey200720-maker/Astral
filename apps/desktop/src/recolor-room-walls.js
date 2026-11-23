import { ROOM_WALL_SHEETS } from "@modovik/climb-contract/recolor/room-walls";

export { ROOM_WALL_SHEETS };

const HEX_DIGITS = "0123456789abcdefABCDEF";
// Покраски «во всей арене» и «без комнаты» идут своей дорогой и в план не входят.
const OUTSIDE_PREFIXES = ["*|", "-|"];

// Цвет: решётка и ровно шесть шестнадцатеричных знаков любого регистра.
function hasUsableColour(text) {
  return text.length === 7 && text[0] === "#" && [...text.slice(1)].every((char) => HEX_DIGITS.includes(char));
}

const isOwnRoomKey = (key) => !OUTSIDE_PREFIXES.some((prefix) => key.startsWith(prefix));

// Годные покраски в порядке входа: { key, colour } с цветом строчными.
function usablePaints(shellPaint) {
  return Object.entries(shellPaint ?? {})
    .filter(([, raw]) => raw)
    .map(([key, raw]) => [key, String(raw)])
    .filter(([, text]) => hasUsableColour(text))
    .filter(([key]) => isOwnRoomKey(key))
    .map(([key, text]) => ({ key, colour: text.toLowerCase() }));
}

export function roomWallPlan(shellPaint) {
  const looked = usablePaints(shellPaint).map((paint) => ({ paint, sheet: ROOM_WALL_SHEETS[paint.key] }));
  return {
    plan: looked.filter(({ sheet }) => sheet).map(({ paint, sheet }) => ({ ...paint, ...sheet })),
    uncovered: looked.filter(({ sheet }) => !sheet).map(({ paint }) => paint.key),
  };
}

const missingFromInventory = (file) => new Error(`Файла ${file} нет в описи арены — обновите Astral.`);

// Адрес файла арены из описи (первая запись с таким именем); без адреса — ошибка.
function inventoryAddress(files, file) {
  const { at } = files.find((record) => record.name === file) ?? {};
  if (at) return at;
  throw missingFromInventory(file);
}

// Правка листа комнаты: запись файла берётся из карты или создаётся, оттенок заменяет прежний.
function paintSheet(byFile, step, at) {
  const record = byFile.get(step.file) || { at, ops: new Map() };
  record.ops.set(step.texture, { tint: step.colour });
  byFile.set(step.file, record);
}

// Шаги плана выполняются по одному; ключ отдаётся только после удачной правки.
function* paintSteps(byFile, plan, files) {
  for (const step of plan) {
    paintSheet(byFile, step, inventoryAddress(files, step.file));
    yield step.key;
  }
}

export function applyRoomWalls(byFile, plan, files) {
  return [...paintSteps(byFile, plan, files)];
}
