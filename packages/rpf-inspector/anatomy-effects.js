/*
 * Эффекты и звуки редукса → заявки (пакет Р3в, проект `REDUX-SYSTEM-1011.md`, §4.4, §4.6 и §6.2; Хелпер 28, 10.11.2026).
 *
 * Компонент «Эффекты» автора раскладывается на пакеты (решения ведущей 10.11.2026):
 *  • кровь — `bloodfx.dat` слоем маршрутов `blood-routing-v1`. Отказ редактора крови (`refusedBlood`) — это «правило частиц не из списка, на который ссылается штатный
 *    bloodfx.dat», то есть проверка пригодности для редактора «Попадания», а не для установки: правило автора лежит в его же `core.ypt` или словарях. Слой собирается,
 *    а правила сверяются с ядром и словарями автора (`authorRules`): нашлись — замечание `blood-own-rules` (info); не нашлись или нечем проверить —
 *    `blood-rules-unverified` (warn). Целиком `bloodfx.dat` в каталог не идёт вовсе: ворота каталога (`isTrustedInstallManifest`) отвергают любой bloodfx.dat, кроме слоя;
 *  • словари частиц `.ypt` автора, включая заглушки, и текстуры эффектов — записями в штатный `ptfx.rpf`;
 *  • таблицы эффектов (`*fx.dat`, `ptxclipregions.dat`, `explosion.ymt`, `peddamage.xml`…) — заменой целого файла с отметкой `boundToBuild`
 *    (привязаны к версии игры, перепроверяются после её обновления, Р4);
 *  • `core.ypt` — разницей на ядро игрока, если «ядро версии автора + разница» совпадает с ядром автора по правилам и листам; иначе —
 *    записью целиком с отметкой `boundToBuild` и списком расхождений в отчёте;
 *  • привязки трассеров из `weapons.meta` и оружейных мет `dlc_patch` — своим пакетом `tracer-bindings` стратегии `weapons-meta-tracer-patch-v1`: по
 *    JSON привязок на каждый файл меты игрока в `update.rpf` (установщик собирает файл из файла игрока, меняя только правило следа и шансы по `WEAPON_*`).
 *    Привязка, чей файл меты не попадает под шаблон пути движка или чьё значение движок не примет, — в `reported` с причиной.
 * Компонент «Звуки»: оружейный банк `.awc` в звуковой папке дополнения — слоем дорожек `awc-stream-layer-v1`; всё остальное — в `reported`
 * с причиной, не теряется.
 *
 * Чистый модуль: байтов не читает. Внедряемые зависимости (`hooks`), все необязательные:
 *   readText(путь в update.rpf) → строка файла автора            stockText(путь) → строка файла игры той же сборки
 *   coreVerdict({ path, size, sha256 }) → { exact, drafts?, discrepancies? }  — проверка «ядро версии автора + разница = ядро автора»
 *   awcStreams(путь) → имена дорожек банка автора                refusedBlood(patch) → правила, на которые редактор крови отказал
 *   authorRules(пути .ypt автора, имена правил) → какие из этих правил есть в ядре и словарях автора (проверка отказа редактора крови)
 *   stockCoreRules(имена правил) → какие из них есть в штатном core.ypt игры (`null` — проверить нечем); с ним правило, которого нет ни у автора, ни в игре, в слое крови становится «-»
 */

import { createHash } from "node:crypto";
import { BLOODFX_EMPTY_NAME, BLOODFX_FIELD, parseBloodFx, referencedEffectRules } from "@modovik/bloodfx";
import { BLOODFX_ENTRY, BLOOD_ROUTING_PAYLOAD, analyzeBloodRouting, bloodRoutingSpec, diffTracerBindings, isHandWeapon, readWeaponTracerBindings } from "./effects.js";
import { EFFECT_CORE } from "./effects-summary.js";
import { weaponName } from "./weapon-names.js";
import { postKey } from "./post-key.js";
import { ID_LIMIT, NO_MEDIA, UPDATE_RPF, idPrefixOf, payloadName, plural, resolveRequires } from "./anatomy-drafts.js";

const ENTRY_CAPABILITIES = Object.freeze(["direct-update-entries-v1", "rpf-container-entry-v1"]);
const PTFX_ARCHIVES = Object.freeze({ "": "x64/patch/data/effects/ptfx.rpf", _hi: "x64/patch/data/effects/ptfx_hi.rpf", _lo: "x64/patch/data/effects/ptfx_lo.rpf" });
const PTFX_ROUTE = /^x64\/patch\/data\/effects\/ptfx(?:_hi|_lo)?\.rpf\//i;
const EXPLOSION_ENTRY = "x64/data/metadata/explosion.ymt";
const TABLE_PATH = /^(?:common\/data\/effects\/(?:peds\/)?[^/]+\.(?:dat|meta|xml)|x64\/data\/effects\/[^/]+\.ymt|x64\/data\/metadata\/explosion\.ymt)$/i;
const TEXTURE_PATH = /^x64\/textures\/(?:fxweather|peddamagedecals)\.ytd$/i;
const TRACER_META = /^(?:common\/data\/ai\/weapons[^/]*\.meta|dlc_patch\/[^/]+\/common\/data\/ai\/(?!vehicle)[^/]*\.meta)$/i;
/* Звуковая папка дополнения, куда ставится слой дорожек оружия (`WEAPON_SOUND_DLC_FOLDERS`, install-engine): путь в dlc_patch → архив пакета. */
const SOUND_DLC = Object.freeze({
  dlc_apartment: "update/x64/dlcpacks/mpapartment/dlc.rpf",
  dlc_low2: "update/x64/dlcpacks/mplowrider2/dlc.rpf",
  dlc_security: "update/x64/dlcpacks/mpsecurity/dlc.rpf",
  dlc_mpsum2: "update/x64/dlcpacks/mpsum2/dlc.rpf",
});
/* Привязки трассеров: те же стратегия, шаблон пути и пределы, что у движка (`weapons-meta-bindings.js`, install-engine; он зависит от этого пакета, поэтому
   здесь копия — совпадение держит тест `redux-anatomy-tracers.test.js`). */
