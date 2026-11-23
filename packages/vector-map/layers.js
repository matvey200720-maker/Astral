import { normalizeWorldMap } from "./model.js";
import { markerGroupOrder, zoneGroupOrder } from "./scene.js";

export const USER_GROUP_PREFIX = "grp-";

export const LAYER_SECTION = Object.freeze(
  Object.fromEntries([
    ["zone", "zones"],
    ["marker", "markers"],
    ["emblem", "emblems"],
    ["stroke", "paint"],
  ]),
);

// Пары «вид → раздел» в порядке обхода и разделы, у которых наборы лежат списком groupOrder.
const KIND_SECTION = Object.entries(LAYER_SECTION);
const LISTED = ["zones", "markers"];
const NO_SET = "own";

const asText = (value) => String(value ? value : "");
const keyOf = (item) => item.group || "";
const patch = (base, changes) => ({ ...base, ...changes });
const weave = (list, at, ...values) => list.toSpliced(at, 0, ...values);
const onlyKeys = (record, pass) => Object.fromEntries(Object.entries(record).filter(([key]) => pass(key)));

const partition = (list, test) => {
  const hit = [];
  const miss = [];
  list.forEach((entry) => (test(entry) ? hit : miss).push(entry));
  return [hit, miss];
};

// Предметы, подошедшие под проверку, переходят в другую группу; остальные остаются как есть.
const regroup = (items, test, group) => items.map((item) => (test(item) ? patch(item, { group }) : item));

// Порядковые номера вызовов groupObjects, в которых нашлись цели.
const serials = (function* count() {
  for (let n = 1; ; n += 1) yield n;
})();

export const isUserGroup = (group) => asText(group).startsWith(USER_GROUP_PREFIX);

export const layerGroupOrder = (section, value) =>
  (section === "zones" ? zoneGroupOrder : markerGroupOrder)(value);

// Единая точка правки: план возвращает новые разделы или null (тогда проект остаётся как есть).
const settle = (project, plan) => {
  const edited = plan(project);
  return edited ? normalizeWorldMap(patch(project, edited)) : project;
};

const rework = (config, plan) => settle(normalizeWorldMap(config), plan);

const replaceItems = (project, section, items) => ({ [section]: patch(project[section], { items }) });

// Предмет проекта по ссылке { kind, id } или undefined.
const lookup = (project, ref) => {
  const bucket = project[LAYER_SECTION[ref?.kind]];
  return bucket && bucket.items.find(({ id }) => id === ref.id);
};

// ---------- состав группы ----------

function* membersOf(project, wanted) {
  for (const [kind, section] of KIND_SECTION) {
    for (const { id, group } of project[section].items) {
      if ((group || "") === wanted) yield { kind, id };
    }
  }
}

export const groupMembers = (config, group) => [...membersOf(normalizeWorldMap(config), group || "")];

// ---------- собрать в свою группу ----------

// Члены группы идут одним блоком сразу за самым поздним из них.
const gather = (items, isMember) => {
  const cut = items.findLastIndex(isMember) + 1;
  const [moved, kept] = partition(items.slice(0, cut), isMember);
  return cut ? kept.concat(moved, items.slice(cut)) : items;
};

const userGroupsIn = (project) =>
  new Set(KIND_SECTION.flatMap(([, section]) => project[section].items.map((item) => item.group).filter(isUserGroup)));

const joinGroup = (section, data, ids, group, name) => {
  const listing = LISTED.includes(section) ? layerGroupOrder(section, data) : null;
  const sources = new Set(data.items.flatMap((item) => (ids.has(item.id) ? [item.group || NO_SET] : [])));
  const top = listing && Math.max(listing.findIndex((key) => sources.has(key)), 0);
  return patch(data, {
    items: gather(regroup(data.items, ({ id }) => ids.has(id), group), (item) => item.group === group),
    groupTitles: patch(data.groupTitles, { [group]: name }),
    ...(listing && { groupOrder: weave(listing, top, group) }),
  });
};

const makeGroup = (project, picked, title) => {
  const group = [USER_GROUP_PREFIX, Date.now().toString(36), serials.next().value.toString(36)].join("");
  const name = asText(title).trim() || `Группа ${userGroupsIn(project).size + 1}`;
  const touched = KIND_SECTION.filter(([kind]) => picked.some((target) => target.kind === kind));
  const sections = touched.map(([kind, section]) => {
    const ids = new Set(picked.filter((target) => target.kind === kind).map((target) => target.id));
    return [section, joinGroup(section, project[section], ids, group, name)];
  });
  return { config: normalizeWorldMap(patch(project, Object.fromEntries(sections))), group };
};

const knownKind = (target) => Boolean(target && LAYER_SECTION[target.kind]);

export const groupObjects = (config, targets, options = {}) => {
  const { title = "" } = options;
  const project = normalizeWorldMap(config);
  const picked = (targets || []).filter(knownKind);
  return picked.length ? makeGroup(project, picked, title) : { config: project, group: null };
};

