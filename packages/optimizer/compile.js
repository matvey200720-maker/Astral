// Компилятор плана оптимизации: по профилю и текстам файлов игрока готовит
// новые тексты (с размером и хэшем), набор игровых настроек и отчёт о том, что
// изменится; умеет вернуть файлы к штатному виду и собрать манифест патча.
import { createHash } from "node:crypto";
import { OPTIMIZER_TWEAK_MAP, OPTIMIZER_TWEAKS, localizedText } from "./catalog.js";
import { OPTIMIZER_TARGETS } from "./targets.js";
import {
  applyProceduralRule,
  childElement,
  fieldValue,
  looksLikeProceduralXml,
  numericField,
  parseProceduralMeta,
  proceduralModelName,
  proceduralObjects,
  serializeProceduralMeta,
} from "./procedural.js";
import {
  parseVisualSettings,
  patchVisualSettings,
  readVisualSetting,
  serializeVisualSettings,
} from "./visualsettings.js";

export { OPTIMIZER_TARGETS };

const MAX_DIFFERENCES = 3;
const ENTRIES_SECTION = "procObjInfos";
const PLANTS_SECTION = "plantInfos";
const NO_MODEL_NAME = "без ModelName";
// Шаг огней растёт вверх, поэтому при споре о значении выигрывает большее.
const GROWING_SETTING_KEYS = new Set(["distantlights.streetlight.Spacing"]);
const NUMERIC_FIELDS = ["Spacing", "MaxDistance"];

const TEXT = {
  notTextual: "Файл россыпи в этой сборке игры не текстовый — правка недоступна.",
  noStockScatter: "Штатного procedural.meta для возврата нет: Astral не нашёл копии игры до своих правок.",
  foreignScatter:
    "Файл россыпи procedural.meta после Astral менял кто-то ещё: вернуть его штатным без копии архива значит стереть чужие правки. Отличия от штатной: ",
  restored: "procedural.meta: россыпь возвращена штатной",
  restoredByChoice: "procedural.meta: россыпь возвращена штатной по выбору человека (чужие правки россыпи сняты)",
  restoredToBefore: "procedural.meta: россыпь возвращена к виду до правок Astral, правки другого мода сохранены",
};

// ---------------------------------------------------------------- общее

const utf8Size = (text) => Buffer.byteLength(text, "utf8");
const sha256Hex = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const kindOf = (tweak) => tweak.recipe.kind;
const touches = (tweaks, kind) => tweaks.some((tweak) => kindOf(tweak) === kind);
const describeChange = ({ key, from, to }) => `${key}: ${from} → ${to}`;

// Переключатели профиля в порядке профиля: повторы остаются, неизвестные пропущены.
function profileTweaks(profile) {
  const ids = profile?.enabled ?? [];
  if (!Array.isArray(ids)) throw new TypeError("profile.enabled должен быть списком");
  return ids.map((id) => OPTIMIZER_TWEAK_MAP[id]).filter(Boolean);
}

// Текст брошенного значения: message ошибки, а без него — строковый вид.
function describeThrown(thrown) {
  const message = thrown?.message;
  return typeof message === "string" && message !== "" ? message : String(thrown);
}

function fileRecord(target, text, rest) {
  return {
    id: target.id,
    file: target.file,
    target: target.target,
    text,
    size: utf8Size(text),
    sha256: sha256Hex(text),
    ...rest,
  };
}

const cloneElement = (element) => ({
  name: element.name,
  attributes: { ...element.attributes },
  children: element.children.map(cloneElement),
  text: element.text,
});

const render = (node) => serializeProceduralMeta(node);

function requireTextual(text) {
  if (typeof text !== "string" || !looksLikeProceduralXml(text)) throw new Error(TEXT.notTextual);
}

function parseTextualTree(text) {
  requireTextual(text);
  return parseProceduralMeta(text);
}

// ---------------------------------------------------------------- россыпь: правила

const isScatter = (tweak) => kindOf(tweak) === "procedural";
const removesRecords = (tweak) => Boolean(tweak.recipe.action.remove);

