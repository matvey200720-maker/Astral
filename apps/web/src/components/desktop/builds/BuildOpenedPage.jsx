import { useState } from "react";
import { PickGrid, PickTileSkeleton } from "../../ui/PickTile.jsx";
import Button from "../../ui/Button.jsx";
import MenuButton from "../../ui/MenuButton.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import BuildWorkTile from "./BuildWorkTile.jsx";
import BuildSummaryFacts from "./BuildSummaryFacts.jsx";
import BuildModRow from "./BuildModRow.jsx";
import BuildCoverCollage from "./BuildCoverCollage.jsx";
import BuildOpenTicket from "./BuildOpenTicket.jsx";
import { REACTIONS, menuOptions } from "./BuildCard.jsx";
import { worksConflictingWithMod } from "../../../features/builds/work-verdicts.js";
import { useWorkVerdicts } from "../../../features/builds/use-work-verdicts.js";
import {
  replacedByBuild,
  buildInstallSummary,
  buildContentsSummary,
} from "../../../features/builds/install-summary.js";
import { hasModPhoto } from "../../../features/builds/mod-faces.js";
import { pendingWithoutPhoto } from "../../../features/builds/cover-tiles.js";
import { catalogLabel } from "../../../features/catalog/catalog-words.js";
import {
  Warning,
  Stack,
  Check,
  CaretLeft,
  DotsThree,
  PenNib,
  TShirt,
} from "../../ui/icons.jsx";
import { gluedTitle } from "../../../features/builds/title-glue.js";
import { usePageFrame } from "../use-page-frame.js";
import "./builds-open.css";

/*
 * Открытая сборка (дизайн 15.11.2026, макет r3/builds/builds-B-open): страница, а не окно. Сверху кадр-обложка со стрелкой «Сборки»,
 * названием, составом цифрами, «Установить сборку», меню «…» и меткой «Уже стоит в игре»; справа «билет» с кодом сборки
 * (`BuildOpenTicket`). Ниже — вкладки по видам модов и плитки состава с отметками «ставить».
 *
 * Логика окна прежняя: отметки (`enabledIds`), блокировки, «снимется из игры» и «встанет вместо вашего», работы мастерской,
 * установка — те же вычисления; изменился только вид. «Изменить» из макета не сделан: у сборки нет правки состава, кроме
 * «Установить» с отметками.
 */

// Общие пустые значения: у хука ответов должна быть стабильная ссылка.
const NO_IDS = new Set();
const NO_LIST = [];

const warnGlyph = <Warning weight="fill" aria-hidden="true" />;
const quiet = { variant: "ghost", size: "sm" };
const ALL = "all";
const OTHER = "other";
const WORKS = "works";

const isResolved = (mod) => !mod.pending && !mod.missing;

// Отметка мода: копия набора, где id переставлен на противоположный.
const flipId = (id) => (current) => {
  const next = new Set(current);
  if (!next.delete(id)) next.add(id);
  return next;
};

const flowOf = (props) => ({
  mods: props.mods,
  enabledIds: props.enabledIds,
  installedIds: props.installedIds,
  allMods: props.availableMods,
  blockOf: props.blockOf,
  extraConflicts: (mod) => worksConflictingWithMod(mod, props.workItems),
});

