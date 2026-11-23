import { useReducer, useEffect } from "react";

const oneMore = (taken) => taken + 1;

// Сколько первых карточек уже можно рисовать: на каждое срабатывание нулевого таймера — ещё одна.
export default function useProgressive(count) {
  const [shown, advance] = useReducer(oneMore, 0);

  useEffect(() => {
    const timer = shown >= count ? null : setTimeout(advance, 0);
    return () => {
      if (timer !== null) clearTimeout(timer);
    };
  }, [shown, count]);

  return shown;
}
