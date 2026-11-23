import { tintFamilyPixels } from "@modovik/ptfx-studio/family-tint.js";

// Поток перекраски листов «Огня и взрывов»: исходный лист приходит один раз на ключ,
// дальше шлют только цвет и настройки.

// Полка листов: порядок записи = старшинство, лишний лист уходит с начала.
class SheetShelf {
  static CAPACITY = 48;

  #byKey = new Map();

  keep(key, pixels) {
    this.#byKey.delete(key);
    this.#byKey.set(key, pixels);
    for (const oldest of this.#byKey.keys()) {
      if (this.#byKey.size <= SheetShelf.CAPACITY) break;
      this.#byKey.delete(oldest);
    }
  }

  lookup(key) {
    return this.#byKey.get(key);
  }
}

const shelf = new SheetShelf();

// Ответ — список аргументов для postMessage: сообщение и, при успехе, передаваемые буферы.
function answerFor({ id, key, rgba, format, rgb, settings }) {
  if (rgba) shelf.keep(key, rgba);
  const source = shelf.lookup(key);
  if (source === undefined) return [{ id, error: "source" }];
  try {
    const painted = tintFamilyPixels(source, rgb, settings, format);
    return [{ id, rgba: painted }, [painted.buffer]];
  } catch (error) {
    return [{ id, error: String(error?.message || error) }];
  }
}

self.onmessage = (event) => {
  self.postMessage(...answerFor(event.data ?? {}));
};
