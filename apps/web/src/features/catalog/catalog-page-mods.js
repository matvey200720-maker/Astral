import { variantOf } from "@modovik/publishing";
import { catalogCategoryForMod, isCatalogBundle, listedCatalogMods, postKeyOf } from "../../catalog-utils.js";
import {
  catalogKinds,
  catalogSectionOfKind,
  catalogSubcategoryOf,
  publicCatalogCategories,
  REDUX_ADDONS_SECTION,
} from "../../components/desktop/catalog/catalogSections.js";
import { EFFECTS_LEAD_ORDER, TRACERS_SLOT, effectsSlotOf, isReduxBase, plainEffectsName } from "./bundles/component-groups.js";
import { UNLISTED_PART_EDITORS, columnEditorOf, reduxEditorOf } from "./redux-editors.js";
import { menuEditorOf } from "./menu/menu-editors.js";
import { groupReduxes } from "./redux-groups.js";
import { arenaTwinsQuiet } from "./arena-twins.js";

// Виды: множество идентификаторов и подпись (нижний регистр) → вид.
// Подписи видов из соседа, прежнее «Скины» и разделы колонки, которые сами являются видами; позднее перекрывает раннее.
const kindIds = new Set();
const kindByLabel = new Map();
for (const { id, label } of catalogKinds) {
  kindIds.add(id);
  kindByLabel.set(label.toLowerCase(), id);
}
kindByLabel.set("скины", "skins");
publicCatalogCategories.filter(({ id }) => kindIds.has(id)).forEach(({ id, label }) => kindByLabel.set(label.toLowerCase(), id));

const EMPTY_GROUPS = Object.freeze([]);
// Превью по умолчанию — один и тот же массив, иначе кэш по ссылке на превью не сработал бы.
const NO_PREVIEW = Object.freeze([]);

// Слабые кэши по объектам-массивам: ответ каталога → результат (для одного превью), результат → группы редуксов.
const resultsBySource = new WeakMap();
const groupsByResult = new WeakMap();

function isClothing(mod) {
  return mod.domain?.clothing ? true : Boolean(mod.clothing);
}

function hasStock(mod) {
  return Boolean(mod.includedModIds?.length) || isCatalogBundle(mod);
}

// Вид по словам: «packs» без состава и без признака сборки — это не пак, а улучшение.
function wordsKind(mod) {
  const kind = catalogCategoryForMod(mod);
  return kind !== "packs" || hasStock(mod) ? kind : "improvements";
}

// Правила вида по порядку; первое вернувшее непустое решает, иначе вид по словам.
const KIND_RULES = [
  (mod) => (isClothing(mod) ? "clothing" : ""),
  (mod, lead) => (lead ? "redux" : ""),
  (mod) => {
    const given = String(mod.catalogCategory ?? "");
    const known = kindIds.has(given) ? given : kindByLabel.get(given.toLowerCase());
    return known === "redux" ? "" : known;
  },
];

function kindOf(mod, lead) {
  for (const rule of KIND_RULES) {
    const kind = rule(mod, lead);
    if (kind) return kind;
  }
  return wordsKind(mod);
}