// Всё, что страница выводит из свойств и ответов по работам.
function assess(props, verdicts) {
  const { blockOf, getModSize } = props;
  const rows = [];
  const installable = [];
  let sizeSum = 0;
  let everySized = true;
  for (const mod of props.mods) {
    const reason = blockOf(mod.id);
    const size = reason ? 0 : getModSize(mod, props.availableMods);
    const row = { mod, reason, size };
    rows.push(row);
    if (reason) continue;
    installable.push(row);
    sizeSum += size;
    if (!(size > 0)) everySized = false;
  }

  const flow = flowOf(props);
  const replaced = replacedByBuild(flow);
  const counts = buildInstallSummary(flow);
  const parts = {
    modCount: props.mods.length,
    works: props.works,
    items: props.items,
    verdicts,
  };
  const summary = buildContentsSummary(counts, parts);

  const inBuild = new Set();
  const replacingMods = [];
  let waiting = false;
  for (const { mod } of rows) {
    inBuild.add(mod.id);
    if (replaced.has(mod.id)) replacingMods.push(mod);
    if (mod.pending && props.enabledIds.has(mod.id)) waiting = true;
  }
  const replacingWorks = [];
  for (const work of props.works) {
    if (verdicts.get(work.code)?.kind === "replacing")
      replacingWorks.push(work);
  }

  // при нуле отмеченных модов снимаемые не показываются вовсе
  const leaving = props.enabledCount === 0 ? [] : props.leavingMods;
  const leavingIds = new Set();
  const shelf = [];
  for (const mod of leaving) {
    leavingIds.add(mod.id);
    if (!inBuild.has(mod.id)) shelf.push(mod);
  }

  return {
    rows,
    installable,
    totalSize: installable.length > 0 && everySized ? sizeSum : 0,
    summary,
    replaced,
    replacingMods,
    replacingWorks,
    leaving,
    leavingIds,
    shelf,
    waiting,
  };
}

function pendingTile(props, mod) {
  const { copy } = props;
  const key = `mod:${mod.id}`;
  const loading = mod.pending === "loading";
  if (loading && !hasModPhoto(mod))
    return <PickTileSkeleton key={key} look="poster" />;
  const rowProps = {
    mod: { ...mod, name: mod.name || mod.id },
    mode: "static",
    note: loading ? copy.loadingNote : copy.offlineNote,
    language: props.language,
    copy,
  };
  return <BuildModRow key={key} {...rowProps} />;
}

function settledTile(props, model, { mod, reason, size }) {
  const { copy, enabledIds, setEnabledIds } = props;
  const enabled = enabledIds.has(mod.id);
  const rowProps = {
    mod: mod.missing
      ? { ...mod, name: mod.name || copy.removedMod(mod.id) }
      : mod,
    enabled,
    blocked: reason,
    leaving: model.leavingIds.has(mod.id),
    replaces: enabled && !reason ? model.replaced.get(mod.id) : null,
    size,
    language: props.language,
    copy,
    onToggle: () => setEnabledIds(flipId(mod.id)),
    /* Вещь одежды, которой нужен выбор «на что поставить»: что выбрано или что нужно выбрать (`use-build-choices.js`). */
    note: props.choice?.noteOf(mod) ?? null,
  };
  return <BuildModRow key={`mod:${mod.id}`} {...rowProps} />;
}

// Что работа получает от ответа по ней; «свежая» и без ответа ничего не получают.
const verdictExtras = (copy, verdict) =>
  ({
    replacing: { replaces: verdict?.yours },
    already: { meta: copy.inGameTag },
    stays: { note: copy.ownEditorNote },
  })[verdict?.kind];

// Вид мода для вкладки: подраздел каталога или раздел, на языке окна; без него — «Другое».
function modGroup(mod, language) {
  const label = mod.catalogSubcategory || mod.categoryLabel || "";
  return label ? catalogLabel(label, language) : OTHER;
}

// Плитки состава: моды, потом работы кода, потом установки старой сборки; у каждой — вкладка, в которой она стоит.
function compositionTiles(props, model, verdicts) {
  const { copy, workKinds, language } = props;
  const tiles = [];
  for (const row of model.rows) {
    const node = row.mod.pending
      ? pendingTile(props, row.mod)
      : settledTile(props, model, row);
    tiles.push({ node, group: modGroup(row.mod, language) });
  }
  for (const work of props.works) {
    const kindLabel = workKinds?.[work.workKind] ?? "";
    const extras = verdictExtras(copy, verdicts.get(work.code));
    const node = (
      <BuildWorkTile
        key={`work:${work.code}`}
        entry={work}
        kindLabel={kindLabel}
        copy={copy}
        {...extras}
      />
    );
    tiles.push({ node, group: WORKS });
  }
  for (const item of props.items) {
    const kindLabel = workKinds?.[item.workKind] ?? "";
    const node = (
      <BuildWorkTile
        key={`item:${item.key}`}
        item={item}
        kindLabel={kindLabel}
        copy={copy}
      />
    );
    tiles.push({ node, group: WORKS });
  }
  return tiles;
}

