import { useCallback, useState } from "react";
import {
  readCatalogFavoriteIds,
  writeCatalogFavoriteIds,
} from "../../catalog-utils.js";

/*
 * Избранное каталога для карточки вне самого каталога (полки страницы мода): тот же список, что у сетки каталога и страницы
 * автора (`astral-catalog-favorites`), читается при открытии и пишется при каждом нажатии сердечка. Обработчик постоянный —
 * карточка каталога под `memo`.
 */
export function useCatalogFavorites() {
  const [favoriteIds, setFavoriteIds] = useState(readCatalogFavoriteIds);
  const toggleFavorite = useCallback((modId) => {
    setFavoriteIds((current) => {
      const next = new Set(current);
      if (next.has(modId)) next.delete(modId);
      else next.add(modId);
      writeCatalogFavoriteIds(next);
      return next;
    });
  }, []);
  return [favoriteIds, toggleFavorite];
}
