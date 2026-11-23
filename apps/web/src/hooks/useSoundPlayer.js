import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { burstClock, startBurst, stopBurst } from "./sound-burst-engine.js";

// Проигрыватель один на окно, одновременно звучит одна дорожка (eb2ad1266, 28.09.2026).
// Общий scope связывает кадр на странице мода со списком под ним (Т-114, 30.09.2026);
// без scope у компонента своя область: файлы разных заявок называются одинаково.
// Состояние дорожки: владелец и ключ; tick растёт при каждой смене. По нему React узнаёт,
// что пора перерисоваться, а прерванный play — что его опередили.
let el = null;
let tick = 0;
let who = null;
let what = null;
const subs = new Set();

const watch = (fn) => (subs.add(fn), () => subs.delete(fn));

const reset = (owner, key) => {
  who = owner;
  what = key;
  tick += 1;
  subs.forEach((fn) => fn());
};

const makeAudio = () => {
  const audio = Object.assign(new Audio(), { volume: 0.6 });
  audio.addEventListener("ended", () => who && reset(null, null));
  return audio;
};

const halt = (owner) => {
  if (who !== owner) return;
  el.pause();
  stopBurst();
  reset(null, null);
};

// Очередь выстрелов (16.11.2026, список «Звуки мода» в каталоге): `options.burst` — `{ interval, shots }` из `burstPlan`. Очередь — того же
// звука по расписанию на Web Audio (`sound-burst-engine.js`), её состояние — то же «играет» этого проигрывателя: любой другой звук, стоп и
// уход с экрана снимают её так же, как <audio>. Очередь недоступна (нет Web Audio, файла, разбора) — звук играет одним выстрелом, как раньше.
const begin = async (owner, key, source, options) => {
  if (who === owner && what === key) return halt(owner);
  el ??= makeAudio();
  el.pause();
  stopBurst();
  reset(owner, key);
  const mine = tick;
  try {
    let src = source;
    if (typeof src === "function") src = await src();
    // Нажали другой звук или стоп, пока добывали адрес: прерванное сбоем не считается.
    if (tick === mine && options?.burst) {
      const outcome = await startBurst({
        url: src,
        burst: options.burst,
        isCurrent: () => tick === mine,
        onEnded: () => reset(null, null),
      });
      if (outcome !== "unavailable") return;
    }
    if (tick === mine) {
      Object.assign(el, { src, currentTime: 0 });
      await el.play();
    }
  } catch (error) {
    if (tick === mine) {
      reset(null, null);
      throw error;
    }
  }
};

export const useSoundPlayer = (scope) => {
  const [own] = useState(Object);
  const owner = scope || own;
  useSyncExternalStore(watch, () => tick);
  // Прогресс читают прямо в кадре анимации, поэтому элемент отдаётся функцией. Идёт очередь выстрелов — отдаются её часы
  // (`duration`, `currentTime`, как у элемента), иначе сам <audio>.
  const audio = useCallback(() => (who === owner && (burstClock() || el)) || null, [owner]);
  const stop = useCallback(() => halt(owner), [owner]);
  const play = useCallback((...args) => begin(owner, ...args), [owner]);
  useEffect(() => () => halt(owner), [owner]);
  return { playing: who === owner ? what : null, play, stop, audio };
};
