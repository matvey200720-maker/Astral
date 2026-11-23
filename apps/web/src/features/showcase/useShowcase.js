import { useEffect, useRef, useState } from "react";
import { pickWeighted as weigh } from "@modovik/contracts/showcase-v1";
import { recordShowcaseEvent } from "./events.js";
import { useAttentionAllows as useAttention } from "../../attention.js";
import { showcaseAllowed } from "./policy.js";
import { getCloudShowcase as askCloud } from "../../api.js";

function resetShowcaseCache() {
  cache.reset();
}

function useShowcaseItem(props) {
  const { screen, place, mod = null } = props;
  const { slot = place, load = askCloud, random = Math.random } = props;
  const allowed = showcaseAllowed({ place, screen, mod });
  const [item, setItem] = useState(allowed ? () => cache.recall(place, slot) : null);

  useEffect(() => enter(allowed, place, slot, load, random, setItem), [allowed, place, slot, load, random]);

  if (!allowed) return null;
  return item;
}

// Место видно хотя бы наполовину, пока окно внимательно.
function useSeen(ref, item) {
  const [visible, setVisible] = useState(false);
  const attentive = useAttention("motion");
  const live = Boolean(item);

  useEffect(() => (live ? new Watch(ref.current, setVisible).start().stop : undefined), [ref, live]);

  return visible && attentive;
}

function useShowcaseView(ref, item, options = {}) {
  const { slot, holdMs = HOLD_MS } = options;
  const seen = useSeen(ref, item);
  const counted = useRef(null);
  counted.current ??= new Set();

  useEffect(() => {
    if (!item || !seen || counted.current.has(item.id)) return undefined;
    const hold = new Hold(holdMs, () => {
      counted.current.add(item.id);
      recordShowcaseEvent(item.id, "view", { slot });
    });
    return hold.start().stop;
  }, [item, seen, slot, holdMs]);
}

// Отдаёт креатив в onItem: закрытому месту null, открытому выбор из памяти или после ответа облака.
// Пока ждёт ответ, возвращает отмену ожидания.
function enter(allowed, place, slot, load, random, onItem) {
  const key = pickKey(place, slot);
  const startedAt = Date.now();
  const entry = cache.picks.get(key);
  switch (true) {
    case !allowed:
      onItem(null);
      return undefined;
    case fresh(entry, startedAt):
      onItem(entry[1]);
      return undefined;
    default: {
      const reader = new Reader();
      (async () => {
        const list = await cache.listFor(place, load, startedAt);
        if (reader.open) onItem(choose(list, random, key, startedAt));
      })();
      return reader.stop;
    }
  }
}

// Выбор по весам запоминается под ключом с моментом начала эффекта.
function choose(list, random, key, startedAt) {
  const chosen = weigh(list, random);
  cache.picks.set(key, [startedAt, chosen]);
  return chosen;
}

// Любая ошибка облака, в том числе синхронная, и ответ не списком дают пустой список.
async function ask(place, load) {
  try {
    const answer = await load(place);
    return Array.isArray(answer) ? answer : [];
  } catch {
    return [];
  }
}

// Ожидание ответа облака, которое можно отменить.
class Reader {
  open = true;

  stop = () => {
    this.open = false;
  };
}

// Подписка на видимость узла: из пачки записей решает последняя.
class Watch {
  constructor(node, onVisible) {
    this.node = node;
    this.onVisible = onVisible;
    this.io = null;
  }

  start() {
    const Observer = globalThis.IntersectionObserver;
    if (this.node && Observer) {
      this.io = new Observer(this.onEntries, { threshold: [0, VISIBLE_FROM, 1] });
      this.io.observe(this.node);
    }
    return this;
  }

  onEntries = (entries) => {
    for (const entry of entries) this.onVisible(entry.intersectionRatio >= VISIBLE_FROM);
  };

  stop = () => {
    this.io?.disconnect();
  };
}

// Секундная задержка показа.
class Hold {
  constructor(ms, job) {
    this.ms = ms;
    this.job = job;
    this.timer = null;
  }

  start() {
    this.timer = setTimeout(this.job, this.ms);
    return this;
  }

  stop = () => {
    clearTimeout(this.timer);
  };
}

const KEEP_MS = 5 * 60 * 1000;
const HOLD_MS = 1000;
const VISIBLE_FROM = 0.5;

const pickKey = (place, slot) => `pick:${place}:${slot}`;

// Запись памяти — [момент, значение]; свежая, пока не прошло KEEP_MS.
const fresh = (entry, now) => Boolean(entry) && now - entry[0] < KEEP_MS;

// Память окна: список креативов по месту и выбранный креатив по «место:слот».
const cache = {
  lists: new Map(),
  picks: new Map(),
  reset() {
    this.lists.clear();
    this.picks.clear();
  },
  recall(place, slot) {
    return this.picks.get(pickKey(place, slot))?.[1] || undefined;
  },
  listFor(place, load, now) {
    const kept = this.lists.get(place);
    if (fresh(kept, now)) return kept[1];
    const fetched = ask(place, load);
    this.lists.set(place, [now, fetched]);
    return fetched;
  },
};

export { resetShowcaseCache, useShowcaseItem, useShowcaseView };
