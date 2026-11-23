import { Suspense, createElement, lazy, useMemo, useState } from "react";
import { Warning } from "../../../ui/icons.jsx";
import { optimizationPart } from "../../../../features/catalog/optimization-part.js";
import OptimizationPeek from "./OptimizationPeek.jsx";
import { formatModSize, isCatalogBundle } from "../../../../catalog-utils.js";
import { catalogLabel } from "../../../../features/catalog/catalog-words.js";
import { CONTENT_SECTIONS, contentSectionOf, partKindOf, partNamePrefixes } from "../../../../features/catalog/pack-contents.js";
import { packContentsCopy } from "../../../../features/catalog/pack-contents-copy.js";
import { localKindWord } from "../../../../features/catalog/part-name.js";
import { faceSource, partFace, partIcon } from "./part-face.jsx";
import ModName from "../ModName.jsx";
import { modModelUrl } from "../ModModelPreview.jsx";
import { coverFor } from "../../../../utils/catalogMedia.js";
import { tr } from "../../../../locales/ui.js";
import ComponentsSplit from "./ComponentsSplit.jsx";
import PartActions from "./PartActions.jsx";
import "./redux-sections.css";
import MappingSet, { mappingSetEntry } from "./MappingSet.jsx";
import { useBundleChoices } from "../../../../features/catalog/bundles/bundle-choices.js";
import { usePartMapWorks } from "../../../../features/catalog/bundles/map-works.js";
import { partVersions } from "../../../../features/catalog/bundles/part-versions.js";
import { isVectorMapPart } from "../../../../features/catalog/part-map.js";
import { reduxEffectsOf } from "../../../../features/catalog/redux-effects.js";
import { ReduxEffectsDialog, effectsEntry } from "./ReduxEffects.jsx";
import { isClothingCard } from "./ModCardParts.jsx";
import ComponentChoiceActions from "./ComponentChoiceActions.jsx";
import ComponentPackages from "./ComponentPackages.jsx";
import { componentSlotOf, hasDeclaredSlots, slotsOf } from "../../../../features/catalog/bundles/component-choices.js";
import { effectsSlotOf, isInteriorSlot, isReduxBase } from "../../../../features/catalog/bundles/component-groups.js";
import { sourceParts } from "../../../../features/catalog/bundles/component-state.js";
import { ownWorkByKey } from "../../../../features/catalog/bundles/component-works.js";
import { useOwnWorks } from "../../../../features/catalog/bundles/use-own-works.js";

const SoundPackList = lazy(() => import("./SoundPackList.jsx"));

const GLUE = " · ";
const NBSP = String.fromCharCode(160);

const joined = (parts, glue) => parts.filter(Boolean).join(glue);

