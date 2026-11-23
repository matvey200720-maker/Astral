import { createContext, useContext, useState } from "react";
import {
  DownloadSimple,
  Heart,
  PaintBrushBroad,
  PencilSimpleLine,
  Trash,
} from "../../../../ui/icons.jsx";
import Button from "../../../../ui/Button.jsx";
import CartButton from "../../../../../features/cart/CartButton.jsx";
import { isCatalogBundle } from "../../../../../catalog-utils.js";
import { isCatalogWork } from "../../../../../features/workshop/works/catalog-work.js";
import { installsFromCatalog } from "../../../../../features/catalog/bundles/catalog-works.js";
import { useModInstall } from "../../useModInstall.jsx";
import { ModCardStatus } from "../ModCardParts.jsx";
import { requestDownloadsPanel } from "../../../../../features/downloads/open-requests.js";
import { useBundleInstall } from "../../../../../features/catalog/bundles/use-bundle-install.js";
import { cardWideCopy } from "../../../../../features/catalog/card-wide-copy.js";
import { bundleCopy } from "../../../../../features/catalog/bundles/bundle-copy.js";
import { useBundleActions } from "../../../../../features/catalog/bundles/BundleContext.js";
import { isGunpackPack, packProgress } from "../../../../../features/library/gunpack-state.js";
import { tr } from "../../../../../locales/ui.js";
import { WIDE_GUN, WIDE_REDUX, WIDE_SOUND } from "./wide-model.js";

/*
 * Действия карточки мода (страница-галерея, 21.11.2026; до этого — ряд «Пульта» в правой панели). Логика установки не тронута: те же `useModInstall`, `useBundleInstall` и
 * очередь, те же слова состояний — «Установить», ход с процентами, «Установлено», «Удалить», «Повторить», «Установить 13 из 14». Изменилось место: расчёт один на страницу
 * (`ActionsProvider`), а нарисовать его можно в двух местах — в шапке рядом с карандашом и ссылкой (`ActionRow layout="bar"`) и внизу панели «Состав» (`layout="footer"`). Обе
 * кнопки видят один и тот же выбор частей, поэтому «Установить 13 из 14» в шапке и в панели ставит одно и то же.
 *
 * Корзина — только у мода, который ставится целиком и ещё не стоит; «Удалить» отдельной кнопкой — только когда его можно нажать (иначе рядом стоял бы закрытый квадрат).
 */

const ActionsContext = createContext(null);

/** Расчёт действий страницы или `null` вне `ActionsProvider`. */
export const useActions = () => useContext(ActionsContext);

/** Значок «В корзину»: квадрат того же размера, что сердечко. */
const cartIcon = (mod, owner = null) => (
  <CartButton mod={mod} owner={owner} size="sm" className="xw-icon xw-cart" />
);

/** Редукс, чья часть открыта: на странице части («Установить отдельно») корзина кладёт её как «часть из редукса». */
const ownerOf = (view, mod) =>
  (view.reduxes || []).find((redux) => redux.id !== mod?.id) ?? null;

/* ---------- расчёты по видам ---------- */

