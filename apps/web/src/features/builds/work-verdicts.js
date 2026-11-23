import { conflictSlotsFor, conflictingMods } from "../../utils/catalogConflicts.js";
import { readInstallRecord } from "../workshop/useInstallRecord.js";
import { WORK_KINDS, gunSlotOf } from "../workshop/works/work-kinds.js";
import { readWorkCode } from "../workshop/works/work-transfer.js";
import {
  WorkInstallUnsupported,
  prepareWorkInstall,
} from "../workshop/work-install/work-installers.js";

/*
 * Что сделает установка сборки с работой мастерской (ТЗ 24.10.2026, вечер, п. C) — тот же вопрос, что `install-summary.js`
 * задаёт модам: уже стоит, заменит вашу, встанет новой. Окно сборки пишет это сводкой слева и жёлтым «!» на плитке работы.
 *
 * Ответ даёт тот же разбор, что у «Установить» (`prepareWorkInstall` из кода работы, без завода проектов): работа, что уже
 * стоит в игре этой версией, — `already`. Иначе смотрим, занято ли её место: у работы по стволу или вещи — тот же ствол,
 * у остальных — тот же вид (мини-карта у человека одна). Занято — `replacing` с тем, что уйдёт; свободно — `fresh`. Вид без
 * установщика вне редактора — `stays` (встанет из «Моих работ», а не из сборки); код не разобрался — ответа нет (`unknown`).
 * Слои «Оптимизации» складываются поверх стоящих, а не заменяют их: у них замены не бывает.
 *
 * Работа по стволу встаёт и вместо мода каталога на том же стволе (`conflictingMods` — то же правило, что у модов), а мод
 * каталога — вместо вашей работы по этому стволу (`worksConflictingWithMod`): места занимают те и другие.
 */

const ADDITIVE_KINDS = new Set(["optimization"]);

/* Место работы в игре: вид, а у «по стволу / вещи» — ещё и ствол. */
const slotKeyOf = (workKind, slotId) =>
  `${workKind}:${WORK_KINDS[workKind]?.perSlot ? slotId || "" : ""}`;

const itemSlotId = (item) =>
  WORK_KINDS[item.workKind]?.perSlot ? gunSlotOf(item.work?.state) || item.slotId : "";

/** Работа человека, что стоит на месте работы из сборки; нет — `null`. */
export function installedWorkOf(entry, workItems = []) {
  const key = slotKeyOf(entry.workKind, entry.slotId);
  return (
    workItems.find((item) => item.workKind && slotKeyOf(item.workKind, itemSlotId(item)) === key) || null
  );
}

/** Ваши работы по стволу, что встанут не на своё место, когда ставится мод каталога на тот же ствол. */
export function worksConflictingWithMod(mod, workItems = []) {
  const slots = new Set(conflictSlotsFor(mod));
  return workItems
    .filter((item) => item.workKind === "weapon" && slots.has(`weapon:${itemSlotId(item)}`))
    .map((item) => ({ id: item.key, name: item.name, work: true }));
}

async function verdictOf(entry, context) {
  try {
    const read = await context.read(entry.code);
    const template =
      read?.templates?.find((item) => item.kind === entry.workKind) || read?.templates?.[0];
    if (!template) return { kind: "unknown" };
    const request = await context.prepare(entry.workKind, template, { create: false, entry });
    const record = readInstallRecord(request.recordKey);
    const inGame = request.installedSignature(record);
    const current = request.isCurrent
      ? request.isCurrent()
      : Boolean(inGame) && inGame === request.spec.signature;
    if (current) return { kind: "already" };
  } catch (error) {
    if (error instanceof WorkInstallUnsupported) return { kind: "stays" };
    return { kind: "unknown" };
  }
  if (ADDITIVE_KINDS.has(entry.workKind)) return { kind: "fresh" };
  const yours = [];
  const own = installedWorkOf(entry, context.workItems);
  if (own) yours.push({ id: own.key, name: own.name, work: true });
  if (entry.workKind === "weapon" && entry.slotId)
    yours.push(
      ...conflictingMods(
        { id: `work:${entry.slotId}`, catalogSection: "gunpacks", catalogSlot: entry.slotId },
        [...context.installedIds],
        context.allMods,
      ),
    );
  return yours.length ? { kind: "replacing", yours } : { kind: "fresh" };
}

/*
 * Карточка из нескольких работ (`library/work-cards.js`: две большие карты): ответ — по ним всем. Хоть одна стоит этой версией — карточка уже в игре;
 * «заменит» — только то, чего в самой карточке нет: своя соседка по карточке «вашей работой» не считается.
 */
async function cardVerdict(entry, context) {
  if (!entry.parts?.length) return verdictOf(entry, context);
  const answers = [];
  for (const part of entry.parts) answers.push(await verdictOf(part, context));
  const own = new Set(entry.parts.map((part) => part.name));
  const replacesOther = (answer) => answer.kind === "replacing" && answer.yours.some((item) => !own.has(item.name));
  return (
    answers.find((answer) => answer.kind === "already") ||
    answers.find(replacesOther) ||
    (answers.every((answer) => answer.kind === "replacing") ? { kind: "already" } : answers[0])
  );
}

/**
 * Ответ по каждой работе: `Map(код работы → { kind, yours? })`. Работы, чей ответ не собрался, в нём остаются как
 * `unknown` — сводка пишет вместо числа прочерк, а не ноль.
 */
export async function workVerdicts(
  entries,
  {
    workItems = [],
    installedIds = new Set(),
    allMods = [],
    read = readWorkCode,
    prepare = prepareWorkInstall,
  } = {},
) {
  const context = { workItems, installedIds, allMods, read, prepare };
  const result = new Map();
  for (const entry of entries) result.set(entry.code, await cardVerdict(entry, context));
  return result;
}
