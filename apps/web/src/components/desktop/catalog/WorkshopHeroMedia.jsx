import { CircleDashed } from "../../ui/icons.jsx";

/*
 * Кадр над списком вариантов слота.
 *
 * Особый случай здесь один — «стандартный вариант»: у него нет и не может быть
 * снимка, потому что показывать нечего, игра и так выглядит так. Раньше на это
 * место вставал крест во весь кадр, и первый экран каждой плитки мастерской
 * читался как сломанная картинка: человек открывал «Прицел» и видел ошибку.
 *
 * Крест — знак отказа. Здесь не отказ, а состояние: ничего не изменено.
 * Поэтому вместо знака — пластина с двумя строками, которые прямо это и
 * говорят.
 */

const VANILLA_COPY = {
  ru: [
    "Как в GTA V",
    "Ничего не изменено — слот работает так, как задумала игра.",
  ],
  en: [
    "Stock GTA V",
    "Nothing is changed — the slot works the way the game ships it.",
  ],
  de: [
    "Wie in GTA V",
    "Nichts geändert — der Slot bleibt so, wie das Spiel ihn ausliefert.",
  ],
  pl: [
    "Jak w GTA V",
    "Nic nie zmieniono — slot działa tak, jak przewidziała gra.",
  ],
  fr: [
    "Comme dans GTA V",
    "Rien n’est modifié — l’emplacement fonctionne comme le jeu l’a prévu.",
  ],
};

export default function WorkshopHeroMedia({
  primaryVariant,
  activeSlot,
  activeSlotTitle,
  coverFor,
  locale = "ru",
  onLoad,
  onError,
}) {
  /* Своего снимка нет ни у отсутствующего варианта, ни у стандартного: первый
     ещё не выбран, второй и есть сама игра. */
  const showsVanillaPlate =
    !primaryVariant ||
    (primaryVariant.isVanilla && primaryVariant.catalogSection === "redux");

  if (showsVanillaPlate) {
    const [title, note] = VANILLA_COPY[locale] || VANILLA_COPY.en;
    /* Класс свой, а не общий «снимка нет»: у того один ребёнок в сетке по
       центру, и его правила растащили бы три строки пластины на всю высоту
       кадра. */
    return (
      <span className="workshop-vanilla-plate">
        <CircleDashed aria-hidden="true" />
        <b>{title}</b>
        <small>{note}</small>
      </span>
    );
  }

  const title = primaryVariant.name || activeSlotTitle || "";

  return (
    <img
      src={coverFor(primaryVariant)}
      alt={title}
      loading="eager"
      decoding="async"
      fetchPriority="high"
      onLoad={onLoad}
      onError={(event) => {
        const fallback =
          primaryVariant.fallbackCover || activeSlot?.fallbackImage;
        if (
          fallback &&
          event.currentTarget.dataset.fallbackApplied !== "true"
        ) {
          event.currentTarget.dataset.fallbackApplied = "true";
          event.currentTarget.src = fallback;
          return;
        }
        onError(event);
      }}
      style={{
        "--workshop-variant-filter": primaryVariant.imageFilter || "none",
      }}
    />
  );
}