/** Ганпак, пак звуков и любой одиночный мод: `selection` — галочки стволов или звуков (`gunSelection`, `soundSelection`); без неё ряд обычного мода. */
function SingleModel({ view, kind, selection, children }) {
  const { plan, actionCopy, language } = view;
  const copy = cardWideCopy(language);
  const install = useModInstall({
    active: plan.active,
    actionCopy,
    installMod: plan.installMod,
    ready: plan.ready,
    reduxCopy: view.copy,
    removing: plan.removing,
    waiting: plan.waiting,
    language,
  });
  const [running, setRunning] = useState(false);
  /* Ганпак стоит по стволам: сколько стволов пака в игре («Стоят 2 из 41»), пока стоит хоть один. */
  const shell = useBundleActions();
  const gunpack = isGunpackPack(view.mod) && shell ? packProgress(view.mod, shell.bundleOf, shell.installed) : null;
  const busy = install.state === "running" || install.state === "queued";
  const partial = Boolean(
    selection?.toggles && !selection.all && install.state === "idle",
  );
  const none = partial && selection.chosen.length === 0;
  /* Пак звуков с полным выбором — обычный мод; ганпак всегда считается набором: корзина и строка статуса у него не стояли. */
  const single = !selection || (kind === WIDE_SOUND && !partial);

  const installChosen = async (event) => {
    const source = event?.currentTarget ?? document.body;
    setRunning(true);
    try {
      // По одному и по порядку: каждый ствол — обычная установка отдельного мода (`onInstall(member)`), очередь та же.
      for (const member of selection.chosen)
        await view.parts.install(member, source);
    } finally {
      setRunning(false);
    }
  };

  const main = partial
    ? {
        button: {
          variant: "primary",
          icon: <DownloadSimple />,
          disabled: running || none,
          progress: null,
          caption: null,
          children: none
            ? tr("Ничего не отмечено")
            : copy.installSome(selection.marked, selection.total),
        },
        onClick: installChosen,
        busy: running,
        className: "is-partial",
      }
    : {
        button: install.button,
        onClick: busy ? () => requestDownloadsPanel() : plan.onInstall,
        busy,
        className: `is-${install.state}`,
      };
  const model = {
    main,
    remove: {
      enabled: Boolean(plan.ready) && !plan.active,
      onClick: () => plan.onInstall(),
    },
    status: single ? (
      <ModCardStatus plan={plan} className="xw-status-line" />
    ) : gunpack?.standing.length ? (
      <p className="mod-card-status is-installed xw-status-line" role="status">
        <i aria-hidden="true" />
        <span>{gunpack.standing.length >= gunpack.total ? bundleCopy(language).full : bundleCopy(language).installed(gunpack.standing.length, gunpack.total)}</span>
      </p>
    ) : null,
    note: { failed: install.state === "failed", text: install.note },
    cart:
      single && !plan.ready && !plan.active
        ? cartIcon(plan.installMod, ownerOf(view, plan.installMod))
        : null,
  };
  return (
    <ActionsContext.Provider value={model}>{children}</ActionsContext.Provider>
  );
}

/** Редукс и любая сборка каталога: расчёты `useBundleInstall`, выбор компонентов уже учтён в них. */
function BundleModel({ view, children }) {
  const bundle = useBundleInstall(view.mod, view.language);
  let model;
  if (!bundle) {
    model = {
      main: null,
      remove: { enabled: false },
      status: null,
      note: { failed: false, text: view.actionCopy.bundleByParts },
      cart: cartIcon(view.mod),
    };
  } else {
    const button = bundle.whole
      ? {
          variant: "danger",
          icon: <Trash />,
          disabled: bundle.busy,
          children: bundle.removeWord,
        }
      : {
          variant: "primary",
          icon: <DownloadSimple />,
          disabled: bundle.busy || bundle.allOff,
          /* В шапке и в низу панели — слово «Установить», а не «Установить сборку» (владелец, 22.11.2026); «Доставить 1 часть», «Все компоненты отключены» остаются как есть. */
          children:
            bundle.caption === bundleCopy(view.language).install
              ? tr("Установить")
              : bundle.caption,
        };
    model = {
      main: {
        button,
        onClick: bundle.whole ? bundle.remove : bundle.install,
        busy: bundle.busy,
        className: bundle.whole ? "is-ready" : "is-idle",
      },
      remove: {
        enabled: bundle.removable && !bundle.busy,
        onClick: bundle.remove,
        note: bundle.removeNote,
      },
      status: bundle.status ? (
        <p className="xw-status">
          <small>{bundle.status.label}</small>
          <strong>{bundle.status.value}</strong>
        </p>
      ) : null,
      note: { failed: false, text: "" },
      cart: bundle.whole || bundle.busy ? null : cartIcon(view.mod),
    };
  }
  return (
    <ActionsContext.Provider value={model}>{children}</ActionsContext.Provider>
  );
}

/**
 * Работа мастерской из каталога. Набор эффектов (трейсер, попадание, огонь) и часть редукса ставятся сами: главная кнопка «Установить», вторая, значком, —
 * «Открыть в мастерской». Остальное (оптимизация, небо, карта) — одна кнопка «Открыть в мастерской», как и было. Остальное — как у любой карточки.
 */
function WorkModel({ view, children }) {
  const { plan, actionCopy } = view;
  const installs = installsFromCatalog(view.mod);
  const model = {
    main: {
      button: {
        variant: "primary",
        icon: installs ? <DownloadSimple /> : <PaintBrushBroad />,
        children: installs ? actionCopy.install : actionCopy.openInWorkshop,
      },
      onClick: plan.onInstall,
      busy: false,
      className: "is-idle",
    },
    open: installs ? { onClick: plan.onOpenWork, label: actionCopy.openInWorkshop } : null,
    remove: { enabled: false },
    status: null,
    note: { failed: false, text: "" },
    cart: cartIcon(view.mod),
  };
  return (
    <ActionsContext.Provider value={model}>{children}</ActionsContext.Provider>
  );
}

