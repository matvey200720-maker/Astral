import Button from "../../components/ui/Button.jsx";
import { bundleCopy, bundleMembers as membersOf, installedBundles, useBundleActions } from "../catalog/bundles/index.js";
import { Stack } from "../../components/ui/icons.jsx";
import { WorkshopCardStatus } from "../../WorkshopLibraryComponents.jsx";

// Строка списка: «Сборки · состояние», «Открыть» и, если части поставила сама сборка, «Снять сборку».
export default function LibraryBundleRows(props) {
  const ctx = useBundleActions();
  const { installed, bundleOf, removeBundle } = ctx ?? {};
  const { mods = [], language, onSelect } = props;
  const entries = ctx && installedBundles(mods, installed);
  const copy = bundleCopy(language);

  const rowOf = ({ bundle, progress: { state, installedCount, total } }) => {
    const { id, name } = bundle;
    const whole = state === "full";
    return (
      <article key={id} data-library-item={`bundle:${id}`} className="ui-panel workshop-library-row">
        <span aria-hidden="true" className="workshop-library-row-mark">
          <Stack />
        </span>
        <div>
          <h3>{name}</h3>
          <p>{`${copy.libraryTitle} · ${whole ? copy.full : copy.installed(installedCount, total)}`}</p>
        </div>
        {whole && <WorkshopCardStatus label={copy.full} status="installed" />}
        <div className="workshop-library-row-actions">
          <Button onClick={() => onSelect?.(bundle)} variant="secondary">
            {copy.open}
          </Button>
          {membersOf(id, bundleOf).length > 0 && (
            <Button onClick={() => removeBundle(bundle)} variant="ghost">
              {copy.remove}
            </Button>
          )}
        </div>
      </article>
    );
  };

  return entries?.length ? (
    <div data-library-section="bundles" className="workshop-library-rows">
      {entries.map(rowOf)}
    </div>
  ) : null;
}
