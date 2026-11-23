import { useMemo, useState } from "react";
import { DownloadSimple, PaintBrushBroad, PencilSimpleLine } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import BundleInstallActions from "../../../../features/catalog/bundles/BundleInstallActions.jsx";
import { isCatalogBundle } from "../../../../catalog-utils.js";
import { isCatalogWork } from "../../../../features/workshop/works/catalog-work.js";
import { installsFromCatalog } from "../../../../features/catalog/bundles/catalog-works.js";
import { useModInstall } from "../useModInstall.jsx";
import CartButton from "../../../../features/cart/CartButton.jsx";
import ModComponents from "./ModComponents.jsx";
import { useQueueProgress } from "../../../../features/downloads/live-progress.js";
import { requestDownloadsPanel } from "../../../../features/downloads/open-requests.js";
import { humanFailure } from "../../../../utils/installFailure.js";
import { modColoursOf } from "../../../../features/clothing/colour-mapping.js";
import ClothingColourPick from "../../clothing/ClothingColourPick.jsx";

/*
 * Органы шапки карточки мода (`ModCard.jsx`): кнопки, строка статуса и
 * выбор варианта. Оценки и отзывов на странице мода нет (владелец, 16.10). Правила кнопки «Установить» — `useModInstall`,
 * «Редактировать» — `features/catalog/mod-editor.js`.
 */

/** Карточка вещи одежды: у неё в шапке только «Установить» и карандаш (ТЗ владельца 27.10.2026, п. 3.1). */
export const isClothingCard = (mod) =>
  mod?.catalogCategory === "clothing" || mod?.catalogSection === "clothing";

/** Редукс, чья часть открыта: корзина кладёт её как «часть из редукса» (`features/cart/`). */
const partOwnerOf = (view, mod) => (view.reduxes || []).find((redux) => redux.id !== mod?.id) ?? null;

/**
 * Ганпак или ствол из него (владелец, 28.10.2026, `ref/23`): раздел «Ганпаки» (`catalogSection`) или вид «Ганпаки» (`catalogCategory: skins`),
 * блок оружия в `domain.weapon`. Звуки оружия и части редуксов сюда не входят: у них свои слоты и своя лента.
 */
export const isGunpackCard = (mod) => {
  if (!mod || mod.catalogCategory === "sounds" || mod.domain?.sound) return false;
  if (mod.catalogSection === "redux" || mod.catalogSlot === "redux-pack") return false;
  return Boolean(
    mod.catalogSection === "gunpacks" ||
      mod.category === "gunpacks" ||
      mod.catalogCategory === "skins" ||
      mod.domain?.weapon,
  );
};

/** «Уже установлено», «Идёт установка 42 %», «В очереди», «Не удалось». */
export function ModCardStatus({ plan, className = "" }) {
  /* Проценты — из склада хода, а не из пропсов страницы: на каждый шаг
     загрузки перерисовывается строка, а не вся карточка (задача 1). */
  const live = useQueueProgress(plan.active?.queueId || "");
  if (!plan.actionStatusTitle) return null;
  const failed = Boolean(plan.active?.failed);
  /* Пока мод ставится, ход и проценты уже на самой кнопке (задача 1): та же
     строка рядом повторяла бы их второй раз. Удаление, отказ и «уже
     установлено» строка говорит по-прежнему. */
  if (plan.active && !failed && !plan.removing) return null;
  const tone = failed
    ? " is-failed"
    : plan.active
      ? " is-busy"
      : plan.ready
        ? " is-installed"
        : "";
  const progress = Math.max(
    0,
    Math.min(99, Number(live?.progress ?? plan.active?.progress) || 0),
  );
  return (
    <p
      className={`mod-card-status${tone}${className ? ` ${className}` : ""}`}
      role={failed ? "alert" : "status"}
    >
      <i aria-hidden="true" />
      <span>{plan.actionStatusTitle}</span>
      {plan.active && !plan.waiting && !failed && <b>{progress}%</b>}
    </p>
  );
}

/*
 * «Редактировать» и «Установить». Первая — второстепенная: главное решение
 * страницы по-прежнему одно, поставить мод; правка — альтернатива ему, а не
 * соперник (у кнопки вариант `secondary`, у установки — `primary`). Сборка и
 * работа мастерской из каталога — со своими кнопками: у сборки — по частям
 * (Т-81d), у работы — «Открыть в мастерской».
 */