export function reduxAvatarOf(mod) {
  for (const candidate of [mod?.avatar, mod?.domain?.redux?.avatar]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return "";
}

// Часть редукса или пак, как её видит группировка: только моды раздела redux с режимом или полкой, кроме одежды.
function isReduxMod(mod) {
  if (mod.catalogSection !== "redux") return false;
  if (!(mod.catalogMode || mod.catalogSlot)) return false;
  return !isClothing(mod);
}

function entryOf(mod) {
  const entry = {};
  entry.id = mod.id;
  entry.name = mod.name;
  entry.author = mod.author;
  entry.pack = hasStock(mod) || mod.catalogCategory === "packs" || mod.catalogSlot === "redux-pack";
  entry.included = mod.includedModIds || [];
  entry.variant = variantOf(mod)?.group ?? "";
  entry.note = mod.attribution?.rights?.note || "";
  entry.post = postKeyOf(mod);
  entry.cover = typeof mod.cover === "string" ? mod.cover : "";
  entry.avatar = reduxAvatarOf(mod);
  /* «Основа редукса» не бывает ни ведущей, ни лицом группы (`redux-groups.js`). */
  entry.base = isReduxBase(mod);
  return entry;
}

// Что спросить у редактора «Для редуксов»: поля исходного мода.
const editorQuery = (mod) => ({
  slot: mod.catalogSlot || mod.slot,
  subcategory: mod.catalogSubcategory,
  categoryLabel: mod.categoryLabel,
  menuButtons: mod.domain?.frontend?.moved === false,
});

// Роли пакетов «Эффектов» автора в каталоге (владелец 12.11.2026: «просто „Эффекты“ и отдельно „Трейсеры“»).
const EFFECTS_LEAD = "lead";
const EFFECTS_HIDDEN = "hidden";
const EFFECTS_TRACERS = "tracers";

/*
 * Пакеты «Эффектов» одного редукса (слоты `blood-routing`, `effects-core`, `particle-effects`, `effects-tables`) — одна вещь: на полке попаданий, в поиске и во «Всех» стоит
 * ОДНА карточка, ведущая — первый существующий пакет по порядку `EFFECTS_LEAD_ORDER`; остальные пакеты этого редукса скрыты, как скрытые части (`catalogUnlisted`), и видны
 * только внутри редукса. Пакет привязок следа пули (`tracer-bindings`) — своя карточка на полке трейсеров. Пакет вне группы редукса (одиночный) не трогается.
 * Версии одного пакета (общая группа вариантов) ведущими остаются все: показывает их одной карточкой общий механизм вариантов.
 * @returns {Map<string, string>} id пакета → роль
 */
function effectsRolesOf(visible, groupOf) {
  const roles = new Map();
  const slotsByGroup = new Map();
  for (const mod of visible) {
    const groupId = groupOf.get(mod.id);
    if (groupId === undefined || !isReduxMod(mod)) continue;
    const slot = effectsSlotOf(mod);
    if (!slot) continue;
    if (slot === TRACERS_SLOT) {
      roles.set(mod.id, EFFECTS_TRACERS);
      continue;
    }
    if (!slotsByGroup.has(groupId)) slotsByGroup.set(groupId, new Map());
    const bySlot = slotsByGroup.get(groupId);
    if (!bySlot.has(slot)) bySlot.set(slot, []);
    bySlot.get(slot).push(mod.id);
  }
  for (const bySlot of slotsByGroup.values()) {
    const leadSlot = EFFECTS_LEAD_ORDER.find((slot) => bySlot.has(slot));
    for (const [slot, ids] of bySlot) ids.forEach((id) => roles.set(id, slot === leadSlot ? EFFECTS_LEAD : EFFECTS_HIDDEN));
  }
  return roles;
}

const FAST_ENTRY_SLOT = "fast-entry";
const isFastEntry = (mod) => [...(Array.isArray(mod.manifest?.slots) ? mod.manifest.slots : []), mod.catalogSlot, mod.slot].includes(FAST_ENTRY_SLOT);

/*
 * «Быстрый вход» (владелец 12.11.2026: «использовать вещь, что уже есть в каталоге»). Это правка одного и того же файла игры (`playerswitch.meta`), и у каждого редукса она
 * лежит своим пакетом: облако принимает сборку только вместе с её частями. В каталоге же это одна вещь — на полке, в поиске и во «Всех» остаётся одна карточка: отдельная
 * (вне редуксов), а пока такой нет — самая ранняя из частей редуксов (id заявок идут по времени). Остальные видны только внутри своего редукса, как скрытые части.
 * @returns {Set<string>} id карточек, которых в каталоге нет
 */
function fastEntryQuiet(visible, groupOf) {
  const cards = visible.filter(isFastEntry);
  if (cards.length < 2) return new Set();
  const alone = cards.filter((mod) => groupOf.get(mod.id) === undefined);
  const kept = new Set(alone.length ? alone.map((mod) => mod.id) : [cards.map((mod) => mod.id).sort()[0]]);
  return new Set(cards.filter((mod) => !kept.has(mod.id)).map((mod) => mod.id));
}

// Части скрытых в колонке редакторов внутри группы помечаются; пакеты «Эффектов» и «Трейсеров» редукса встают на свою полку по слоту пакета, какой бы ни была запись полки каталога.
function editorFields(mod, kind, member, lead, effects = "") {
  if (catalogSectionOfKind(kind) === REDUX_ADDONS_SECTION) {
    const editor = menuEditorOf(mod, reduxEditorOf(effects ? { slot: effectsSlotOf(mod) } : editorQuery(mod)), member);
    const unlisted = effects === EFFECTS_HIDDEN || (member && !lead && UNLISTED_PART_EDITORS.has(editor));
    if (unlisted) return { catalogEditor: editor, catalogUnlisted: true };
    if (editor) return { catalogEditor: columnEditorOf(editor) };
  }
  return effects === EFFECTS_HIDDEN ? { catalogUnlisted: true } : null;
}

// Витрина одной выборки: знает, в какой группе каждая запись и какие записи возглавляют группы.
class Showcase {
  constructor(groups, groupOf, effects, quiet) {
    this.groupOf = groupOf;
    this.effects = effects;
    this.quiet = quiet;
    this.leads = new Set(groups.map(({ packId }) => packId).filter(Boolean));
  }

  show(mod) {
    const lead = this.leads.has(mod.id);
    const groupId = this.groupOf.get(mod.id);
    const kind = kindOf(mod, lead);
    const shown = { ...mod, catalogCategory: kind, catalogSubcategory: catalogSubcategoryOf(kind, mod) };
    const effects = this.effects.get(mod.id);
    Object.assign(shown, editorFields(mod, kind, groupId !== undefined, lead, effects));
    /* Ведущая карточка эффектов называется без служебной пометки: «<редукс> Effects (ядро)» человеку ни к чему. */
    if (effects === EFFECTS_LEAD) shown.name = plainEffectsName(mod.name);
    if (this.quiet.has(mod.id)) shown.catalogUnlisted = true;
    /* «Основа редукса» (`redux-base`): служебный пакет с файлами автора без своего раздела. Карточкой в каталоге его нет ни на полке, ни в поиске, ни во «Всех» — он виден только
       внутри своего редукса, в «Компонентах». Узнаётся не по полке (она — маппинг, нарочно: прежнее окно прячет такие части), а по `manifest.slots` / `kind` / `domain.anatomy`. */
    if (isReduxBase(mod)) shown.catalogUnlisted = true;
    if (groupId === undefined) return shown;
    const extra = { reduxGroup: groupId, reduxPartKind: kindIds.has(mod.catalogCategory) ? mod.catalogCategory : catalogCategoryForMod(mod) };
    if (lead) extra.reduxLead = true;
    return Object.assign(shown, extra);
  }
}

// Прежний результат, если для этого ответа считали с тем же превью (по ссылке).
function recall(source, preview) {
  const entry = resultsBySource.get(source);
  return entry && entry.preview === preview ? entry.result : null;
}

// Запомнить результат и его группы; пустые группы — общий замороженный массив.
function remember(source, preview, result, groups) {
  groupsByResult.set(result, groups.length ? Object.freeze(groups) : EMPTY_GROUPS);
  resultsBySource.set(source, { preview, result });
  return result;
}

export function catalogPageMods(source, preview = NO_PREVIEW) {
  if (!Array.isArray(source)) return [];
  const earlier = recall(source, preview);
  if (earlier) return earlier;

  const visible = source.filter(({ internal }) => !internal);
  const { groups, groupOf } = groupReduxes(visible.filter(isReduxMod).map(entryOf));
  const quiet = new Set([...fastEntryQuiet(visible, groupOf), ...arenaTwinsQuiet(visible)]);
  const showcase = new Showcase(groups, groupOf, effectsRolesOf(visible, groupOf), quiet);

  // Набор по id в порядке вставки: сначала превью как есть, затем моды ответа; повтор id заменяет мод на его месте.
  const lineup = new Map();
  const place = (mod) => lineup.set(mod.id, mod);
  preview.forEach((mod) => place(mod));
  visible.forEach((mod) => place(showcase.show(mod)));

  return remember(source, preview, listedCatalogMods(Array.from(lineup.values())), groups);
}

export function catalogReduxGroups(pageMods) {
  return groupsByResult.get(pageMods) ?? EMPTY_GROUPS;
}