// Вкладки: «Все», потом виды модов в порядке появления, «Работы мастерской» последней; у каждой — сколько плиток.
function tabsOf(tiles) {
  const counts = new Map();
  for (const { group } of tiles)
    counts.set(group, (counts.get(group) || 0) + 1);
  const kinds = [...counts.keys()].filter(
    (group) => group !== OTHER && group !== WORKS,
  );
  const order = [
    ...kinds,
    ...(counts.has(OTHER) ? [OTHER] : []),
    ...(counts.has(WORKS) ? [WORKS] : []),
  ];
  return [
    { id: ALL, count: tiles.length },
    ...order.map((id) => ({ id, count: counts.get(id) })),
  ];
}

const tabName = (id) => {
  if (id === ALL) return tr("Все");
  if (id === OTHER) return tr("Другое");
  if (id === WORKS) return tr("Работы мастерской");
  return id;
};

function shelfTiles(props, shelf) {
  const { copy, language, availableMods, getModSize } = props;
  return shelf.map((mod) => {
    const rowProps = {
      mod: { ...mod, name: mod.name || mod.id },
      mode: "static",
      leaving: true,
      size: isResolved(mod) ? getModSize(mod, availableMods) : 0,
      language,
      copy,
    };
    return <BuildModRow key={`left:${mod.id}`} {...rowProps} />;
  });
}

const Notice = ({ extra, children }) => (
  <p
    role="note"
    className={
      extra ? `builds-dialog-leaving ${extra}` : "builds-dialog-leaving"
    }
  >
    {warnGlyph}
    <span>{children}</span>
  </p>
);

function replaceText(copy, model) {
  if (model.replacingWorks.length === 0)
    return copy.replaceWarningText(model.replacingMods);
  return copy.replaceAnyWarningText([
    ...model.replacingMods,
    ...model.replacingWorks,
  ]);
}

// Дата правки сборки словами окна: «12 ноября»; не дата — пусто.
function stampOf(iso, language) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(language, {
      day: "numeric",
      month: "long",
    }).format(date);
  } catch {
    return "";
  }
}

function originPill(props) {
  const { build, language, fromCode } = props;
  const stamp = stampOf(build.updatedAt, language);
  if (fromCode)
    return stamp
      ? tr("Пришла по коду · {date}").replace("{date}", stamp)
      : tr("Пришла по коду");
  return stamp
    ? tr("Ваша сборка · обновлена {date}").replace("{date}", stamp)
    : tr("Ваша сборка");
}

// Кадр-обложка: первое фото сборки во весь кадр; нет фото у модов — мозаика из того, что есть.
function heroCover(props) {
  const { mods, works, items } = props;
  const lead = mods.find(hasModPhoto);
  if (lead) return <BuildCoverCollage mods={[lead]} />;
  return (
    <BuildCoverCollage
      mods={mods}
      works={works}
      items={items}
      pending={pendingWithoutPhoto(mods)}
    />
  );
}

