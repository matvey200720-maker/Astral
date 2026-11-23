/*
 * Обложки карточек «нашего Core» на кадре игры (Хелпер 20, 29.10.2026): что поставить на сцену попадания.
 *
 * Карточка ядра меняет у игрока не проект мастерской, а само ядро эффектов: лист (`ypt-texture-layer-v1`), числа штатных
 * правил (`ypt-rule-patch-v1`) или свои правила автора (`ypt-own-rules-v1`). Печь снимает её так же честно, как «Попадания»:
 * выстрел на кадре GTA V дважды — с базой эффектов игры и с той же базой, в которую вписана правка карточки, —
 * и разница двух прогонов и есть то, что принесла карточка. Здесь — только подготовка: какая сцена, копия базы с правкой и
 * (у попадания) слой зоны «тело», на котором правка видна. Играет и снимает `fxCoreCover` (`fx-frame-cover.js`).
 *
 *   hit    — кровь: выстрел в тело вблизи, слой зоны «тело» с донором крови, которую правка задела;
 *   tracer — вспышка карабина, след и попадание в стену (`combat-shot-fx.js`): сцена сбоку, без зоны, один выстрел.
 *
 * Сцен огня и взрывов в наборе нет: такая карточка остаётся без обложки, причина — словами.
 */
import { BLOOD_VARIANTS, IMPACT_TEMPLATES, bloodDonor, defaultImpactLayer, defaultImpactZone, effectTextures } from "@modovik/ptfx-studio";

const STORE = Object.freeze({ effect: "effects", emitter: "emitters", particle: "particles" });
/* Обложка компонента «Эффекты» редукса (владелец 12.11.2026: «поймать момент, когда эффект уже вылетает, чтобы было видно, что это за эффекты»): попадание
   в тело так, как его сыграет ядро автора. Не стратегия установки — только вид обложки; файлы готовит печь (`cover-stage.js: authorHitFiles`). */
export const AUTHOR_HIT = "author-hit-v1";
/* Имя, под которым сцена кадра играет эффект зоны «тело» спереди (`impact-clones.js: cloneName`). */
const BODY_FRONT_CLONE = "astral_preview_body_front";
/* Что играет сцена трассера: вспышка ствола карабина, штатный след, попадание в стену (`combat-shot-fx.js`) — и где это видно на кадре. */
export const TRACER_SCENE_PLAYS = Object.freeze(["muz_assault_rifle", "bullet_tracer", "bul_concrete"]);
const SPOT = Object.freeze({ muz_assault_rifle: "muzzle", bullet_tracer: "muzzle", bul_concrete: "impact" });
const spotsOf = (played) => [...new Set(played.map((rule) => SPOT[rule]))];
/* Порядок, в котором лист ищется у крови: крупные брызги видны лучше всего. */
const BLOOD_ORDER = ["big", ...BLOOD_VARIANTS.map((item) => item.id).filter((id) => id !== "big")];
const FIRE_REASON = "у огня и взрывов своей сцены в наборе пока нет";
/* Огонь и взрывы по имени правила или листа — им сцена нужна своя; прочему (фонтаны, вспышки вертолётов) сцены в наборе нет вовсе. */
const FIRE_NAME = /fire|flame|exp_|explosion|molotov|burn/i;
const missingScene = (names) => (names.some((name) => FIRE_NAME.test(name)) ? FIRE_REASON : "сцены, где они играют, в наборе нет");

/* Узел свойства с кадрами внутри объекта выгрузки — мимо эволюций и событий, как у установщика (`ptfx-player-core.js`). */
function propNode(object, prop) {
  if (!object || typeof object !== "object") return null;
  if (Array.isArray(object)) {
    for (const item of object) {
      const found = propNode(item, prop);
      if (found) return found;
    }
    return null;
  }
  if (object.Name === prop && Array.isArray(object.Keyframes)) return object;
  for (const [key, value] of Object.entries(object)) {
    if (key === "EvolutionList" || key === "EvolvedKeyframeProps" || key === "EventEmitters") continue;
    const found = propNode(value, prop);
    if (found) return found;
  }
  return null;
}