// ---------- разобрать группу ----------

const dissolve = (data, doomed, listed) =>
  patch(data, {
    items: regroup(data.items, ({ group }) => doomed.has(group), ""),
    groupTitles: onlyKeys(data.groupTitles, (key) => !doomed.has(key)),
    ...(listed && { groupOrder: data.groupOrder.filter((key) => !doomed.has(key)) }),
  });

const ungroupPlan = (project, targets) => {
  const found = [...(targets || [])].map((target) => lookup(project, target));
  const doomed = new Set(found.filter((hit) => hit && isUserGroup(hit.group)).map((hit) => hit.group));
  return doomed.size
    ? Object.fromEntries(
        KIND_SECTION.map(([, section]) => [section, dissolve(project[section], doomed, LISTED.includes(section))]),
      )
    : null;
};

export const ungroupObjects = (config, targets) => rework(config, (project) => ungroupPlan(project, targets));

// ---------- перенос строки ----------

// Набор или группа встаёт рядом с другим: в зонах и точках двигается ключ в groupOrder,
// в остальных разделах переставляется блок предметов.
const reorderListed = (project, section, dragged, aimed, place) => {
  const rest = layerGroupOrder(section, project[section]).filter((key) => key !== dragged);
  const at = rest.indexOf(aimed);
  return at < 0 ? null : { [section]: patch(project[section], { groupOrder: weave(rest, at + Number(place === "after"), dragged) }) };
};

const reorderBlock = (project, section, dragged, aimed, place) => {
  const [members, rest] = partition(project[section].items, (item) => keyOf(item) === dragged);
  const isAnchor = (item) => keyOf(item) === aimed;
  const first = rest.findIndex(isAnchor);
  const slot = place === "after" ? first : rest.findLastIndex(isAnchor) + 1;
  return members.length && first >= 0 ? replaceItems(project, section, weave(rest, slot, ...members)) : null;
};

const dragGroup = (project, drag, drop) => {
  const { section } = drag;
  const foreign = [drop.section !== section, drop.type !== "group", drop.group === drag.group].some(Boolean);
  if (foreign) return null;
  return LISTED.includes(section)
    ? reorderListed(project, section, drag.group || NO_SET, drop.group || NO_SET, drop.place)
    : reorderBlock(project, section, drag.group || "", drop.group || "", drop.place);
};

// Куда встаёт предмет: в конец набора или рядом со строкой другого предмета.
const landOnGroup = (rest, drop, section) => {
  const group = drop.group || "";
  const last = rest.findLastIndex((item) => keyOf(item) === group);
  return drop.section === section ? { group, at: last < 0 ? rest.length : last + 1 } : null;
};

const landOnRow = (rest, drop, section, movingId) => {
  const row = drop.target;
  const aimed = LAYER_SECTION[row?.kind] === section && row.id !== movingId;
  const anchor = aimed ? rest.findIndex(({ id }) => id === row.id) : -1;
  // Выше в панели — больший номер в массиве, поэтому «after» ставит предмет перед опорным.
  return anchor < 0 ? null : { group: keyOf(rest[anchor]), at: anchor + (drop.place === "after" ? 0 : 1) };
};

const dragItem = (project, drag, drop) => {
  const section = LAYER_SECTION[drag.target?.kind];
  const items = section ? project[section].items : [];
  const moving = items.find(({ id }) => id === drag.target.id);
  const rest = items.filter(({ id }) => id !== moving?.id);
  const landing = !moving ? null : drop.type === "group" ? landOnGroup(rest, drop, section) : landOnRow(rest, drop, section, moving.id);
  return landing && replaceItems(project, section, weave(rest, landing.at, patch(moving, { group: landing.group })));
};

export const moveLayer = (config, drag, drop) =>
  rework(config, (project) => (drag && drop ? (drag.type === "group" ? dragGroup : dragItem)(project, drag, drop) : null));

// ---------- шаг на ступень ----------

// Ближайший сосед той же группы в сторону шага; -1, если такого нет.
const sameGroupNeighbour = (items, from, step) => {
  for (let at = from + step; at >= 0 && at < items.length; at += step) {
    if (keyOf(items[at]) === keyOf(items[from])) return at;
  }
  return -1;
};

const stepPlan = (project, target, direction) => {
  const section = LAYER_SECTION[target?.kind];
  const items = section ? project[section].items : [];
  const from = items.findIndex(({ id }) => id === target.id);
  const to = from < 0 ? -1 : sameGroupNeighbour(items, from, direction === "up" ? 1 : -1);
  const swap = (item, at) => (at === from ? items[to] : at === to ? items[from] : item);
  return to < 0 ? null : replaceItems(project, section, items.map(swap));
};

export const stepLayer = (config, target, direction) => rework(config, (project) => stepPlan(project, target, direction));