export const WEAPONS_META_STRATEGY = "weapons-meta-tracer-patch-v1";
export const WEAPONS_META_ENTRY = /^(?:common\/data\/ai\/weapons[a-z0-9_]*\.meta|dlc_patch\/[a-z0-9_]{1,64}\/common\/data\/ai\/(?!vehicle)[a-z0-9_]{1,64}\.meta)$/i;
const WEAPONS_META_SCHEMA = 1;
const WEAPONS_META_MAX_BINDINGS = 512;
const WEAPONS_META_MAX_FILES = 128;
const WEAPON_NAME = /^WEAPON_[A-Z0-9_]{1,60}$/;
const RULE_NAME = /^[A-Za-z0-9_]{0,96}$/;
const SOUND_BANK = /^dlc_patch\/[^/]+\/x64\/audio\/sfx\/(dlc_[a-z0-9]+)\/([a-z0-9][a-z0-9._-]{0,119})\.awc$/i;

const lower = (value) => String(value ?? "").split("\\").join("/").toLowerCase();
const lastOf = (path) => lower(path).split("/").pop();
const unique = (list) => [...new Set(list)];
const sha256Of = (bytes) => createHash("sha256").update(bytes).digest("hex");
const toBytes = (text) => new TextEncoder().encode(text);

export const EFFECT_COMPONENT_SLOTS = Object.freeze(["effects", "sounds"]);

const filesWord = (n) => `${n} ${plural(n, "файл", "файла", "файлов")}`;

/*
 * Полки пакетов эффектов (владелец 12.11.2026: «непонятные „Частицы и текстуры эффектов“, „блуд“, „таблица эффектов“ убрать: должно быть просто „Эффекты“ и
 * отдельно „Трейсеры“»). Все пакеты компонента «Эффекты» — одна вещь для человека: одна строка в «Компонентах», одна карточка на полке попаданий; каталог
 * показывает из них ведущий пакет, остальные ставятся с ним (окно, `component-groups.js`). Привязки следа пули — своя вещь «Трейсеры».
 */
const EFFECTS_SHELF = Object.freeze({ category: "effects", categoryLabel: "Эффекты", section: "redux", catalogCategory: "effects", catalogSubcategory: "Попадания" });
const SHELVES = Object.freeze({
  blood: { ...EFFECTS_SHELF, slot: "blood-routing" },
  particles: { ...EFFECTS_SHELF, slot: "particle-effects" },
  tables: { ...EFFECTS_SHELF, slot: "effects-tables" },
  core: { ...EFFECTS_SHELF, slot: "effects-core" },
  tracers: { category: "effects", categoryLabel: "Трейсеры", section: "redux", slot: "tracer-bindings", catalogCategory: "effects", catalogSubcategory: "Трейсеры" },
  sounds: { category: "sounds", categoryLabel: "Звуки оружия", section: "other", slot: "weapon-sounds", catalogCategory: "sounds", catalogSubcategory: "Оружие" },
});
/* Имя карточки пакета эффектов: «<редукс> · Эффекты»; служебные пакеты различает слово в скобках (в каталоге их не видно, но в списке установленного имена не должны совпадать). */
export const EFFECTS_TITLE = "Эффекты";
export const TRACERS_TITLE = "Трейсеры";
const effectsName = (env, note = "") => `${env.label || env.component.label} · ${EFFECTS_TITLE}${note ? ` (${note})` : ""}`;

/* ---------------------------------------------------------------- классификация файлов компонента */

/** Куда файл эффектов ложится у игрока и к какому пакету относится. `null` — для файла нет места (идёт в `reported`). */
export function effectPlaceOf(unit, file) {
  const base = lastOf(file.path);
  if (unit.type === "file") return base === "gta5.ymt" || /explosion/.test(base) ? { pack: "tables", entry: EXPLOSION_ENTRY, rank: 0 } : null;
  const inner = lower(unit.type === "container" ? file.inner : file.path);
  const rank = unit.type === "container" ? 1 : 2;
  if (EFFECT_CORE.test(inner)) {
    const suffix = /core_hi\.ypt$/.test(inner) ? "_hi" : /core_lo\.ypt$/.test(inner) ? "_lo" : (/ptfx(_hi|_lo)?\.rpf\/core\.ypt$/.exec(inner)?.[1] ?? "");
    return { pack: "core", entry: `${PTFX_ARCHIVES[suffix]}/core.ypt`, rank };
  }
  if (inner === BLOODFX_ENTRY) return { pack: "blood", entry: BLOODFX_ENTRY, rank };
  if (/\.ypt$/.test(inner)) return { pack: "particles", entry: PTFX_ROUTE.test(inner) ? inner : `${PTFX_ARCHIVES[""]}/${lastOf(inner)}`, rank };
  if (TEXTURE_PATH.test(inner)) return { pack: "particles", entry: inner, rank };
  if (TABLE_PATH.test(inner)) return { pack: "tables", entry: inner, rank };
  return null;
}

/* ---------------------------------------------------------------- привязки трассеров */