// Удаления идут первыми, остальные следом — так отчёт описывает итог, а не
// показывает разреженным то, что тут же удалено.
function applyScatterRules(document, tweaks) {
  const ordered = [...tweaks.filter(removesRecords), ...tweaks.filter((tweak) => !removesRecords(tweak))];
  return ordered.map((tweak) => {
    const { removed, adjusted } = applyProceduralRule(document, tweak.recipe.match, tweak.recipe.action);
    return { tweak, removed, adjusted: adjusted.map(({ model }) => model) };
  });
}

function scatterLines({ tweak, removed, adjusted }, titled) {
  const { title } = titled(tweak);
  const lines = [];
  if (removed.length > 0) lines.push(`${title}: убрано моделей — ${removed.length}`);
  if (adjusted.length > 0) lines.push(`${title}: разрежено моделей — ${adjusted.length}`);
  return lines;
}

// ---------------------------------------------------------------- план

function mergeSettingValues(tweaks) {
  const merged = new Map();
  for (const tweak of tweaks) {
    for (const [key, value] of Object.entries(tweak.recipe.values)) {
      if (!merged.has(key)) {
        merged.set(key, value);
        continue;
      }
      const pick = GROWING_SETTING_KEYS.has(key) ? Math.max : Math.min;
      merged.set(key, pick(merged.get(key), value));
    }
  }
  return Object.fromEntries(merged);
}

function planSettings(tweaks, base, titled) {
  const patch = patchVisualSettings(parseVisualSettings(base), mergeSettingValues(tweaks));
  if (patch.applied.length === 0) return null;
  return fileRecord(OPTIMIZER_TARGETS.visualsettings, serializeVisualSettings(patch.document), {
    changed: patch.applied.length,
    missing: patch.missing,
    lines: patch.applied.map(describeChange),
    tweaks: tweaks.map(titled),
  });
}

function planScatter(tweaks, base, titled) {
  const document = parseTextualTree(base);
  const steps = applyScatterRules(document, tweaks);
  const changed = steps.reduce((sum, { removed, adjusted }) => sum + removed.length + adjusted.length, 0);
  if (changed === 0) return null;
  return fileRecord(OPTIMIZER_TARGETS.procedural, serializeProceduralMeta(document), {
    changed,
    missing: [],
    lines: steps.flatMap((step) => scatterLines(step, titled)),
    tweaks: steps.map(({ tweak }) => titled(tweak)),
    models: steps.map(({ tweak, removed, adjusted }) => ({ ...titled(tweak), removed, adjusted })),
  });
}

const FILE_PLANNERS = { visualsettings: planSettings, procedural: planScatter };

export function requiredBases(profile) {
  const kinds = new Set(profileTweaks(profile).map(kindOf));
  return Object.values(OPTIMIZER_TARGETS).filter((target) => kinds.has(target.id));
}

export function compileOptimizerPlan({ profile, bases = {}, locale = "ru" } = {}) {
  const tweaks = profileTweaks(profile);
  const titled = (tweak) => ({ id: tweak.id, title: localizedText(tweak.title, locale) });

  const game = { values: {}, tweaks: [] };
  for (const tweak of tweaks.filter((candidate) => kindOf(candidate) === "game")) {
    Object.assign(game.values, tweak.recipe.values);
    game.tweaks.push(titled(tweak));
  }

  const files = [];
  const skipped = [];
  for (const target of Object.values(OPTIMIZER_TARGETS)) {
    const group = tweaks.filter((tweak) => kindOf(tweak) === target.id);
    if (group.length === 0) continue;
    const skipAll = (reason, extra) => group.map((tweak) => ({ ...titled(tweak), reason, ...extra }));

    const base = bases[target.id];
    if (!base) {
      skipped.push(...skipAll("base-missing"));
      continue;
    }
    let file;
    try {
      file = FILE_PLANNERS[target.id](group, base, titled);
    } catch (error) {
      skipped.push(...skipAll("base-unreadable", { message: describeThrown(error) }));
      continue;
    }
    if (file === null) skipped.push(...skipAll("nothing-to-change"));
    else files.push(file);
  }

  return {
    files,
    game,
    skipped,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    changes: files.reduce((sum, file) => sum + file.changed, 0),
    empty: files.length === 0 && game.tweaks.length === 0,
  };
}

