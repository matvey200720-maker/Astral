import { useRef, useState } from "react";
import { tr, useTr } from "../../../locales/ui.js";
import { formatSize } from "../../../catalog-utils.js";
import { useRememberedState } from "../../../section-memory.js";
import Button from "../../ui/Button.jsx";
import TileThumbImg from "../../ui/TileThumbImg.jsx";
import {
  Check,
  CaretLeft,
  ClipboardText,
  MagnifyingGlass,
  PenNib,
  Stack,
  Warning,
} from "../../ui/icons.jsx";
import { usePreviewModel } from "./BuildContentsPreview.jsx";
import { usePageFrame } from "../use-page-frame.js";
import "./builds-create.css";

/*
 * «Новая сборка» (дизайн 15.11.2026, макет r3/builds/builds-C-create, вариант «Стопка»): страница из трёх колонок вместо окна.
 * Слева — откуда брать (библиотека или код друга) и вид мода; посередине — название, поиск и список с отметками; справа — «Ваша стопка»:
 * веер обложек, вес по видам, что войдёт и предупреждение, если что-то встанет вместо вашего.
 *
 * Логика прежняя (`usePreviewModel` из `BuildContentsPreview.jsx`): те же отметки (`selection`, `codeSelection`), те же цифры и «встанет вместо вашего»,
 * те же действия «Создать» и «Прочитать код». «Каталог» из макета как источник не сделан: сборка собирается из библиотеки или читается из кода.
 */

const ALL = "all";
const WORKS = "works";
const SHADES = [
  "#f4f4f5",
  "#a6a6ac",
  "#6e6e75",
  "#c9c9ce",
  "#8a8a91",
  "#dcdce0",
];
const STACK_LIST = 4;

const groupOf = (entry) =>
  String(entry.key).startsWith("work:") ? WORKS : entry.kicker || "";
const isPicked = (entry) => (entry.check ? entry.check.checked : true);

function Thumb({ face, className }) {
  if (face?.cover) {
    const fit = face.fit === "contain" ? " is-contain" : "";
    return (
      <span className={`${className}${fit}`} aria-hidden="true">
        <TileThumbImg
          alt=""
          loading="lazy"
          decoding="async"
          src={face.cover}
          tile={120}
        />
      </span>
    );
  }
  return (
    <span className={`${className} is-blank`} aria-hidden="true">
      {face?.media ?? <Stack />}
    </span>
  );
}

// Веер из трёх обложек: верхняя — первая в стопке, остальные выглядывают из-под неё.
function Fan({ entries }) {
  const faces = entries.slice(0, 3).reverse();
  const rotate =
    faces.length === 3 ? [-9, -2, 7] : faces.length === 2 ? [-5, 5] : [0];
  const shift =
    faces.length === 3 ? [0, 14, 28] : faces.length === 2 ? [0, 22] : [0];
  return (
    <div className="builds-fan" aria-hidden="true">
      <div
        className="builds-fan-stack"
        style={{ width: 140 + shift[shift.length - 1] + 16 }}
      >
        {faces.map((entry, index) => (
          <span
            key={entry.key}
            className="builds-fan-card"
            style={{
              left: shift[index],
              transform: `rotate(${rotate[index]}deg)`,
            }}
          >
            <Thumb face={entry.face} className="builds-fan-pic" />
          </span>
        ))}
      </div>
    </div>
  );
}

