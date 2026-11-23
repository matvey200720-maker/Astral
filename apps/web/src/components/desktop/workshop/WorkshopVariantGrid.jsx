import { Check, Heart, MagnifyingGlass, X } from "../../ui/icons.jsx";
import { tr, useTr } from "../../../locales/ui.js";

export default function WorkshopVariantGrid({
  mods,
  selectedId,
  favorites,
  favoritesOnly,
  query,
  onQueryChange,
  onToggleFavoritesOnly,
  onSelect,
  onFavorite,
  coverFor,
  formatSize,
}) {
  useTr();
  return (
    <div className="workshop-local-library">
      <div className="workshop-local-toolbar">
        <label>
          <MagnifyingGlass />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={tr("Поиск модификаций")}
            aria-label={tr("Поиск модификаций")}
          />
        </label>
        <button
          type="button"
          className={favoritesOnly ? "is-active" : ""}
          aria-label={tr("Показать понравившиеся модификации")}
          aria-pressed={favoritesOnly}
          onClick={onToggleFavoritesOnly}
        >
          <Heart weight={favoritesOnly ? "fill" : "regular"} />
        </button>
      </div>

      <div className="workshop-local-grid">
        {mods.map((mod) => {
          const liked = favorites.includes(mod.id);
          const selected = selectedId === mod.id;
          const vanillaUsesCross =
            mod.isVanilla && mod.catalogSection === "redux";

          return (
            <article
              className={`workshop-local-card${selected ? " is-selected" : ""}`}
              key={mod.id}
            >
              <button
                type="button"
                className="workshop-local-card-select"
                onClick={() => onSelect(mod)}
              >
                <span className="workshop-local-card-media">
                  {vanillaUsesCross ? (
                    <span
                      className="workshop-local-vanilla-card"
                      aria-hidden="true"
                    >
                      <X />
                    </span>
                  ) : (
                    <img
                      src={coverFor(mod)}
                      alt={mod.name}
                      style={{
                        "--workshop-variant-filter":
                          mod.imageFilter || "brightness(1)",
                      }}
                    />
                  )}
                  <span className="workshop-local-card-copy">
                    <b>{mod.name}</b>
                    <em>{mod.isVanilla ? tr("0 МБ") : formatSize(mod)}</em>
                  </span>
                </span>
              </button>
              <button
                type="button"
                className={`workshop-local-card-like${liked ? " is-liked" : ""}`}
                aria-label={
                  liked ? tr("Убрать из понравившихся") : tr("Добавить в понравившиеся")
                }
                aria-pressed={liked}
                onClick={() => onFavorite(mod)}
              >
                <Heart weight={liked ? "fill" : "regular"} />
              </button>
              {selected && <Check className="workshop-local-card-selected" />}
            </article>
          );
        })}
      </div>
    </div>
  );
}