function actionRow(props, model) {
  const { build, copy, worksCopy, onInstall, installed } = props;
  const installProps = {
    variant: "primary",
    size: "lg",
    icon: <Check weight="bold" aria-hidden="true" />,
    disabled:
      model.waiting || (props.enabledCount === 0 && props.works.length === 0),
    onClick: onInstall,
  };
  const copied = props.copiedBuildId === build.id;
  const menuProps = {
    className: "builds-open-menu",
    variant: "secondary",
    size: "lg",
    icon: <DotsThree weight="bold" aria-hidden="true" />,
    trailing: null,
    ariaLabel: copy.actionsFor(build.name),
    align: "start",
    options: menuOptions(copy, worksCopy, {
      copied,
      hasWorks: props.works.length > 0,
    }),
    onSelect: (value) => {
      const handler = {
        onCopy: props.onCopy,
        onRemoveWorks: props.onRemoveWorks,
        onDelete: props.onDelete,
      }[REACTIONS[value]];
      handler?.(build);
    },
  };
  return (
    <div className="builds-open-actions">
      {props.hasContent ? (
        <Button {...installProps}>{tr("Установить сборку")}</Button>
      ) : null}
      {props.choice?.total > 0 ? (
        <Button
          variant="secondary"
          size="lg"
          icon={<TShirt aria-hidden="true" />}
          onClick={props.choice.start}
        >
          {props.choice.count > 0
            ? tr("Выбрать цели ({n})").replace("{n}", String(props.choice.count))
            : tr("Изменить цели")}
        </Button>
      ) : null}
      {props.onEdit ? (
        <Button
          variant="secondary"
          size="lg"
          icon={<PenNib aria-hidden="true" />}
          onClick={() => props.onEdit(build)}
        >
          {tr("Изменить")}
        </Button>
      ) : null}
      <MenuButton {...menuProps} />
      {installed && props.hasContent ? (
        <span className="builds-open-state">
          <i aria-hidden="true">
            <Check weight="bold" />
          </i>
          {tr("Уже стоит в игре")}
        </span>
      ) : null}
    </div>
  );
}

function hero(props, model) {
  const { build, copy, onClose } = props;
  return (
    <header className="builds-open-hero">
      <div className="builds-open-cover" aria-hidden="true">
        {heroCover(props)}
      </div>
      <div className="builds-open-shade" aria-hidden="true" />
      <button type="button" className="builds-open-crumb" onClick={onClose}>
        <CaretLeft weight="bold" aria-hidden="true" />
        {copy.title}
      </button>
      <div className="builds-open-copy">
        <span className="builds-open-pill">{originPill(props)}</span>
        <h1 id="builds-open-title">{gluedTitle(build.name)}</h1>
        {props.hasContent ? (
          <BuildSummaryFacts
            className="builds-open-facts"
            summary={model.summary}
            totalSize={model.totalSize}
            language={props.language}
            copy={copy}
          />
        ) : null}
      </div>
      {actionRow(props, model)}
      {props.hasContent ? (
        <BuildOpenTicket
          build={build}
          copy={copy}
          copied={props.copiedBuildId === build.id}
          shownCode={props.shownCode}
          onCopy={props.onCopy}
          onPasteCode={props.onPasteCode}
        />
      ) : null}
    </header>
  );
}

function notes(props, model) {
  const { mods, works, items, copy } = props;
  const replaces = model.replacingMods.length + model.replacingWorks.length > 0;
  const replaceNote = replaces ? (
    <Notice extra="builds-dialog-replacing">{replaceText(copy, model)}</Notice>
  ) : null;
  const leavingNote =
    mods.length > 0 && model.leaving.length > 0 ? (
      <Notice>{copy.leavingText(model.leaving)}</Notice>
    ) : null;
  const hasOwn = works.length > 0 || items.length > 0;
  const worksNote = hasOwn ? (
    <p className="builds-dialog-works-note">{props.worksCopy.worksNote}</p>
  ) : null;
  if (!replaceNote && !leavingNote && !worksNote) return null;
  return (
    <div className="builds-open-notes">
      {replaceNote}
      {leavingNote}
      {worksNote}
    </div>
  );
}

function bulkControls(props, model) {
  const { copy, enabledCount, setEnabledIds } = props;
  const everyId = model.installable.map((row) => row.mod.id);
  const pickAll = () => setEnabledIds(new Set(everyId));
  const clearAll = () => setEnabledIds(new Set());
  return (
    <div className="builds-open-bulk">
      <Button
        {...quiet}
        disabled={enabledCount === everyId.length}
        onClick={pickAll}
      >
        {copy.selectAll}
      </Button>
      <Button {...quiet} disabled={enabledCount === 0} onClick={clearAll}>
        {copy.selectNone}
      </Button>
    </div>
  );
}