function SourceNav({
  props,
  mode,
  onMode,
  filter,
  onFilter,
  groups,
  libraryCount,
}) {
  const { copy, onClose, editing } = props;
  const onTabKey = (event) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[
      event.key
    ];
    if (!step) return;
    event.preventDefault();
    const next = mode === "save" ? "code" : "save";
    if (next === mode) return;
    onMode(next);
    event.currentTarget.ownerDocument
      .getElementById(`builds-create-tab-${next}`)
      ?.focus();
  };
  const sources = [
    {
      id: "save",
      label: tr("Библиотека"),
      count: libraryCount,
      icon: <Stack aria-hidden="true" />,
    },
    {
      id: "code",
      label: copy.tabCode,
      count: null,
      icon: <ClipboardText aria-hidden="true" />,
    },
  ].filter((source) => !editing || source.id === "save");
  return (
    <nav className="builds-create-nav" aria-label={copy.createTitle}>
      <button type="button" className="builds-create-crumb" onClick={onClose}>
        <CaretLeft weight="bold" aria-hidden="true" />
        {copy.title}
      </button>
      <h2>{tr("Откуда")}</h2>
      <div role="tablist" aria-orientation="vertical" onKeyDown={onTabKey}>
        {sources.map(({ id, label, count, icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`builds-create-tab-${id}`}
            aria-selected={mode === id}
            aria-controls="builds-create-panel"
            className={
              mode === id
                ? "builds-create-nav-item is-active"
                : "builds-create-nav-item"
            }
            onClick={() => onMode(id)}
          >
            {icon}
            <span>{label}</span>
            {count !== null ? <b>{count}</b> : null}
          </button>
        ))}
      </div>
      <h2 className="builds-create-nav-gap">{tr("Тип")}</h2>
      <div role="group" aria-label={tr("Тип")}>
        {[{ id: ALL, picked: 0 }, ...groups].map(({ id, picked }) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            className={
              filter === id
                ? "builds-create-nav-item is-active"
                : "builds-create-nav-item"
            }
            onClick={() => onFilter(id)}
          >
            <span>
              {id === ALL
                ? tr("Все")
                : id === WORKS
                  ? tr("Работы мастерской")
                  : id}
            </span>
            {id !== ALL && picked > 0 ? <em>{picked}</em> : null}
          </button>
        ))}
      </div>
    </nav>
  );
}

function Row({ entry, copy }) {
  const { check } = entry;
  const on = check
    ? check.checked
    : !String(entry.className).includes("is-blocked");
  const body = (
    <>
      <span
        className={`builds-create-box${on ? " is-on" : ""}`}
        aria-hidden="true"
      >
        {on ? <Check weight="bold" /> : null}
      </span>
      <Thumb face={entry.face} className="builds-create-thumb" />
      <span className="builds-create-name">
        <b>{entry.title}</b>
        <span className={entry.badge ? "is-caution" : undefined}>
          {entry.badge}
          {entry.note ||
            [entry.kicker, entry.meta === copy.offGameTag ? entry.meta : ""]
              .filter(Boolean)
              .join(" · ")}
        </span>
      </span>
      <span className="builds-create-size">{entry.weight || ""}</span>
    </>
  );
  const rowClass = `builds-create-row ${entry.className || ""}${on ? " is-sel" : ""}`;
  if (!check) return <li className={rowClass}>{body}</li>;
  return (
    <li className={rowClass}>
      <label>
        <input
          type="checkbox"
          checked={check.checked}
          aria-label={check.label}
          onChange={check.onChange}
        />
        {body}
      </label>
    </li>
  );
}

