// Правки клавиш кнопок паузы в frontend.xml: разбор блоков курсором, без регулярных выражений на блок.

const BUTTON_OPEN = "<CMenuButton";
const BUTTON_CLOSE = "</CMenuButton>";
const WORD_CHAR = /\w/;
const SPACE_CHAR = /\s/;

// Слова идут в описание сборки как есть. Объект обычный: наследуемые имена дают мусор намеренно.
const BUTTON_WORDS = {
  IB_RESTART: "Перезапуск",
  IB_RETRY: "Повтор",
  IB_SKIP: "Пропуск",
  IB_QUIT: "Выход",
  IB_OK: "ОК",
  IB_YES: "Да",
  IB_NO: "Нет",
  IB_BACK: "Назад",
  IB_CANCEL: "Отмена",
  IB_CONFIRM: "Подтверждение",
};

function nextBlockStart(text, from) {
  let at = text.indexOf(BUTTON_OPEN, from);
  while (at >= 0) {
    const after = text[at + BUTTON_OPEN.length];
    if (after === undefined || !WORD_CHAR.test(after)) return at;
    at = text.indexOf(BUTTON_OPEN, at + 1);
  }
  return -1;
}

class Cursor {
  constructor(text, at) {
    this.text = text;
    this.at = at;
  }

  skipSpaces() {
    while (this.at < this.text.length && SPACE_CHAR.test(this.text[this.at])) this.at += 1;
  }

  accept(token) {
    if (!this.text.startsWith(token, this.at)) return false;
    this.at += token.length;
    return true;
  }

  // Значение поля: непустой текст без пробелов и без «<», пробелы вокруг допустимы.
  field(tag) {
    this.skipSpaces();
    if (!this.accept(`<${tag}>`)) return null;
    this.skipSpaces();
    const start = this.at;
    while (
      this.at < this.text.length &&
      this.text[this.at] !== "<" &&
      !SPACE_CHAR.test(this.text[this.at])
    ) {
      this.at += 1;
    }
    const value = this.text.slice(start, this.at);
    this.skipSpaces();
    return value !== "" && this.accept(`</${tag}>`) ? value : null;
  }
}

function readButton(text, blockStart) {
  const tagEnd = text.indexOf(">", blockStart + BUTTON_OPEN.length);
  if (tagEnd < 0) return null;
  const cursor = new Cursor(text, tagEnd + 1);
  const name = cursor.field("hButtonHash");
  if (name === null) return null;
  const input = cursor.field("ButtonInput");
  if (input === null) return null;
  return { name, input, end: cursor.at };
}

// Кнопки файла; ordinal — порядковый номер среди одноимённых.
function listButtons(text) {
  const buttons = [];
  const seen = new Map();
  let from = 0;
  for (let start = nextBlockStart(text, from); start >= 0; start = nextBlockStart(text, from)) {
    const button = readButton(text, start);
    if (button === null) {
      from = start + 1;
    } else {
      const ordinal = seen.get(button.name) ?? 0;
      seen.set(button.name, ordinal + 1);
      buttons.push({ name: button.name, input: button.input, ordinal });
      from = button.end;
    }
  }
  return buttons;
}

function textOutsideBlocks(text) {
  let kept = "";
  let from = 0;
  for (let start = nextBlockStart(text, from); start >= 0; start = nextBlockStart(text, from)) {
    const close = text.indexOf(BUTTON_CLOSE, start + BUTTON_OPEN.length);
    if (close < 0) break;
    kept += text.slice(from, start);
    from = close + BUTTON_CLOSE.length;
  }
  return (kept + text.slice(from)).replace(/\s+/g, "");
}

function findTwin(buttons, { name, ordinal }) {
  return buttons.find((button) => button.name === name && button.ordinal === ordinal);
}

export function frontendButtonChanges(author, stock) {
  if (!stock) return null;
  const authorText = String(author || "");
  const stockText = String(stock);
  const authorButtons = listButtons(authorText);
  const stockButtons = listButtons(stockText);

  const changes = [];
  let authorOnly = false;
  for (const button of authorButtons) {
    const twin = findTwin(stockButtons, button);
    if (!twin) authorOnly = true;
    else if (twin.input !== button.input) {
      changes.push({ button: button.name, from: twin.input, to: button.input });
    }
  }
  const missing = stockButtons
    .filter((button) => !findTwin(authorButtons, button))
    .map((button) => button.name);

  const other = authorOnly || textOutsideBlocks(authorText) !== textOutsideBlocks(stockText);
  return missing.length ? { changes, missing, other } : { changes, other };
}

function keyName(key) {
  return String(key).replace(/^INPUT_/, "");
}

function describeChange({ button, from, to }) {
  return {
    id: `${button}\n${from}\n${to}`,
    text: `${BUTTON_WORDS[button] || button} — другой кнопкой (${keyName(to)} вместо ${keyName(from)})`,
  };
}

export function frontendButtonsLine(changes = []) {
  const parts = new Map();
  for (const { id, text } of changes.map(describeChange)) {
    if (!parts.has(id)) parts.set(id, text);
  }
  return [...parts.values()].join("; ");
}
