import * as Glyph from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import * as Slang from "@modovik/gunpack/slang";
import Select from "../../../ui/Select.jsx";
import { createElement as h, useDeferredValue, useMemo, useReducer } from "react";
import * as Copy from "../gun/gun-copy.js";
import { tr, useTr } from "../../../../locales/ui.js";
import SegmentedControl from "../../../ui/SegmentedControl.jsx";
import * as Studio from "./useGunpackStudio.js";

/** Самая строгая проверка ствола: "block", "warn", "info" или null. */
export function weaponSeverity(weapon) {
  const seen = new Set((weapon?.checks || []).map(({ severity }) => severity));
  for (const level of STRICTEST_FIRST) if (seen.has(level)) return level;
  return null;
}

export default function GunpackRail(props) {
  useTr();
  const { pack, variant } = props;
  const search = useSearch();
  const sections = useSections(variant, search.settled);

  return h(
    "div",
    { className: "gunpack-rail" },
    packBar(props),
    when(props.onCompose, () => composeButton(props.onCompose)),
    when(pack && pack.variants.length > 1, () => variantTabs(props)),
    when(variant, () => searchBox(search)),
    weaponList(props, sections, search.typed),
    when(variant, () => attachmentNote(variant.attachments)),
  );
}

// Текст поля живёт в колонке; список отстаёт от него на один проход.
function useSearch() {
  const [typed, type] = useReducer(replaceWith, "");
  return { typed, type, settled: useDeferredValue(typed) };
}

// Пересчёт идёт по ссылке на variant: правка объекта на месте список не трогает.
function useSections(variant, query) {
  return useMemo(() => {
    if (!variant) return [];
    return regroup(variant.weapons ?? [], query);
  }, [variant, query]);
}

function packBar(props) {
  const { packs, pack } = props;
  const picker = () =>
    h(Select, {
      label: tr("Мои паки"),
      value: pack?.id || "",
      options: packs.map(optionPair),
      onChange: props.onSelectPack,
    });
  const actions = [
    h(Button, { variant: "primary", size: "sm", icon: h(Glyph.Plus), onClick: props.onChoose }, tr("Добавить ганпак")),
    when(props.onEditComposition, () =>
      quietIcon(Glyph.PencilSimple, {
        "aria-label": tr("Изменить сборку"),
        title: tr("Изменить сборку: другие стволы, другие паки"),
        onClick: props.onEditComposition,
      }),
    ),
    when(pack, () =>
      quietIcon(Glyph.Trash, {
        "aria-label": tr("Убрать пак из «Моих паков»"),
        title: tr("Убрать пак из «Моих паков» (сам архив останется)"),
        onClick: () => props.onForgetPack(pack.id),
      }),
    ),
  ];
  return h(
    "div",
    { className: "gunpack-rail-packs" },
    when(packs.length > 0, picker),
    h("div", { className: "gunpack-rail-actions" }, ...actions),
  );
}

function optionPair(pack) {
  return [pack.id, packCaption(pack)];
}

function quietIcon(Icon, extra) {
  return h(Button, { variant: "ghost", size: "sm", icon: h(Icon), ...extra });
}

function composeButton(onClick) {
  const title = tr("Свой пак: каждый ствол — из того пака, где он нравится");
  return h(Button, { variant: "secondary", size: "sm", icon: h(Glyph.Stack), title, onClick }, tr("Собрать свой пак"));
}

function packCaption(pack) {
  const { name, composed } = pack;
  if (pack.available === false) return `${name} — ${composed ? tr("нет пака-источника") : tr("архив пропал")}`;
  if (composed) return say("{name} (своя сборка)", { name });
  return name;
}

function variantTabs(props) {
  const options = props.pack.variants.map(tabOption);
  return h(SegmentedControl, {
    options,
    size: "sm",
    className: "gunpack-variants",
    value: props.variant?.key,
    label: tr("Вариант пака"),
    onChange: props.onVariant,
  });
}

function tabOption(entry) {
  return { value: entry.key, label: entry.label || tr("Пак") };
}

function searchBox({ typed, type }) {
  return h(
    "label",
    { className: "gunpack-search" },
    h(Glyph.MagnifyingGlass, { "aria-hidden": "true" }),
    h("input", {
      type: "search",
      "aria-label": tr("Найти ствол"),
      placeholder: tr("Найти ствол: хевик, сайга, карабин…"),
      value: typed,
      onChange: ({ target }) => type(target.value),
    }),
  );
}