/** Числа автора в копии выгрузки: `{ model, touched }` — что правка задела (имена объектов). */
export function applyRulePatches(model, patches) {
  const copy = structuredClone(model || {});
  const touched = new Set();
  for (const patch of patches || []) {
    const node = propNode(copy?.[STORE[patch.kind]]?.[patch.name], patch.prop);
    if (!node) continue;
    node.Keyframes = patch.values.map((row) => [...row]);
    touched.add(patch.name);
  }
  return { model: copy, touched };
}

const bodyZone = (layer) => ({ ...defaultImpactZone("body"), enabled: true, layers: [layer] });

/* Слой «кровь» зоны «тело» с донором из правки: штатный вариант крови, чьё правило карточка задела. */
function bloodLayerFor(effects) {
  const variant = BLOOD_VARIANTS.find((item) => effects.has(bloodDonor("body", item.id)));
  return variant ? { ...defaultImpactLayer("body"), variant: variant.id } : null;
}

/* Копия базы: правится только сцена попаданий (выгрузки правил по словарям и листы). */
function impactCopy(base) {
  const impact = base?.impact;
  return { ...base, impact: { ...impact, model: { ...(impact?.model || {}) }, sheets: { ...(impact?.sheets || {}) } } };
}

/* Копия базы: правится только сцена трассера (её выгрузка и листы). */
function tracerCopy(base, exported, sheets = {}) {
  const scene = base.tracerScene;
  return { ...base, tracerScene: { ...scene, exports: [exported || scene.exports[0], ...scene.exports.slice(1)], sheets: { ...(scene.sheets || {}), ...sheets } } };
}

const keyOf = (sheets, name) => Object.keys(sheets || {}).find((item) => item.toLowerCase() === String(name).toLowerCase());

/* Лист карточки: сцена трассера, если его рисует то, что она играет; иначе кровь, у которой он есть; иначе причина. */
function texturePlan(base, card) {
  const name = String(card.merge?.texture || "").toLowerCase();
  const sheet = card.sheets?.[keyOf(card.sheets, name)];
  if (!sheet) return { reason: `листа ${name} в карточке нет` };
  const exports = base?.tracerScene?.exports || [];
  const played = TRACER_SCENE_PLAYS.filter((rule) => effectTextures(exports, rule).has(name));
  if (played.length)
    return {
      scene: "tracer",
      base: tracerCopy(base, null, { [keyOf(base.tracerScene.sheets, name) || name]: sheet }),
      spots: spotsOf(played),
      label: `лист ${name} · ${played.join(", ")}`,
    };
  const core = base?.impact?.model?.core;
  const key = keyOf(base?.impact?.sheets, name);
  const variant = core && key ? BLOOD_ORDER.find((id) => effectTextures([core], bloodDonor("body", id)).has(name)) : null;
  if (!variant) return { reason: `лист ${name} на сценах попадания и трассера не рисуется — ${missingScene([name])}` };
  const next = impactCopy(base);
  next.impact.sheets[key] = sheet;
  const zone = bodyZone({ ...defaultImpactLayer("body"), variant });
  return { scene: "hit", base: next, withZones: { body: zone }, withoutZones: { body: zone }, label: `лист ${name}` };
}

/* Числа автора: кровь — на сцене попадания; вспышка карабина, след, попадание в стену — на сцене трассера; прочее — причина. */
function rulesPlan(base, card) {
  const core = base?.impact?.model?.core;
  if (core) {
    const { model, touched } = applyRulePatches(core, card.patches);
    const layer = bloodLayerFor(new Set([...(card.effects || []), ...touched]));
    if (layer) {
      const next = impactCopy(base);
      next.impact.model.core = model;
      const zone = bodyZone(layer);
      return { scene: "hit", base: next, withZones: { body: zone }, withoutZones: { body: zone }, label: `числа автора у ${bloodDonor("body", layer.variant)}` };
    }
  }
  const exported = base?.tracerScene?.exports?.[0];
  const played = TRACER_SCENE_PLAYS.filter((rule) => (card.effects || []).includes(rule));
  if (exported && played.length) {
    const { model, touched } = applyRulePatches(exported, card.patches);
    if (touched.size) return { scene: "tracer", base: tracerCopy(base, model), spots: spotsOf(played), label: `числа автора у ${played.join(", ")}` };
  }
  const named = (card.effects || []).slice(0, 4).join(", ");
  return { reason: `правка (${named || "правила"}) не задевает ни кровь, ни вспышку карабина, след и попадание в стену — ${missingScene(card.effects || [])}` };
}

