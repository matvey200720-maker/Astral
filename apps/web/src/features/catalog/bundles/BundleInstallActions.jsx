import {
  tr,
} from "../../../locales/ui.js";
import {
  Trash,
  DownloadSimple,
} from "../../../components/ui/icons.jsx";
import {
  useBundleActions,
} from "./BundleContext.js";
import {
  bundlePartsLabel,
  bundleCopy,
} from "./bundle-copy.js";
import {
  isVectorMapPart,
} from "../part-map.js";
import {
  useBundleComponents,
  componentGroupOf,
} from "./component-choices.js";
import {
  useBundleChoices,
} from "./bundle-choices.js";
import {
  usePartMapWorks,
  chosenMapWork,
} from "./map-works.js";
import {
  withKnownWorks,
} from "./component-works.js";
import {
  bundleRemoval,
  bundleMembers,
} from "./bundle-state.js";
import {
  useOwnWorks,
} from "./use-own-works.js";
import {
  bundleProgressOf,
  bundlePartsOf,
} from "./component-state.js";
import Button from "../../../components/ui/Button.jsx";

const FALLBACK_CLASS = "mod-action-no-package";
const NOTE_CLASS = "mod-action-bundle-note";

// Подписки. Зовутся при каждом показе и до решения «оболочки нет»:
// иначе переключение провайдера меняло бы число хуков.
function useSources(bundle) {
  const shell = useBundleActions();
  const [choices, picked] = [useBundleChoices(bundle.id), useBundleComponents(componentGroupOf(bundle))];
  const ownWorks = useOwnWorks(!!Object.keys(picked.work).length);
  const catalog = shell?.mods || null;
  // Части состава, которые являются большой картой без растровых плиток паузы
  // (для них человек может выбрать свою карту). Порядок — как в каталоге.
  const mapIds = catalog ? catalog.flatMap((mod) => ((bundle.includedModIds ?? []).some((id) => id === mod.id) && isVectorMapPart(mod) ? [mod.id] : [])) : [];
  return { shell, choices, picked, ownWorks, catalog, mapIds, mapWorks: usePartMapWorks(mapIds) };
}

export default function BundleInstallActions(props) {
  const { bundle, language, fallback = "" } = props;
  const { shell, choices, picked, ownWorks, catalog, mapIds, mapWorks } = useSources(bundle);
  if (!shell) {
    if (!fallback) return null;
    return <p className={FALLBACK_CLASS}>{fallback}</p>;
  }

  const { installed, queue, bundleOf, installBundle, removeBundle } = shell;
  const components = withKnownWorks(picked, ownWorks);
  const { parts, skipped } = bundlePartsOf(bundle, catalog ?? [], { installed, choices, mapWorks, components, ownWorks: ownWorks ?? [] });
  // четвёртый аргумент — большие карты, вместо которых уже стоит выбранная своя карта
  const { total, installedCount, pendingIds, state } = bundleProgressOf(
    bundle,
    installed,
    catalog,
    mapIds.flatMap((id) => (chosenMapWork(id, mapWorks, choices)?.installed ? [id] : [])),
    components,
    ownWorks ?? [],
  );
  const removable = bundleRemoval(bundle, { installed, members: bundleMembers(bundle.id, bundleOf), mods: catalog }).ids;

  // Занято: живая (без failed) строка очереди тронула часть сборки — по своему id или по id из пачки.
  // Вид операции не важен.
  const watched = new Set([...(bundle.includedModIds ?? []), ...parts.map(({ id }) => id)]);
  const busy = queue.some(({ failed, id, batch }) => !failed && (watched.has(id) || (batch?.ids ?? []).some((other) => watched.has(other))));
  const allOff = total === 0 && skipped.length > 0;
  const whole = state === "full";

  const words = bundleCopy(language);
  const { status, remove } = words;
  const summary = (whole && words.full) || words.installed(installedCount, total);
  const note = words.removeRemembered(bundlePartsLabel(removable.length, language));
  // Подпись кнопки установки — первое подошедшее правило, по силе.
  const caption =
    (allOff && tr("Все компоненты отключены")) ||
    (busy && words.busy) ||
    (state === "partial" && words.installMissing(bundlePartsLabel(pendingIds.length, language))) ||
    words.install;

  const statusLine =
    installedCount > 0 ?
      <p className="mod-action-bundle-status">
        <small>{status}</small>
        <strong>{summary}</strong>
      </p>
    : null;
  const installButton = whole ? null : (
    <Button variant="primary" size="lg" icon={<DownloadSimple />} disabled={busy || allOff} block onClick={() => installBundle(bundle)}>
      {caption}
    </Button>
  );
  const removeButtons =
    removable.length === 0 ? null : (
      <>
        <Button icon={<Trash />} variant={whole ? "danger" : "secondary"} size="lg" disabled={busy} block onClick={() => removeBundle(bundle)}>
          {remove}
        </Button>
        <small className={NOTE_CLASS}>{note}</small>
      </>
    );

  return <div className="mod-action-bundle">{statusLine}{installButton}{removeButtons}</div>;
}