// ---------------------------------------------------------------- возврат: настройки

// Ключи настроек, которые вообще пишет каталог, с их значениями — в порядке каталога.
function catalogSettingValues() {
  const byKey = new Map();
  for (const tweak of OPTIMIZER_TWEAKS) {
    if (kindOf(tweak) !== "visualsettings") continue;
    for (const [key, value] of Object.entries(tweak.recipe.values)) {
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(value);
    }
  }
  return byKey;
}

// Заводские значения ключей из каталога (`recipe.vanilla` — числа ванильного
// файла игры). Ими возврат пользуется, когда копии update.rpf «до Astral» нет.
function catalogVanillaValues() {
  const byKey = new Map();
  for (const tweak of OPTIMIZER_TWEAKS) {
    if (kindOf(tweak) !== "visualsettings") continue;
    for (const [key, value] of Object.entries(tweak.recipe.vanilla ?? {})) {
      if (!byKey.has(key)) byKey.set(key, value);
    }
  }
  return byKey;
}

// Совпадает ли значение с записью строки: запись значения в формате живой
// строки ничего бы не изменила.
function sameSetting(key, current, value) {
  const probe = { newline: "\n", lines: [`${key} ${current}`], keys: new Map([[key, 0]]) };
  return patchVisualSettings(probe, { [key]: value }).unchanged.length > 0;
}

// Значение «наше», если оно совпадает с каким-то значением каталога.
function writtenByAstral(key, current, catalogValues) {
  return catalogValues.some((value) => sameSetting(key, current, value));
}

/*
 * Штатное значение ключа: из копии update.rpf «до Astral», а без неё — из
 * каталога. Копии может не быть (уборка кэша, перенос хранилища, сбой её
 * чтения) — прежде возврат тогда падал «Штатного visualsettings.dat для
 * возврата нет», и урезанные дальности детализации оставались в игре.
 */
function originalSetting(stockDocument, vanilla, key) {
  if (stockDocument) return readVisualSetting(stockDocument, key);
  return vanilla.has(key) ? vanilla.get(key) : null;
}

function revertSettings(ctx, live, stock) {
  if (!live) return;
  const liveDocument = parseVisualSettings(live);
  const stockDocument = stock ? parseVisualSettings(stock) : null;
  const vanilla = catalogVanillaValues();
  const profileKeys = new Set(
    ctx.tweaks.flatMap((tweak) => (kindOf(tweak) === "visualsettings" ? Object.keys(tweak.recipe.values) : [])),
  );

  const back = {};
  for (const [key, catalogValues] of catalogSettingValues()) {
    const current = readVisualSetting(liveDocument, key);
    const original = originalSetting(stockDocument, vanilla, key);
    if (current === null || original === null || current === original) continue;
    if (sameSetting(key, current, original)) continue;
    if (writtenByAstral(key, current, catalogValues)) back[key] = original;
    else if (profileKeys.has(key)) ctx.outcome.kept.push(key);
  }
  if (Object.keys(back).length === 0) return;

  const patch = patchVisualSettings(liveDocument, back);
  if (patch.applied.length === 0) return;
  const text = serializeVisualSettings(patch.document);
  const lines = patch.applied.map(describeChange);
  ctx.outcome.bases.visualsettings = text;
  ctx.outcome.files.push(
    fileRecord(OPTIMIZER_TARGETS.visualsettings, text, { changed: lines.length, missing: [], lines, tweaks: [] }),
  );
}

// ---------------------------------------------------------------- возврат: россыпь

// Штатный текст, в котором раздел растений заменён живым (траву ведёт
// «Растительность», не оптимизатор). Не разобралось — штатный как есть.
function scatterRevertBase(live, stock) {
  if (!live || !stock) return stock;
  try {
    const stockTree = parseProceduralMeta(stock);
    const liveTree = parseProceduralMeta(live);
    const normalized = render(stockTree);
    const livePlants = childElement(liveTree, PLANTS_SECTION);
    const slot = stockTree.children.findIndex((child) => child.name === PLANTS_SECTION);
    if (livePlants !== null && slot >= 0) stockTree.children[slot] = livePlants;
    const merged = render(stockTree);
    return merged === normalized ? stock : merged;
  } catch {
    return stock;
  }
}

