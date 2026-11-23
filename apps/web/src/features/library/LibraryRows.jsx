import { Suspense, lazy, useMemo, useState } from "react";
import Button from "../../components/ui/Button.jsx";
import { PencilSimple, Plus, Trash } from "../../components/ui/icons.jsx";
import { modSizeBytes, formatSize } from "../../catalog-utils.js";
import { Card } from "../downloads/ribbon/Lists.jsx";
import { ribbonCopyFor } from "../downloads/ribbon/ribbon-copy.js";
import { tr } from "../../locales/ui.js";
import { bundleCopy } from "../catalog/bundles/bundle-copy.js";
import { libraryLayout } from "./library-groups.js";
import { openRowEditor } from "./row-actions.js";

/* Окна выбора цели для одежды те же, что у корзины и карточки; грузятся, только когда нажали карандаш у вещи. */
const ClothingChoice = lazy(() => import("../cart/CartClothingChoice.jsx"));

/*
 * Библиотека справа на «Загрузках» (владелец, 16.11.2026, макет v2): то, что стоит в игре, строками. Строка — превью, название жирным, под ним «тип · размер»,
 * справа карандаш и корзина, и больше ничего («никаких выборов»). Карандаш — только там, куда есть идти: у работы мастерской он открывает редактор на ней, у
 * одежды — окно выбора цели (сменить заменёнку); у остальных на месте карандаша пусто, и корзина остаётся на своём месте. Корзина — то же удаление с тем же подтверждением, что
 * было у плитки Библиотеки (`useLibraryShelfRemoval.jsx`). Количества установленного на экране нет.
 *
 * Карточки и их данные те же, что у прежней полки (`libraryShelfModel` в `CatalogPages.jsx`): превью — готовая плитка (кадр, пара «вещь → заменёнка», живая обложка
 * работы), ужатая до миниатюры и закрытая от щелчков (`inert`); название и «тип» читаются из неё же. Страница не заводит своих данных.
 */

/** Текст узла: у имён «из данных» плитка кладёт строку в `<span lang>` (`dataName`), так что название бывает и строкой, и элементом. */
function textOf(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf(node.props?.children);
}

/** Название строки — первая строка плитки (у работы это её имя, «Алый кант», а не название редактора «Килл-эффект»), нет её — имя карточки. */
const titleOf = (card) => textOf(card.node?.props?.title).trim() || card.name;

/**
 * Подпись «тип · размер · Заменён: кем»: тип — вторая строка плитки, размер — у мода каталога. «Заменён» — пометка плитки (новый мод старше, 18.11.2026):
 * место мода целиком занял более новый слой, и строка говорит это словом, а не делает вид, что он стоит.
 */
