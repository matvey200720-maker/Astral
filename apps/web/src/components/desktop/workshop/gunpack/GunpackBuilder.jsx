import * as Glyph from "../../../ui/icons.jsx";
import Select from "../../../ui/Select.jsx";
import * as Slang from "@modovik/gunpack/slang";
import TextField from "../../../ui/TextField.jsx";
import { createElement as h, useDeferredValue, useMemo, useReducer } from "react";
import * as Copy from "../gun/gun-copy.js";
import { tr, useTr } from "../../../../locales/ui.js";
import SlotTracer from "./SlotTracer.jsx";
import * as Rail from "./GunpackRail.jsx";
import * as Tracers from "./gunpack-tracers.js";
import * as Checks from "./gunpack-check-copy.js";

export function BuilderRail(props) {
  useTr();
  const search = useSearch();
  const builder = props.builder;
  const slots = builder.slots;
  const groups = useGroups(slots, search.settled);
  const total = slots.length;

  const header = h(
    "div",
    { className: "gunpack-rail-packs" },
    h(TextField, { label: tr("Название сборки"), value: builder.name, maxLength: 80, onChange: builder.setName }),
    note(say("Взято стволов: {n} из {total}", { n: builder.picked, total })),
  );
  return h("div", { className: "gunpack-rail" }, header, searchBox(search), slotList(builder, groups, search.typed));
}

export function BuilderPanel(props) {
  useTr();
  const builder = props.builder;
  const slot = builder.slot;
  const onTracer = props.onTracer ?? null;
  const middle = slot ? versionsBlock(builder, slot, onTracer) : [hint(tr("Слева — стволы из «Моих паков»."))];
  const hintText = tr(
    "Возьми каждый ствол из того пака, где он тебе нравится. Сборка ляжет в «Мои паки» рядом с остальными — её можно поставить в игру одним нажатием, как обычный пак.",
  );

  return h(
    "section",
    { className: "gun-panel gunpack-builder" },
    h("h2", null, tr("Свой пак")),
    hint(hintText),
    ...middle,
    h("h3", null, tr("Обвесы")),
    sourcePicker(builder),
    builder.error ? h("p", { className: "gun-hint gunpack-catalog-error", role: "alert" }, builder.error) : null,
  );
}

// Текст поля живёт в колонке; список отстаёт от него на один проход.
function useSearch() {
  const [typed, type] = useReducer(replaceWith, "");
  return { typed, type, settled: useDeferredValue(typed) };
}

// Группы пересчитываются по ссылке на массив слотов: правка на месте их не трогает.
const useGroups = (slots, query) =>
  useMemo(() => {
    const kept = slots.flatMap((slot) => (Slang.weaponMatches(slot, query) ? [slot] : []));
    const titles = kept.map((slot) => familyTitle(slot.family));
    return [...new Set(titles)].map((title) => [title, kept.filter((_, at) => titles[at] === title)]);
  }, [slots, query]);

function searchBox(search) {
  const onChange = ({ target }) => search.type(target.value);
  const field = h("input", {
    type: "search",
    value: search.typed,
    "aria-label": tr("Найти ствол"),
    placeholder: tr("Найти ствол: хевик, сайга, карабин…"),
    onChange,
  });
  return h("label", { className: "gunpack-search" }, h(Glyph.MagnifyingGlass, { "aria-hidden": "true" }), field);
}

function slotList(builder, groups, typed) {
  const sections = [];
  for (const group of groups) sections.push(groupSection(builder, group));
  if (groups.length === 0) sections.push(note(say("Ничего не нашлось по «{query}».", { query: typed })));
  return h("div", { className: "gunpack-weapons", role: "list" }, ...sections);
}

function groupSection(builder, [title, members]) {
  const rows = [];
  for (const slot of members) rows.push(slotRow(builder, slot));
  return h(
    "section",
    { key: members[0].model, className: "gunpack-family", role: "listitem" },
    h("h3", null, Copy.tl(title), " ", h("small", null, members.length)),
    ...rows,
  );
}

function slotRow(builder, slot) {
  const lookup = builder.picks;
  const chosen = locate(slot.versions, lookup[slot.model]);
  const current = slot.model === builder.model;
  const classes = ["gunpack-weapon", current && "is-active", !chosen && "is-skipped"];
  const picture = frameOf(builder, chosen ?? slot.versions[0]);
  const copy = h(
    "span",
    { className: "gunpack-weapon-copy" },
    h("b", null, tr(slot.name)),
    h("small", null, tracerDot(builder.tracers, slot.weaponId), statusOf(slot, chosen)),
  );

  return h(
    "button",
    {
      key: slot.model,
      type: "button",
      className: classes.filter(Boolean).join(" "),
      "aria-pressed": current,
      onClick: () => builder.setModel(slot.model),
    },
    shotCell(picture),
    copy,
    chosen ? stamp("gunpack-weapon-mark is-picked", Glyph.CheckCircle, tr("Взят в сборку")) : null,
  );
}

function statusOf(slot, chosen) {
  if (!chosen) return say("не берём · версий: {n}", { n: slot.versions.length });
  return say("из «{pack}»", { pack: chosen.packName });
}

// Выбранная версия слота; метод списка вызывается и без выбора (строка вместо списка даёт TypeError).
function locate(versions, pick) {
  const at = versions.findIndex((version) => Boolean(pick) && sameSource(version, pick));
  return at < 0 ? undefined : versions[at];
}

