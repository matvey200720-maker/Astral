import { memo, useRef } from "react";
import { Check, DownloadSimple } from "../../../../components/ui/icons.jsx";
import FavoriteHeart from "../../../../components/ui/FavoriteHeart.jsx";
import Button from "../../../../components/ui/Button.jsx";
import ModName from "../../../../components/desktop/catalog/ModName.jsx";
import { dataLangOf } from "../../../../components/desktop/catalog/data-lang.js";
import { catalogDownloadCount } from "../../../../catalog-utils.js";
import { modSizeLabel, sizeEstimateNote } from "../../size-estimate.js";
import { catalogMediaPresentation, coverFor } from "../../../../utils/catalogMedia.js";
import { tr } from "../../../../locales/ui.js";
import { cardProjectsOf } from "../../card-projects.js";

/*
 * Строка списка в виде Б вкладки «Каталог»: кадр, имя, автор, проекты, размер, загрузки, сердечко и «Установить». Запись — мод или карточка редукса
 * (`reduxCard`: имя и кадр группы, открывается её пак). Строка целиком открывает страницу мода одной настоящей кнопкой на имени (она растянута на строку),
 * сердечко и «Установить» — свои кнопки поверх неё, как органы карточки в сетке.
 */

/* Кадр ствола, вещи, карты и звука вписывается целиком; кадр игры — во всю плитку. */
const FIT_CONTAIN = /is-(weapon|clothing|contained|sound)-media/;

function CatalogRow({ item, mods, words, liked, installed, quick, busy, onOpen, onFavorite, onInstall }) {
  const redux = Boolean(item.reduxCard);
  const group = redux ? item.group : null;
  /* Группа без пака — псевдо-мод с обложкой группы, как у её карточки в сетке (`ReduxGroupCard`). */
  const mod = redux ? item.lead || { id: group.leadId || group.id, cover: group.cover } : item;
  const name = redux ? group.name : mod.name;
  const author = redux ? group.author : mod.author;
  const media = catalogMediaPresentation(mod, "");
  const size = modSizeLabel(mod, mods, words.locale);
  const downloads = catalogDownloadCount(mod);
  const projects = redux ? [] : cardProjectsOf(mod);
  const thumb = useRef(null);
  return (
    <div className={`cv-b-row${installed ? " is-installed" : ""}`} data-mod={redux ? undefined : mod.id} data-redux-group={redux ? group.id : undefined}>
      <span className={`cv-b-thumb${FIT_CONTAIN.test(media.className) ? " is-contain" : ""}`} ref={thumb} aria-hidden="true">
        <img src={coverFor(mod)} alt="" loading="lazy" decoding="async" draggable="false" />
      </span>
      <span className="cv-b-name">
        <button type="button" className="cv-b-open" onClick={() => onOpen(item)}>
          <ModName name={name} />
        </button>
        {author ? (
          <small className="cv-b-by" lang={dataLangOf(author)}>
            {author}
          </small>
        ) : null}
      </span>
      <span className="cv-b-cell cv-b-author" lang={dataLangOf(author || "")}>
        {author || ""}
      </span>
      <span className="cv-b-cell cv-b-projects">
        {projects.map((project) => (
          <img key={project.id} className={`cv-b-project is-${project.fit}`} src={project.logo} alt="" title={project.label} draggable="false" />
        ))}
      </span>
      <span className="cv-b-cell cv-b-size" data-approximate={size.approximate ? "" : undefined} title={size.approximate ? sizeEstimateNote() : undefined}>
        {size.text}
      </span>
      <span className="cv-b-cell cv-b-downloads">{downloads > 0 ? downloads.toLocaleString(words.locale) : ""}</span>
      <span className="cv-b-actions">
        {redux ? null : (
          <Button
            variant="ghost"
            size="sm"
            className="cv-b-like"
            icon={<FavoriteHeart on={liked} />}
            aria-pressed={liked}
            ariaLabel={liked ? words.favoriteRemove(name) : words.favoriteAdd(name)}
            title={liked ? words.favoriteRemove(name) : words.favoriteAdd(name)}
            onClick={() => onFavorite(mod.id)}
          />
        )}
        <Button
          variant="secondary"
          size="sm"
          className="cv-b-install"
          icon={installed ? <Check /> : <DownloadSimple />}
          disabled={installed || busy}
          title={quick || installed ? undefined : tr("Откроется страница мода: там выбирают, что поставить")}
          onClick={() => (quick ? onInstall(mod, thumb.current) : onOpen(item))}
        >
          {installed ? tr("Установлено") : tr("Установить")}
        </Button>
      </span>
    </div>
  );
}

export default memo(CatalogRow);
