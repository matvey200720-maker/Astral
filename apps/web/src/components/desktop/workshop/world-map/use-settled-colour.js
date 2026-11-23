import { useState, useEffect, useCallback } from "react";

const isHex = (value) => typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);

// Какие цвета подложки поменялись в next. null, если правка не только про цвета.
export function baseColourChanges(next, current) {
  if (!next?.base || !current?.base || next.base === current.base) return null;

  const changed = [];
  for (const [key, value] of Object.entries(next.base)) {
    if (value === current.base[key]) continue;
    if (!isHex(value)) return null;
    changed.push([key, value]);
  }
  if (!changed.length) return null;

  for (const key of Object.keys(next)) {
    if (key !== "base" && next[key] !== current[key]) return null;
  }
  return Object.fromEntries(changed);
}

export const COLOUR_SETTLE_MS = 220;

// Копилка: правка чужой части карты забирает накопленные цвета, если не трогала их сама.
function withHeldColours(next, held, currentBase) {
  const base = { ...next.base };
  Object.keys(held).forEach((key) => {
    if (base[key] === currentBase?.[key]) base[key] = held[key];
  });
  return { ...next, base };
}

class Desk {
  constructor(show) {
    this.show = show;
    this.entry = null;
    this.timer = null;
    this.sink = null;
    this.config = null;
  }

  sync(sink, config) {
    this.sink = sink;
    this.config = config;
  }

  clear() {
    clearTimeout(this.timer);
    this.timer = null;
    this.entry = null;
    this.show(false);
  }

  flush = () => {
    const { entry, sink } = this;
    if (!entry) return;
    this.clear();
    sink(entry.next, entry.label, entry.property);
  };

  accept(next, label, property, delay) {
    const changes = baseColourChanges(next, this.config);

    if (changes === null) {
      const held = this.entry?.colours;
      const { sink } = this;
      const outgoing = held && next?.base ? withHeldColours(next, held, this.config?.base) : next;
      this.clear();
      sink(outgoing, label, property);
      return;
    }

    const colours = { ...this.entry?.colours, ...changes };
    this.entry = {
      colours,
      next: { ...next, base: { ...next.base, ...colours } },
      label,
      property,
    };
    this.show(true);
    clearTimeout(this.timer);
    this.timer = setTimeout(this.flush, delay);
  }
}

export function useSettledColourPatch(apply, config, settleMs = COLOUR_SETTLE_MS) {
  const [settling, setSettling] = useState(false);
  const [desk] = useState(() => new Desk(setSettling));
  desk.sync(apply, config);

  useEffect(() => desk.flush, [desk]);

  const submit = useCallback(
    (next, label, property = "") => {
      desk.accept(next, label, property, settleMs);
    },
    [desk, settleMs],
  );

  return { apply: submit, settling };
}