/** Привязки следа пули, тронутые автором: по оружейным метам из «данных версии» (`skipped.gameData`). Без файла игры сравнивать не с чем. */
async function tracerBindingsOf(anatomy, hooks, problems) {
  /* Оружейные меты лежат и в «данных версии игры» (`dlc_patch`), и в «не названном в §4.5» (`weapons.meta`): привязки читаются из обоих списков. */
  const paths = [...anatomy.skipped.gameData, ...anatomy.skipped.unverified].map((item) => item.path).filter((path) => TRACER_META.test(lower(path)));
  const changed = new Map();
  const sources = [];
  for (const path of paths) {
    const author = hooks.readText ? await hooks.readText(path) : null;
    if (!author) continue;
    const stock = hooks.stockText ? await hooks.stockText(path) : null;
    const rows = diffTracerBindings(readWeaponTracerBindings(author), stock ? readWeaponTracerBindings(stock) : null);
    sources.push(path);
    for (const row of rows.filter((item) => item.changed && isHandWeapon(item.weapon))) {
      changed.set(row.weapon, { weapon: row.weapon, model: row.model, tracerFx: row.tracerFx, chanceSP: row.chanceSP, chanceMP: row.chanceMP, ...(row.before ? { before: { tracerFx: row.before.tracerFx, chanceSP: row.before.chanceSP, chanceMP: row.before.chanceMP } } : {}), file: path });
    }
  }
  if (paths.length && !hooks.stockText) problems.push({ code: "tracer-bindings", message: "Привязки трассеров: оружейные меты автора есть, но нечем сравнить с игрой — нужны меты чистой сборки.", severity: "info" });
  const bindings = [...changed.values()].sort((left, right) => left.weapon.localeCompare(right.weapon));
  return { bindings, sources, summary: tracerSummary(bindings) };
}

/** Названия стволов из привязок: те же слова в карточке и в сводке (первые шесть, дальше «и ещё N»). */
function tracerSummary(bindings) {
  const names = unique(bindings.map((item) => (item.model ? weaponName(item.model) : item.weapon.replace(/^WEAPON_/, "").toLowerCase())));
  return names.length ? `трассер: ${names.slice(0, 6).join(", ")}${names.length > 6 ? ` и ещё ${names.length - 6}` : ""}` : "";
}

/** Почему привязку движок не примет (`parseWeaponsMetaBindings`); `""` — примет. */
function tracerRefusal(binding) {
  if (!WEAPON_NAME.test(binding.weapon)) return "имя ствола не вида WEAPON_*";
  if (!RULE_NAME.test(binding.tracerFx)) return `правило следа «${String(binding.tracerFx).slice(0, 40)}» — не буквы, цифры и _ (до 96 знаков)`;
  for (const [field, value] of [["chanceSP", binding.chanceSP], ["chanceMP", binding.chanceMP]]) {
    if (value !== null && value !== undefined && !(typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1)) return `${field} ${value} вне 0…1`;
  }
  return "";
}

/** Файл привязок — тот же текст, что готовит `weaponsMetaPayload` движка: порядок стволов как дан, шанс до шести знаков. */
export function tracerPayload(bindings) {
  const round = (value) => (value === null || value === undefined ? null : Math.round(value * 1e6) / 1e6);
  const rows = bindings.map((item) => ({ weapon: item.weapon, tracerFx: item.tracerFx, chanceSP: round(item.chanceSP), chanceMP: round(item.chanceMP) }));
  return toBytes(`${JSON.stringify({ schema: WEAPONS_META_SCHEMA, bindings: rows })}\n`);
}

/* ---------------------------------------------------------------- сборка заявки */

function makeContext(anatomy, component, context) {
  const { label = "", author = "", archive = "", postUrl = "", sourceOf = (path) => path } = context;
  return { anatomy, component, label, author, archive, tail: postKey(postUrl), sourceOf };
}

function anatomyBlock(env, { pack, slots, units, omitted, boundToBuild, extra, sources = null, needs = null }) {
  const { anatomy, component, label } = env;
  return {
    schema: 1,
    redux: label,
    slot: component.slot,
    slots: [...slots],
    kind: component.kind,
    label: component.label,
    order: component.order,
    build: anatomy.build.key,
    stock: "diff",
    package: pack,
    units: units.map((unit) => ({ id: unit.id, path: unit.path, order: unit.order, part: null, container: null, files: unit.files.length, kindBy: unit.kindBy, kindNote: unit.kindNote })),
    omitted,
    ...(boundToBuild ? { boundToBuild: true } : {}),
    ...(extra ? { effects: extra } : {}),
    /* Откуда запись у автора: `запись → { author, inventory? }` (`covers[].author`/`inventory` описи части). */
    ...(sources && Object.keys(sources).length ? { sources } : {}),
    /* Ключи пакетов, чьи правила нужны этому пакету (`resolveRequires` превращает их в `requires` — id заявок). */
    ...(needs?.length ? { needs: [...needs] } : {}),
  };
}

function draftOf(env, { id, kind, spec, files, card, domain, problems }) {
  return { id, archive: env.archive, kind, delivery: "package", spec: { ...spec, id }, files, card, domain, problems: [...problems, { code: "needs-media", message: NO_MEDIA, severity: "warn" }] };
}

/* Пакеты, в которых лежат правила частиц автора: кровь и привязки трассеров ссылаются на них по имени, значит ставятся после них. */
const RULE_CARRIERS = Object.freeze(["effects-core", "particle-effects"]);

/** Правила частиц, на которые ссылается штатный bloodfx.dat (они есть в штатном ядре игры). Текст не разобрать — пусто: проверка «нет нигде» тогда сомневается во всём, поэтому `null`. */
function stockRuleSet(text) {
  try {
    return new Set(referencedEffectRules(parseBloodFx(text)));
  } catch {
    return null;
  }
}

/** Поля записи с именем правила частиц, которые умеет менять `blood-routing-v1` (те же четыре, что `NAME_KEYS` правки). */
export const BLOOD_RULE_FIELDS = Object.freeze(["fxSystem", "fxSystemBodyArmour", "fxSystemHeavyArmour", "fxSystemUnderwater"]);

