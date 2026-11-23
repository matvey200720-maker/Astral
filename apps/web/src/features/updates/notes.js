// Заметки «Что нового» приходят с сервера простым текстом и рисуются только текстовыми узлами:
// подписанный манифест не значит «безопасно вставлять как HTML», поэтому разметки внутри строки
// нет вовсе, а блоков три вида: подзаголовок, абзац, список (docs/beta/release-channels.md §5.4).

const BULLET_MARKS = "-*•–—";
const HEADING_MAX_HASHES = 3;

const isSpace = (char) => /\s/.test(char);

// «#», «##» или «###», пробельный знак и текст. Четыре решётки и «#текст» — обычная строка.
function headingText(trimmed) {
  let hashes = 0;
  while (trimmed[hashes] === "#") hashes += 1;
  if (hashes === 0 || hashes > HEADING_MAX_HASHES) return null;
  const next = trimmed[hashes];
  return next !== undefined && isSpace(next)
    ? trimmed.slice(hashes).trim()
    : null;
}

// Смотрим на необрезанную строку: «- » (метка и пробел) — пункт с пустым текстом.
function bulletText(line) {
  let at = 0;
  while (at < line.length && isSpace(line[at])) at += 1;
  const mark = line[at];
  if (mark === undefined || !BULLET_MARKS.includes(mark)) return null;
  const gap = line[at + 1];
  return gap !== undefined && isSpace(gap) ? line.slice(at + 2).trim() : null;
}

export function parseNotes(text) {
  const source = text === null || text === undefined ? "" : String(text);
  const blocks = [];
  let open = null;
  for (const line of source.split(/\r\n|\r|\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") {
      open = null;
      continue;
    }
    const heading = headingText(trimmed);
    if (heading !== null) {
      blocks.push({ type: "h", text: heading });
      open = null;
      continue;
    }
    const item = bulletText(line);
    if (item !== null) {
      if (open?.type === "ul") {
        open.items.push(item);
      } else {
        open = { type: "ul", items: [item] };
        blocks.push(open);
      }
      continue;
    }
    if (open?.type === "ul") {
      open.items[open.items.length - 1] += ` ${trimmed}`;
    } else if (open) {
      open.text += ` ${trimmed}`;
    } else {
      open = { type: "p", text: trimmed };
      blocks.push(open);
    }
  }
  return blocks;
}
