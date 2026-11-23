import { useCallback, useEffect, useRef, useState } from "react";
import { motionEnabled } from "../../motion-preference.js";

export function useCatalogDisclosure(expanded, setExpanded, delay = 380) {
  const [renderedExpanded, setRenderedExpanded] = useState(expanded);
  const [collapsing, setCollapsing] = useState(false);
  const collapseTimerRef = useRef(null);

  useEffect(() => () => window.clearTimeout(collapseTimerRef.current), []);

  const toggle = useCallback(() => {
    window.clearTimeout(collapseTimerRef.current);
    if (!expanded) {
      setRenderedExpanded(true);
      setCollapsing(false);
      setExpanded(true);
      return;
    }
    setExpanded(false);
    setCollapsing(true);
    /* Задержка существует ради анимации сворачивания: она держит содержимое в
       разметке, пока оно уезжает. Без анимации это просто лаг. */
    collapseTimerRef.current = window.setTimeout(
      () => {
        setRenderedExpanded(false);
        setCollapsing(false);
      },
      motionEnabled() ? delay : 0,
    );
  }, [delay, expanded, setExpanded]);

  return { collapsing, renderedExpanded, toggle };
}