export function ModCardActions({ view, size = "lg", className = "" }) {
  const { mod, plan, actionCopy, copy, cardCopy, editor } = view;
  const install = useModInstall({
    active: plan.active,
    actionCopy,
    installMod: plan.installMod,
    ready: plan.ready,
    reduxCopy: copy,
    removing: plan.removing,
    waiting: plan.waiting,
    language: view.language,
  });
  /* «Редактировать» части редукса сперва достаёт её файлы (`part-workshop`):
     пока они едут, кнопка занята; не вышло — причина под кнопками. */
  const [editing, setEditing] = useState(false);
  const [editFailure, setEditFailure] = useState("");
  /* Вещь с несколькими расцветками: карандаш сперва спрашивает, какую править (владелец, 29.10.2026); с одной — ведёт сразу. */
  const [pickingColour, setPickingColour] = useState(false);
  const colours = useMemo(() => (isClothingCard(mod) ? modColoursOf(mod, view.language) : []), [mod, view.language]);
  /* `colour` — буква расцветки; кнопка отдаёт событие, а не букву — тогда без выбора. */
  const edit = async (colour = "") => {
    if (editing) return;
    setEditing(true);
    setEditFailure("");
    try {
      await view.onEdit(typeof colour === "string" ? colour : "");
    } catch (error) {
      setEditFailure(
        humanFailure(error, view.language) || String(error?.message || ""),
      );
    } finally {
      setEditing(false);
    }
  };
  /* Занятая кнопка — дверь к подробностям: «Загрузки» сами не открываются. */
  const busy = install.state === "running" || install.state === "queued";
  const classes = `mod-card-actions${className ? ` ${className}` : ""}`;
  /* «Установить» и «Компоненты» — одной строкой (владелец, 24.10.2026 ночью): главное решение страницы и всё, что в паке. */
  if (isCatalogBundle(mod))
    return (
      <div className={classes}>
        <div className="mod-card-primary">
          <BundleInstallActions
            bundle={mod}
            language={view.language}
            fallback={actionCopy.bundleByParts}
          />
          <ModComponents view={view} size={size} />
          {/* Корзина — последняя, справа от остальных значков ряда (владелец, 16.11.2026). */}
          <CartButton mod={mod} size={size} />
        </div>
      </div>
    );
  if (isCatalogWork(mod)) {
    /* Набор эффектов (трейсер, попадание, огонь) и часть редукса ставятся сами: «Установить» и значок «Открыть в мастерской»; остальное — одна кнопка в мастерскую. */
    const installs = installsFromCatalog(mod);
    return (
      <div className={classes}>
        <div className="mod-card-primary">
          <Button
            variant="primary"
            size={size}
            className="mod-card-install"
            icon={installs ? <DownloadSimple /> : <PaintBrushBroad />}
            onClick={plan.onInstall}
          >
            {installs ? actionCopy.install : actionCopy.openInWorkshop}
          </Button>
          {installs && (
            <Button
              variant="secondary"
              size={size}
              className="mod-card-pencil"
              icon={<PencilSimpleLine />}
              ariaLabel={actionCopy.openInWorkshop}
              title={actionCopy.openInWorkshop}
              onClick={plan.onOpenWork}
            />
          )}
          <CartButton mod={mod} size={size} />
        </div>
      </div>
    );
  }
  /* Одежда (владелец, 27.10.2026): «только кнопка «Установить» и карандаш — перейти в мастерскую с этой моделью. Больше ничего». Карандаш —
     значком, без слова, рядом с «Установить» одной строкой; пояснения под кнопками нет. */
  if (isClothingCard(mod))
    return (
      <div className={`${classes} is-clothing`}>
        <div className="mod-card-primary">
          <Button
            size={size}
            className={`mod-card-install is-${install.state}`}
            onClick={busy ? () => requestDownloadsPanel() : plan.onInstall}
            title={busy ? actionCopy.detailsHint : undefined}
            aria-busy={busy || undefined}
            {...install.button}
          />
          {editor && (
            <Button
              variant="secondary"
              size={size}
              className="mod-card-pencil"
              icon={<PencilSimpleLine />}
              ariaLabel={cardCopy.editor[editor.copyKey || editor.kind]?.name || cardCopy.edit}
              title={cardCopy.editor[editor.copyKey || editor.kind]?.hint || cardCopy.edit}
              onClick={colours.length > 1 ? () => setPickingColour(true) : edit}
              aria-busy={editing || undefined}
              disabled={editing}
            />
          )}
          {!plan.ready && !plan.active && <CartButton mod={plan.installMod} owner={partOwnerOf(view, plan.installMod)} size={size} />}
          {pickingColour && (
            <ClothingColourPick
              mod={mod}
              colours={colours}
              onClose={() => setPickingColour(false)}
              onPick={(letter) => {
                setPickingColour(false);
                void edit(letter);
              }}
            />
          )}
        </div>
        {/* Слово под кнопками — только когда оно объясняет серую кнопку («пакета нет», «тату ждёт») или отказ; обычной подсказки нет. */}
        {(editFailure || install.note) && (
          <p
            className={`mod-card-action-note${editFailure || install.state === "failed" ? " is-failed" : ""}`}
            role={editFailure || install.state === "failed" ? "alert" : undefined}
          >
            {editFailure || install.note}
          </p>
        )}
      </div>
    );
  return (
    <div className={classes}>
      {editor && (
        <Button
          variant="secondary"
          size={size}
          icon={<PencilSimpleLine />}
          title={cardCopy.editor[editor.copyKey || editor.kind]?.hint}
          onClick={edit}
          aria-busy={editing || undefined}
          disabled={editing}
        >
          {cardCopy.edit}
        </Button>
      )}
      <div className="mod-card-primary">
        <Button
          size={size}
          className={`mod-card-install is-${install.state}`}
          onClick={busy ? () => requestDownloadsPanel() : plan.onInstall}
          title={busy ? actionCopy.detailsHint : undefined}
          aria-busy={busy || undefined}
          {...install.button}
        />
        {/* Одна строка: «Установить» тянется на остаток, справа — квадратные значки «В корзину» (пока мод не стоит и не ставится, `features/cart`) и «Компоненты». */}
        <ModComponents view={view} size={size} />
        {!plan.ready && !plan.active && <CartButton mod={plan.installMod} owner={partOwnerOf(view, plan.installMod)} size={size} />}
      </div>
      {editFailure && (
        <p className="mod-card-action-note is-failed" role="alert">
          {editFailure}
        </p>
      )}
      {install.note && (
        <p
          className={`mod-card-action-note${install.state === "failed" ? " is-failed" : ""}`}
          role={install.state === "failed" ? "alert" : undefined}
        >
          {install.note}
        </p>
      )}
    </div>
  );
}
