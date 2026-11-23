// Слова плашки: «краткое|подробное» на язык. Обычный объект: имя вроде constructor находит значение прототипа,
// у которого нет split, и отрисовка падает с TypeError (так и было).
const WORDS = {
  ru: "Без кадра|Кадров мода пока нет — это фон Astral, не мод",
  uk: "Без кадру|Кадрів мода ще немає — це тло Astral, не мод",
  en: "No frame|No frames of this mod yet — this is an Astral backdrop",
  pl: "Brak kadru|Brak kadrów z tego moda — to tło Astral",
  de: "Kein Bild|Noch keine Bilder dieses Mods — Hintergrund von Astral",
  fr: "Sans image|Aucune image de ce mod pour l’instant — c’est un arrière-plan d’Astral, pas le mod",
};

/** Подсказка вместо плашки: у кадров, что взяты не из самого мода, происхождение называется только во всплывающем слове (решение владельца 25.10.2026). */
export function stockCoverHint(language) {
  return (WORDS[language] || WORDS.ru).split("|")[1];
}

export default function StockCoverNote({ language, className }) {
  const [short, detailed] = (WORDS[language] || WORDS.ru).split("|");
  return (
    <span className={className ? `catalog-stock-note ${className}` : "catalog-stock-note"} title={detailed}>
      {short}
    </span>
  );
}