const catalogScatterRules = () => OPTIMIZER_TWEAKS.filter(isScatter);

function renderWith(baseTree, rules) {
  const copy = cloneElement(baseTree);
  applyScatterRules(copy, rules);
  return render(copy);
}

// Все непустые наборы из списка (для шести правок — 63 набора).
function nonEmptySubsets(items) {
  let subsets = [[]];
  for (const item of items) subsets = subsets.concat(subsets.map((subset) => [...subset, item]));
  return subsets.slice(1);
}

// Тексты, которые дала бы сборка основы: сначала набор из профиля, затем любой
// непустой набор из правок россыпи каталога.
function* scatterCandidates(baseTree, profileRules) {
  yield renderWith(baseTree, profileRules);
  for (const rules of nonEmptySubsets(catalogScatterRules())) yield renderWith(baseTree, rules);
}

// Знает ли каталог правку этого действия, выбирающую модель записи.
function catalogRuleSelects(actionKey, item) {
  const model = proceduralModelName(item);
  return catalogScatterRules().some((tweak) => tweak.recipe.action[actionKey] && tweak.recipe.match(model, item));
}

const entrySignature = (item) =>
  render({ ...item, children: item.children.filter((child) => !NUMERIC_FIELDS.includes(child.name)) });

// Число поля «подвинуто в нашу сторону» (или не менялось).
function movesOurWay(fieldName, actionKey, grows, liveItem, baseItem) {
  const was = numericField(baseItem, fieldName);
  const now = numericField(liveItem, fieldName);
  if (was === now) return true;
  return was !== null && now !== null && grows(now, was) && catalogRuleSelects(actionKey, baseItem);
}

// Записи основы по порядку против записей живого файла: убранная запись допустима,
// если её убирает правка каталога; лишних записей в живом файле быть не должно.
function entriesFollowCatalog(baseItems, liveItems) {
  let next = 0;
  for (const base of baseItems) {
    const live = liveItems[next];
    if (live !== undefined && entrySignature(live) === entrySignature(base)) {
      const spacingOk = movesOurWay("Spacing", "spacing", (now, was) => now > was, live, base);
      const distanceOk = movesOurWay("MaxDistance", "maxDistance", (now, was) => now < was, live, base);
      if (!spacingOk || !distanceOk) return false;
      next += 1;
    } else if (!catalogRuleSelects("remove", base)) {
      return false;
    }
  }
  return next === liveItems.length;
}

const shellOf = (tree) => ({ ...tree, children: [] });

function sectionsOutsideEntries(tree) {
  const entries = childElement(tree, ENTRIES_SECTION);
  return tree.children.filter((child) => child !== entries);
}

// «Дрейф»: прежние версии накладывали множители дважды.
function isScatterDrift(live, baseTree) {
  let liveTree;
  try {
    liveTree = parseProceduralMeta(live);
  } catch {
    return false;
  }
  if (render(shellOf(liveTree)) !== render(shellOf(baseTree))) return false;
  const liveSections = sectionsOutsideEntries(liveTree).map(render);
  const baseSections = sectionsOutsideEntries(baseTree).map(render);
  if (liveSections.length !== baseSections.length) return false;
  if (liveSections.some((section, index) => section !== baseSections[index])) return false;
  return entriesFollowCatalog(proceduralObjects(baseTree), proceduralObjects(liveTree));
}

function isOurScatter(live, baseTree, tweaks) {
  if (typeof live === "string") {
    for (const candidate of scatterCandidates(baseTree, tweaks.filter(isScatter))) {
      if (candidate === live) return true;
    }
  }
  return isScatterDrift(live, baseTree);
}

// ---------------------------------------------------------------- возврат: отличия

const tagOf = (item) => (fieldValue(item, "Tag") ?? "").trim();
const pairKey = (item) => `${tagOf(item)}\u0000${proceduralModelName(item)}`;
const placeOf = (item) => ({ model: proceduralModelName(item) || NO_MODEL_NAME, tag: tagOf(item) });