function StackPanel({ props, model, picked }) {
  const { copy, worksCopy, language } = props;
  const list = picked.slice(0, STACK_LIST);
  const sized = picked.filter((entry) => entry.bytes > 0);
  const totalBytes = sized.reduce((sum, entry) => sum + entry.bytes, 0);
  const byType = new Map();
  for (const entry of sized) {
    const key = groupOf(entry) || tr("Другое");
    byType.set(key, (byType.get(key) || 0) + entry.bytes);
  }
  const parts = [...byType.entries()];
  const modCount = model.selecting ? model.enabledIds.size : model.mods.length;
  const caution =
    model.comparing &&
    (model.replacedMods.length > 0 || model.replacingWorks.length > 0)
      ? model.replacingWorks.length > 0
        ? copy.replaceAnyWarningText([
            ...model.replacedMods,
            ...model.replacingWorks,
          ])
        : copy.replaceWarningText(model.replacedMods)
      : null;
  const facts = [
    ["fresh", copy.previewFresh, model.unknown ? "—" : model.summary.fresh],
    [
      "replace",
      copy.factReplaceAny,
      model.unknown ? "—" : model.summary.replacing,
    ],
    ...(model.summary.already > 0
      ? [["already", copy.previewInGame, model.summary.already]]
      : []),
  ];

  return (
    <aside className="builds-create-stack" aria-label={tr("Ваша стопка")}>
      <h2>{tr("Ваша стопка")}</h2>
      <div className="builds-fan-wrap">
        {picked.length > 0 ? <Fan entries={picked} /> : null}
      </div>
      <div className="builds-stack-total">
        <b>
          <span data-fact="mods">{copy.mods(modCount)}</span>
          {model.works.length > 0 ? (
            <>
              {" · "}
              <span data-fact="works">
                {worksCopy.works(model.works.length)}
              </span>
            </>
          ) : null}
          {model.totalSize > 0 ? (
            <>
              {" · "}
              <span data-fact="size">
                {formatSize(model.totalSize, language)}
              </span>
            </>
          ) : null}
        </b>
        {parts.length > 0 ? <span>{tr("размер по типам")}</span> : null}
      </div>
      {parts.length > 0 ? (
        <>
          <div className="builds-stack-meter" aria-hidden="true">
            {parts.map(([name, bytes], index) => (
              <i
                key={name}
                style={{
                  width: `${(bytes / totalBytes) * 100}%`,
                  background: SHADES[index % SHADES.length],
                }}
              />
            ))}
          </div>
          <ul className="builds-stack-legend">
            {parts.map(([name, bytes], index) => (
              <li key={name} style={{ "--c": SHADES[index % SHADES.length] }}>
                {name} {formatSize(bytes, language)}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {model.comparing ? (
        <dl className="builds-stack-compare">
          {facts.map(([id, label, value]) => (
            <div key={id}>
              <dt>{label}</dt>
              <dd
                data-fact={id}
                className={
                  id === "replace" && value > 0 ? "is-caution" : undefined
                }
              >
                {id === "replace" && value > 0 ? (
                  <Warning weight="fill" aria-hidden="true" />
                ) : null}
                {value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <ul className="builds-stack-list">
        {list.map((entry) => (
          <li key={entry.key}>
            <Thumb face={entry.face} className="builds-stack-thumb" />
            <span>{entry.title}</span>
            <em>{entry.weight || ""}</em>
          </li>
        ))}
      </ul>
      {picked.length > list.length ? (
        <p className="builds-stack-more">
          {copy.andMore} {picked.length - list.length}
        </p>
      ) : null}
      {caution ? (
        <p className="builds-stack-warn" role="note">
          <Warning aria-hidden="true" />
          <span>{caution}</span>
        </p>
      ) : null}
    </aside>
  );
}

export default function BuildCreatePage(props) {
  useTr();
  usePageFrame(".desktop-main", ".desktop-content", true);
  const {
    copy,
    name,
    onName,
    defaultName,
    importCode,
    onImportCode,
    onCreate,
    onImport,
    onClose,
  } = props;
  const {
    installedMods,
    installedWorks,
    installedIds,
    availableMods,
    getModSize,
    blockOf,
    workItems,
  } = props;
  const {
    importMods = [],
    importWorks = [],
    pastedCode = null,
    selection = null,
    codeSelection = null,
    language,
  } = props;
  const [rememberedMode, setMode] = useRememberedState(
    "builds:create-mode",
    "save",
  );
  const editing = Boolean(props.editing);
  /* «Изменить» правит состав сборки — вкладки «По коду» тут нет. */
  const mode = editing ? "save" : rememberedMode;
  const [filter, setFilter] = useState(ALL);
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState(false);
  const titleField = useRef(null);
  const saving = mode === "save";
  const submit = saving ? onCreate : onImport;
  const onEnter = (event) => {
    if (event.key === "Enter") submit();
  };

  const model = usePreviewModel({
    mode: saving ? "save" : "code",
    mods: saving ? installedMods : importMods,
    works: saving ? installedWorks : importWorks,
    selection: saving ? selection : codeSelection,
    installedIds,
    availableMods,
    getModSize,
    blockOf,
    workItems,
    language,
    copy,
  });
  const entries = model.entries;
  const pickedEntries = entries.filter(isPicked);
  const counts = new Map();
  for (const entry of entries) {
    const group = groupOf(entry) || tr("Другое");
    counts.set(group, (counts.get(group) || 0) + (isPicked(entry) ? 1 : 0));
  }
  const groups = [...counts.entries()].map(([id, picked]) => ({ id, picked }));
  const activeFilter = filter === ALL || counts.has(filter) ? filter : ALL;
  const needle = query.trim().toLowerCase();
  const shown = entries.filter((entry) => {
    if (
      activeFilter !== ALL &&
      (groupOf(entry) || tr("Другое")) !== activeFilter
    )
      return false;
    if (only && !isPicked(entry)) return false;
    return !needle || String(entry.title).toLowerCase().includes(needle);
  });
  const listLabel = saving ? copy.willSave : copy.codeContents;
  const pickedCount = model.selecting
    ? model.enabledIds.size
    : pickedEntries.length;

  return (
    <section
      className="builds-create"
      role="region"
      aria-label={editing ? tr("Изменить сборку") : copy.createTitle}
    >
      <SourceNav
        props={props}
        mode={mode}
        onMode={setMode}
        filter={activeFilter}
        onFilter={setFilter}
        groups={groups}
        libraryCount={installedMods.length}
      />
      <div
        className="builds-create-mid"
        id="builds-create-panel"
        role="tabpanel"
        aria-labelledby={`builds-create-tab-${mode}`}
      >
        {saving ? (
          <div className="builds-create-title">
            <input
              ref={titleField}
              type="text"
              value={name}
              placeholder={defaultName}
              aria-label={copy.nameLabel}
              maxLength={120}
              autoFocus
              onChange={(event) => onName(event.target.value)}
              onKeyDown={onEnter}
            />
            <button
              type="button"
              className="builds-create-pen"
              aria-hidden="true"
              tabIndex={-1}
              onClick={() => titleField.current?.focus()}
            >
              <PenNib aria-hidden="true" />
            </button>
          </div>
        ) : (
          <div className="builds-create-title is-code">
            <input
              type="text"
              value={importCode}
              placeholder="ASTRAL-XXXXXXXXXX"
              aria-label={copy.codeLabel}
              aria-invalid={pastedCode?.problem ? "true" : undefined}
              spellCheck={false}
              autoFocus
              onChange={(event) => onImportCode(event.target.value)}
              onKeyDown={onEnter}
            />
          </div>
        )}
        {!saving ? (
          <p
            className={
              pastedCode?.problem
                ? "builds-create-hint is-error"
                : "builds-create-hint"
            }
          >
            {pastedCode?.problem ||
              (pastedCode?.loading
                ? tr("Код загружается с сервера…")
                : copy.importText)}
          </p>
        ) : null}
        <div className="builds-create-tools">
          <label className="builds-create-search">
            <MagnifyingGlass aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder={
                saving ? tr("Найти в библиотеке") : tr("Найти в коде")
              }
              aria-label={tr("Найти по названию")}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div
            className="builds-create-seg"
            role="group"
            aria-label={listLabel}
          >
            <button
              type="button"
              aria-pressed={!only}
              className={
                only ? "builds-create-chip" : "builds-create-chip is-on"
              }
              onClick={() => setOnly(false)}
            >
              {tr("Все")}
            </button>
            <button
              type="button"
              aria-pressed={only}
              className={
                only ? "builds-create-chip is-on" : "builds-create-chip"
              }
              onClick={() => setOnly(true)}
            >
              {tr("Выбранные · {count}").replace(
                "{count}",
                String(pickedCount),
              )}
            </button>
          </div>
        </div>
        {model.selecting && model.installable.length > 1 ? (
          <div className="builds-create-bulk">
            <Button
              size="sm"
              variant="ghost"
              disabled={model.picked.length === model.installable.length}
              onClick={() =>
                (saving ? selection : codeSelection).onSetAll(true)
              }
            >
              {copy.selectAll}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={model.picked.length === 0}
              onClick={() =>
                (saving ? selection : codeSelection).onSetAll(false)
              }
            >
              {copy.selectNone}
            </Button>
          </div>
        ) : null}
        {entries.length > 0 ? (
          <ul className="builds-create-list" aria-label={listLabel}>
            {shown.map((entry) => (
              <Row key={entry.key} entry={entry} copy={copy} />
            ))}
          </ul>
        ) : saving ? (
          <p className="builds-create-note">
            {props.installedWorksCount > 0
              ? copy.nothingInstalled
              : copy.emptyBuild}
          </p>
        ) : null}
      </div>
      <div className="builds-create-side">
        <StackPanel props={props} model={model} picked={pickedEntries} />
        <div className="builds-create-cta">
          <Button variant="secondary" size="lg" onClick={onClose}>
            {copy.cancel}
          </Button>
          <Button
            variant="primary"
            size="lg"
            icon={<Check weight="bold" aria-hidden="true" />}
            onClick={submit}
          >
            {editing
              ? tr("Сохранить изменения")
              : saving
                ? tr("Создать сборку")
                : copy.readCode}
          </Button>
        </div>
      </div>
    </section>
  );
}
