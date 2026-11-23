import { useModVariant } from "../../../../components/desktop/catalog/useModVariant.js";
import { useModInstall } from "../../../../components/desktop/catalog/useModInstall.jsx";
import { animateInstallToDownloads } from "../../../../components/desktop/catalog/install-flight.js";
import { modActionCopy } from "../../../../components/desktop/catalog/modActionCopy.js";
import { modDetailCopy } from "../../../../components/desktop/catalog/modDetailCopy.js";
import Button from "../../../../components/ui/Button.jsx";
import { Check, DownloadSimple } from "../../../../components/ui/icons.jsx";
import { coverFor, hasOwnCover } from "../../../../utils/catalogMedia.js";
import { isCatalogBundle } from "../../../../catalog-utils.js";
import { clothingInstallKind } from "@modovik/clothing/install-kind";
import BundleInstallActions from "../../bundles/BundleInstallActions.jsx";
import { useBundleActions } from "../../bundles/BundleContext.js";
import { requestDownloadsPanel } from "../../../downloads/open-requests.js";
import { tr } from "../../../../locales/ui.js";

/*
 * «Установить» на сцене варианта В — настоящая кнопка страницы мода (`useModInstall`: заливка хода, «в очереди», «Установлено», «Повторить»), а не ссылка на страницу.
 * Ставит она тем же путём, что кнопка страницы: `installOnce` оболочки приходит через общий контекст (`BundleContext`), новых пропсов по цепочке страниц нет.
 *
 * Три случая:
 *  • обычный мод — кнопка хода установки; поставленный мод снимается на странице мода («Открыть»), здесь он «Установлен» тихой отметкой;
 *  • сборка (редукс) — её собственные кнопки по частям (`BundleInstallActions`);
 *  • вещь одежды и мод, которому нужен выбор («На что поставить?»), — «Выбрать и установить»: окно выбора живёт на странице мода, сцена открывает её.
 */

const NOTHING = Object.freeze([]);

const isClothing = (mod) => mod?.catalogCategory === "clothing" || mod?.catalogSection === "clothing";

/* Моду нужно окно выбора до установки (одежда, замена вещи сервера): на сцене оно не живёт. */
export const needsChoice = (mod) => isClothing(mod) || Boolean(clothingInstallKind(mod));

function PlainInstall({ mod, mods, language, onSelect }) {
  const actions = useBundleActions();
  const actionCopy = modActionCopy(language);
  const { target, ready, active } = useModVariant({
    mod,
    allMods: mods,
    installed: actions?.installed || NOTHING,
    queue: actions?.queue || NOTHING,
  });
  const failed = Boolean(active?.failed);
  const waiting = Boolean(active) && !failed && !active.started && !(active.progress > 0);
  const removing = active?.operation === "remove";
  const install = useModInstall({
    active,
    actionCopy,
    installMod: target,
    ready,
    reduxCopy: modDetailCopy(language),
    removing,
    waiting,
    language,
  });
  const busy = install.state === "running" || install.state === "queued";
  const press = (event) => {
    if (busy) {
      requestDownloadsPanel();
      return;
    }
    /* Снять поставленный мод — на странице мода: там рядом откат и объяснение. */
    if (ready) {
      onSelect?.(mod);
      return;
    }
    if (!actions?.installBundle) {
      onSelect?.(mod);
      return;
    }
    void animateInstallToDownloads({
      source: event.currentTarget,
      cover: hasOwnCover(mod) ? coverFor(mod) : "",
      label: target.name,
    }).then(() => actions.installBundle(target));
  };
  /* Поставленный мод — отметка «Установлено», а не красное «Удалить» на сцене просмотра. */
  const installed = install.state === "ready";
  const props = installed
    ? { ...install.button, variant: "secondary", icon: <Check weight="bold" />, children: actionCopy.installed }
    : install.button;
  return (
    <>
      <Button
        size="md"
        className={`cvc-install is-${install.state}`}
        onClick={press}
        title={busy ? actionCopy.detailsHint : undefined}
        aria-busy={busy || undefined}
        {...props}
      />
      {install.note && (
        <p className={`cvc-action-note${install.state === "failed" ? " is-failed" : ""}`} role={install.state === "failed" ? "alert" : undefined}>
          {install.note}
        </p>
      )}
    </>
  );
}

function ChoiceInstall({ mod, onSelect }) {
  return (
    <Button variant="primary" size="md" className="cvc-install" icon={<DownloadSimple />} onClick={() => onSelect?.(mod)}>
      {tr("Выбрать и установить")}
    </Button>
  );
}

export default function SceneInstall({ mod, mods, language, onSelect }) {
  if (isCatalogBundle(mod))
    return <BundleInstallActions bundle={mod} language={language} fallback={modActionCopy(language).bundleByParts} />;
  if (needsChoice(mod)) return <ChoiceInstall mod={mod} onSelect={onSelect} />;
  return <PlainInstall mod={mod} mods={mods} language={language} onSelect={onSelect} />;
}
