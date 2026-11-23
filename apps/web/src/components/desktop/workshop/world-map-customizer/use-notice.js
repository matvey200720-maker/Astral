// Уведомление в строке статуса: вспышка, которая гаснет через 4 секунды.
import { useEffect, useRef, useState } from "react";
import { NOTICE_MS as FADE_MS } from "./panel-data.js";

// Пустое уведомление: ничего не показано, таймера нет
const NONE = "";

// Одно уведомление и один таймер его гашения. Новое значение заменяет прежнее и отменяет
// его таймер; то же значение ничего не меняет; пустая строка таймера не заводит.
class NoticeFade {
  shown = NONE;

  timer = 0;

  constructor(show) {
    this.show = show;
  }

  set = (next) => {
    if (Object.is(next, this.shown)) return;
    this.shown = next;
    this.stop();
    this.show(next);
    if (next) this.timer = setTimeout(this.clear, FADE_MS);
  };

  clear = () => this.set(NONE);

  stop() {
    clearTimeout(this.timer);
    this.timer = 0;
  }
}

export function useNotice() {
  const [notice, show] = useState(NONE);
  const holder = useRef(null);
  if (holder.current === null) holder.current = new NoticeFade(show);
  const fade = holder.current;

  // при закрытии окна таймер не должен дожить до сброса
  useEffect(() => () => fade.stop(), [fade]);

  return { notice, notify: fade.set };
}
