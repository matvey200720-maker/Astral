// Одно письмо на всё окно: кнопка «Редактировать» кладёт, страница раздела забирает.
const LIFETIME_MS = 60_000;

class Mailbox {
  #letter = null;

  put(letter) {
    this.#letter = letter;
  }

  clear() {
    this.#letter = null;
  }

  // Письмо читается один раз: ячейка пустеет и тогда, когда оно просрочено.
  collect(isAlive) {
    const letter = this.#letter;
    this.#letter = null;
    return letter !== null && isAlive(letter) ? letter : null;
  }
}

const mailbox = new Mailbox();

// Умолчание только вместо undefined: null, 0 и пустая строка остаются как есть.
const orElse = (value, fallback) => (value === undefined ? fallback : value);

export function requestOptimizerFocus(input = {}) {
  const layers = orElse(input.layers, []);
  if (!(layers.length > 0)) {
    mailbox.clear();
    return;
  }
  mailbox.put({
    layers: [...layers],
    source: orElse(input.source, ""),
    facts: [...orElse(input.facts, [])],
    back: orElse(input.back, null),
    at: Date.now(),
  });
}

export function takeOptimizerFocus() {
  return mailbox.collect((letter) => Date.now() - letter.at < LIFETIME_MS);
}
