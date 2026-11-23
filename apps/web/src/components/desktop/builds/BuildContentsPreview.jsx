import { formatSize } from "../../../catalog-utils.js";
import {
  blockReasonText,
  missingModTitle,
} from "../../../features/builds/blocked-copy.js";
import { catalogLabel } from "../../../features/catalog/catalog-words.js";
import { modTileLook } from "../../../features/builds/mod-faces.js";
import MyModPicture from "../../../features/library/MyModPicture.jsx";
import {
  buildContentsSummary,
  buildInstallSummary,
  replacedByBuild,
} from "../../../features/builds/install-summary.js";
import { useWorkVerdicts } from "../../../features/builds/use-work-verdicts.js";
import { worksConflictingWithMod } from "../../../features/builds/work-verdicts.js";
import { workshopCopyFor } from "../../../workshop-copy.js";
import Button from "../../ui/Button.jsx";
import { Warning } from "../../ui/icons.jsx";
import ComponentsSplit from "../catalog/mod-card/ComponentsSplit.jsx";
import { ReplacesBadge } from "./BuildModRow.jsx";
import BuildWorkCover from "./BuildWorkCover.jsx";

/*
 * Что войдёт в сборку — до того, как её создали или прочитали (ТЗ 23.10, п. K).
 *
 * Раньше «Войдёт в сборку» была лентой из пяти мелких обложек с «+N»: какие именно моды и сколько
 * из них заменят ваши, видно не было, а фото рисовались не так, как в окне готовой сборки. Теперь здесь та же сетка
 * плиток-постеров (`BuildModRow`, одно правило фото с библиотекой — `modPhoto`), что в открытой сборке, и те же цифры:
 * сколько модов, какой вес, сколько встанет без замены, сколько заменят ваши (число с «!», а на плитке такого мода —
 * знак и в подсказке имена ваших модов), сколько уже в игре.
 *
 * Работы мастерской (ТЗ 24.10.2026, вечер, п. C) — теми же плитками в той же сетке, а не строками под ней: у «Из
 * установленного» это то, что стоит у вас (всё уже в игре, «!» нет), у «По коду» — работы кода, и те из них, что встанут
 * вместо ваших, несут жёлтое «!» с тем, что именно уйдёт (`work-verdicts.js`), а в цифры «новые / заменят» входят наравне с
 * модами.
 *
 * `mode="save"` — «Из установленного»: всё, что войдёт, и так стоит в игре, поэтому «без замены» и «заменят» молчат.
 * `mode="code"` — прочитанный код: цифры считаются относительно того, что стоит у вас сейчас.
 *
 * «Из установленного» (`selection`, ТЗ 23.10) показывает все моды библиотеки — стоящие в игре и снятые проверкой файлов:
 * у плитки отметка и пометка «Стоит в игре» / «Не стоит», над сеткой «Выбрать все / Снять все», а цифры и «!» считаются
 * по отмеченному. Не встанет заведомо (нет в каталоге, пакет без подписи) — плитка без отметки, с причиной.
 *
 * 31.10.2026 (владелец): вместо сетки плиток — вид окна «Компоненты» (`ComponentsSplit`):
 * слева список с отметками, справа кадр выбранного. Отметки теперь и у прочитанного кода.
 */