/**
 * Правка крови без ссылок на несуществующие правила (решение ведущей 10.11.2026): поле, которое у автора ведёт на правило, которого нет ни в его ядре и словарях,
 * ни в штатном ядре игры, в игре у автора ничего не рисует, поэтому в слой оно идёт как «нет эффекта» («-»). Остальные поля и записи правки не трогаются.
 * Если «-» равно слову штатного файла (поле у игры и так пустое), поле из правки убирается; запись без изменений выбрасывается.
 * Возвращает { patch | null, replaced: [{ rule, section, id, field, was }] }.
 */
export function withoutRules(patch, rules, stock) {
  const gone = new Set(rules.map((rule) => rule.toLowerCase()));
  let stockDocument = null;
  try {
    stockDocument = stock ? parseBloodFx(stock) : null;
  } catch {
    stockDocument = null;
  }
  const replaced = [];
  const effects = [];
  for (const effect of patch.effects || []) {
    const next = { ...effect };
    for (const field of BLOOD_RULE_FIELDS) {
      if (typeof next[field] !== "string" || !gone.has(next[field].toLowerCase())) continue;
      const stockWord = stockDocument?.records?.[effect.section]?.rows?.get(effect.id)?.tokens?.[BLOODFX_FIELD[field]]?.text;
      replaced.push({ rule: next[field], section: effect.section, id: effect.id, field, was: stockWord ?? null });
      if (stockWord === BLOODFX_EMPTY_NAME) delete next[field];
      else next[field] = BLOODFX_EMPTY_NAME;
    }
    if (Object.keys(next).length > 2) effects.push(next);
  }
  const routes = patch.routes || [];
  return { patch: effects.length || routes.length ? { ...patch, routes, effects } : null, replaced };
}

const idOf = (env, key) => [[idPrefixOf(env.label), key].join("-"), env.tail].filter(Boolean).join("-").slice(0, ID_LIMIT);

function entryPackage(env, { pack, items, key, kind, title, note = "", boundToBuild, units, omitted }) {
  const specFiles = [];
  const mapping = [];
  const sources = {};
  items.forEach((item, at) => {
    const source = payloadName(lastOf(item.file.path), at);
    specFiles.push({ source, target: UPDATE_RPF, entry: item.entry, action: item.action ?? "upsert" });
    sources[item.entry] = { author: item.file.path, inventory: item.file.sha256 };
    mapping.push({ path: source, source: env.sourceOf(item.file.path), sha256: item.file.sha256, size: item.file.size });
  });
  const id = idOf(env, key);
  const from = env.label ? ` редукса ${env.label}` : "";
  const description = `${title}${from}: ${filesWord(specFiles.length)} автора по штатным путям игры.${boundToBuild ? " Привязано к версии игры: после её обновления файлы перепроверяются." : ""}`;
  return draftOf(env, {
    id,
    kind,
    spec: { version: "1.0.0", adapter: "rpf-entry", editions: ["Legacy"], requiresLoader: false, scope: "game-root", ...(env.author ? { author: env.author } : {}), capabilities: [...ENTRY_CAPABILITIES], slots: [SHELVES[pack].slot], files: specFiles },
    files: mapping,
    card: { name: effectsName(env, note), description, author: env.author, ...SHELVES[pack] },
    domain: { anatomy: anatomyBlock(env, { pack: key, slots: [SHELVES[pack].slot], units, omitted, boundToBuild, sources }) },
    problems: [],
  });
}

/* ---------------------------------------------------------------- кровь */

function bloodDraft(env, { file, unit, analysis, ownRules = null, ownRuleSources = [], unverifiedRules = [], danglingRules = [], replacedRules = [] }) {
  const payload = toBytes(`${JSON.stringify(analysis.patch, null, 2)}\n`);
  const id = idOf(env, "blood-routing");
  const rules = (analysis.rules || []).slice(0, 3);
  const classes = (analysis.classes || []).length;
  const words = classes === 1 ? "класса" : "классов";
  const from = env.label ? ` редукса ${env.label}` : "";
  const problems = analysis.exact ? [] : [{ code: "effects-blood-inexact", message: "Слой крови повторяет файл автора не полностью: часть записей или клеток правкой не выражается.", severity: "info" }];
  return draftOf(env, {
    id,
    kind: "blood-routing",
    spec: Object.assign(bloodRoutingSpec({ id, author: env.author }), { slots: ["blood-routing"] }),
    files: [{ path: BLOOD_ROUTING_PAYLOAD, source: payload, sha256: sha256Of(payload), size: payload.length, from: env.sourceOf(file.path) }],
    card: {
      name: effectsName(env),
      description: `Эффекты попадания из bloodfx.dat${from}${rules.length ? ` — правила частиц ${rules.join(", ")}` : ""}. Срабатывают у ${classes} ${words} оружия. Ставятся слоем поверх bloodfx.dat игрока: меняются только записи и маршруты из правки.`,
      author: env.author,
      ...SHELVES.blood,
    },
    domain: { anatomy: anatomyBlock(env, { pack: "blood-routing", slots: ["blood-routing"], units: [unit], omitted: [], sources: { [BLOODFX_ENTRY]: { author: file.path } }, needs: RULE_CARRIERS, ...(ownRules || danglingRules.length || replacedRules.length ? { extra: { ...(ownRules ? { bloodOwnRules: ownRules, bloodOwnRuleSources: ownRuleSources } : {}), ...(unverifiedRules.length ? { bloodRulesUnverified: unverifiedRules } : {}), ...(danglingRules.length ? { bloodRulesDangling: danglingRules } : {}), ...(replacedRules.length ? { bloodRulesReplaced: replacedRules } : {}) } } : {}) }) },
    problems,
  });
}

/* ---------------------------------------------------------------- ядро */