// Поле одной строкой: дети — записанным видом, иначе текст и/или атрибуты.
function describeField(field) {
  if (field === null) return null;
  if (field.children.length > 0) {
    return render(field)
      .replace(/^<\?xml[^>]*\?>/, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  const pairs = Object.entries(field.attributes);
  if (pairs.length === 0) return field.text;
  if (pairs.length === 1 && pairs[0][0] === "value" && !field.text) return pairs[0][1];
  const parts = pairs.map(([name, value]) => `${name}=${value}`);
  if (field.text) parts.push(field.text);
  return parts.join(" ");
}

// Допустимое изменение числового поля: ровно в нашу сторону и только там,
// где каталог знает такую правку.
function isCatalogAdjustment(fieldName, live, base) {
  const was = numericField(base, fieldName);
  const now = numericField(live, fieldName);
  if (was === null || now === null) return false;
  if (fieldName === "Spacing") return now > was && catalogRuleSelects("spacing", base);
  if (fieldName === "MaxDistance") return now < was && catalogRuleSelects("maxDistance", base);
  return false;
}

function* fieldDifferences(live, base) {
  const names = new Set([...base.children, ...live.children].map((child) => child.name));
  for (const name of names) {
    const was = describeField(childElement(base, name));
    const now = describeField(childElement(live, name));
    if (was === now || isCatalogAdjustment(name, live, base)) continue;
    yield { kind: "field", ...placeOf(base), field: name, from: was, to: now };
  }
}

function* sectionDifferences(liveTree, baseTree) {
  const liveSections = sectionsOutsideEntries(liveTree);
  const baseSections = sectionsOutsideEntries(baseTree);
  const length = Math.max(liveSections.length, baseSections.length);
  for (let index = 0; index < length; index += 1) {
    const live = liveSections[index];
    const base = baseSections[index];
    if (live && base && render(live) === render(base)) continue;
    yield { kind: "section", name: (live ?? base).name };
    return;
  }
  if (render(shellOf(liveTree)) !== render(shellOf(baseTree))) yield { kind: "section", name: liveTree.name };
}

function* entryDifferences(liveTree, baseTree) {
  const baseItems = proceduralObjects(baseTree);
  const queues = new Map();
  for (const item of baseItems) {
    const key = pairKey(item);
    if (!queues.has(key)) queues.set(key, []);
    queues.get(key).push(item);
  }

  const paired = new Set();
  for (const item of proceduralObjects(liveTree)) {
    const mate = queues.get(pairKey(item))?.shift();
    if (mate === undefined) {
      yield { kind: "extra", ...placeOf(item) };
      continue;
    }
    paired.add(mate);
    yield* fieldDifferences(item, mate);
  }
  for (const item of baseItems) {
    if (!paired.has(item) && !catalogRuleSelects("remove", item)) yield { kind: "missing", ...placeOf(item) };
  }
}

function* scatterDifferences(liveTree, baseTree) {
  yield* sectionDifferences(liveTree, baseTree);
  yield* entryDifferences(liveTree, baseTree);
}

function collectDifferences(live, baseTree) {
  let liveTree;
  try {
    liveTree = parseProceduralMeta(live);
  } catch (error) {
    return [{ kind: "unreadable", message: describeThrown(error) }];
  }
  const found = [];
  for (const difference of scatterDifferences(liveTree, baseTree)) {
    found.push(difference);
    if (found.length === MAX_DIFFERENCES) break;
  }
  return found.length > 0 ? found : [{ kind: "order" }];
}

const placeText = ({ model, tag }) => (tag ? `${model} (${tag})` : model);
const DIFFERENCE_TEXT = {
  unreadable: (d) => `файл не разбирается: ${d.message}`,
  section: (d) => `раздел ${d.name} вне ${ENTRIES_SECTION}`,
  extra: (d) => `лишняя запись ${placeText(d)}`,
  missing: (d) => `нет записи ${placeText(d)}`,
  field: (d) => `${placeText(d)}: ${d.field} ${d.from ?? "нет"} → ${d.to ?? "нет"}`,
  order: () => "записи стоят не в штатном порядке",
};

function foreignScatterError(live, baseTree) {
  const differences = collectDifferences(live, baseTree);
  const error = new Error(`${TEXT.foreignScatter}${differences.map((d) => DIFFERENCE_TEXT[d.kind](d)).join("; ")}.`);
  error.code = "FOREIGN_SCATTER";
  error.details = { differences };
  return error;
}

function putScatterBack(ctx, base, line) {
  ctx.outcome.bases.procedural = base;
  ctx.outcome.files.push(
    fileRecord(OPTIMIZER_TARGETS.procedural, base, {
      changed: 1,
      missing: [],
      lines: [line],
      tweaks: [],
    }),
  );
}

/*
 * Основа, на которую оптимизатор ставил правки россыпи в прошлый раз (16.11.2026,
 * журнал beta.106: у человека чужой редукс со своим procedural.meta, штатного вида
 * у файла нет). Против штатной такой файл «нашим» не станет никогда, а против
 * запомненной основы — станет: это она плюс наши правки. Та же проверка, тот же
 * раздел растений из живого файла; не сошлось (запись устарела, файл менял кто-то
 * ещё) — `false`, и дальше прежний отказ. Живой файл, равный самой основе, — наших
 * правок в нём уже нет, возвращать нечего.
 */
function returnToRemembered(ctx, live, before) {
  if (typeof before !== "string" || before === "") return false;
  try {
    const base = scatterRevertBase(live, before);
    if (live === base) return true;
    if (!isOurScatter(live, parseTextualTree(base), ctx.tweaks)) return false;
    putScatterBack(ctx, base, TEXT.restoredToBefore);
    return true;
  } catch {
    return false;
  }
}

function revertScatter(ctx, live, stock, before) {
  const base = scatterRevertBase(live, stock);
  if (!live || live === base) return;

  const baseTree = stock ? parseTextualTree(base) : null;
  const ours = baseTree !== null && isOurScatter(live, baseTree, ctx.tweaks);
  if (baseTree !== null && (ours || ctx.forceScatter)) {
    putScatterBack(ctx, base, ours ? TEXT.restored : TEXT.restoredByChoice);
    return;
  }
  /* «Вернуть штатной» (`forceScatter`) просит штатную и только её; иначе — к основе, на которую ставили. */
  if (!ctx.forceScatter && returnToRemembered(ctx, live, before)) return;
  if (!ctx.strict || !touches(ctx.tweaks, "procedural")) return;
  throw baseTree === null ? new Error(TEXT.noStockScatter) : foreignScatterError(live, baseTree);
}

export function revertOptimizerBases({
  profile,
  bases = {},
  stock = {},
  before = {},
  strict = true,
  forceScatter = false,
} = {}) {
  const tweaks = profileTweaks(profile);
  const live = { settings: bases.visualsettings, scatter: bases.procedural };
  const original = { settings: stock.visualsettings, scatter: stock.procedural };

  const outcome = { bases: { ...bases }, files: [], kept: [] };
  const ctx = { tweaks, strict: Boolean(strict), forceScatter: Boolean(forceScatter), outcome };
  revertSettings(ctx, live.settings, original.settings);
  revertScatter(ctx, live.scatter, original.scatter, before?.procedural);
  return outcome;
}

// ---------------------------------------------------------------- манифест патча

export function optimizerPatchManifest({ name, files }) {
  if (!Array.isArray(files)) throw new TypeError("files должен быть массивом");
  return {
    ReduxName: name || "Astral optimizer",
    ParsedAt: new Date().toISOString(),
    // Размеры суммируются как есть: строка склеится со счётчиком, пропуск даст NaN.
    TotalPatchSize: files.reduce((sum, file) => sum + file.size, 0),
    Actions: files.map((file) => ({
      Type: "Replace",
      TargetPath: file.target,
      SourcePath: `payload/${file.file}`,
      Size: file.size,
      Sha256: file.sha256,
      IsWholeReplaceNestedRpf: false,
    })),
  };
}