// Ключ сравнения: нижний регистр, только буквы и цифры.
const lettersOf = (text) => String(text ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

const SPECIALS = ".*+?^${}()|[]\\";
const escapeForPattern = (word) => [...word].map((sign) => (SPECIALS.includes(sign) ? `\\${sign}` : sign)).join("");

// Имя части без имени сборки-владельца (владелец от трёх знаков, без учёта регистра).
function withoutOwner(name, owner) {
  const source = String(name ?? "");
  const ownerName = typeof owner === "string" ? owner.trim() : "";
  if (ownerName.length < 3) return source;
  const body = escapeForPattern(ownerName).replace(/\s+/g, "\\s+");
  const cleaned = [
    [new RegExp(`«\\s*${body}\\s*»`, "gi"), ""],
    [new RegExp(body, "gi"), ""],
    [/«\s*»/g, ""],
    [/""/g, ""],
    [/\s{2,}/g, " "],
    [/^[\s·:—-]+|[\s·:—-]+$/g, ""],
  ]
    .reduce((text, [pattern, by]) => text.replace(pattern, by), source)
    .trim();
  return cleaned.length < 2 ? source : cleaned;
}

// Повторы через « · »: кусок с уже встречавшимся ключом выбрасывается, пустые ключи остаются.
function withoutRepeats(name) {
  const seen = new Set();
  const isNew = (piece) => {
    const key = lettersOf(piece);
    if (!key) return true;
    const fresh = !seen.has(key);
    seen.add(key);
    return fresh;
  };
  return name.split(GLUE).filter(isNew).join(GLUE);
}

// Вес с неразрывным пробелом между цифрой и последним словом.
const sizeOf = (part, view) => {
  const text = formatModSize(part, view.rails.allMods, view.locale);
  return text.replace(/(\d) (?=\S+$)/, (_, digit) => digit + NBSP);
};

// Общая часть: у неё и у сборки есть разные origin.url; плитка не отдельная.
const isSharedPart = (item, part, owner) => Boolean(!item.separate && part.origin?.url && owner.origin?.url && part.origin.url !== owner.origin.url);

// Слова плитки: kicker над именем, title и вид kind.
const GENDER_WORDS = new Map([["male", "Мужское"], ["female", "Женское"]]);

const gunWords = (weapon, copy, fallbackTitle) =>
  weapon.kind === "attachments"
    ? { kicker: null, title: copy.attachments, kind: undefined }
    : { kicker: weapon.name, title: weapon.look || fallbackTitle(), kind: undefined };

// Слот `interior-<N>` — «Интерьер N» на языке окна: у каждого интерьера редукса свой номер, в словаре его нет.
const INTERIOR_NUMBER = /^interior-(\d+)$/;
const interiorWord = (part) => {
  const found = INTERIOR_NUMBER.exec(componentSlotOf(part));
  return found ? `${tr("Интерьер")} ${found[1]}` : "";
};

function tileWords(item, part, view, copy) {
  const ordinaryTitle = () => copy.partName(withoutRepeats(withoutOwner(part.name, view.mod.name)), partNamePrefixes(part));
  if (item.weapon) return gunWords(item.weapon, copy, ordinaryTitle);

  const { language } = view;
  /* Общий архив нескольких слотов зон называется «Зоны», а не словом первого из слотов. */
  const sharedZones = slotsOf(part).length > 1 ? copy.kinds.zones : "";
  const kind = sharedZones || copy.kinds[componentSlotOf(part)] || copy.kinds[partKindOf(part)] || interiorWord(part) || catalogLabel(part.catalogSubcategory || part.categoryLabel || "", language);
  if (isSharedPart(item, part, view.mod)) return { kicker: null, title: localKindWord(part.categoryLabel, language) || kind, kind };
  const title = ordinaryTitle();
  const genderWord = GENDER_WORDS.get(part.domain?.clothing?.gender);
  if (genderWord) return { kicker: catalogLabel(genderWord, language), title, kind };
  const covered = Boolean(kind) && title.toLowerCase().indexOf(kind.toLowerCase()) >= 0;
  return { kicker: covered ? null : kind, title, kind };
}

// Слова под вторую строку: «отдельно», «общая с…», обвесы; у «Основы редукса» — пояснение, что это за файлы.
function tileCaption(item, part, view, copy) {
  const owner = isSharedPart(item, part, view.mod)
    ? view.rails.allMods.find((one) => isCatalogBundle(one) && one.origin?.url === part.origin.url)?.name
    : undefined;
  const attachments = item.weapon?.kind === "attachments" ? (item.weapon.hidden ? copy.hidden : copy.detailCount(item.weapon.count)) : "";
  const base = isReduxBase(part) ? tr("Файлы автора без своего раздела в каталоге: ставятся вместе с редуксом") : "";
  return joined([item.separate && copy.separate, owner && copy.shared(owner), attachments, base], GLUE);
}

// Кнопка «Смотреть в 3D»: адрес модели, подпись и вызов onView3D.
function view3DFor(part, title, onView3D) {
  const model = modModelUrl(part);
  if (!model) return null;
  const open = () => {
    onView3D({ model, preview: coverFor(part), name: title, kind: isClothingCard(part) ? "clothing" : "weapon" });
  };
  return { label: `${tr("Показать модель в 3D")}: ${title}`, onOpen: open };
}

// Что делает «Открыть»: оптимизация открывает окно, остальное — страницу части.
function openerFor(part, view, peekWith) {
  if (optimizationPart(part)) return () => { peekWith(part); };
  return view.parts.open ? () => { view.parts.open(part); } : null;
}

// Слот-интерьер: интерьеры показываются одной группой «Интерьеры (N)» с раскрытием (ТЗ ведущей 10.11.2026), а выбор у каждого свой.

// Вес всех пакетов слота одной строкой: сумма там, где у каждого известен размер, иначе вес первого.
function sizeOfPackages(packages, view) {
  const known = packages.every((one) => Number(one.sizeBytes) > 0);
  if (!known) return sizeOf(packages[0], view);
  const total = packages.reduce((sum, one) => sum + Number(one.sizeBytes), 0);
  return formatModSize({ id: "sum", sizeBytes: total }, [], view.locale).replace(/(\d) (?=\S+$)/, (_, digit) => digit + NBSP);
}

// Поля записи части (порядок ключей важен); p — общий разбор плитки.
const PART_FIELDS = [
  ["key", (p) => p.item.mod.id],
  ["title", (p) => (p.asKind ? <span>{p.kind}</span> : <span data-no-translate=""><ModName name={p.title} /></span>)],
  ["sub", (p) => (p.asKind ? p.size : joined([p.kicker || p.kind, p.size], GLUE)) || null],
  ["ariaLabel", (p) => (p.asKind ? joined([p.kind, p.shownLabel], ": ") : joined([p.kicker || p.kind, p.title, p.shownLabel], ": "))],
  ["face", (p) => ({ media: createElement(p.Icon, { weight: "regular" }), ...partFace(p.facePart) })],
  ["hint", (p) => p.hint],
  ["kicker", (p) => (p.asKind ? p.shownLabel : joined([p.kicker, p.shownLabel], GLUE)) || null],
  ["meta", (p) => p.words || null],
  ["weight", (p) => p.size || null],
  ["note", (p) => p.choice.note || (p.replaced.length > 0 ? p.copy.replaces(p.replaced.map((one) => one.name)) : null)],
  ["check", (p) => p.choice.check],
  ["className", (p) => p.choice.rowClass],
  ["group", (p) => p.choice.group],
  ["badge", (p) => (p.replaced.length > 0 ? <Warning weight="fill" /> : null)],
  ["installed", (p) => p.packages.every((one) => p.view.parts.installed.includes(one.id))],
  [
    "actions",
    (p) => (
      <>
        {p.multi ? (
          <ComponentPackages packages={p.packages} parts={p.view.parts} copy={p.copy} name={p.asKind ? p.kind : p.title} />
        ) : (
          <PartActions part={p.part} parts={p.parts} copy={p.copy} editorCopy={p.view.cardCopy.editor} versions={p.versions} work={p.work} view3D={p.view3D} name={p.asKind ? p.kind : ""} />
        )}
        {p.choice.actions}
      </>
    ),
  ],
  ["menu", (p) => p.choice.menu],
  ["onOpen", (p) => p.onOpen],
];

// Выбор человека по компоненту сборки: галочка в строке, слова в панели, затемнение отключённого и кнопки «Отключить / Взять из другой сборки / Вернуть родную».
const NO_CHOICE_FIELDS = Object.freeze({ check: null, note: null, rowClass: undefined, group: undefined, actions: null, menu: null });

function choiceOf(item, part, title, view, works) {
  const picked = view.choice;
  const key = item.slotKey || "";
  if (!picked || !key || item.separate || !isCatalogBundle(view.mod)) return NO_CHOICE_FIELDS;
  const packages = item.packages || [item.mod];
  const originals = item.originals || packages;
  const off = Boolean(picked.components.off[key]);
  const swapped = Boolean(item.original);
  /* Своя работа мастерской на месте компонента: её имя — в слове панели; удалённая работа (список прочитан, а её нет) ничего не значит. */
  const workKey = picked.components.work[key] || "";
  const work = workKey && works ? ownWorkByKey(works, workKey) : null;
  /* Слоты, закрытые тем же общим архивом или одной и той же своей работой (три слота зон): галочка гасит и включает их вместе. */
  const sameWork = workKey ? Object.keys(picked.components.work).filter((slot) => slot !== key && picked.components.work[slot] === workKey) : [];
  const also = [...(item.alsoKeys || []), ...sameWork];
  const toggle = (on) => {
    const source = document.querySelector("[data-part-root] img") || document.body;
    picked.toggle(packages, key, on, source, also);
  };
  const states = [
    swapped && joined([tr("Заменён частью другой сборки"), item.swapSource?.name], GLUE),
    work && joined([tr("Заменён своей работой"), work.name], GLUE),
    off && tr("Отключён: при установке сборки пропускается"),
  ];
  const note = picked.notes[key] || joined(states.filter(Boolean), " — ") || null;
  return {
    check: { checked: !off, label: `${tr("Входит в сборку")}: ${title}`, onChange: toggle },
    note,
    rowClass: off ? "is-off" : undefined,
    group: isInteriorSlot(key) ? "interiors" : undefined,
    menu: (
      <ComponentChoiceActions
        menu
        view={view}
        picked={picked}
        bundle={view.mod}
        packages={packages}
        also={also}
        original={originals[0]}
        name={key}
        off={off}
        swapped={swapped}
        sourceId={item.swapSource?.id || ""}
        workKey={work ? workKey : ""}
        ownWorks={works}
      />
    ),
    actions: (
      <ComponentChoiceActions
        view={view}
        picked={picked}
        bundle={view.mod}
        packages={packages}
        also={also}
        original={originals[0]}
        name={key}
        off={off}
        swapped={swapped}
        sourceId={item.swapSource?.id || ""}
        workKey={work ? workKey : ""}
        ownWorks={works}
      />
    ),
  };
}

const isComponentTile = (tile) => !tile.separate && !tile.weapon && !tile.pieces && !tile.effects && !tile.sound;

// Пакеты одного слота — одна запись списка (ТЗ ведущей 10.11.2026: «компонент — это слот»): первая плитка слота несёт все его пакеты, остальные уходят.
function groupTiles(tiles, view) {
  const picked = view.choice;
  if (!picked || !isCatalogBundle(view.mod)) return tiles;
  const heads = new Map();
  const grouped = [];
  for (const tile of tiles) {
    const slotKey = isComponentTile(tile) ? picked.keys.get(tile.mod.id) : undefined;
    if (!slotKey) {
      grouped.push(tile);
    } else if (heads.has(slotKey)) {
      heads.get(slotKey).packages.push(tile.mod);
    } else {
      const head = { ...tile, slotKey, packages: [tile.mod] };
      heads.set(slotKey, head);
      grouped.push(head);
    }
  }
  return grouped;
}

// Слот другой сборки, который человек поставил на место компонента, показывается вместо родного: его кадр, имя и вес; ключ выбора остаётся родным.
function swapTile(tile, view, lookup) {
  const picked = view.choice;
  if (!picked || !tile.slotKey) return tile;
  const source = lookup.byId.get(picked.components.swap[tile.slotKey]);
  const parts = source ? sourceParts(source, tile.slotKey, lookup.byId, tile.packages.flatMap(slotsOf)) : [];
  if (!parts.length) return tile;
  return { ...tile, mod: parts[0], packages: parts, original: tile.mod, originals: tile.packages, swapSource: source };
}

// Запись окна «Компоненты» для одной части сборки или ганпака.
function partEntry(item, view, copy, ctx) {
  const { part, label, work, versions } = partVersions(item, { view, copy, choices: ctx.choices, mapWorks: ctx.mapWorks });
  const { kicker, title, kind } = tileWords(item, item.mod, view, copy);
  const packages = item.packages || [item.mod];
  const multi = packages.length > 1;
  const size = work ? "" : multi ? sizeOfPackages(packages, view) : sizeOf(part, view);
  const words = tileCaption(item, item.mod, view, copy);
  const shownLabel = label && !lettersOf(title).includes(lettersOf(label)) ? label : "";
  const Icon = partIcon(part);
  const replaced = view.parts.replaces(part);
  const view3D = view3DFor(part, title, ctx.onView3D);
  const moved = item.mod.domain?.frontend?.moved !== false;
  const hint = item.weapon?.render ? copy.render : partKindOf(item.mod) === "minimap" && moved ? tr("Мини-карта нарисована Astral, а не снята в игре: карта под полосами — пример, полосы и цифры стоят так, как они лежат в файлах мода.") : null;
  /* «Основа редукса»: страницы части у неё нет (карточкой в каталог она не идёт) и «Открыть» тоже; изменить её в мастерской нельзя — редактора под эти файлы нет. */
  const base = isReduxBase(item.mod);
  const onOpen = base ? null : openerFor(part, view, (picked) => ctx.setPeek({ part: picked, title, meta: joined([words, size], GLUE) }));
  const shownParts = base ? { ...view.parts, edit: undefined } : view.parts;
  /* Заголовок строки компонента, что выдал разбор редукса (пакет объявил слоты, `manifest.slots`), — его вид («Таймцикл», «Арена», «Интерьер 7»): имя такой части — название редукса,
     а оно стоит один раз в шапке окна. Прежние записи с собственным именем («Кнопки меню») и два компонента с одним словом вида остаются с названием части. */
  const native = item.original || item.mod;
  /* «Эффекты» и «Трейсеры» без манифеста (облачная витрина, слот полки) называются так же словом вида, а не именем пакета. */
  const asKind = Boolean(item.slotKey) && Boolean(kind) && (hasDeclaredSlots(native) || Boolean(effectsSlotOf(native)) || isReduxBase(native)) && (ctx.kindCounts.get(kind) || 0) === 1;
  const choice = choiceOf(item, part, asKind ? kind : title, view, ctx.ownWorks);
  /* Картинка строки — обложка самой части, как на её карточке; у компонента из нескольких пакетов («Эффекты») — обложка ведущего пакета с кадром. */
  const facePart = faceSource(part, packages, item.mod);
  const known = { item, view, copy, part, parts: shownParts, facePart, packages, multi, Icon, versions, work, view3D, title, kind, kicker, size, words, shownLabel, replaced, hint, onOpen, choice, asKind };
  return Object.fromEntries(PART_FIELDS.map(([field, make]) => [field, make(known)]));
}

// Порядок плиток: ганпак — как есть; сборка — по разделам мастерской, части сборки раньше отдельных, эффекты в конце.
function orderTiles(items, effects, bundle) {
  const last = effects ? { effects, separate: false } : null;
  if (!bundle) return last ? [...items, last] : items;
  const buckets = new Map(CONTENT_SECTIONS.map((section) => [section.id, []]));
  [...items, ...(last ? [last] : [])].forEach((tile) => {
    const id = tile === last ? "effects" : contentSectionOf(tile.mod);
    (buckets.get(id) ?? buckets.get("other")).push(tile);
  });
  const rank = (tile) => (tile === last ? 2 : tile.separate ? 1 : 0);
  return [...buckets.values()].flatMap((tiles) => tiles.sort((one, two) => rank(one) - rank(two)));
}

// Строка-сводка: стволы ганпака либо число частей и отдельных.
function summaryOf(items, copy) {
  const count = (test) => items.reduce((total, item) => total + (test(item) ? 1 : 0), 0);
  const guns = count((item) => item.weapon?.kind === "weapon");
  if (guns) return copy.weaponCount(guns);
  const apart = count((item) => item.separate);
  return [copy.parts(items.length - apart), apart && copy.more(apart)].filter(Boolean).join(GLUE);
}

// Всё, что окно читает до проверки «пусто»: два состояния, выбор версий и свои карты (порядок хуков важен).
function useWindowData(view) {
  const peekState = useState(null);
  const effectsState = useState(false);
  const choices = useBundleChoices(view.mod?.id || "");
  const tiles = view.contents || [];
  const mapIds = tiles.filter((item) => !item.separate && isVectorMapPart(item.mod)).map((item) => item.mod.id);
  /* Слоты других сборок на месте родных: справочник «id → запись» строится, только когда человек что-то заменил. */
  const swapped = Object.keys(view.choice?.components.swap || {}).length > 0;
  const allMods = view.rails?.allMods;
  const lookup = useMemo(() => (swapped ? { byId: new Map(allMods.map((mod) => [mod.id, mod])) } : null), [swapped, allMods]);
  /* Свои работы читаются и там, где «Взять из другого редукса» ведёт в каталог (`parts.pickPlace`): у слота с полкой работы живут отдельной тихой кнопкой «Моя работа». */
  const ownWorks = useOwnWorks(Object.keys(view.choice?.components.work || {}).length > 0 || Boolean(view.parts?.pickPlace && view.choice && isCatalogBundle(view.mod)));
  return { peekState, effectsState, choices, tiles, lookup, ownWorks, mapWorks: usePartMapWorks(mapIds) };
}

// Записи окна «Компоненты» по частям сборки и ганпака: общий путь окна и панели карточки (`useComponentEntries`).
function buildEntries({ view, data, effects, copy, onView3D, setPeek, openEffects }) {
  const grouped = groupTiles(data.tiles, view);
  const shown = data.lookup ? mergeCovered(grouped.map((tile) => swapTile(tile, view, data.lookup))) : grouped;
  const ctx = { choices: data.choices, mapWorks: data.mapWorks, ownWorks: data.ownWorks, onView3D, setPeek, kindCounts: kindCountsOf(shown, view, copy) };
  const entries = clusterGroups(orderTiles(shown, effects, isCatalogBundle(view.mod)).map((tile) => {
    if (tile.effects) return effectsEntry(tile.effects, view.language, openEffects);
    return tile.pieces ? mappingSetEntry(tile, view, copy) : partEntry(tile, view, copy, ctx);
  }));
  return { entries, grouped, shown };
}

const NO_VIEW_3D = () => {};

/**
 * Записи списка компонентов для панели на самой карточке (Каталог 2.0, часть 2): те же строки, что в окне «Компоненты», — картинка (`face`), слова (`title`, `sub`), отметка
 * (`check`) и «стоит ли» (`installed`). `null` — компонентов нет, либо это куски маппинга или звуки: у них свои списки. Хуки идут до проверок, порядок вызовов не зависит от данных.
 */
export function useComponentEntries(view, onView3D = NO_VIEW_3D) {
  const data = useWindowData(view);
  const [, setPeek] = data.peekState;
  const [, setEffectsOpen] = data.effectsState;
  const effects = reduxEffectsOf(view.mod);
  if ((data.tiles.length === 0 && !effects) || data.tiles[0]?.piece || data.tiles[0]?.sound) return null;
  const copy = packContentsCopy(view.language);
  const openEffects = () => {
    setEffectsOpen(true);
  };
  return buildEntries({ view, data, effects, copy, onView3D, setPeek, openEffects });
}

export default function ModContents({ view, onView3D }) {
  const data = useWindowData(view);
  const { peekState, effectsState, tiles } = data;
  const [peek, setPeek] = peekState;
  const [effectsOpen, setEffectsOpen] = effectsState;
  const effects = reduxEffectsOf(view.mod);
  if (tiles.length === 0 && !effects) return null;

  const copy = packContentsCopy(view.language);
  if (tiles[0]?.piece) return <MappingSet view={view} items={tiles} copy={copy} />;
  if (tiles[0]?.sound) {
    return (
      <Suspense fallback={null}>
        <SoundPackList view={view} items={tiles} onView3D={onView3D} />
      </Suspense>
    );
  }

  const openEffects = () => {
    setEffectsOpen(true);
  };
  const { entries, grouped, shown } = buildEntries({ view, data, effects, copy, onView3D, setPeek, openEffects });
  const closePeek = () => {
    setPeek(null);
  };
  const closeEffects = () => {
    setEffectsOpen(false);
  };

  return createElement(
    "section",
    { className: "mod-card-section mod-contents", "aria-label": copy.title },
    createElement("p", { className: "mod-components-summary" }, summaryOf(grouped, copy)),
    <ComponentsSplit entries={entries} groups={GROUPS} initial={focusedKey(shown, view.focusSlot)} />,
    peek ? <OptimizationPeek {...peek} view={view} copy={copy} onClose={closePeek} /> : null,
    effectsOpen && effects ? <ReduxEffectsDialog effects={effects} language={view.language} onClose={closeEffects} /> : null,
  );
}

// Запись, на которой окно открывается после выбора из каталога (`use-pick-return.js`): компонент этого слота; ключ записи — первая часть, что стоит на его месте сейчас.
function focusedKey(tiles, slot) {
  if (!slot) return "";
  const tile = tiles.find((one) => one.slotKey === slot || one.alsoKeys?.includes(slot));
  return tile?.mod.id || "";
}

// Сколько компонентов сборки названо каждым словом вида: слово, что встречается дважды, заголовком строки не служит (`partEntry`).
function kindCountsOf(tiles, view, copy) {
  const counts = new Map();
  for (const tile of tiles) {
    if (!tile.slotKey) continue;
    const { kind } = tileWords(tile, tile.mod, view, copy);
    if (kind) counts.set(kind, (counts.get(kind) || 0) + 1);
  }
  return counts;
}

// Общий архив нескольких слотов, что человек поставил вместо родных, — одна строка: слоты, которые он закрыл, едут в `alsoKeys` первой.
function mergeCovered(tiles) {
  const heads = new Map();
  return tiles.filter((tile) => {
    if (!tile.swapSource) return true;
    const signature = `${tile.swapSource.id}|${tile.packages.map((one) => one.id).join(",")}`;
    const head = heads.get(signature);
    if (!head) {
      heads.set(signature, tile);
      tile.alsoKeys = [];
      return true;
    }
    head.alsoKeys.push(tile.slotKey);
    return false;
  });
}

// Записи одной группы стоят подряд, на месте первой из них: интерьеры, разошедшиеся по разделам мастерской, не дают двух заголовков.
function clusterGroups(entries) {
  const placed = new Set();
  return entries.flatMap((entry) => {
    if (!entry.group) return [entry];
    if (placed.has(entry.group)) return [];
    placed.add(entry.group);
    return entries.filter((one) => one.group === entry.group);
  });
}

// Группы строк списка: id → слово заголовка («Интерьеры (N)»).
const GROUPS = { interiors: () => tr("Интерьеры") };