/*
 * Пакет «Эффекты»: ядро автора целиком, словари частиц с текстурами и таблицы — одной вещью. Ключ пакета и вид — ведущего состава (ядро, иначе частицы,
 * иначе таблицы): по ключу кровь и привязки следа находят правила частиц (`RULE_CARRIERS`, `resolveRequires`), по виду печь снимает обложку попаданием
 * и выстрелом автора. Слоты — всех составов, что вошли: два пакета «Эффектов» разных редуксов рядом не встают.
 */
const WHOLE_NOTE = Object.freeze({ core: "ядро", particles: "частицы", tables: "таблицы" });

function effectsWholeDraft(env, { whole, particles, tables, units, omitted, discrepancies }) {
  const lead = whole.length ? "core" : particles.length ? "particles" : "tables";
  const key = SHELVES[lead].slot;
  /* Слово в скобках — служебное: слой крови того же редукса зовётся «<редукс> · Эффекты», а имена в списке установленного совпадать не должны; человеку окно его не показывает. */
  const draft = entryPackage(env, { pack: lead, items: [...whole, ...particles, ...tables], key, kind: key, title: EFFECTS_TITLE, note: WHOLE_NOTE[lead], boundToBuild: true, units, omitted });
  const slots = [whole.length ? SHELVES.core.slot : "", particles.length ? SHELVES.particles.slot : "", tables.length ? SHELVES.tables.slot : ""].filter(Boolean);
  draft.spec.slots = slots;
  draft.domain.anatomy.slots = [...slots];
  if (!whole.length) return draft;
  draft.domain.anatomy.discrepancies = discrepancies;
  draft.problems.unshift({ code: "core-whole", message: `Ядро эффектов автора идёт записью целиком, привязано к версии игры: ${discrepancies.length ? discrepancies.slice(0, 3).join("; ") : "проверка точности не выполнена"}.`, severity: "warn" });
  return draft;
}

function coreDiffDrafts(env, { verdict, units }) {
  return verdict.drafts.map((made, at) => {
    const id = made.id || idOf(env, `effects-core-${at + 1}`);
    const slots = made.spec?.slots ?? [];
    return draftOf(env, {
      id,
      kind: made.kind || "effects-core",
      spec: made.spec,
      files: made.files,
      card: { author: env.author, ...made.card },
      domain: { ...(made.domain || {}), anatomy: anatomyBlock(env, { pack: `effects-core-${at + 1}`, slots, units, omitted: [] }) },
      problems: made.problems || [],
    });
  });
}

/* ---------------------------------------------------------------- привязки трассеров */

/**
 * Пакет привязок трассеров: по JSON на каждый файл меты игрока (`common/data/ai/weapons*.meta`, `dlc_patch/<пакет>/common/data/ai/<имя>.meta`).
 * Привязки группируются по файлу меты автора; что движок не примет, — в `reported` с причиной, ничего не теряется молча.
 */
function tracerBindingsDraft(env, tracer, result) {
  const { anatomy, component } = env;
  const known = new Map([...anatomy.skipped.gameData, ...anatomy.skipped.unverified].map((item) => [lower(item.path), item]));
  const report = (path, why) => {
    const item = known.get(lower(path));
    result.reported.push({ slot: component.slot, path, sha256: item?.sha256, size: item?.size, noInstall: true, why });
  };
  const byFile = new Map();
  for (const binding of tracer.bindings) {
    const key = lower(binding.file);
    if (!byFile.has(key)) byFile.set(key, { path: binding.file, list: [] });
    byFile.get(key).list.push(binding);
  }
  const files = [];
  for (const { path, list } of byFile.values()) {
    if (!WEAPONS_META_ENTRY.test(lower(path))) {
      report(path, `привязки трассеров (${list.length}) не ставятся: файл меты не под шаблон пути движка (common/data/ai/weapons*.meta или dlc_patch/<пакет>/common/data/ai/<имя>.meta)`);
      continue;
    }
    const good = [];
    for (const binding of list) {
      const why = tracerRefusal(binding);
      if (why) report(path, `привязка ${binding.weapon} не ставится: ${why}`);
      else good.push(binding);
    }
    if (good.length > WEAPONS_META_MAX_BINDINGS) {
      report(path, `привязок ${good.length} — больше предела ${WEAPONS_META_MAX_BINDINGS}: лишние ${good.length - WEAPONS_META_MAX_BINDINGS} не взяты`);
      good.length = WEAPONS_META_MAX_BINDINGS;
    }
    if (good.length) files.push({ path: lower(path), source: path, bindings: good });
  }
  if (files.length > WEAPONS_META_MAX_FILES) {
    for (const dropped of files.splice(WEAPONS_META_MAX_FILES)) report(dropped.source, `файлов мет с привязками больше предела ${WEAPONS_META_MAX_FILES}: этот не взят`);
  }
  if (!files.length) return;

  const specFiles = [];
  const mapping = [];
  const sources = {};
  files.forEach((file, at) => {
    const payload = tracerPayload(file.bindings);
    const name = `${/^dlc_patch\/([^/]+)\//.exec(file.path)?.[1] ?? "base"}-${lastOf(file.path).replace(/\.meta$/, "")}.json`;
    const source = payloadName(name, at);
    specFiles.push({ source, target: UPDATE_RPF, entry: file.path, action: "replace", merge: { strategy: WEAPONS_META_STRATEGY } });
    sources[file.path] = { author: file.source };
    mapping.push({ path: source, source: payload, sha256: sha256Of(payload), size: payload.length });
  });
  const packed = files.flatMap((file) => file.bindings);
  const id = idOf(env, "tracer-bindings");
  const from = env.label ? ` редукса ${env.label}` : "";
  const summary = tracerSummary(packed);
  const count = packed.length;
  result.drafts.push(draftOf(env, {
    id,
    kind: "tracer-bindings",
    spec: { version: "1.0.0", adapter: "rpf-entry", editions: ["Legacy"], requiresLoader: false, scope: "game-root", ...(env.author ? { author: env.author } : {}), capabilities: [WEAPONS_META_STRATEGY, "direct-update-entries-v1"], slots: [SHELVES.tracers.slot], files: specFiles },
    files: mapping,
    card: {
      name: `${env.label || component.label} · ${TRACERS_TITLE}`,
      description: `Привязки трассеров${from}: правило следа и шансы у ${count} ${plural(count, "ствол", "ствола", "стволов")} на ${files.length} ${plural(files.length, "файле", "файлах", "файлах")} меты игрока. Остальное в мете (урон, разброс) остаётся как у игрока. ${summary ? `${summary[0].toUpperCase()}${summary.slice(1)}.` : ""}`.trim(),
      author: env.author,
      ...SHELVES.tracers,
    },
    domain: { anatomy: anatomyBlock(env, { pack: "tracer-bindings", slots: [SHELVES.tracers.slot], units: [], omitted: [], sources, needs: RULE_CARRIERS, extra: { tracerBindings: packed, tracerBindingSources: files.map((file) => file.source) } }) },
    problems: [],
  }));
}

