import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import Button from "../../components/ui/Button.jsx";
import Dialog from "../../components/ui/Dialog.jsx";
import { ArrowRight, DownloadSimple, PencilSimpleLine, Trash, X } from "../../components/ui/icons.jsx";
import { modCardKickerParts, modSizeBytes, formatSize } from "../../catalog-utils.js";
import { tr, useTr, useUiLanguage } from "../../locales/ui.js";
import { trFill } from "../../locales/tr-fill.js";
import { coverFor } from "../../utils/catalogMedia.js";
import { coverThumbUrl } from "../../utils/cover-thumb.js";
import { choiceWaitingText } from "./cart-copy.js";
import { partInstallArgs } from "../catalog/bundles/component-groups.js";
import { CHOOSING_WORK_KINDS, cartKindOf, isWorkKey, needsChoice, parsePartKey } from "./cart-eligibility.js";
import { rememberCartOrigin } from "./cart-return.js";
import { clearCart, closeCart, openCart, removeFromCart, useCart } from "./cart-store.js";

/* Окна выбора цели для одежды — отдельным куском и только когда человек нажал «Установить» у вещи. */
const CartClothingChoice = lazy(() => import("./CartClothingChoice.jsx"));
/* Хранилище «Моих работ», коды работ и очередь мастерской — отдельным куском, и только когда в корзине лежат работы. */
const loadCartWorks = () => import("./cart-works.js");

const LOCALES = { ru: "ru-RU", uk: "uk-UA", en: "en-US", de: "de-DE", pl: "pl-PL", fr: "fr-FR" };

const queuedInstall = (queue, mod) => queue.some((item) => item.id === mod.id && item.operation === "install" && !item.failed);

