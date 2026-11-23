// Перевод правки крови мода (blood-routing-v1) в проект редактора попаданий и оценка точности перевода.
import {
  ASTRAL_BLOOD_REFERENCE,
  BLOODFX_EMPTY_NAME,
  BLOODFX_FIELD,
  BLOODFX_TABLES,
  BLOOD_WEAPON_CLASSES,
  BLOOD_WEAPON_GROUPS,
  applyBloodRouting,
  findBloodZone,
  normalizeBloodRouting,
  parseBloodFx,
  recordField,
  referenceBloodFxDocument,
  tableRow,
  weaponClassIndex,
} from "@modovik/bloodfx";
import { parseColour } from "./shapes.js";
import { BLOOD_VARIANTS, IMPACT_TEMPLATES, IMPACT_ZONES, VANILLA_BLOOD_COLOUR, bloodDonor, defaultImpactLayer } from "./impact.js";
import { createProject, parseProject } from "./project.js";
import { planProject } from "./compile.js";

const DEFAULT_NAME = "Попадания";
const VARIANT_LIMIT = 3;
const BRIGHTNESS = { stockLead: 50, topLead: 210, stock: Math.max(...parseColour(VANILLA_BLOOD_COLOUR)) / 255 };

/** Светлота по ведущему каналу тона: до штатного — пропорционально, выше — плавно к белому. */
function lightnessOfLead(lead) {
  const { stockLead, topLead, stock } = BRIGHTNESS;
  if (lead <= stockLead) return (stock * lead) / stockLead;
  return stock + ((Math.min(lead, topLead) - stockLead) / 160) * (1 - stock);
}

/** Тон пятен записи (каналы 0…255) -> цвет крови редактора; обратная к bloodDecalTint. */
export function bloodColourOfTint(tint) {
  const values = (tint || []).map(Number);
  const usable = values.length === 3 && values.every(Number.isFinite);
  const lead = usable ? Math.max(0, ...values) : 0;
  if (lead <= 0) return VANILLA_BLOOD_COLOUR;
  const lightness = lightnessOfLead(lead);
  const digits = values.map((channel) => {
    const byte = Math.round((channel / lead) * lightness * 255);
    return Math.min(255, Math.max(0, byte)).toString(16).padStart(2, "0");
  });
  return "#" + digits.join("");
}

const SIDES = [
  { id: "front", section: "entry" },
  { id: "back", section: "exit" },
];

/** Что играет в клетках документа: правило и тон; слова таблицы разбираются один раз на запись. */
function readGrid(doc) {
  const rowCache = new Map();
  const recordCache = new Map();
  const tintColumns = [BLOODFX_FIELD.tintRed, BLOODFX_FIELD.tintGreen, BLOODFX_FIELD.tintBlue];
  const nothing = { rule: BLOODFX_EMPTY_NAME, tint: null };
  const rowOf = (state, bone) => {
    const key = `${state}/${bone}`;
    if (!rowCache.has(key)) rowCache.set(key, tableRow(doc, state, bone));
    return rowCache.get(key);
  };
  const recordOf = (section, word) => {
    const key = `${section}/${word}`;
    if (recordCache.has(key)) return recordCache.get(key);
    const rule = recordField(doc, section, word, BLOODFX_FIELD.fxSystem) || BLOODFX_EMPTY_NAME;
    const tint = tintColumns.map((column) => Number(recordField(doc, section, word, column)));
    const played = { rule, tint: tint.every(Number.isFinite) ? tint : null };
    recordCache.set(key, played);
    return played;
  };
  return (section, state, bone, classIndex) => {
    const word = rowOf(state, bone)?.[classIndex];
    if (!word || word === "0") return nothing;
    return recordOf(section, word);
  };
}

/** Слой редактора для правила: сначала вариант крови, потом шаблон без выборки частиц. */
function layerForRule(zoneId, rule, side) {
  const asBlood = () => {
    const variant = BLOOD_VARIANTS.find((candidate) => bloodDonor(zoneId, candidate.id) === rule);
    return variant ? { ...defaultImpactLayer(zoneId), placement: side, variant: variant.id } : null;
  };
  const asTemplate = () => {
    const template = IMPACT_TEMPLATES.find((candidate) => candidate.rule === rule && !candidate.keep);
    return template ? { ...defaultImpactLayer(zoneId, "template"), placement: side, template: template.id } : null;
  };
  return asBlood() ?? asTemplate();
}

const PLAIN_WORDS = new Map([
  [BLOODFX_EMPTY_NAME, "ничего"],
  [ASTRAL_BLOOD_REFERENCE.placeholder, "как в игре"],
]);

