// Запечённые текстуры одной покраски: на каждое имя текстуры игры ровно одна
// запись, и это покрашенная запись, если такая нашлась.

export function createBakedTextures() {
  const list = [];
  const slots = new Map();

  const reactions = {
    append(key, entry, painted) {
      slots.set(key, { at: list.push(entry) - 1, painted });
    },
    swap(key, entry) {
      const slot = slots.get(key);
      list[slot.at] = entry;
      slot.painted = true;
    },
    drop() {},
  };

  function add(entry, painted) {
    const key = textureKey(entry);
    const flag = Boolean(painted);
    reactions[verdict(slots.get(key), flag)](key, entry, flag);
  }

  return { list, add };
}

// Имя без учёта регистра; пустое значение даёт пустое имя.
const textureKey = ({ texture }) => String(texture || "").toLowerCase();

// Новое имя кладём в конец; потёртую запись заменяет только первая покрашенная.
function verdict(known, painted) {
  if (!known) return "append";
  return painted && !known.painted ? "swap" : "drop";
}