/* ---------------------------------------------------------------- компонент «Эффекты» */

async function effectsDrafts(env, hooks, result) {
  const { anatomy, component } = env;
  const unitsById = new Map(anatomy.units.map((unit) => [unit.id, unit]));
  const members = component.units.map((id) => unitsById.get(id));
  const tracer = await tracerBindingsOf(anatomy, hooks, result.problems);

  /* 1. Каждый файл — на своё место; при совпадении путей побеждает регистрация автора (файл → контейнер → правка по штатному пути). */
  const chosen = new Map();
  const reported = result.reported;
  const duplicated = [];
  const place = (unit, file, found) => {
    const key = lower(found.entry);
    const prior = chosen.get(key);
    const item = { unit, file, ...found };
    if (!prior) {
      chosen.set(key, item);
      return;
    }
    const [keep, drop] = prior.rank <= found.rank ? [prior, item] : [item, prior];
    chosen.set(key, keep);
    const same = keep.file.sha256 === drop.file.sha256;
    duplicated.push({ path: drop.file.path, sha256: drop.file.sha256, size: drop.file.size, why: same ? `тот же файл, что ${keep.file.path}` : `перекрыт одноимённой записью ${keep.file.path} (в игре побеждает подключённый автором архив)` });
    if (!same) result.problems.push({ code: "effects-overridden", message: `${drop.file.path}: путь ${found.entry} занят файлом ${keep.file.path} с другим содержимым — взят подключённый автором.`, severity: "warn" });
  };
  for (const unit of members) {
    for (const file of unit.files) {
      const found = effectPlaceOf(unit, file);
      if (!found) {
        reported.push({ slot: component.slot, path: file.path, sha256: file.sha256, size: file.size, noInstall: true, why: unit.type === "container" ? `${lastOf(file.path)}: не эффект — лежит в контейнере эффектов автора, штатного пути у файла нет` : "нет штатного места" });
        continue;
      }
      place(unit, file, found);
    }
  }
  const items = [...chosen.values()];
  const by = (pack) => items.filter((item) => item.pack === pack);
  const unitsOf = (list) => unique(list.map((item) => item.unit)).filter(Boolean);

  /* 2. Кровь. Отказ редактора крови не выбрасывает файл: правила проверяются по ядру и словарям автора, не получилось — файл целиком в таблицы эффектов. */
  const blood = by("blood")[0];
  if (blood) {
    const note = (why) => reported.push({ slot: component.slot, path: blood.file.path, sha256: blood.file.sha256, size: blood.file.size, why });
    const author = hooks.readText ? await hooks.readText(blood.file.path) : null;
    const stock = hooks.stockText ? await hooks.stockText(BLOODFX_ENTRY) : null;
    if (!author || !stock) note("bloodfx.dat сравнивается с файлом игры той же сборки: его нет у разбора — слой крови не собран, целиком файл в каталог не идёт");
    else {
      let analysis = null;
      try {
        analysis = analyzeBloodRouting(author, stock);
      } catch (failure) {
        note(`bloodfx.dat не разобрать: ${failure.message}`);
      }
      let refused = analysis?.patch && hooks.refusedBlood ? hooks.refusedBlood(analysis.patch) : null;
      /* Правила, на которые ведёт правка, но которых нет ни в штатном bloodfx.dat, ни в ядре и словарях автора (опечатка автора: `blood_entryr` вместо `blood_entry`, hallowen, 10.11.2026):
         установка слоя крови отказывает «В ядре эффектов игры нет правил …». Редактор крови (`refused`) их не видит — он смотрит не на все поля записи, а установка на все. */
      const stockRules = analysis?.patch && !analysis.identical ? stockRuleSet(stock) : null;
      const outsideStock = stockRules ? (analysis.rules || []).filter((rule) => !stockRules.has(rule)) : [];
      const sources = unique([...by("core"), ...by("particles").filter((item) => /\.ypt$/i.test(item.file.path))].map((item) => item.file.path));
      const checkNames = unique([...(refused ?? []), ...outsideStock]);
      const found = hooks.authorRules && sources.length && checkNames.length ? await hooks.authorRules(sources, checkNames) : null;
      const authorHas = new Set((Array.isArray(found) ? found : [...(found ?? [])]).map((name) => String(name).toLowerCase()));
      let dangling = found == null ? [] : outsideStock.filter((rule) => !authorHas.has(rule.toLowerCase()));
      /* Решение ведущей 10.11.2026: правило, которого нет ни у автора, ни в штатном ядре игры, у автора в игре ничего не рисует, а установке слоя крови оно не даёт встать
         («В ядре эффектов игры нет правил …»). Отсутствие доказано по обоим ядрам (`stockCoreRules` — поставщик по штатному `core.ypt`) — ссылка в слое становится «-» (нет эффекта),
         каждая замена названа в замечании и на сводной странице. Не доказано (поставщика нет, штатное ядро не прочиталось) — ссылка остаётся, замечание `blood-rules-dangling` предупреждает, что слой может не встать.
         Нашлось в штатном ядре — ссылка рабочая, ничего не трогаем. */
      let replaced = [];
      if (dangling.length && analysis?.patch && hooks.stockCoreRules) {
        const inGame = await hooks.stockCoreRules(dangling);
        if (Array.isArray(inGame)) {
          const gameHas = new Set(inGame.map((name) => String(name).toLowerCase()));
          dangling = dangling.filter((rule) => !gameHas.has(rule.toLowerCase()));
          if (dangling.length) {
            const edited = withoutRules(analysis.patch, dangling, stock);
            const gone = new Set(dangling.map((rule) => rule.toLowerCase()));
            replaced = edited.replaced;
            analysis = { ...analysis, patch: edited.patch, rules: (analysis.rules || []).filter((rule) => !gone.has(rule.toLowerCase())), effects: edited.patch?.effects?.length ?? 0 };
            refused = analysis.patch && hooks.refusedBlood ? hooks.refusedBlood(analysis.patch) : null;
            dangling = [];
          }
        }
      }
      for (const item of replaced)
        result.problems.push({ code: "blood-rules-replaced", message: `${blood.file.path}: у автора ссылка на несуществующее правило ${item.rule}, запись ${item.id} (поле ${item.field}) — эффекта нет и у него; в слое поле «${BLOODFX_EMPTY_NAME}» (нет эффекта).`, severity: "info" });
      if (dangling.length) result.problems.push({ code: "blood-rules-dangling", message: `${blood.file.path}: правка ведёт на правила ${dangling.join(", ")} — их нет ни в штатном bloodfx.dat, ни в ядре и словарях автора (${sources.length === 1 ? sources[0] : `${sources.length} файла`}): вероятно, опечатка автора. Есть ли они в штатном ядре игры, проверить нечем — слой крови может не встать («В ядре эффектов игры нет правил …»). Когда отсутствие доказано и там, ссылка при упаковке заменяется на «-» (эффекта нет, как у автора в игре), замена называется на сводной странице.`, severity: "warn" });
      if (analysis?.identical) note("bloodfx.dat как в игре: правки крови нет");
      else if (analysis && refused?.length) {
        const have = new Set((Array.isArray(found) ? found : [...(found ?? [])]).map((name) => String(name).toLowerCase()));
        const missing = found == null ? refused : refused.filter((name) => !have.has(String(name).toLowerCase()));
        if (analysis.patch && !analysis.error) {
          /* Слой собирается при любом исходе проверки: целый bloodfx.dat каталог не примет, а потерять кровь автора нельзя. */
          result.drafts.push(bloodDraft(env, { file: blood.file, unit: blood.unit, analysis, ownRules: refused, ownRuleSources: sources, unverifiedRules: missing, danglingRules: dangling, replacedRules: replaced }));
          const where = sources.length === 1 ? `(${sources[0]})` : `(${sources.length} файла)`;
          if (missing.length === 0) result.problems.push({ code: "blood-own-rules", message: `${blood.file.path}: правила частиц ${refused.join(", ")} — свои у автора, они есть в его ядре или словарях ${where}; слой крови собран и ставится вместе с ними.`, severity: "info" });
          else {
            const why = found == null ? "проверить, есть ли эти правила у автора, нечем" : `правил нет ни в ядре, ни в словарях автора: ${missing.join(", ")}`;
            result.problems.push({ code: "blood-rules-unverified", message: `${blood.file.path}: редактор крови отказал на правилах ${refused.join(", ")} (${why}) — слой собран, но ссылается на правила, которых у игрока может не быть; без них попадание ничего не рисует.`, severity: "warn" });
          }
        } else note(`редактор крови отказал на правилах ${refused.join(", ")}, правка крови не собирается${analysis.error ? `: ${analysis.error}` : ""}`);
      } else if (analysis && (analysis.error || !analysis.patch)) note(replaced.length && !analysis.error ? `вся правка крови вела на несуществующие правила (${unique(replaced.map((item) => item.rule)).join(", ")}): после замены на «${BLOODFX_EMPTY_NAME}» слою нечего менять, он не собран` : `правка крови не собирается${analysis.error ? `: ${analysis.error}` : ""}`);
      else if (analysis) result.drafts.push(bloodDraft(env, { file: blood.file, unit: blood.unit, analysis, danglingRules: dangling, replacedRules: replaced }));
    }
  }

  /* 3–4. Словари частиц, текстуры эффектов, таблицы и ядро целиком — ОДИН пакет «Эффекты» (владелец 12.11.2026: «particle effects, effects tables, effects
     core — это всё одно, это просто эффекты попадания»; так и в его ручном разборе: папка «эффекты» — файлы эффектов автора вместе). Слой крови остаётся
     своим пакетом: каталог и установщик принимают `bloodfx.dat` только отдельным JSON маршрутов (`install-engine/manifest.js`, `api/publisher.js`).
     Ядро разницей — когда проверка точности сошлась — идёт, как раньше, своими заявками. */
  const particles = by("particles");
  const tables = by("tables");
  const whole = [];
  const discrepancies = [];
  for (const core of by("core")) {
    const verdict = hooks.coreVerdict ? await hooks.coreVerdict({ path: core.file.path, size: core.file.size, sha256: core.file.sha256 }) : null;
    if (verdict?.exact === true && Array.isArray(verdict.drafts) && verdict.drafts.length > 0) {
      result.drafts.push(...coreDiffDrafts(env, { verdict, units: [core.unit] }));
      continue;
    }
    const why = verdict?.discrepancies?.length ? verdict.discrepancies : [verdict ? "ядро версии автора с разницей не совпало с ядром автора" : "проверка точности не подключена к разбору"];
    whole.push(core);
    discrepancies.push(...why);
    result.problems.push({ code: "core-discrepancies", message: `${core.file.path}: ${why.join("; ")}`, severity: "info", discrepancies: why });
  }
  const together = [...whole, ...particles, ...tables];
  if (together.length) result.drafts.push(effectsWholeDraft(env, { whole, particles, tables, units: unitsOf(together), omitted: duplicated, discrepancies: unique(discrepancies) }));

  /* 5. Привязки трассеров — своим пакетом поверх мет игрока. */
  if (tracer.bindings.length) tracerBindingsDraft(env, tracer, result);
}