/*
 * Ядро сцены попадания с правилами автора: штатное, а поверх него всё, что выгружено печью из ядра автора (`card.ownExport`: правило попадания и
 * правила выстрела — вспышка ствола, след, — их излучатели и частицы под своими именами), листы автора — рядом. База печи не трогается.
 *
 * Картинка «Эффектов» — всегда миг попадания на сцене «в тело» (владелец 13.11.2026 об ALLIANCE V3: «ты взял картинку, как и для трейсеров»). До этого
 * редуксу без крови доставался запасной кадр со сцены трассера — стрелок сбоку со вспышкой, то есть та же картинка, что у части «Трейсеры». Автор убрал
 * кровь — значит, его попадание и есть выстрел без крови: тот же ракурс, что у попадания с эффектом, и подпись «Автор убрал эффект попадания».
 */
function authorImpactCopy(base, card) {
  const copy = impactCopy(base);
  const core = structuredClone(copy.impact.model.core);
  for (const store of Object.values(STORE)) core[store] = { ...(core[store] || {}), ...(card.ownExport?.[store] || {}) };
  copy.impact.model.core = core;
  for (const [name, sheet] of Object.entries(card.sheets || {})) copy.impact.sheets[name] = sheet;
  return { copy, core };
}

/**
 * Что снимать: `{ scene: "hit", base, withZones, withoutZones, label }` или `{ reason }`.
 * `card` — `{ strategy, merge, patches?, effects?, sheets?, ownExport? }`: правка из файлов карточки, листы уже готовыми
 * записями базы (`{ width, height, columns, rows, png }`, их делает окно из DDS карточки).
 */
export function coreCoverPlan(base, card) {
  if (!base?.impact?.model?.core && !base?.tracerScene?.exports?.length) return { reason: "правил эффектов из игры нет (--game, --keys)" };
  const strategy = card?.strategy;
  if (strategy === "ypt-texture-layer-v1") return texturePlan(base, card);
  if (strategy === "ypt-rule-patch-v1") return rulesPlan(base, card);
  if (strategy === AUTHOR_HIT) {
    if (!base?.impact?.model?.core) return { reason: "правил сцены попаданий из игры нет (--game, --keys)" };
    const rule = String(card.merge?.rule || "");
    const silent = { ...defaultImpactZone("body"), enabled: false, layers: [] };
    /* Автор убрал попадание совсем: сцена играет выстрел без эффекта зоны, клона зоны в ядре нет. Правила выстрела автора (вспышка, след), если печь
       их выгрузила, встают в ядро сцены: и на этом кадре стреляет автор. Обе стороны сравнения молчат — кровь игры в кадр не попадает. */
    if (card.merge?.blank) {
      const scene = card.ownExport ? authorImpactCopy(base, card).copy : base;
      return { scene: "hit", base: scene, withZones: { body: silent }, withoutZones: { body: silent }, blankOk: true, label: "попадание без эффекта (автор убрал)" };
    }
    const effect = card.ownExport?.effects?.[rule];
    if (!effect) return { reason: `выгрузки правила автора ${rule || "(не названо)"} нет` };
    /* Ядро сцены — штатное, поверх него всё, что выгружено из ядра автора (правило, его излучатели и частицы под своими именами), и то же правило под
       именем клона зоны «тело»: сцена играет попадание именно им, слоёв мастерской у зоны нет. */
    const { copy, core } = authorImpactCopy(base, card);
    core.effects = { ...core.effects, [BODY_FRONT_CLONE]: structuredClone(effect) };
    /* `blankOk`: правило автора может ничего не рисовать (листы — пустышки, «оптимизация» крови) — кадр выстрела без эффекта честнее чужой картинки.
       Сравнивается с выстрелом ВОВСЕ без эффекта зоны (`withoutZones` молчит, клона в базе игры нет): отличие — ровно то, что рисует автор, а не
       «штатная кровь пропала». `fine`: эффект автора бывает с ладонь (чёрные брызги GODMODE) — мерить тонко, снимать крупно. `scatter`: миг — разлёт, а не раскрытие
       пятна (13.11.2026, «они как PNG-шки, а должны прям как эффекты разлетаться»): брызги и капли автора снимаются, когда разошлись, а не в первый миг. */
    return { scene: "hit", base: copy, withZones: { body: silent }, withoutZones: { body: silent }, blankOk: true, fine: true, scatter: true, label: `попадание автора ${rule}` };
  }
  if (strategy === "ypt-own-rules-v1") {
    if (!base?.impact?.model?.core) return { reason: "правил сцены попаданий из игры нет (--game, --keys)" };
    const rules = card.merge?.rules || [];
    const template = IMPACT_TEMPLATES.find((item) => !item.keep && item.file && rules.includes(item.rule));
    if (!template) return { reason: `свои правила ${rules.join(", ")} мастерская на сцене попадания не играет` };
    if (!card.ownExport?.effects?.[template.rule]) return { reason: `выгрузки правила автора ${template.rule} нет` };
    const next = impactCopy(base);
    const target = structuredClone(next.impact.model[template.file] || { effects: {}, emitters: {}, particles: {} });
    for (const store of Object.values(STORE)) target[store] = { ...(target[store] || {}), ...(card.ownExport[store] || {}) };
    next.impact.model[template.file] = target;
    for (const [name, sheet] of Object.entries(card.sheets || {})) next.impact.sheets[name] = sheet;
    const layer = { ...defaultImpactLayer("body", "template"), template: template.id };
    return { scene: "hit", base: next, withZones: { body: bodyZone(layer) }, withoutZones: {}, label: `правило автора ${template.rule}` };
  }
  return { reason: "карточка не ядра эффектов" };
}