/** Вторая кнопка работы-набора, значком: «Открыть в мастерской». Нет её у остальных. */
function OpenWork({ open }) {
  if (!open) return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      className="xw-icon xw-open"
      icon={<PencilSimpleLine />}
      ariaLabel={open.label}
      title={open.label}
      onClick={open.onClick}
    />
  );
}

/** Одна на страницу: считает действия по виду мода и раздаёт их рядам (`ActionRow`, `ActionNotes`). */
export function ActionsProvider({ view, kind, selection = null, children }) {
  if (kind === WIDE_REDUX || isCatalogBundle(view.mod))
    return <BundleModel view={view}>{children}</BundleModel>;
  if (isCatalogWork(view.mod))
    return <WorkModel view={view}>{children}</WorkModel>;
  return (
    <SingleModel
      view={view}
      kind={kind}
      selection={kind === WIDE_GUN || kind === WIDE_SOUND ? selection : null}
    >
      {children}
    </SingleModel>
  );
}

/* ---------- ряды ---------- */

/**
 * Ряд действий. `bar` — шапка страницы (слово владельца 22.11.2026, «лайк и корзину верни»): «Установить» (компактная, 34 px), «Удалить» — когда его можно нажать, `lead` (карандаш), сердечко,
 * корзина и `tail` (ссылка); все квадраты одной высоты с кнопкой. `footer` — низ панели «Состав»: главная кнопка обычной высоты, не на всю ширину.
 */
export function ActionRow({
  layout = "bar",
  lead = null,
  tail = null,
  like = null,
  caption = "",
}) {
  const act = useActions();
  if (!act) return null;
  const { remove, cart, open } = act;
  /* Подпись «Установить 7 из 8» заменяет слово кнопки, пока сборка ещё не стоит и не идёт ход. */
  const main =
    act.main && caption && act.main.className === "is-idle"
      ? { ...act.main, button: { ...act.main.button, children: caption } }
      : act.main;
  if (layout === "footer") {
    if (!main) return null;
    return (
      <div className="xw-actions is-footer">
        <Button
          size="sm"
          className={`mod-card-install xw-install${main.className ? ` ${main.className}` : ""}`}
          {...main.button}
          onClick={main.onClick}
          aria-busy={main.busy || undefined}
        />
        <OpenWork open={open} />
      </div>
    );
  }
  /* Мод стоит — сама главная кнопка уже «Удалить»: вторая такая же корзина рядом дублировала бы имя, её нет. */
  const mainRemoves = Boolean(main?.className?.includes("is-ready"));
  return (
    <div className="xw-actions is-bar">
      {main && (
        <Button
          size="sm"
          className={`mod-card-install xw-install${main.className ? ` ${main.className}` : ""}`}
          {...main.button}
          onClick={main.onClick}
          aria-busy={main.busy || undefined}
        />
      )}
      <OpenWork open={open} />
      {!mainRemoves && remove.enabled && (
        <Button
          variant="secondary"
          size="sm"
          className="xw-icon xw-remove"
          icon={<Trash />}
          ariaLabel={tr("Удалить")}
          title={remove.note || tr("Удалить")}
          onClick={remove.onClick}
        />
      )}
      {lead}
      {like && (
        <Button
          variant="secondary"
          size="sm"
          className={`xw-icon xw-heart${like.on ? " is-on" : ""}`}
          icon={<Heart weight={like.on ? "fill" : "regular"} />}
          ariaLabel={like.on ? tr("Убрать из избранного") : tr("В избранное")}
          title={like.on ? tr("Убрать из избранного") : tr("В избранное")}
          aria-pressed={like.on}
          onClick={like.toggle}
        />
      )}
      {cart}
      {tail}
    </div>
  );
}

/** Строка статуса («Установлено», отказ) и слова под кнопкой («Повторить», «Работает после перезапуска игры»); пустое — ничего. */
export function ActionNotes({ className = "" }) {
  const act = useActions();
  if (!act) return null;
  const { status, note } = act;
  if (!status && !note.text) return null;
  return (
    <div className={`xw-notes${className ? ` ${className}` : ""}`}>
      {status}
      {note.text && (
        <p
          className={`xw-note${note.failed ? " is-failed" : ""}`}
          role={note.failed ? "alert" : undefined}
        >
          {note.text}
        </p>
      )}
    </div>
  );
}