/* ---------------------------------------------------------------- компонент «Звуки» */

async function soundDrafts(env, hooks, result) {
  const { anatomy, component } = env;
  const unitsById = new Map(anatomy.units.map((unit) => [unit.id, unit]));
  const layers = [];
  for (const id of component.units) {
    const unit = unitsById.get(id);
    for (const file of unit.files) {
      const found = SOUND_BANK.exec(lower(file.path));
      const archive = found && Object.hasOwn(SOUND_DLC, found[1]) ? SOUND_DLC[found[1]] : null;
      if (!archive) {
        result.reported.push({ slot: component.slot, path: file.path, sha256: file.sha256, size: file.size, noInstall: true, why: "слой дорожек (awc-stream-layer-v1) ставится только в банки RESIDENT/WEAPONS_PLAYER и в звуковые папки оружейных дополнений (mpapartment, mplowrider2, mpsecurity, mpsum2): для этого банка маршрута нет" });
        continue;
      }
      const read = hooks.awcStreams ? await hooks.awcStreams(file.path) : null;
      /* Имена дорожек — хэши вида `0X1A2B3C4D` (так их пишет `awcStreamName`); подписывающий принимает только этот вид. */
      const streams = Array.isArray(read) ? unique(read.map((name) => String(name).trim().toUpperCase())).sort() : [];
      if (streams.length === 0 || !streams.every((name) => /^0X[0-9A-F]{8}$/.test(name))) {
        result.reported.push({ slot: component.slot, path: file.path, sha256: file.sha256, size: file.size, why: "оружейный банк подходит под слой дорожек, но имена дорожек не прочитаны (нужен разбор .awc)" });
        continue;
      }
      layers.push({ unit, file, archive, bank: found[2].toLowerCase(), folder: found[1].toLowerCase(), streams });
    }
  }
  if (!layers.length) return;
  const files = layers.map((layer, at) => ({ source: payloadName(`${layer.bank}.awc`, at), target: layer.archive, entry: `x64/audio/sfx/${layer.folder}/${layer.bank}.awc`, action: "replace", merge: { strategy: "awc-stream-layer-v1", bank: layer.bank, streams: layer.streams } }));
  const slots = unique(layers.flatMap((layer) => layer.streams.map((name) => `sound-${layer.bank.replace(/[^a-z0-9]+/g, "-")}-${name.toLowerCase()}`)));
  const id = idOf(env, "sounds");
  const from = env.label ? ` редукса ${env.label}` : "";
  result.drafts.push(draftOf(env, {
    id,
    kind: "weapon-sounds",
    spec: { version: "1.0.0", adapter: "rpf-entry", editions: ["Legacy"], requiresLoader: false, scope: "game-root", ...(env.author ? { author: env.author } : {}), capabilities: ["awc-stream-layer-v1"], slots, files },
    files: layers.map((layer, at) => ({ path: files[at].source, source: env.sourceOf(layer.file.path), sha256: layer.file.sha256, size: layer.file.size })),
    card: { name: `${env.label || component.label} · Звуки оружия`, description: `Звуки оружия${from}: ${filesWord(layers.length)} банков, дорожки ставятся слоем в звуковую папку дополнения.`, author: env.author, ...SHELVES.sounds },
    domain: { anatomy: anatomyBlock(env, { pack: "sounds", slots, units: unique(layers.map((layer) => layer.unit)), omitted: [], boundToBuild: true }) },
    problems: [],
  }));
}

