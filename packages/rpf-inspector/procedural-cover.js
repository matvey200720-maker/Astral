// Сравнение таблиц procedural.meta: сколько записей было в файле игры и сколько оставил автор.

const COVER_TABLES = [
  { id: "grass", tag: "plantInfos" },
  { id: "other", tag: "procObjInfos" },
];

const ENTRY_OPEN = "<Item";
const WORD_CHAR = /\w/;

const COMMENT = /<!--[\s\S]*?-->/g;

// Самозакрытая таблица («<plantInfos />», так пустой список пишет CodeWalker) — пустая, а не
// отсутствующая; комментарии убраны заранее: закомментированная старая таблица не заслоняет настоящую.
function tableBody(text, tag) {
  const open = new RegExp(`<${tag}(?:\\s[^>]*)?\\/?>`).exec(text);
  if (!open) return null;
  if (open[0].endsWith("/>")) return "";
  const bodyStart = open.index + open[0].length;
  const end = text.indexOf(`</${tag}>`, bodyStart);
  return end < 0 ? null : text.slice(bodyStart, end);
}

function countEntries(body) {
  let count = 0;
  for (
    let at = body.indexOf(ENTRY_OPEN);
    at >= 0;
    at = body.indexOf(ENTRY_OPEN, at + ENTRY_OPEN.length)
  ) {
    const next = body[at + ENTRY_OPEN.length];
    if (next === undefined || !WORD_CHAR.test(next)) count += 1;
  }
  return count;
}

function entriesOf(text, tag) {
  const body = tableBody(text, tag);
  return body === null ? null : countEntries(body);
}

export function proceduralCoverGroups(author, stock) {
  const authorText = String(author || "").replace(COMMENT, "");
  const stockText = String(stock || "").replace(COMMENT, "");
  const groups = [];
  for (const { id, tag } of COVER_TABLES) {
    const after = entriesOf(authorText, tag);
    const before = entriesOf(stockText, tag);
    if (before !== null && after !== null && before !== after) {
      groups.push({ id, before, after });
    }
  }
  return groups;
}
