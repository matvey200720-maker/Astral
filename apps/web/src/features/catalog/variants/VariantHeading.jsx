import AccountAvatar from "../../../components/ui/AccountAvatar.jsx";
import ModName from "../../../components/desktop/catalog/ModName.jsx";
import { dataLangOf } from "../../../components/desktop/catalog/data-lang.js";

/*
 * Заголовок места в каталоге для видов вкладки: название раздела, подраздела или выбранного редукса (с его аватаркой, как шапка канала), строка
 * «сколько найдено» и пометка издания GTA V — то же, что давала шапка прежнего вида (`PublicCatalog.jsx`), собранное из `model`.
 */
export default function VariantHeading({ model }) {
  const { title, status, reduxGroup, editionNotice } = model;
  return (
    <div className="catalog-main-heading">
      {reduxGroup ? (
        <div className="catalog-redux-title" lang={dataLangOf(reduxGroup.monogram)}>
          <AccountAvatar account={{ avatarUrl: reduxGroup.avatar, displayName: reduxGroup.monogram }} size="lg" />
          <h1 className="catalog-title">
            <ModName name={title} />
          </h1>
        </div>
      ) : (
        <h1 className="catalog-title">{title}</h1>
      )}
      <p className={`catalog-main-status${status.tone ? ` is-${status.tone}` : ""}`} role="status">
        {status.lead ? (
          <>
            <span lang={dataLangOf(status.lead)}>{status.lead}</span>
            {" · "}
          </>
        ) : null}
        {status.text}
      </p>
      {editionNotice ? (
        <span
          className={`ui-editor-edition catalog-edition-chip${editionNotice.tone === "warning" ? " is-warning" : ""}`}
          title={editionNotice.detail}
          aria-label={`${editionNotice.label}. ${editionNotice.detail}`}
        >
          {editionNotice.label}
        </span>
      ) : null}
    </div>
  );
}