function describeRule(rule) {
  if (PLAIN_WORDS.has(rule)) return PLAIN_WORDS.get(rule);
  const template = IMPACT_TEMPLATES.find((candidate) => candidate.rule === rule && !candidate.keep);
  return template === undefined ? rule : `«${template.label}» (${rule})`;
}

function recordsWord(count) {
  if (count === 1) return "запись";
  return count >= 2 && count <= 4 ? "записи" : "записей";
}

/** Самые частые значения: по убыванию числа, при равенстве — по первому появлению. */
function mostFrequent(items, limit) {
  const tally = new Map();
  items.forEach((item) => tally.set(item, 1 + (tally.get(item) ?? 0)));
  return [...tally]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([item]) => item);
}

/** Все сочетания «по одному варианту из каждого списка»; первый список — внешний цикл. */
function* combinations(lists, chosen = []) {
  if (chosen.length === lists.length) {
    yield chosen;
    return;
  }
  for (const item of lists[chosen.length]) yield* combinations(lists, [...chosen, item]);
}

/** Клетки стороны зоны в порядке «состояние, кость, класс». */
function* cellsOf(states, zone, section, classIndexes) {
  for (const state of states) {
    for (const bone of zone.bones) {
      for (const classIndex of classIndexes) yield [section, state, bone, classIndex];
    }
  }
}

/** Варианты одной стороны зоны; `own` — спереди главное правило нельзя выразить слоем редактора. */
function variantsOfSide(world, zone, side) {
  const touched = [...cellsOf(world.states, zone, side.section, world.touchedClasses)]
    .filter((cell) => world.differs(...cell))
    .map((cell) => world.modCell(...cell));
  const rules = mostFrequent(touched.map((cell) => cell.rule), Infinity);
  const lead = rules[0];
  const own = side.id === "front" && lead !== undefined && lead !== BLOODFX_EMPTY_NAME && layerForRule(zone.id, lead, side.id) === null;
  const variants = touched.length === 0 ? [{ kind: "game" }] : [];
  for (const rule of rules) {
    if (rule === BLOODFX_EMPTY_NAME) {
      variants.push({ kind: "nothing" });
      continue;
    }
    const layer = layerForRule(zone.id, rule, side.id);
    if (layer === null) {
      world.unknownRules.add(rule);
      continue;
    }
    const tinted = layer.kind === "blood" ? touched.find((cell) => cell.rule === rule && cell.tint) : undefined;
    if (tinted) layer.colour = bloodColourOfTint(tinted.tint);
    variants.push({ kind: "layer", layer });
  }
  return { variants: (variants.length > 0 ? variants : [{ kind: "nothing" }]).slice(0, VARIANT_LIMIT), own };
}

function zoneProject(zone, front, back) {
  const enabled = front.kind !== "game" || back.kind !== "game";
  if (!enabled) return { enabled, layers: [] };
  const frontLayer = front.kind === "game" ? { ...defaultImpactLayer(zone.id), placement: "front" } : front.layer;
  const backLayer = back.layer;
  return { enabled, layers: [frontLayer, backLayer].filter(Boolean) };
}

function buildProject(world, combo, groups) {
  const zones = {};
  world.zones.forEach((zone, index) => {
    zones[zone.id] = zoneProject(zone, combo[index * 2], combo[index * 2 + 1]);
  });
  const impact = { enabled: true, states: [...world.states], weaponGroups: groups.map((group) => group.id), zones };
  return parseProject({ ...createProject(world.name), impact });
}

/** Расхождения проекта с модом по всем клеткам: план применяется к свежей базе и сравнивается правило за правилом. */
function scoreProject(world, project) {
  const plan = planProject({ project, bloodDocument: world.fresh() });
  const doc = world.fresh();
  if (plan.blood) applyBloodRouting(doc, plan.blood);
  const played = readGrid(doc);
  const donorOf = (rule) => {
    const clone = plan.clones.find((candidate) => candidate.effect === rule);
    if (clone === undefined) return rule;
    const layers = clone.layers || [];
    return layers.length === 1 ? layers[0].donorEffect : clone.effect;
  };
  const missing = world.cells.flatMap((cell, index) => (donorOf(played(...cell).rule) === world.wanted[index] ? [] : [world.wanted[index]]));
  return { project, mismatched: missing.length, missing };
}

function searchBest(world, sideLists, groups) {
  let top = null;
  for (const combo of combinations(sideLists)) {
    const project = buildProject(world, combo, groups);
    if (!project.impact.enabled) continue;
    const scored = scoreProject(world, project);
    if (top === null || scored.mismatched < top.mismatched) top = { ...scored, combo };
  }
  return top;
}