function tracerDot(tracers, weaponId) {
  const tracer = Tracers.slotTracer(tracers, weaponId)?.tracer;
  if (!tracer || tracer.off) return null;
  const label = say("Трейсер: {name}", { name: tracer.title });
  return h("i", { className: "gunpack-tracer-dot", style: { "--tracer": tracer.colour }, title: label, "aria-label": label });
}

function versionsBlock(builder, slot, onTracer) {
  const picked = Boolean(builder.picks[slot.model]);
  const { weaponId } = slot;
  const rows = [
    versionButton({
      title: tr("Не брать"),
      note: tr("В игре останется ствол, который стоит сейчас"),
      key: "skip",
      onClick: () => builder.choose(slot.model, null),
      active: !picked,
    }),
  ];
  for (const version of slot.versions) rows.push(versionItem(builder, slot.model, version));
  return [
    h("h3", null, tr(slot.name)),
    h("ul", { className: "gunpack-versions" }, ...rows),
    h(SlotTracer, { weaponId, tracers: builder.tracers, onTracer }),
  ];
}

function versionItem(builder, model, version) {
  const { packId, variantKey, packName, weapon } = version;
  return versionButton({
    key: `${packId}|${variantKey}`,
    active: builder.isChosen(version),
    onClick: () => builder.choose(model, { packId, variantKey }),
    frame: builder.thumbOf(version),
    title: say("Из «{pack}»", { pack: packName }),
    note: versionNote(weapon),
    mark: verdictMark(Rail.weaponSeverity(weapon)),
  });
}

function versionButton(spec) {
  const { key, active, onClick, frame, title, note: remark, mark = null } = spec;
  const props = {
    type: "button",
    className: active ? "gunpack-version is-active" : "gunpack-version",
    "aria-pressed": active,
    onClick,
  };
  const copy = h("span", { className: "gunpack-weapon-copy" }, h("b", null, title), h("small", { title: remark }, remark));
  return h("li", { key }, h("button", props, shotCell(frame), copy, mark));
}

function verdictMark(verdict) {
  switch (verdict) {
    case "block":
      return stamp("gunpack-weapon-mark is-block", Glyph.XCircle, tr("Не встанет"));
    case "warn":
      return stamp("gunpack-weapon-mark is-warn", Glyph.WarningCircle, tr("Есть предупреждения"));
    default:
      return null;
  }
}

/** Пояснение к версии: первое предупреждение или запрет, иначе счёт файлов. */
function versionNote(weapon) {
  const checks = weapon.checks || [];
  const flagged = checks.find(isFlagged);
  if (flagged) return Checks.checkMessage(flagged.message);
  const forms = tr("файл|файла|файлов");
  return say("{what}, замечаний нет", { what: Copy.count(weapon.files.length, forms) });
}

function sourcePicker(builder) {
  const { sources, attachments } = builder;
  const options = [["", tr("Не брать — обвесы как в игре")]];
  for (const source of sources.values()) {
    const caption = sourceCaption(source);
    options.push([sourceValue(source), caption]);
  }
  return h(Select, {
    label: tr("Откуда взять обвесы"),
    value: attachments ? sourceValue(attachments) : "",
    options,
    onChange: (picked) => builder.setAttachments(decodeSource(picked)),
  });
}

function sourceCaption(source) {
  const { label, count, hidden } = source;
  if (!hidden) return `«${label}» — ${count}`;
  return say("«{name}» — {n}, скрыто {hidden}", { name: label, n: count, hidden });
}

function decodeSource(value) {
  return value ? splitSource(value.split("|")) : null;
}

function splitSource(parts) {
  return { packId: parts[0], variantKey: parts[1] ?? "" };
}

function familyTitle(family) {
  // Поиск прямо по имени семейства, как в старом коде: имена из прототипа объекта
  // дают не строку, а пустой заголовок.
  return TITLES_BY_FAMILY[family] ?? Copy.trKey("Прочее");
}

const sourceValue = (source) => `${source.packId}|${source.variantKey}`;
const sameSource = (a, b) => ["packId", "variantKey"].every((field) => a[field] === b[field]);
const frameOf = (builder, version) => (version ? builder.thumbOf(version) : undefined);
const isFlagged = ({ severity }) => severity === "warn" || severity === "block";
const replaceWith = (_, next) => next;
const say = (template, values) => Copy.fill(tr(template), values);
const hint = (...kids) => h("p", { className: "gun-hint" }, ...kids);
const note = (...kids) => h("p", { className: "gunpack-rail-note" }, ...kids);
const stamp = (className, Icon, label) => h(Icon, { className, weight: "fill", "aria-label": label });

function shotCell(frame) {
  const picture = frame ? h("img", { alt: "", src: frame }) : h(Glyph.Crosshair);
  return h("span", { className: "gunpack-weapon-shot", "aria-hidden": "true" }, picture);
}

const FAMILY_NAMES = "pistol smg rifle shotgun sniper machinegun launcher melee thrown".split(" ");
const FAMILY_TITLES = [
  Copy.trKey("Пистолеты"),
  Copy.trKey("Пистолеты-пулемёты"),
  Copy.trKey("Винтовки"),
  Copy.trKey("Дробовики"),
  Copy.trKey("Снайперские"),
  Copy.trKey("Пулемёты"),
  Copy.trKey("Тяжёлое"),
  Copy.ctx("melee"),
  Copy.trKey("Метательное"),
];
const TITLES_BY_FAMILY = Object.fromEntries(FAMILY_NAMES.map((name, at) => [name, FAMILY_TITLES[at]]));
