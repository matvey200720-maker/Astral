import { ArrowsDownUp, CaretDown } from "../../../components/ui/icons.jsx";
import FavoriteHeart from "../../../components/ui/FavoriteHeart.jsx";
import Button from "../../../components/ui/Button.jsx";
import MenuButton from "../../../components/ui/MenuButton.jsx";
import ProjectFilter from "../ProjectFilter.jsx";

/*
 * Орудия над результатами в видах вкладки «Каталог»: сердечко избранного, проект, порядок с фильтром раздела — те же органы, что в
 * прежней строке `catalog-main-tools` (`PublicCatalog.jsx`), собранные из `model`. Поле поиска стоит в колонке; при свёрнутой колонке
 * оно возвращается сюда, а вид может поставить его и сам (`own`: поле уже есть рядом — второго не рисовать).
 */
export default function VariantTools({ model, own = false, className = "", children = null }) {
  const { words, menuOpen, searchField, favoritesOnly, setFavoritesOnly, sortMode, menuOptions, chooseMenuOption, activeFilter, filterGroup } = model;
  return (
    <div className={`catalog-main-tools${className ? ` ${className}` : ""}`}>
      {menuOpen || own ? null : searchField}
      {children}
      <Button
        variant="secondary"
        size="sm"
        className="catalog-favorites-toggle"
        icon={<FavoriteHeart on={favoritesOnly} />}
        active={favoritesOnly}
        aria-pressed={favoritesOnly}
        ariaLabel={words.favoritesNav}
        title={words.favoritesNav}
        onClick={() => setFavoritesOnly((current) => !current)}
      />
      <ProjectFilter words={words} />
      <MenuButton
        className="catalog-sort"
        variant="secondary"
        size="sm"
        icon={<ArrowsDownUp />}
        trailing={<CaretDown />}
        label={`${words.sorts[sortMode] || words.sorts.new}${activeFilter ? ` · ${activeFilter}` : ""}`}
        ariaLabel={filterGroup ? words.sortFilterLabel : words.sortLabel}
        align="end"
        options={menuOptions}
        value={`sort:${sortMode}`}
        onSelect={chooseMenuOption}
      />
    </div>
  );
}