/** Группа убирается, если без неё расхождений строго меньше. */
function refineGroups(world, found, groups) {
  let best = found;
  let kept = groups;
  for (const group of groups) {
    if (kept.length < 2) break;
    const rest = kept.filter((other) => other !== group);
    const candidate = scoreProject(world, buildProject(world, best.combo, rest));
    if (candidate.mismatched < best.mismatched) {
      kept = rest;
      best = { ...candidate, combo: best.combo };
    }
  }
  return best;
}

function normalizeOrNull(input) {
  try {
    return normalizeBloodRouting(input);
  } catch {
    return null;
  }
}

export function impactFromBloodRouting(input, { name = "", baseText = "" } = {}) {
  const fresh = () => (baseText ? parseBloodFx(baseText) : referenceBloodFxDocument());
  const base = fresh();
  const patch = normalizeOrNull(input);
  if (patch === null) return null;

  // Отсев по базе: остаются записи и маршруты, чьи строки есть в базе.
  const effects = patch.effects.filter(({ section, id }) => base.records[section]?.rows.has(id));
  const routes = patch.routes.filter((route) => base.records.entry.rows.has(route.entry));
  const dropped = patch.effects.length + patch.routes.length - effects.length - routes.length;

  const modDoc = fresh();
  applyBloodRouting(modDoc, { ...patch, routes, effects });

  const states = BLOODFX_TABLES.map((table) => table.id);
  const zones = IMPACT_ZONES.map((zone) => ({ id: zone.id, bones: zone.bloodZones.flatMap((id) => findBloodZone(id)?.parts ?? []) }));
  const baseCell = readGrid(base);
  const modCell = readGrid(modDoc);
  const differs = (section, state, bone, classIndex) => baseCell(section, state, bone, classIndex).rule !== modCell(section, state, bone, classIndex).rule;

  const groupChanged = (group) => {
    const indexes = group.classes.map((cls) => weaponClassIndex(cls));
    return zones.some((zone) => SIDES.some((side) => [...cellsOf(states, zone, side.section, indexes)].some((cell) => differs(...cell))));
  };
  const groups = BLOOD_WEAPON_GROUPS.filter(groupChanged);
  if (groups.length === 0) return null;

  const world = {
    name: name || DEFAULT_NAME,
    fresh,
    states,
    zones,
    differs,
    modCell,
    touchedClasses: groups.flatMap((group) => group.classes.map((cls) => weaponClassIndex(cls))),
    unknownRules: new Set(),
  };

  // Варианты каждой стороны: (голова, спереди), (голова, сзади), (тело, спереди), (тело, сзади).
  const sideLists = [];
  let ownFront = false;
  for (const zone of zones) {
    for (const side of SIDES) {
      const { variants, own } = variantsOfSide(world, zone, side);
      sideLists.push(variants);
      ownFront ||= own;
    }
  }

  const { unknownRules } = world;
  const lost = [];
  if (dropped !== 0) lost.push(`${dropped} ${recordsWord(dropped)} правки автора нет в базе bloodfx.dat — их клетки не сверены`);
  if (unknownRules.size > 0) {
    lost.push(`свои частицы автора (${[...unknownRules].slice(0, 3).join(", ")}) — в редакторе попаданий их нет`);
  }
  if (ownFront) return { project: null, exact: false, lost, unknownRules: [...unknownRules] };

  // Клетки по всем 25 классам, костям обеих зон, состояниям и сторонам.
  const allClasses = BLOOD_WEAPON_CLASSES.map((_, index) => index);
  world.cells = zones.flatMap((zone) => SIDES.flatMap((side) => [...cellsOf(states, zone, side.section, allClasses)]));
  world.wanted = world.cells.map((cell) => modCell(...cell).rule);

  const found = searchBest(world, sideLists, groups);
  if (found === null) return null;
  const best = refineGroups(world, found, groups);

  const total = world.cells.length;
  if (best.mismatched > 0) {
    const words = mostFrequent(best.missing, 3).map(describeRule).join(", ");
    lost.push(`${best.mismatched} из ${total} клеток «кость × оружие» играют у автора иначе (${words}) — в редакторе эффект один на зону и сторону`);
  }
  return {
    project: best.project,
    exact: best.mismatched === 0 && unknownRules.size === 0 && dropped === 0,
    mismatched: best.mismatched,
    total,
    lost,
    unknownRules: [...unknownRules],
  };
}