export function usePreviewModel({
  mode = "save",
  mods,
  /* «Из установленного» — работы, что стоят у вас (`item`); «По коду» — работы кода (`entry`). */
  works = [],
  installedIds,
  availableMods,
  getModSize,
  blockOf = () => "",
  /* Работы, что стоят у вас: с ними сверяются работы кода и моды по тому же стволу. */
  workItems = [],
  /* `{ enabledIds, onToggle, onSetAll }` — моды библиотеки с отметками; без него плитки только показываются. */
  selection = null,
  language,
  copy,
}) {
  const selecting = Boolean(selection);
  const enabledIds = selecting
    ? selection.enabledIds
    : new Set(mods.map((mod) => mod.id));
  const known = mods.filter((mod) => !mod.pending && !mod.missing);
  const sizes = known.map((mod) =>
    blockOf(mod.id) ? 0 : getModSize?.(mod, availableMods) || 0,
  );
  /* Вес — по тем, что встанут (и отмечены), и только когда он известен у каждого: часть не выдаётся за целое. */
  const installable = known.filter((mod) => !blockOf(mod.id));
  const picked = installable.filter((mod) => enabledIds.has(mod.id));
  const installableSizes = picked.map(
    (mod) => getModSize?.(mod, availableMods) || 0,
  );
  const totalSize =
    installableSizes.length && installableSizes.every((value) => value > 0)
      ? installableSizes.reduce((sum, value) => sum + value, 0)
      : 0;
  const input = {
    mods,
    enabledIds,
    installedIds,
    allMods: availableMods,
    blockOf: (id) => blockOf(id) || null,
    extraConflicts: (mod) => worksConflictingWithMod(mod, workItems),
  };
  const code = mode === "code";
  /* Работы кода сверяются с тем, что стоит; работы библиотеки и так стоят — отвечать за них нечем. */
  const codeWorks = code ? works : [];
  const verdicts = useWorkVerdicts(codeWorks, {
    workItems,
    installedIds,
    allMods: availableMods,
  });
  const summary = buildContentsSummary(buildInstallSummary(input), {
    modCount: mods.length,
    works: codeWorks,
    verdicts,
  });
  const replaced = replacedByBuild(input);
  const replacedMods = mods.filter((mod) => replaced.has(mod.id));
  const replacingWorks = codeWorks.filter(
    (entry) => verdicts.get(entry.code)?.kind === "replacing",
  );
  /* Цифры «встанут / заменят / уже в игре» — у кода всегда, у библиотеки, когда в ней есть то, что не стоит. */
  const comparing =
    code ||
    (selecting &&
      known.some((mod) => !installedIds.has(mod.id) && !blockOf(mod.id)));
  const unknown = summary.unknown > 0;
  const workKinds = workshopCopyFor(language).works?.kinds || {};
  const modEntry = (mod) => {
    const settled = !mod.pending && !mod.missing;
    const blocked = settled ? blockOf(mod.id) : "";
    const title =
      mod.name ||
      (mod.missing
        ? copy.removedMod(mod.id)
        : mod.pending
          ? mod.id
          : missingModTitle(language));
    const size = blocked || !settled ? 0 : sizes[known.indexOf(mod)] || 0;
    const kind = mod.catalogSubcategory || mod.categoryLabel || "";
    const replaces =
      comparing && !blocked && enabledIds.has(mod.id)
        ? replaced.get(mod.id) || null
        : null;
    const state =
      selecting && settled
        ? installedIds.has(mod.id)
          ? copy.inGameTag
          : copy.offGameTag
        : "";
    const sizeText = size > 0 ? formatSize(size, language) : "";
    const pendingNote = mod.pending
      ? mod.pending === "loading"
        ? copy.loadingNote
        : copy.offlineNote
      : "";
    const note = blocked ? blockReasonText(blocked, language) : pendingNote;
    const replacesText = replaces?.length
      ? replaces.some((item) => item.work)
        ? copy.replacesAnyBadgeText(replaces)
        : copy.replacesBadgeText(replaces)
      : "";
    return {
      key: mod.id,
      className: `builds-mod-tile${blocked ? " is-blocked" : ""}${replaces?.length ? " is-replacing" : ""}`,
      title,
      sub: note || [state, sizeText].filter(Boolean).join(" · ") || null,
      kicker: kind ? catalogLabel(kind, language) : null,
      meta: state || null,
      weight: sizeText || null,
      bytes: size,
      note: replacesText || note || null,
      face: modTileLook(mod),
      badge: replaces?.length ? <ReplacesBadge label={replacesText} /> : null,
      check:
        selecting && settled && !blocked
          ? {
              checked: enabledIds.has(mod.id),
              label: `${copy.willSave}: ${title}`,
              onChange: () => selection.onToggle(mod.id),
            }
          : null,
    };
  };
  const workEntry = (work) => {
    const verdict = code ? verdicts.get(work.code) : null;
    const yours = verdict?.kind === "replacing" ? verdict.yours : null;
    const kind = workKinds[work.workKind] || null;
    return {
      key: `work:${work.code || work.key}`,
      className: `builds-work-tile${yours?.length ? " is-replacing" : ""}`,
      title: work.name || "",
      kicker: kind,
      sub: kind,
      meta: verdict?.kind === "already" ? copy.inGameTag : null,
      note: yours?.length
        ? copy.replacesAnyBadgeText(yours)
        : verdict?.kind === "stays"
          ? copy.ownEditorNote
          : null,
      face: {
        media: code ? <BuildWorkCover entry={work} /> : <MyModPicture item={work} />,
      },
      badge: yours?.length ? <ReplacesBadge label={copy.replacesAnyBadgeText(yours)} /> : null,
    };
  };
  const entries = [...mods.map(modEntry), ...works.map(workEntry)];

  return {
    mode,
    mods,
    works,
    selecting,
    enabledIds,
    installable,
    picked,
    totalSize,
    summary,
    replacedMods,
    replacingWorks,
    comparing,
    unknown,
    entries,
    code,
  };
}