/** Подходящие стволы по группам в фиксированном порядке; пустые группы пропускаются. */
function regroup(weapons, query) {
  const buckets = Array.from({ length: OTHER_RANK + 1 }, () => []);
  weapons.forEach((gun) => {
    if (Slang.weaponMatches(gun, query)) buckets[rankOfFamily(gun.family)].push(gun);
  });
  return buckets.flatMap((items, at) => (items.length ? [{ at, items }] : []));
}

function weaponList(props, sections, typed) {
  const { variant, weapon, shots } = props;
  const rowFor = (gun) =>
    weaponRow(gun, {
      current: weapon?.model === gun.model,
      shot: shots[Studio.shotKey(variant, gun.model)],
      pick: () => props.onWeapon(gun.model),
    });
  const groups = sections.map(({ at, items }) =>
    h(
      "section",
      { key: at, className: "gunpack-family", role: "listitem" },
      h("h3", null, Copy.tl(titleAt(at)), " ", h("small", null, items.length)),
      ...items.map(rowFor),
    ),
  );
  return h(
    "div",
    { className: "gunpack-weapons", role: "list" },
    ...groups,
    when(variant && sections.length === 0, () => note(say("Ничего не нашлось по «{query}».", { query: typed }))),
  );
}

function weaponRow(gun, state) {
  const frame = state.shot ? h("img", { alt: "", src: state.shot.url }) : h(Glyph.Crosshair);
  return h(
    "button",
    {
      key: gun.model,
      type: "button",
      className: state.current ? "gunpack-weapon is-active" : "gunpack-weapon",
      "aria-pressed": state.current,
      onClick: state.pick,
    },
    h("span", { className: "gunpack-weapon-shot", "aria-hidden": "true" }, frame),
    h("span", { className: "gunpack-weapon-copy" }, h("b", null, tr(gun.name)), h("small", null, caption(gun))),
    levelMark(weaponSeverity(gun)),
  );
}

function caption(gun) {
  const { origin, slang, model } = gun;
  if (origin) return say("из «{pack}» · {model}", { pack: origin.packName, model });
  if (slang?.length) return `«${slang[0]}» · ${model}`;
  return model;
}

function levelMark(level) {
  switch (level) {
    case "warn":
      return flag(Glyph.WarningCircle, level, tr("Есть предупреждения"));
    case "block":
      return flag(Glyph.XCircle, level, tr("Ставить нельзя"));
    default:
      return null;
  }
}

function flag(Icon, level, hint) {
  return h(Icon, { className: `gunpack-weapon-mark is-${level}`, weight: "fill", "aria-label": hint });
}

function attachmentNote(items) {
  const hidden = items.map((item) => item.hidden).filter(Boolean).length;
  if (items.length < 1) return null;
  return note(say("Обвесы: {n}", { n: items.length }), hiddenTail(hidden, items.length));
}

function hiddenTail(hidden, total) {
  if (hidden === 0) return null;
  if (hidden < total) return say(", скрыто автором {n}", { n: hidden });
  return tr(" — все скрыты автором");
}

function note(...kids) {
  return h("p", { className: "gunpack-rail-note" }, ...kids);
}

function say(template, values) {
  return Copy.fill(tr(template), values);
}

function when(condition, make) {
  return condition ? make() : null;
}

function replaceWith(_, next) {
  return next;
}

function rankOfFamily(family) {
  return FAMILY_RANK.get(family) ?? OTHER_RANK;
}

function titleAt(rank) {
  switch (rank) {
    case 0:
      return Copy.trKey("Пистолеты");
    case 1:
      return Copy.trKey("Пистолеты-пулемёты");
    case 2:
      return Copy.trKey("Винтовки");
    case 3:
      return Copy.trKey("Дробовики");
    case 4:
      return Copy.trKey("Снайперские");
    case 5:
      return Copy.trKey("Пулемёты");
    case 6:
      return Copy.trKey("Тяжёлое");
    case 7:
      return Copy.ctx("melee");
    case 8:
      return Copy.trKey("Метательное");
    default:
      return Copy.trKey("Прочее");
  }
}

const STRICTEST_FIRST = "block warn info".split(" ");
const FAMILY_RANK = new Map();
"pistol smg rifle shotgun sniper machinegun launcher melee thrown".split(" ").forEach((name, rank) => FAMILY_RANK.set(name, rank));
const OTHER_RANK = FAMILY_RANK.size;
