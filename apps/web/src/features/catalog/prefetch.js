import { useEffect } from "react";

const IDLE_FALLBACK_MS = 1200;

// Заранее подгружает ленивые куски страниц каталога, пока окно простаивает.
export function usePrefetchCatalogPages() {
  useEffect(() => {
    const load = () => {
      import("../../components/desktop/catalog/ModDetailPage.jsx").catch(() => {});
      import("../../components/desktop/catalog/AdvancedCatalogSearch.jsx").catch(() => {});
    };
    const wait = window.requestIdleCallback
      ? window.requestIdleCallback(load)
      : window.setTimeout(load, IDLE_FALLBACK_MS);
    // Способ отмены выбирается отдельно от способа ожидания.
    const cancel = window.cancelIdleCallback || window.clearTimeout;
    return () => {
      cancel.call(window, wait);
    };
  }, []);
}