export default function BuildContentsPreview(props) {
  const { selection = null, language, copy } = props;
  const model = usePreviewModel(props);
  const { mode, mods, works, selecting, enabledIds, installable, picked, totalSize, summary } = model;
  const { replacedMods, replacingWorks, comparing, unknown, entries, code } = model;

  return (
    <div className="builds-preview" data-mode={mode}>
      <div className="builds-preview-head">
      <dl className="builds-preview-facts">
        <div>
          <dt>{copy.factMods}</dt>
          <dd data-fact="mods">{selecting ? enabledIds.size : mods.length}</dd>
        </div>
        {works.length > 0 && (
          <div>
            <dt>{copy.factWorks}</dt>
            <dd data-fact="works">{works.length}</dd>
          </div>
        )}
        {totalSize > 0 && (
          <div>
            <dt>{copy.factSize}</dt>
            <dd data-fact="size">{formatSize(totalSize, language)}</dd>
          </div>
        )}
        {comparing && (
          <>
            <div>
              <dt>{copy.previewFresh}</dt>
              <dd data-fact="fresh">{unknown ? "—" : summary.fresh}</dd>
            </div>
            <div>
              <dt>{copy.factReplaceAny}</dt>
              <dd
                data-fact="replace"
                className={summary.replacing > 0 ? "is-caution" : undefined}
              >
                {summary.replacing > 0 && (
                  <Warning weight="fill" aria-hidden="true" />
                )}
                {unknown ? "—" : summary.replacing}
              </dd>
            </div>
            {summary.already > 0 && (
              <div>
                <dt>{copy.previewInGame}</dt>
                <dd data-fact="already">{summary.already}</dd>
              </div>
            )}
          </>
        )}
      </dl>
      {selecting && installable.length > 1 && (
        <div className="builds-preview-bulk">
          <Button
            size="sm"
            variant="ghost"
            disabled={picked.length === installable.length}
            onClick={() => selection.onSetAll(true)}
          >
            {copy.selectAll}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={picked.length === 0}
            onClick={() => selection.onSetAll(false)}
          >
            {copy.selectNone}
          </Button>
        </div>
      )}
      </div>
      {comparing && (replacedMods.length > 0 || replacingWorks.length > 0) && (
        <p className="builds-preview-caution" role="note">
          <Warning weight="fill" aria-hidden="true" />
          <span>
            {replacingWorks.length > 0
              ? copy.replaceAnyWarningText([...replacedMods, ...replacingWorks])
              : copy.replaceWarningText(replacedMods)}
          </span>
        </p>
      )}
      {entries.length > 0 && (
        <ComponentsSplit
          entries={entries}
          label={code ? copy.codeContents : copy.willSave}
        />
      )}
    </div>
  );
}
