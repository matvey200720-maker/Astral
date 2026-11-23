export const LIBRARY_TABS = Object.freeze("graphics weapons clothing optimization".split(" "));

// Ряд вкладок от результата не зависит: он нужен только точке «новое» на вкладке.
export const presentLibraryTabs = (counts = {}) => [...LIBRARY_TABS].filter(id => counts[id] > 0);