function tabRow(props, model, tabs, tab, setTab) {
  const { mods, copy } = props;
  const status = model.waiting
    ? copy.loadingMods
    : mods.length === 0
      ? null
      : copy.selected(props.enabledCount, mods.length);
  return (
    <div className="builds-open-tabs-row">
      <div
        className="builds-open-tabs"
        role="tablist"
        aria-label={copy.contentsTitle}
      >
        {tabs.map(({ id, count }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={id === tab}
            className={id === tab ? "is-active" : undefined}
            onClick={() => setTab(id)}
          >
            {tabName(id)}
            <em>{count}</em>
          </button>
        ))}
      </div>
      {status ? (
        <span
          className="builds-dialog-loading builds-open-status"
          role="status"
        >
          {status}
        </span>
      ) : null}
      {mods.length > 0 ? bulkControls(props, model) : null}
    </div>
  );
}

function compositionSection(props, model, tiles, tabState) {
  const { mods, copy, pageSize, setVisibleModCount } = props;
  const { tab, setTab } = tabState;
  const tabs = tabsOf(tiles);
  const active = tabs.some((item) => item.id === tab) ? tab : ALL;
  const shown =
    active === ALL ? tiles : tiles.filter((entry) => entry.group === active);
  const hiddenCount = shown.length - props.visibleModCount;
  const advance = () =>
    setVisibleModCount((count) => Math.min(shown.length, pageSize + count));
  const nextPage = () => (
    <div className="builds-open-more">
      <Button variant="ghost" onClick={advance}>
        {copy.showMore(hiddenCount)}
      </Button>
    </div>
  );

  return (
    <section
      aria-label={copy.contentsTitle}
      className="builds-open-mods builds-dialog-mods"
    >
      {tabRow(props, model, tabs, active, setTab)}
      <PickGrid
        label={copy.contentsTitle}
        look="poster"
        className="builds-mod-grid"
      >
        {shown.slice(0, props.visibleModCount).map((entry) => entry.node)}
      </PickGrid>
      {hiddenCount > 0 ? nextPage() : null}
      {mods.length > 0 ? (
        <p className="builds-dialog-hint">{copy.pickHint}</p>
      ) : null}
    </section>
  );
}

function shelfSection(props, shelf) {
  const { copy } = props;
  const hint = <p className="builds-dialog-hint">{copy.leavingHint}</p>;
  return (
    <section
      aria-label={copy.leavingTitle}
      className="builds-open-mods builds-dialog-removed"
    >
      <header className="builds-open-section-head">
        <h3>
          {warnGlyph}
          {copy.leavingTitle}
        </h3>
      </header>
      <PickGrid
        label={copy.leavingTitle}
        look="poster"
        className="builds-mod-grid"
      >
        {shelfTiles(props, shelf)}
      </PickGrid>
      {hint}
    </section>
  );
}

function emptyStub(props) {
  const { copy, onClose, onNavigate } = props;
  const goCatalog = () => {
    onClose();
    onNavigate("catalog");
  };
  return (
    <div className="builds-dialog-empty">
      <Stack aria-hidden="true" />
      <strong>{copy.emptyTitle}</strong>
      <p>{copy.emptyText}</p>
      <Button onClick={goCatalog}>{copy.openCatalog}</Button>
    </div>
  );
}

const BuildOpenedPage = (rawProps) => {
  useTr();
  usePageFrame(".desktop-main", ".desktop-content", true);
  const {
    items = NO_LIST,
    installedIds = NO_IDS,
    workItems = NO_LIST,
  } = rawProps;
  const props = { ...rawProps, items, installedIds, workItems };
  const [tab, setTab] = useState(ALL);

  const verdicts = useWorkVerdicts(props.works, {
    workItems,
    installedIds,
    allMods: props.availableMods,
  });
  const model = assess(props, verdicts);
  const tiles = compositionTiles(props, model, verdicts);

  return (
    <section
      className="builds-open"
      role="region"
      aria-label={props.build.name}
    >
      {hero(props, model)}
      <div className="builds-open-body">
        {props.hasContent ? (
          <>
            {notes(props, model)}
            {compositionSection(props, model, tiles, { tab, setTab })}
            {model.shelf.length > 0 ? shelfSection(props, model.shelf) : null}
          </>
        ) : (
          emptyStub(props)
        )}
      </div>
    </section>
  );
};

export default BuildOpenedPage;