/* Работы по ключам корзины: читаются, пока корзина открыта, когда меняется список ключей. `ready` — первый ответ пришёл (до него работы в списке не рисуются, чтобы не мигать «Работа удалена»). */
function useCartWorks(open, keys) {
  const [state, setState] = useState({ ready: false, works: new Map(), lib: null });
  const stamp = keys.join("\n");
  useEffect(() => {
    if (!open || !keys.length) return undefined;
    let alive = true;
    loadCartWorks()
      .then((lib) => alive && setState({ ready: true, works: lib.readCartWorks(keys), lib }))
      .catch(() => alive && setState((now) => ({ ...now, ready: true })));
    return () => {
      alive = false;
    };
    // `keys` — тот же список, что и `stamp`: перечитываем по смене состава, а не по новому массиву.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stamp]);
  return state;
}

/*
 * Корзина (владелец, 16.11.2026): человек кладёт сюда что хочет — моды, одежду, сборки, работы мастерской, — а здесь у каждой позиции своя «Установить», переход на карточку (у работы — в её редактор) и «Убрать».
 *  - мод ставится тем же путём, что кнопка «Установить» на карточке (`onInstall` оболочки): строка идёт в обычную очередь, видна в «Загрузках», конфликты и отказы разбирают те же окна;
 *  - вещь одежды сперва спрашивает, на что ставить: те же окна, что на карточке (`CartClothingChoice.jsx`), второго пути нет;
 *  - сборка ставится со своей карточки: «Установить» открывает её (`onOpenMod`);
 *  - работа мастерской ссылается на сохранённую работу: «Установить» ставит её последнюю сохранённую версию тем же путём, что работы сборок (`cart-works.js`), щелчок по названию открывает редактор на этой
 *    работе, и «назад» из него приводит обратно в корзину (`cart-return.js`); работа одежды и ствола ставится только через выбор цели в редакторе — «Установить» открывает его; удалённая работа — «Работа удалена» и только «Убрать».
 * «Скачать всё» ставит всё, что ставится одним нажатием; позиции, где нужен выбор, и работы (они уже на компьютере) не трогает, а говорит об этом словами. Что встало в очередь или уже стоит в игре, из корзины уходит;
 * что не вышло (не вошёл в аккаунт, игра не готова), остаётся — нажать ещё раз можно, когда причина снята.
 */
export default function CartPanel({ mods, installed, queue, onInstall, onOpenMod, onNavigate, onNotice, page = "" }) {
  useTr();
  const code = useUiLanguage();
  const { ids, open } = useCart();
  const [busy, setBusy] = useState(false);
  /* Вещь, которой выбирают цель (окно поверх корзины), и слова после «Скачать всё». */
  const [choosing, setChoosing] = useState(null);
  const [said, setSaid] = useState("");
  /* Свежие очередь и список установленного нужны после цикла, когда React уже применил их, — не снимок из замыкания. */
  const latest = useRef({ installed, queue });
  latest.current = { installed, queue };

  const byId = useMemo(() => new Map((mods || []).map((mod) => [mod.id, mod])), [mods]);
  /* Пока каталог не пришёл, id без карточки не выбрасываем: корзина переживает запуск, а каталог догружается позже. */
  const catalogReady = byId.size > 0;
  const workKeys = useMemo(() => ids.filter(isWorkKey), [ids]);
  const cartWorks = useCartWorks(open, workKeys);
  /* Позиции по порядку, как положили: мод — запись каталога, работа — запись «Моих работ» или `null`, если её удалили. */
  const entries = useMemo(
    () =>
      ids.flatMap((id) => {
        if (isWorkKey(id)) return cartWorks.ready ? [{ id, work: cartWorks.works.get(id) ?? null }] : [];
        /* Часть мода: запись самой части и мод, чья она (его может не быть — тогда карточка части своя). */
        const part = parsePartKey(id);
        if (part) {
          const mod = byId.get(part.partId);
          return mod ? [{ id, mod, owner: byId.get(part.ownerId) ?? null, part: true }] : [];
        }
        const mod = byId.get(id);
        return mod ? [{ id, mod }] : [];
      }),
    [ids, byId, cartWorks],
  );
  useEffect(() => {
    if (!catalogReady) return;
    const stale = ids.filter((id) => !isWorkKey(id) && !byId.has(parsePartKey(id)?.partId ?? id));
    if (stale.length) removeFromCart(...stale);
  }, [catalogReady, ids, byId]);
  /* Закрытая корзина слов не помнит. */
  useEffect(() => {
    if (!open) {
      setSaid("");
      setChoosing(null);
    }
  }, [open]);

  /* Панель выезжает от рейки и оставляет рейку живой: щелчок по другому значку рейки закрывает панель (страница сменится обычным щелчком), по значку корзины — закрывает его собственная кнопка. */
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (event.target?.closest?.(".desktop-sidebar") && !event.target.closest(".sidebar-cart-button")) closeCart();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  const locale = LOCALES[code] || "en-US";
  const modEntries = entries.filter((entry) => entry.mod);
  const total = modEntries.reduce((sum, { mod }) => sum + (modSizeBytes(mod, mods) || 0), 0);
  const isInstalled = (mod) => installed.includes(mod.id);
  const waiting = modEntries.filter(({ mod }) => !isInstalled(mod) && !queuedInstall(queue, mod));
  const waitingWorks = entries.filter((entry) => entry.work && !entry.work.installed).map((entry) => entry.work);

  /* Поставленное уходит из корзины, когда React уже применил очередь (после цикла), а не по ответу `onInstall`. */
  const dropStarted = async (started) => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const now = latest.current;
    removeFromCart(...started.filter(({ mod }) => now.installed.includes(mod.id) || queuedInstall(now.queue, mod)).map(({ id }) => id));
  };
  /* Часть ставится «Установить отдельно» — теми же аргументами, что строка части на странице мода; остальное — сам мод. */
  const installArgs = (entry) => (entry.part ? partInstallArgs(entry.mod) : [entry.mod]);

  const downloadAll = async () => {
    if (busy || !(waiting.length || waitingWorks.length)) return;
    setBusy(true);
    setSaid("");
    try {
      const single = waiting.filter(({ mod }) => !needsChoice(mod));
      for (const entry of single) {
        try {
          await onInstall?.(...installArgs(entry));
        } catch {
          /* Отказ одного мода оболочка уже назвала сообщением; остальные ставим дальше. */
        }
      }
      await dropStarted(single);
      const asking = waiting.filter(({ mod }) => needsChoice(mod)).map(({ mod }) => mod);
      const choosingWorks = waitingWorks.filter((work) => CHOOSING_WORK_KINDS.includes(work.workKind));
      setSaid(
        choiceWaitingText(code, {
          clothing: asking.filter((mod) => cartKindOf(mod) === "clothing").length + choosingWorks.filter((work) => work.workKind === "clothing").length,
          cards: asking.filter((mod) => cartKindOf(mod) === "card").length,
          works: waitingWorks.length - choosingWorks.filter((work) => work.workKind === "clothing").length,
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const openCard = (mod) => {
    closeCart();
    onOpenMod?.(mod);
  };

  const installRow = async (entry) => {
    setSaid("");
    const { mod } = entry;
    const kind = cartKindOf(mod);
    if (kind === "card") return openCard(mod);
    if (kind === "clothing") return setChoosing(entry);
    try {
      await onInstall?.(...installArgs(entry));
    } catch {
      /* Отказ оболочка уже назвала сообщением. */
    }
    await dropStarted([entry]);
  };

  /* Выбор цели подтверждён: записи ставит оболочка, как с карточки; вещь уходит из корзины, когда встала в очередь. */
  const chosen = async (entry, requests) => {
    setChoosing(null);
    for (const request of requests) {
      try {
        await onInstall?.(request);
      } catch {
        /* Отказ оболочка уже назвала сообщением. */
      }
    }
    await dropStarted([entry]);
  };

  /* Работа открывается в своём редакторе на том месте, где её оставили; корзина закрывается, а «назад» вернёт её открытой на этой же странице. */
  const openWork = async (work, { apply = false } = {}) => {
    setSaid("");
    rememberCartOrigin(page);
    closeCart();
    let opened = false;
    try {
      opened = await (await loadCartWorks()).openCartWork(work, { navigate: onNavigate, locale: code, apply });
    } catch {
      opened = false;
    }
    if (!opened) {
      openCart();
      onNotice?.(tr("Работа не открылась."), "error");
    }
  };

  const installWork = async (work) => {
    setSaid("");
    /* Работа одежды ставится только через выбор цели: редактор открывается на ней сразу с окном выбора (то же, что у «Применить»); молча её не ставим. */
    if (CHOOSING_WORK_KINDS.includes(work.workKind)) return openWork(work, { apply: true });
    setBusy(true);
    try {
      const ledger = await (await loadCartWorks()).installCartWork(work, { notify: onNotice });
      if (ledger.queued?.length || ledger.already?.length) removeFromCart(work.key);
      else {
        const refused = [...(ledger.unsupported || []), ...(ledger.failed || [])][0];
        onNotice?.(refused?.reason ? String(refused.reason) : tr("Работа не встала в очередь."), "error");
      }
    } catch (error) {
      onNotice?.(String(error?.message || tr("Работа не встала в очередь.")), "error");
    } finally {
      setBusy(false);
    }
  };

  const forget = (id) => {
    setSaid("");
    removeFromCart(id);
  };

  const removeButton = (id, name) => (
    <button type="button" className="cart-row-icon cart-row-remove" aria-label={trFill("Убрать из корзины: {0}", name)} title={tr("Убрать из корзины")} onClick={() => forget(id)}>
      <X aria-hidden="true" />
    </button>
  );

  const modRow = (entry) => {
    const { mod, owner, id } = entry;
    const size = modSizeBytes(mod, mods) ? formatSize(modSizeBytes(mod, mods), locale) : "";
    const state = isInstalled(mod) ? tr("Уже установлено") : queuedInstall(queue, mod) ? tr("В очереди") : "";
    /* Часть мода: «Часть: <имя> · из <мод>»; карточка, куда ведёт строка, — самого мода. */
    const title = entry.part ? trFill("Часть: {0}", mod.name) : mod.name;
    const kind = entry.part ? (owner ? trFill("из «{0}»", owner.name) : "") : modCardKickerParts(mod, "", code).text;
    const cover = coverFor(mod);
    const card = entry.part && owner ? owner : mod;
    return (
      <li className="cart-row" key={id} data-kind={entry.part ? "part" : cartKindOf(mod)}>
        <span className="cart-row-cover" aria-hidden="true">
          {cover ? <img src={coverThumbUrl(cover)} alt="" loading="lazy" decoding="async" draggable="false" /> : null}
        </span>
        <span className="cart-row-copy">
          <button type="button" className="cart-row-name" title={tr("Открыть карточку")} onClick={() => openCard(card)}>
            {title}
          </button>
          <small>{[kind, size, state].filter(Boolean).join(" · ")}</small>
        </span>
        <span className="cart-row-actions">
          <Button size="sm" variant="primary" className="cart-row-install" disabled={busy || Boolean(state)} ariaLabel={trFill("Установить: {0}", title)} onClick={() => installRow(entry)}>
            {tr("Установить")}
          </Button>
          <button type="button" className="cart-row-icon" aria-label={trFill("Открыть карточку: {0}", title)} title={tr("Открыть карточку")} onClick={() => openCard(card)}>
            <ArrowRight aria-hidden="true" />
          </button>
          {removeButton(id, title)}
        </span>
      </li>
    );
  };

  const workRow = ({ id, work }) => {
    /* Работу удалили из «Моих работ»: позиция остаётся словом и одной кнопкой «Убрать». */
    if (!work)
      return (
        <li className="cart-row is-deleted" key={id} data-kind="work">
          <span className="cart-row-cover is-glyph" aria-hidden="true">
            <PencilSimpleLine />
          </span>
          <span className="cart-row-copy">
            <b>{tr("Работа удалена")}</b>
          </span>
          <span className="cart-row-actions">{removeButton(id, tr("Работа удалена"))}</span>
        </li>
      );
    const kind = cartWorks.lib?.workKindLabel(work, code) || "";
    const name = work.name || kind || tr("Работа");
    const state = work.installed ? tr("Уже установлено") : "";
    return (
      <li className="cart-row" key={id} data-kind="work">
        <span className="cart-row-cover is-glyph" aria-hidden="true">
          <PencilSimpleLine />
        </span>
        <span className="cart-row-copy">
          <button type="button" className="cart-row-name" title={tr("Открыть в редакторе")} onClick={() => openWork(work)}>
            {name}
          </button>
          <small>{[kind, state].filter(Boolean).join(" · ")}</small>
        </span>
        <span className="cart-row-actions">
          <Button size="sm" variant="primary" className="cart-row-install" disabled={busy || Boolean(state)} ariaLabel={trFill("Установить: {0}", name)} onClick={() => installWork(work)}>
            {tr("Установить")}
          </Button>
          <button type="button" className="cart-row-icon" aria-label={trFill("Открыть в редакторе: {0}", name)} title={tr("Открыть в редакторе")} onClick={() => openWork(work)}>
            <ArrowRight aria-hidden="true" />
          </button>
          {removeButton(id, name)}
        </span>
      </li>
    );
  };

  const status = entries.length ? `${trFill("Позиций: {0}", entries.length)}${total ? ` · ${formatSize(total, locale)}` : ""}` : null;
  return (
    <>
      <Dialog
        open={open}
        onClose={closeCart}
        title={tr("Корзина")}
        description={entries.length ? tr("«Скачать всё» ставит то, что ставится одним нажатием. Одежду, сборки и работы ставят кнопкой «Установить» у самой позиции.") : null}
        size="drawer"
        className="cart-drawer"
        backdropClassName="cart-drawer-backdrop"
        bodyClassName="cart-drawer-body"
        status={status}
        actions={
          entries.length ? (
            <>
              <Button variant="secondary" icon={<Trash />} disabled={busy} onClick={clearCart}>
                {tr("Очистить")}
              </Button>
              <Button variant="primary" icon={<DownloadSimple />} disabled={busy || !(waiting.length || waitingWorks.length)} aria-busy={busy || undefined} onClick={downloadAll}>
                {tr("Скачать всё")}
              </Button>
            </>
          ) : null
        }
      >
        {entries.length ? (
          <>
            <ul className="cart-list">{entries.map((entry) => (entry.mod ? modRow(entry) : workRow(entry)))}</ul>
            {said ? (
              <p className="cart-said" role="status">
                {said}
              </p>
            ) : null}
          </>
        ) : (
          <p className="cart-empty">
            {ids.length && workKeys.length && !cartWorks.ready
              ? ""
              : ids.length && !catalogReady
                ? tr("Каталог ещё не загрузился — отложенные моды появятся здесь, как только он придёт.")
                : tr("Сюда кладут моды, одежду, сборки и работы: нажмите значок корзины на карточке. У каждой позиции здесь своя «Установить» и переход на карточку.")}
          </p>
        )}
      </Dialog>
      {choosing && (
        <Suspense fallback={null}>
          <CartClothingChoice
            mod={choosing.mod}
            catalog={mods}
            onDone={(requests) => chosen(choosing, requests)}
            onClose={() => setChoosing(null)}
            onNoDialog={() => {
              setChoosing(null);
              openCard(choosing.mod);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