const text = (bytes) => new TextDecoder().decode(bytes);
const json = (file) => (file ? JSON.parse(text(file.bytes)) : null);

/**
 * Правка карточки из её файлов (печь, `cover-stage.js`): `core-merge.json` — стратегия и политика слоя, `rules.json` — числа
 * автора, `own-export.json` — выгрузка своих правил, `clip-rows.json` — сетки своих листов, DDS — листы. `null` — не карточка ядра.
 */
export function coreCardOf(files) {
  const byName = new Map(files.map((file) => [file.name.toLowerCase(), file]));
  const head = json(byName.get("core-merge.json"));
  if (!head?.strategy) return null;
  const rules = json(byName.get("rules.json"));
  const clips = json(byName.get("clip-rows.json"));
  const prefix = `${head.merge?.prefix || ""}t_`;
  const dds = [];
  for (const file of files) {
    if (!/\.dds$/i.test(file.name)) continue;
    const name = head.strategy === "ypt-texture-layer-v1" ? String(head.merge?.texture || "") : file.name.replace(/^sheet-/i, "").replace(/\.dds$/i, "");
    if (!dds.some((item) => item.name === name)) dds.push({ name, bytes: file.bytes });
  }
  /* Сетка своего листа — из строки кадров автора (имя в ней — наше: `<приставка>t_<лист без ptfx_>`). */
  const grids = {};
  for (const row of clips?.rows || []) {
    const short = String(row.texture || "").startsWith(prefix) ? row.texture.slice(prefix.length) : "";
    const [columns, rowsCount] = String(row.line || "").trim().split(/\s+/).slice(1, 3).map(Number);
    const sheet = dds.find((item) => item.name.toLowerCase().replace(/^ptfx_/, "") === short);
    if (sheet && columns > 0 && rowsCount > 0) grids[sheet.name.toLowerCase()] = { columns, rows: rowsCount };
  }
  /* Сетки листов из таблицы самого автора (`ptxclipregions.dat`, `cover-stage.js: authorClipGrids`): они главнее сетки штатного листа с тем же именем. */
  const authored = json(byName.get("clip-grids.json"))?.grids;
  for (const [name, grid] of Object.entries(authored && typeof authored === "object" ? authored : {})) {
    if (grid?.columns > 0 && grid?.rows > 0) grids[name.toLowerCase()] = { columns: grid.columns, rows: grid.rows };
  }
  return {
    strategy: head.strategy,
    merge: head.merge || {},
    patches: rules?.patches || [],
    effects: rules?.effects || [],
    dds,
    grids,
    ownExport: json(byName.get("own-export.json")),
  };
}