/**
 * Заявки компонентов «Эффекты» и «Звуки».
 *
 * @param {object} anatomy результат `analyzeAnatomy`
 * @param {{ label?: string, author?: string, archive?: string, postUrl?: string, sourceOf?: (path: string) => string, hooks?: object }} [context]
 * @returns {Promise<{ drafts: object[], problems: object[], reported: object[], claimed: Set<string> }>}
 *   `reported` — файлы, не попавшие в заявку, с причиной: ни один файл не теряется молча.
 */
export async function effectsComponentDrafts(anatomy, context = {}) {
  const hooks = context.hooks ?? {};
  const result = { drafts: [], problems: [], reported: [], claimed: new Set() };
  for (const component of anatomy.components) {
    if (!EFFECT_COMPONENT_SLOTS.includes(component.slot)) continue;
    const env = makeContext(anatomy, component, context);
    for (const id of component.units) {
      const unit = anatomy.units.find((item) => item.id === id);
      if (unit.type === "container") result.claimed.add(lower(unit.path));
      for (const file of unit.files) result.claimed.add(lower(file.path));
    }
    if (component.slot === "effects") await effectsDrafts(env, hooks, result);
    else await soundDrafts(env, hooks, result);
  }
  resolveRequires(result.drafts);
  return result;
}