function subline(card, mods, language) {
  const kind = textOf(card.node?.props?.description).trim();
  const bytes = card.meta?.mod ? modSizeBytes(card.meta.mod, mods) : 0;
  const covered = card.node?.props?.status === "covered" ? textOf(card.node.props.statusLabel).trim() : "";
  return [kind, bytes > 0 ? formatSize(bytes, language) : "", covered]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Подпись ряда переносится по границам « · »: «Дороги · Поставлено 21 ноября 2026 г. · На GTA 5 RP видно: …» — дата на своей строке, слова про RP ниже (до четырёх строк), полный текст в подсказке.
 * Раньше строка резалась многоточием в одну (21.11.2026: «· На GTA 5 R…»).
 */
export function SubLine({ text }) {
  const parts = text.split(" · ");
  return (
    <small className="dl-lib-sub" title={text}>
      {parts.map((part, index) => (index ? [" · ", <wbr key={index} />, part] : part))}
    </small>
  );
}

/**
 * Заголовок группы: ганпак или сборка редукса, под которой стоят её строки (22.11.2026). Слово вида, «Стоят N из M» (или «Всё стоит») и кнопка снятия всей группы: она открывает то же окно подтверждения, что корзина
 * строки, — со всеми строками группы сразу.
 */
function LibraryGroupHead({ group, language, removing, onRemove }) {
  const copy = bundleCopy(language);
  const { kind, bundle, standing, total } = group;
  const count = standing >= total ? copy.full : copy.installed(standing, total);
  return (
    <article className="dl-row dl-lib-row dl-lib-group" data-row data-library-group={group.id} data-removing={removing || undefined} aria-busy={removing || undefined}>
      <div className="dl-row-name">
        <h3 data-audit-ignore="caps">{bundle.name}</h3>
        <SubLine text={[kind === "pack" ? tr("Ганпак") : copy.libraryTitle, count].join(" · ")} />
      </div>
      <div className="download-actions dl-lib-group-actions">
        <Button variant="ghost" size="sm" disabled={removing} onClick={() => onRemove(group)}>
          {kind === "pack" ? tr("Удалить ганпак") : copy.remove}
        </Button>
      </div>
    </article>
  );
}

function LibraryRow({ card, mods, language, rc, removing, grouped = false, onEdit, onRemove }) {
  const edit = card.meta?.edit || null;
  const title = titleOf(card);
  const editWords = edit?.type === "clothing" ? rc.editClothing : rc.editWork;
  return (
    <article
      className="dl-row dl-lib-row"
      data-row
      data-library-row={card.id}
      data-grouped={grouped || undefined}
      data-removing={removing || undefined}
      aria-busy={removing || undefined}
    >
      <div className="download-thumb dl-lib-thumb" inert>
        {card.node}
      </div>
      <div className="dl-row-name">
        <h3 data-audit-ignore="caps">{title}</h3>
        <SubLine text={subline(card, mods, language)} />
      </div>
      <div className="download-actions dl-lib-actions">
        {edit ? (
          <button
            type="button"
            className="dl-pencil"
            title={editWords}
            aria-label={rc.editLabel(editWords, title)}
            disabled={removing}
            onClick={() => onEdit(card)}
          >
            <PencilSimple />
          </button>
        ) : (
          <span className="dl-action-slot" aria-hidden="true" />
        )}
        <button
          type="button"
          className="dl-trash"
          title={rc.removeFromGame}
          aria-label={rc.editLabel(rc.removeFromGame, title)}
          disabled={removing}
          onClick={() => onRemove(card)}
        >
          <Trash />
        </button>
      </div>
    </article>
  );
}

/**
 * @param {object} props
 * @param {{ id: string, name: string, node: import("react").ReactNode, meta?: { mod?: object, edit?: object } }[]} props.cards что стоит в игре, строкой на карточку
 * @param {object[]} props.mods каталог: размеры модов
 * @param {string} props.language язык окна
 * @param {Set<string>} props.removingIds строки, что удаляются прямо сейчас
 * @param {object[]=} props.mods каталог: размеры модов и вещи для окна выбора цели
 * @param {(page: string) => void=} props.onNavigate переход оболочки: редактор работы открывается на странице мастерской
 * @param {(mod: object) => unknown=} props.onInstall поставить запись установки одежды после выбора цели
 * @param {(mod: object) => void=} props.onSelect карточка мода, если у вещи окна выбора нет
 * @param {(text: string, tone?: string) => void=} props.onNotice уведомление оболочки
 * @param {(card: object) => void} props.onRemove корзина: окно подтверждения
 * @param {{ id: string, kind: "pack"|"build", bundle: object, cardIds: string[], standing: number, total: number }[]=} props.groups ганпаки и сборки, чьи строки стоят под заголовком (`library-groups.js`)
 * @param {(group: object) => void=} props.onRemoveGroup «Удалить ганпак» / «Снять сборку»: окно подтверждения со всеми строками группы
 * @param {import("react").ReactNode=} props.notices строки сверху (ждёт новой версии, архив не тот)
 * @param {import("react").ReactNode=} props.dialogs окно подтверждения удаления и выбор цели
 * @param {() => void=} props.onOpenCatalog дорога туда, где это берут
 */
export default function LibraryRows({
  cards,
  mods = [],
  language = "ru",
  removingIds,
  onNavigate,
  onInstall,
  onSelect,
  onNotice,
  onRemove,
  groups = [],
  onRemoveGroup,
  notices = null,
  dialogs = null,
  onOpenCatalog,
}) {
  const rc = useMemo(() => ribbonCopyFor(language), [language]);
  const layout = useMemo(() => libraryLayout(cards, groups), [cards, groups]);
  const [choosing, setChoosing] = useState(null);
  /* Карандаш: у вещи одежды — окно выбора цели, у работы — редактор на странице мастерской. */
  const onEdit = (card) => {
    const edit = card.meta?.edit;
    if (!edit) return;
    if (edit.type === "clothing") {
      setChoosing(edit.mod);
      return;
    }
    openRowEditor(edit, { navigate: onNavigate, language }).then(
      (shown) => shown || onNotice?.(rc.editFailed, "error"),
      () => onNotice?.(rc.editFailed, "error"),
    );
  };
  const placed = async (requests) => {
    setChoosing(null);
    for (const request of requests) {
      try {
        await onInstall?.(request);
      } catch {
        /* Отказ оболочка уже назвала сообщением. */
      }
    }
  };
  return (
    <>
      <Card
        title={rc.libraryTitle}
        className="dl-library"
        signal={cards.length}
        before={notices}
      >
        {cards.length ? (
          layout.map((item) =>
            item.type === "group" ? (
              <LibraryGroupHead
                key={`group:${item.group.id}`}
                group={item.group}
                language={language}
                removing={item.group.cardIds.every((id) => removingIds.has(id))}
                onRemove={(group) => onRemoveGroup?.(group)}
              />
            ) : (
              <LibraryRow
                key={item.card.id}
                card={item.card}
                mods={mods}
                language={language}
                rc={rc}
                grouped={item.grouped}
                removing={removingIds.has(item.card.id)}
                onEdit={onEdit}
                onRemove={onRemove}
              />
            ),
          )
        ) : (
          <div className="dl-empty dl-lib-empty">
            <span className="dl-empty-mark" aria-hidden="true">
              <Plus />
            </span>
            <b>{rc.libraryEmptyTitle}</b>
            <span>{rc.libraryEmptyText}</span>
            {onOpenCatalog ? (
              <Button variant="primary" size="sm" onClick={onOpenCatalog}>
                {rc.openCatalog}
              </Button>
            ) : null}
          </div>
        )}
      </Card>
      {choosing ? (
        <Suspense fallback={null}>
          <ClothingChoice
            mod={choosing}
            catalog={mods}
            onDone={placed}
            onClose={() => setChoosing(null)}
            onNoDialog={() => {
              setChoosing(null);
              onSelect?.(choosing);
            }}
          />
        </Suspense>
      ) : null}
      {dialogs}
    </>
  );
}
