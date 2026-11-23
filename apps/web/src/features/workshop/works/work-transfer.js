/*
 * Работа ⇄ код: что уходит другу и что приходит от него.
 *
 * Строка кода — дело `work-code.js`. Здесь — смысл: какие данные каждого
 * редактора кладутся в код, что из них остаётся на этом компьютере и как
 * пришедшее превращается в работу, которую редактор откроет.
 *
 * Правило одно для всех: в код идёт то, что откроется у друга, и ничего
 * сверх. Картинки и звуки человека (своя иконка HP, подложка карты,
 * картинка слоя попадания, свой файл выстрела) живут в хранилище его окна —
 * ссылка на них у друга указывала бы в пустоту. Такие ссылки из кода
 * снимаются, и отправителю говорится, что именно не поедет.
 *
 * Разбор каждого вида приезжает по требованию: окно, вставившее код неба,
 * не должно тянуть в себя мастерскую эффектов.
 */

import { WorkCodeError, decodeWorkCode, encodeWorkCode } from "./work-code.js";
import { expandWorkCode, isBuildCodeText } from "./work-code-share.js";
import {
  EFFECTS_PART_KINDS,
  WORK_KINDS,
  studioKindOfModules,
} from "./work-kinds.js";
import {
  addStudioWork,
  addTemplateWork,
  effectsPartsOf,
  roundSkyNumbers,
  workStateFor,
} from "./workshop-works.js";
import { tr } from "../../../locales/ui.js";

/**
 * Отказ переноса со словом для окна: `empty` (в работе нечего передать),
 * `wrong-kind` (код другого редактора), `cloud` (прежняя ссылка, которую не
 * открыть), `invalid` (данные кода не читаются этим редактором).
 */
export class WorkTransferError extends Error {
  constructor(reason, message = reason, details = {}) {
    super(message);
    this.name = "WorkTransferError";
    this.reason = reason;
    Object.assign(this, details);
  }
}

const loadEffects = () => import("@modovik/ptfx-studio");
const loadSky = () => import("@modovik/timecycle");
const loadKill = () => import("@modovik/kill-effects");
const loadScreenHits = () => import("@modovik/kill-effects/screen-hits.js");
const loadGps = () => import("../gps-editor/gps-project.js");
/* «Полоска HP» (задача 2 ТЗ 11.10.2026): договор полоски — в договоре прицела. */
const loadTargetHp = () => import("@modovik/reticle-contract");
/* «Групповые метки» (задача 21 ТЗ 18.10.2026, вечер). */
const loadGroupMarkers = () => import("../group-markers-editor/group-markers-project.js");
/* «Дым из-под колёс» (ТЗ 11.10.2026, вечер): только договор дыма, а не
   пакет студии эффектов целиком. */
const loadWheelSmoke = () => import("@modovik/ptfx-studio/wheel-smoke.js");
const loadLamps = () => import("@modovik/street-light-contract/lamps");
const loadWallbang = () => import("@modovik/climb-contract/wallbang");
/* Наборы перекраски (запретные зоны, завод, ангар, маппинг) — одной
   таблицей договоров: код у всех устроен одинаково. */
const loadRecolor = () => import("@modovik/climb-contract/recolor/projects");
const loadStudio = () =>
  import("../../../components/desktop/workshop/workshop-project.js");
const loadWorldMap = () => import("@modovik/vector-map");
const loadClimbs = () => import("../climb-editor/workshop-adapter.js");
const loadGun = () => import("@modovik/gun-studio");
/* Не `@modovik/sound-studio` целиком: пакет уже есть в стартовом куске
   частью (песочница звука), и импорт всего пакета удержал бы там и разбор
   метаданных, и слоты банков. Имена семей даёт модель студии. */
const loadSound = () =>
  import("../../../components/desktop/workshop/sound/sound-kit-model.js");

const parse = (value) => {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(String(value ?? ""));
  } catch {
    return null;
  }
};

/* --- Картинки, которые кодом не передаются ------------------------- */

/* Слои попаданий со своей картинкой: картинка лежит в окне автора. */
function impactPictureLoss(effects, project) {
  if (!project?.impact?.enabled) return "";
  let count = 0;
  for (const zone of effects.IMPACT_ZONES) {
    const settings = project.impact.zones?.[zone.id];
    if (!settings?.enabled) continue;
    count += (settings.layers || []).filter(effects.layerNeedsUpload).length;
  }
  return count
    ? `Свои картинки слоёв (${count}) кодом не передаются — у получателя их нужно будет выбрать заново.`
    : "";
}

const MINIMAP_PICTURES = Object.freeze([
  [
    "healthIconAssetId",
    "своя иконка HP",
    { healthIconPreset: "heart" },
    (effects) => effects.healthIconPreset === "custom",
  ],
  [
    "armorIconAssetId",
    "своя иконка брони",
    { armorIconPreset: "shield" },
    (effects) => effects.armorIconPreset === "custom",
  ],
  [
    "playerMarkerAssetId",
    "своя стрелка игрока",
    { playerMarkerMode: "stock" },
    (effects) => effects.playerMarkerMode === "custom",
  ],
  ["damageAssetId", "своя картинка урона", {}, () => false],
]);

/* Мини-карта без своих картинок: картинка снимается, а режим, который на
   неё опирался, возвращается к штатному. */
function minimapWithoutPictures(config) {
  const effects = { ...(config?.effects || {}) };
  const lost = [];
  for (const [field, label, fallback, usesPicture] of MINIMAP_PICTURES) {
    const inUse = usesPicture(effects);
    if (!effects[field] && !inUse) continue;
    if (effects[field]) lost.push(label);
    effects[field] = "";
    if (inUse) Object.assign(effects, fallback);
  }
  /* Метка GPS в мини-карте (задача 10 ТЗ 10.10.2026, вечер): своя картинка
     метки — значком игры, как у прежнего кода «Меток и GPS». */
  const gps = config?.gps?.marker?.assetId
    ? { ...config.gps, marker: { ...config.gps.marker, icon: config.gps.marker.icon === "custom" ? "stock" : config.gps.marker.icon, assetId: "" } }
    : config?.gps;
  if (config?.gps?.marker?.assetId) lost.push("своя картинка метки GPS");
  return {
    config: { ...config, effects, ...(gps ? { gps } : {}) },
    lost: lost.length
      ? `Картинки кодом не передаются, поэтому убрано: ${lost.join(", ")}.`
      : "",
  };
}

async function climbsWithoutPicture(module, projectId) {
  const { climbModuleHasPictures, copyClimbModuleForProject } =
    await loadClimbs();
  const hadPicture = climbModuleHasPictures(module);
  const copy = copyClimbModuleForProject(module, projectId);
  return {
    /* Копия зовётся «— копия»: для кода это лишнее, имя метки остаётся
       авторским. */
    module: {
      ...copy,
      design: {
        ...copy.design,
        name: module?.design?.name || copy.design.name,
      },
    },
    lost: hadPicture
      ? tr("Свои картинки меток кодом не передаются — вместо них значки мода.")
      : "",
  };
}

/* --- Код из того, что открыто или сохранено ------------------------ */

/**
 * Код части набора эффектов. `project` — набор целиком (разобранный или
 * снимок), в код идёт только часть `part`: у друга она ляжет на своё место,
 * не трогая остальные его эффекты.
 */
export async function effectsPartCode(project, part, { name = "" } = {}) {
  const effects = await loadEffects();
  const serialized = effects.serializeProject(
    effects.parseProject(parse(project)),
  );
  if (!effectsPartsOf(serialized).includes(part))
    throw new WorkTransferError("empty");
  const kind = EFFECTS_PART_KINDS[part];
  return {
    kind,
    code: await encodeWorkCode(kind, {
      name: name || serialized.name,
      data: { schema: serialized.schema, [part]: serialized[part] },
    }),
    lost: part === "impact" ? impactPictureLoss(effects, serialized) : "",
  };
}

/**
 * Код неба: вид острова и прежние точечные правки, с точностью, которую
 * читает игра. Пустые правки в код не кладутся: вид весит сотню байт, и
 * лишний пустой объект — это лишние символы в строке, которую копируют руками.
 */
export async function skyCode(project, { name = "" } = {}) {
  const sky = await loadSky();
  const parsed = sky.parseProject(
    typeof project === "string" ? project : JSON.stringify(project),
  );
  if (sky.projectIsEmpty(parsed)) throw new WorkTransferError("empty");
  const legacy = Object.keys(parsed.weathers || {}).length;
  return {
    kind: "sky",
    code: await encodeWorkCode("sky", {
      name: name || parsed.name,
      data: roundSkyNumbers({
        schemaVersion: parsed.schemaVersion,
        look: parsed.look,
        ...(legacy ? { weathers: parsed.weathers } : {}),
      }),
    }),
    lost: "",
  };
}

/*
 * Код фонарей: работа целиком — свет, луч, блик и частицы. Картинок и
 * файлов человека в ней нет, и передаётся она без потерь. Вид игры кодом не
 * делятся: получателю его нечем отличить от пустого кода.
 */
export async function lampsCode(project, { name = "" } = {}) {
  const lamps = await loadLamps();
  const parsed = lamps.parseLampProject(project);
  if (lamps.lampProjectIsVanilla(parsed)) throw new WorkTransferError("empty");
  const { name: own, ...data } = parsed;
  return {
    kind: "lamps",
    code: await encodeWorkCode("lamps", { name: name || own, data }),
    lost: "",
  };
}

/*
 * Код следа на экране: картинка, цвет, вид и время. Своя картинка живёт в
 * окне автора: у друга след откроется каплей игры, и об этом говорится.
 */
export async function screenHitsCode(project, { name = "" } = {}) {
  const hits = await loadScreenHits();
  const parsed = hits.parseScreenHitsProject(project);
  if (hits.screenHitsIsVanilla(parsed)) throw new WorkTransferError("empty");
  const own = parsed.shape === "own";
  const { name: ownName, ...data } = own ? { ...parsed, shape: "game", own: { asset: "", name: "", invert: false } } : parsed;
  return {
    kind: "screen-hits",
    code: await encodeWorkCode("screen-hits", { name: name || ownName, data }),
    lost: own ? tr("своя картинка следа (у друга будет капля игры)") : "",
  };
}

/*
 * Код меток и GPS: цвет и значок метки, маршруты сервера и точность. Своя
 * картинка значка живёт в окне автора: у друга метка откроется значком игры.
 */
export async function gpsCode(project, { name = "" } = {}) {
  const gps = await loadGps();
  const parsed = gps.parseGpsProject(project);
  if (gps.gpsProjectIsStock(parsed)) throw new WorkTransferError("empty");
  const own = parsed.marker.icon === "custom";
  const { name: ownName, ...data } = own ? { ...parsed, marker: { ...parsed.marker, icon: "stock", assetId: "" } } : parsed;
  return {
    kind: "gps",
    code: await encodeWorkCode("gps", { name: name || ownName, data }),
    lost: own ? tr("своя картинка значка метки (у друга будет значок игры)") : "",
  };
}

/*
 * Код «Полоски HP» (задача 2 ТЗ 11.10.2026): вид, видимость, раскладка,
 * броня, размер, цвета и цифры. Файлов человека в работе нет — передаётся
 * без потерь; полоска «как в игре» — пустая работа.
 */
export async function targetHpCode(project, { name = "" } = {}) {
  const contract = await loadTargetHp();
  const parsed = contract.parseTargetHpProject(project);
  if (contract.targetHealthIsStock(parsed)) throw new WorkTransferError("empty");
  const { name: own, ...data } = parsed;
  return {
    kind: "target-hp",
    code: await encodeWorkCode("target-hp", { name: name || own, data }),
    lost: "",
  };
}

/*
 * Код «Групповых меток» (задача 21 ТЗ 18.10.2026, вечер): какие метки правлены, цвет, убрано, надписи, размер и
 * обводка. Свои картинки живут в окне автора и кодом не передаются: у друга такая метка откроется штатной;
 * надпись едет словами, а картинку для неё окно друга рисует само.
 */
export async function groupMarkersCode(project, { name = "" } = {}) {
  const markers = await loadGroupMarkers();
  const parsed = markers.parseGroupMarkersProject(project);
  if (markers.groupMarkersProjectIsStock(parsed)) throw new WorkTransferError("empty");
  const withPictures = Object.values(parsed.marks).some((edit) => edit.mode === "image");
  /* Надпись едет словами: её PNG живёт в окне автора, у друга окно нарисует свой (`asset` не передаётся). */
  const marks = Object.fromEntries(
    Object.entries(parsed.marks)
      .filter(([, edit]) => edit.mode !== "image")
      .map(([id, edit]) => {
        if (edit.mode !== "text") return [id, edit];
        const { asset: _asset, ...words } = edit;
        return [id, words];
      }),
  );
  const { name: ownName, ...data } = { ...parsed, marks };
  if (!Object.keys(marks).length) throw new WorkTransferError("empty");
  return {
    kind: "group-markers",
    code: await encodeWorkCode("group-markers", { name: name || ownName, data }),
    lost: withPictures ? tr("свои картинки меток (у друга эти метки будут штатными)") : "",
  };
}

/*
 * Код «Дыма из-под колёс» (ТЗ 11.10.2026, вечер): вид, цвета, ползунки и
 * где он работает. Листы звёзд и сердечек рисует приложение — файлов
 * человека в работе нет, передаётся без потерь; дым «как в игре» — пустая
 * работа.
 */
export async function wheelSmokeCode(project, { name = "" } = {}) {
  const contract = await loadWheelSmoke();
  const parsed = contract.parseWheelSmokeProject(project);
  if (contract.wheelSmokeIsStock(parsed)) throw new WorkTransferError("empty");
  const { name: own, ...data } = parsed;
  return {
    kind: "wheel-smoke",
    code: await encodeWorkCode("wheel-smoke", { name: name || own, data }),
    lost: "",
  };
}

/*
 * Код прострелов: облик подсветки, своя подсветка укрытий и какие укрытия
 * скрыты. Файлов человека в работе нет — передаётся без потерь.
 */
export async function wallbangCode(project, { name = "" } = {}) {
  const wallbang = await loadWallbang();
  const parsed = wallbang.parseWallbangProject(project);
  if (wallbang.wallbangProjectIsEmpty(parsed))
    throw new WorkTransferError("empty");
  const { name: own, ...data } = parsed;
  return {
    kind: "wallbang",
    code: await encodeWorkCode("wallbang", { name: name || own, data }),
    lost: "",
  };
}

/*
 * Код набора перекраски: цвета и настройки работы. Своя картинка (эмблема
 * ангара) живёт в окне автора и кодом не передаётся — об этом говорит
 * `lost`, а у друга встаёт эмблема набора.
 */
export async function recolorCode(kind, project, { name = "" } = {}) {
  const { recolorProject } = await loadRecolor();
  const contract = recolorProject(kind);
  if (!contract) throw new WorkTransferError("empty");
  const parsed = contract.normalize(contract.parse(project));
  const { name: own, ...data } = contract.shareable
    ? contract.shareable(parsed)
    : parsed;
  return {
    kind,
    code: await encodeWorkCode(kind, { name: name || own, data }),
    lost: contract.lostInCode ? contract.lostInCode(parsed) : "",
  };
}

/*
 * Знак на килле из своего файла: кадры гифки лежат в окне автора. У друга
 * знак остаётся со всеми настройками — движением, размером, временем, — а
 * вместо картинки встаёт череп.
 */
function killWithoutPicture(kill, project) {
  if (project.marker?.source?.kind !== "image") return { project, lost: "" };
  return {
    project: {
      ...project,
      marker: {
        ...project.marker,
        source: kill.normalizeKillMarkerSource({ kind: "icon", icon: "skull" }),
      },
    },
    lost: project.marker.enabled
      ? tr("Своя картинка знака на килле кодом не передаётся — у получателя вместо неё череп.")
      : "",
  };
}

/** Код килл-эффекта. */
export async function killCode(project, { name = "" } = {}) {
  const kill = await loadKill();
  const shared = killWithoutPicture(
    kill,
    kill.parseKillEffectProject(parse(project)),
  );
  return {
    kind: "kill",
    code: await encodeWorkCode("kill", {
      name: name || shared.project.name,
      data: shared.project,
    }),
    lost: shared.lost,
  };
}

/**
 * Код проекта студии: модули его вида без ссылок на картинки.
 * `kind` — вид работы; не назван — узнаётся по модулям проекта.
 */
export async function studioCode(project, kind = "") {
  const resolved =
    kind ||
    studioKindOfModules(
      project?.enabledModules || Object.keys(project?.modules || {}),
    );
  const spec = WORK_KINDS[resolved];
  if (!spec?.studio) throw new WorkTransferError("empty");
  const modules = {};
  let lost = "";
  if (resolved === "world-map") {
    const { describeSharedMapLoss, sharedWorldMap } = await loadWorldMap();
    const shared = sharedWorldMap(project);
    modules["world-map"] = shared.config;
    lost = describeSharedMapLoss(shared.report);
  } else if (resolved === "minimap") {
    const stripped = minimapWithoutPictures(project?.modules?.minimap || {});
    modules.minimap = stripped.config;
    lost = stripped.lost;
  } else if (resolved === "climbs") {
    const stripped = await climbsWithoutPicture(
      project?.modules?.climbs,
      "shared",
    );
    modules.climbs = stripped.module;
    lost = stripped.lost;
  } else {
    for (const id of spec.modules)
      if (project?.modules?.[id]) modules[id] = project.modules[id];
  }
  if (!Object.keys(modules).length) throw new WorkTransferError("empty");
  return {
    kind: resolved,
    code: await encodeWorkCode(resolved, {
      name: String(project?.name || ""),
      data: { modules },
    }),
    lost,
  };
}

/* Что не уехало в код скина — словами, с числом. */
function gunLossText({ paint, images }) {
  const parts = [];
  if (paint)
    parts.push(
      paint === 1 ? tr("роспись кистью") : `роспись кистью (${paint} слоя)`,
    );
  if (images)
    parts.push(images === 1 ? tr("своя картинка") : `свои картинки (${images})`);
  return parts.length
    ? `В код не вошли ${parts.join(" и ")}: они лежат только на этом компьютере. Узоры, эмблемы, брелоки и эффекты друг получит целиком.`
    : "";
}

/**
 * Код скина оружия: ствол и проект без своих картинок.
 * `state` — снимок работы `{ slot, project }`.
 */
export async function gunCode(state, { name = "", kind = "weapon" } = {}) {
  const gun = await loadGun();
  const parsed = parse(state) || {};
  const slot = String(parsed.slot || "");
  if (!slot || !parsed.project) throw new WorkTransferError("empty");
  const project = gun.parseGunProject(parsed.project);
  const { project: shared, lost } = gun.shareableGunProject(project);
  if (gun.projectIsEmpty(shared)) throw new WorkTransferError("empty");
  return {
    kind,
    code: await encodeWorkCode(kind, {
      name: name || project.name,
      data: { slot, project: JSON.parse(gun.serializeGunProject(shared)) },
    }),
    lost: gunLossText(lost),
  };
}

/* Звуки со своими файлами — словами: чьи выстрелы и какие попадания. */
function soundLossText(lost) {
  if (!lost.length) return "";
  const names = lost.map((item) =>
    item.kind === "weapon"
      ? `«${item.title}»`
      : item.part === "head"
        ? tr("попадание в голову")
        : tr("попадание в тело"),
  );
  return `В код не вошли звуки из своих файлов (${names.join(", ")}): файлы лежат только на этом компьютере. Готовые звуки и обработку голоса игры друг получит целиком.`;
}

/**
 * Код звуков: замыслы семей стволов и частей попадания. Свой файл в код не
 * идёт — он лежит в окне автора; отправителю говорится, чьи звуки остались
 * дома, а правка из одних своих файлов кодом не становится вовсе.
 */
export async function soundCode(state, { name = "" } = {}) {
  const sound = await loadSound();
  const parsed = parse(state);
  if (sound.soundKitIsEmpty(sound.normalizeSoundKit(parsed)))
    throw new WorkTransferError("empty");
  const { kit, lost } = sound.shareableSoundKit(parsed);
  if (sound.soundKitIsEmpty(kit))
    throw new WorkTransferError(
      "files-only",
      "Кодом передаются готовые звуки и обработка голоса игры, а здесь только свои файлы — они лежат на этом компьютере.",
    );
  return {
    kind: "sound",
    code: await encodeWorkCode("sound", { name, data: kit }),
    lost: soundLossText(lost),
  };
}

/*
 * Звуки из кода. Свои файлы снимаются и здесь: код мог собрать не этот
 * Astral, а ссылка на чужое хранилище открылась бы пустотой. Стволы и
 * готовые звуки, которых этот Astral не знает, отсеивает разбор студии.
 */
async function soundTemplate(data, name) {
  const sound = await loadSound();
  const parsed = parse(data);
  if (!parsed || typeof parsed !== "object")
    throw new WorkTransferError("invalid");
  const { kit } = sound.shareableSoundKit(parsed);
  if (sound.soundKitIsEmpty(kit)) throw new WorkTransferError("empty");
  return {
    kind: "sound",
    name: String(name || "").slice(0, 120) || tr("Мои звуки"),
    state: sound.soundKitWorkState(kit),
    lost: "",
  };
}

async function gunTemplate(kind, data, name) {
  const gun = await loadGun();
  const parsed = parse(data) || {};
  const slot = String(parsed.slot || "");
  if (!/^[a-z0-9_-]{1,48}$/.test(slot)) throw new WorkTransferError("invalid");
  let project;
  try {
    /* Тот же разбор, что у файла с диска: чужое поле или лишний слой через
       код не пройдут. Картинки снимаются и здесь — код мог собрать не этот
       Astral. */
    project = gun.shareableGunProject(
      gun.parseGunProject(parsed.project),
    ).project;
  } catch (error) {
    throw new WorkTransferError("invalid", String(error?.message || error));
  }
  if (name) project.name = String(name).slice(0, 80);
  return {
    kind,
    name: project.name,
    state: JSON.stringify({
      slot,
      project: JSON.parse(gun.serializeGunProject(project)),
    }),
    lost: "",
  };
}

/**
 * Код работы из «Моих работ» — снимка отдельного редактора или проекта
 * студии (`project` приносит вызывающий: список работ проекты не держит).
 */
export async function savedWorkCode(work, project = null) {
  const spec = WORK_KINDS[work?.workKind];
  if (!spec) throw new WorkTransferError("empty");
  if (spec.studio) return studioCode(project, work.workKind);
  if (spec.perSlot)
    return gunCode(work.state, { name: work.name, kind: work.workKind });
  if (spec.type === "effects")
    return effectsPartCode(work.state, spec.part, { name: work.name });
  if (spec.type === "timecycle")
    return skyCode(work.state, { name: work.name });
  if (spec.type === "lamps") return lampsCode(work.state, { name: work.name });
  if (spec.type === "screen-hits") return screenHitsCode(work.state, { name: work.name });
  if (spec.type === "gps") return gpsCode(work.state, { name: work.name });
  /* «Полоска HP» (задача 2 ТЗ 11.10.2026). */
  if (spec.type === "target-hp") return targetHpCode(work.state, { name: work.name });
  /* «Групповые метки» (задача 21 ТЗ 18.10.2026, вечер). */
  if (spec.type === "group-markers") return groupMarkersCode(work.state, { name: work.name });
  /* «Дым из-под колёс» (ТЗ 11.10.2026, вечер). */
  if (spec.type === "wheel-smoke") return wheelSmokeCode(work.state, { name: work.name });
  if (spec.type === "wallbang")
    return wallbangCode(work.state, { name: work.name });
  if (spec.type === "optimization")
    return optimizationCode(work.state, { name: work.name });
  if (spec.recolor) return recolorCode(work.workKind, work.state, { name: work.name });
  if (spec.type === "sound-kit")
    return soundCode(work.state, { name: work.name });
  return killCode(work.state, { name: work.name });
}

/* --- Шаблон из кода ------------------------------------------------- */

async function effectsTemplates(data, name, parts = null) {
  const effects = await loadEffects();
  let parsed;
  try {
    parsed = effects.parseProject({
      ...(parse(data) || {}),
      name: name || undefined,
    });
  } catch (error) {
    throw new WorkTransferError("invalid", String(error?.message || error));
  }
  const serialized = effects.serializeProject(parsed);
  const present = effectsPartsOf(serialized).filter(
    (part) => !parts || parts.includes(part),
  );
  if (!present.length) throw new WorkTransferError("empty");
  return present.map((part) => ({
    kind: EFFECTS_PART_KINDS[part],
    name: name || serialized.name,
    state: workStateFor(EFFECTS_PART_KINDS[part], serialized),
    lost: part === "impact" ? impactPictureLoss(effects, serialized) : "",
  }));
}

async function skyTemplate(data, name) {
  const sky = await loadSky();
  let parsed;
  try {
    parsed = sky.parseProject(
      JSON.stringify({ ...(parse(data) || {}), name: name || tr("Моё небо") }),
    );
  } catch (error) {
    throw new WorkTransferError("invalid", String(error?.message || error));
  }
  if (sky.projectIsEmpty(parsed)) throw new WorkTransferError("empty");
  return {
    kind: "sky",
    name: parsed.name,
    state: workStateFor("sky", parsed),
    lost: "",
  };
}

async function lampsTemplate(data, name) {
  const lamps = await loadLamps();
  const source = parse(data);
  if (!source || typeof source !== "object")
    throw new WorkTransferError("invalid", "Данные кода фонарей не читаются.");
  const parsed = lamps.normalizeLampProject({
    ...source,
    name: name || tr("Мои фонари"),
  });
  if (lamps.lampProjectIsVanilla(parsed)) throw new WorkTransferError("empty");
  return {
    kind: "lamps",
    name: parsed.name,
    state: workStateFor("lamps", parsed),
    lost: "",
  };
}

async function screenHitsTemplate(data, name) {
  const hits = await loadScreenHits();
  const source = parse(data);
  if (!source || typeof source !== "object") throw new WorkTransferError("invalid", "Данные кода следа на экране не читаются.");
  const parsed = hits.normalizeScreenHitsProject({ ...source, name: name || tr("Мой след на экране") });
  if (hits.screenHitsIsVanilla(parsed)) throw new WorkTransferError("empty");
  return {
    kind: "screen-hits",
    name: parsed.name,
    state: workStateFor("screen-hits", parsed),
    lost: "",
  };
}

async function gpsTemplate(data, name) {
  const gps = await loadGps();
  const source = parse(data);
  if (!source || typeof source !== "object") throw new WorkTransferError("invalid", "Данные кода меток и GPS не читаются.");
  const parsed = gps.normalizeGpsProject({ ...source, name: name || gps.GPS_DEFAULT_NAME });
  if (gps.gpsProjectIsStock(parsed)) throw new WorkTransferError("empty");
  return {
    kind: "gps",
    name: parsed.name,
    state: workStateFor("gps", parsed),
    lost: "",
  };
}

/* «Групповые метки» (задача 21 ТЗ 18.10.2026, вечер). */
async function groupMarkersTemplate(data, name) {
  const markers = await loadGroupMarkers();
  const source = parse(data);
  if (!source || typeof source !== "object") throw new WorkTransferError("invalid", "Данные кода групповых меток не читаются.");
  const parsed = markers.normalizeGroupMarkersProject({ ...source, name: name || tr(markers.GROUP_MARKERS_DEFAULT_NAME) });
  if (markers.groupMarkersProjectIsStock(parsed)) throw new WorkTransferError("empty");
  return {
    kind: "group-markers",
    name: parsed.name,
    state: workStateFor("group-markers", parsed),
    lost: "",
  };
}

/* «Полоска HP» (задача 2 ТЗ 11.10.2026). */
async function targetHpTemplate(data, name) {
  const contract = await loadTargetHp();
  const source = parse(data);
  if (!source || typeof source !== "object") throw new WorkTransferError("invalid", "Данные кода полоски HP не читаются.");
  const parsed = contract.normalizeTargetHpProject({ ...source, name: name || "Моя полоска HP" });
  if (contract.targetHealthIsStock(parsed)) throw new WorkTransferError("empty");
  return {
    kind: "target-hp",
    name: parsed.name,
    state: workStateFor("target-hp", parsed),
    lost: "",
  };
}

/* «Дым из-под колёс» (ТЗ 11.10.2026, вечер). */
async function wheelSmokeTemplate(data, name) {
  const contract = await loadWheelSmoke();
  const source = parse(data);
  if (!source || typeof source !== "object") throw new WorkTransferError("invalid", "Данные кода настройки автомобиля не читаются.");
  const parsed = contract.normalizeWheelSmokeProject({ ...source, name: name || "Моя настройка автомобиля" });
  if (contract.wheelSmokeIsStock(parsed)) throw new WorkTransferError("empty");
  return {
    kind: "wheel-smoke",
    name: parsed.name,
    state: workStateFor("wheel-smoke", parsed),
    lost: "",
  };
}

/**
 * Код работы «Оптимизация» (ТЗ 24.10.2026): слои Astral, только известные и без ступеней «Ухудшения текстур» (та же
 * проверка, что у блока сборки). Данные — `{ layers }`, как у кода оптимизации части редукса (`ASTRAL-OPT1`).
 */
export async function optimizationCode(state, { name = "" } = {}) {
  const { normalizeOptimizationDomain } =
    await import("@modovik/optimizer/bundle-domain.js");
  let block = null;
  try {
    block = normalizeOptimizationDomain({ layers: parse(state)?.layers });
  } catch {
    throw new WorkTransferError("invalid", "Слоёв оптимизации из работы нет в этой версии Astral.");
  }
  if (!block?.layers?.length) throw new WorkTransferError("empty");
  return {
    kind: "optimization",
    code: await encodeWorkCode("optimization", { name: name || tr("Оптимизация"), data: { layers: block.layers } }),
    lost: "",
  };
}

/* «Оптимизация» части редукса (17.10): слои Astral, только известные —
   та же проверка, что у блока сборки (`normalizeOptimizationDomain`). */
async function optimizationTemplate(data, name) {
  const { normalizeOptimizationDomain } =
    await import("@modovik/optimizer/bundle-domain.js");
  const source = parse(data);
  let block = null;
  try {
    block = normalizeOptimizationDomain({ layers: source?.layers });
  } catch {
    throw new WorkTransferError(
      "invalid",
      "Слоёв оптимизации из кода нет в этой версии Astral.",
    );
  }
  if (!block?.layers?.length) throw new WorkTransferError("empty");
  return {
    kind: "optimization",
    name: name || tr("Оптимизация"),
    state: { layers: block.layers },
    lost: "",
  };
}

async function wallbangTemplate(data, name) {
  const wallbang = await loadWallbang();
  const source = parse(data);
  if (!source || typeof source !== "object")
    throw new WorkTransferError(
      "invalid",
      "Данные кода прострелов не читаются.",
    );
  const parsed = wallbang.normalizeWallbangProject({
    ...source,
    name: name || tr("Мои прострелы"),
  });
  if (wallbang.wallbangProjectIsEmpty(parsed))
    throw new WorkTransferError("empty");
  return {
    kind: "wallbang",
    name: parsed.name,
    state: workStateFor("wallbang", parsed),
    lost: "",
  };
}

async function recolorTemplate(kind, data, name) {
  const { recolorProject } = await loadRecolor();
  const contract = recolorProject(kind);
  const source = parse(data);
  if (!contract || !source || typeof source !== "object")
    throw new WorkTransferError("invalid", "Данные кода набора не читаются.");
  const parsed = contract.normalize({ ...source, name: name || "" });
  return {
    kind,
    name: parsed.name,
    state: workStateFor(kind, parsed),
    lost: "",
  };
}

async function killTemplate(data, name) {
  const kill = await loadKill();
  let parsed;
  try {
    parsed = kill.parseKillEffectProject({
      ...(parse(data) || {}),
      ...(name ? { name } : {}),
    });
  } catch (error) {
    throw new WorkTransferError("invalid", String(error?.message || error));
  }
  /* Прежний код мог унести ссылку на картинку — у получателя её нет. */
  const shared = killWithoutPicture(kill, parsed);
  return {
    kind: "kill",
    name: shared.project.name,
    state: workStateFor("kill", shared.project),
    lost: "",
  };
}

/*
 * Проект студии из кода: заводской проект своего вида, в который легли
 * модули кода. Прогон через миграцию проекта — та же проверка, что у
 * проекта с диска: подсунуть через код чужой модуль или лишнее поле нельзя.
 * Картинки снимаются и здесь: код мог собрать не этот Astral.
 */
async function studioTemplate(kind, data, name) {
  const spec = WORK_KINDS[kind];
  const studio = await loadStudio();
  const modules = parse(data)?.modules;
  if (!modules || typeof modules !== "object")
    throw new WorkTransferError("invalid");
  const base = studio.createWorkshopProject({
    name: name || "",
    sourceModId: spec.sourceModId,
    sourceModName: name || "",
    enabledModules: [...spec.modules],
  });
  let project;
  try {
    project = studio.migrateWorkshopProject({
      ...base,
      name: name || base.name,
      modules: Object.fromEntries(
        spec.modules.map((id) => [
          id,
          modules[id] && typeof modules[id] === "object"
            ? modules[id]
            : base.modules[id],
        ]),
      ),
      assets: [],
      installations: [],
    });
  } catch (error) {
    throw new WorkTransferError("invalid", String(error?.message || error));
  }
  let lost = "";
  if (kind === "world-map") {
    const { describeSharedMapLoss, sharedWorldMap } = await loadWorldMap();
    const shared = sharedWorldMap(project);
    project.modules["world-map"] = shared.config;
    lost = describeSharedMapLoss(shared.report);
  } else if (kind === "minimap") {
    const stripped = minimapWithoutPictures(project.modules.minimap);
    project.modules.minimap = stripped.config;
    lost = stripped.lost;
  } else if (kind === "climbs") {
    const stripped = await climbsWithoutPicture(
      project.modules.climbs,
      project.id,
    );
    project.modules.climbs = stripped.module;
    lost = stripped.lost;
  }
  return { kind, name: project.name, project, lost };
}

/*
 * Прежняя ссылка студии (`MMAP-…`). Открыть её можно только там, где
 * лежит хранилище автора, — то есть почти никогда у друга. Попытка всё же
 * делается: на компьютере автора такой код по-прежнему открывается.
 */
async function cloudTemplate(found) {
  try {
    const { importWorkshopProjectCloud } = await import("../../../api.js");
    const payload = await importWorkshopProjectCloud(found.code);
    const source = payload?.project?.project;
    const moduleIds =
      source?.enabledModules || Object.keys(source?.modules || {});
    const kind = studioKindOfModules(moduleIds);
    if (!kind) throw new Error("empty");
    return studioTemplate(
      kind,
      { modules: source.modules },
      String(source.name || "").replace(/ · копия$/, ""),
    );
  } catch {
    throw new WorkTransferError("cloud", "cloud", { code: found.code });
  }
}

/**
 * Шаблоны из кода: `{ kind, format, code, templates }`.
 *
 * Шаблонов бывает несколько только у прежнего кода набора эффектов: он нёс
 * весь набор, а работа — одна часть. `accept` — виды, которые готов открыть
 * вызывающий (редактор трассеров открывает только трассеры); код другого
 * вида отвергается `wrong-kind` с его видом — окно скажет, куда его нести.
 */
export async function readWorkCode(text, { accept = null } = {}) {
  /* Короткий код — адрес: запись скачивается и дальше идёт тем же разбором, что
     вставленный текст. Без короткого кода сеть не трогается. */
  const full = await expandWorkCode(text);
  if (full !== text && isBuildCodeText(full))
    throw new WorkTransferError(
      "build-code",
      tr("Это код сборки: вставьте его в разделе «Сборки»."),
    );
  const decoded = await decodeWorkCode(full);
  const acceptable = (kind) => !accept || accept.includes(kind);
  let templates;
  if (decoded.format === "cloud") {
    if (!acceptable(decoded.kind))
      throw new WorkTransferError("wrong-kind", "wrong-kind", {
        kind: decoded.kind,
      });
    templates = [await cloudTemplate(decoded)];
  } else if (decoded.format === "fx1") {
    const parts = accept
      ? accept.map((kind) => WORK_KINDS[kind]?.part).filter(Boolean)
      : null;
    try {
      templates = await effectsTemplates(decoded.data, decoded.name, parts);
    } catch (error) {
      /* В прежнем коде нет части, которую ждёт редактор: называем то, что
         в нём есть, — трассеры, попадания или огонь. */
      if (error?.reason === "empty" && accept) {
        const present = effectsPartsOf(decoded.data);
        if (present.length)
          throw new WorkTransferError("wrong-kind", "wrong-kind", {
            kind: EFFECTS_PART_KINDS[present[0]],
          });
      }
      throw error;
    }
  } else {
    if (!acceptable(decoded.kind))
      throw new WorkTransferError("wrong-kind", "wrong-kind", {
        kind: decoded.kind,
      });
    const spec = WORK_KINDS[decoded.kind];
    if (spec.studio)
      templates = [
        await studioTemplate(decoded.kind, decoded.data, decoded.name),
      ];
    else if (spec.type === "effects")
      templates = await effectsTemplates(decoded.data, decoded.name, [
        spec.part,
      ]);
    else if (spec.type === "timecycle")
      templates = [await skyTemplate(decoded.data, decoded.name)];
    else if (spec.type === "lamps")
      templates = [await lampsTemplate(decoded.data, decoded.name)];
    else if (spec.type === "screen-hits")
      templates = [await screenHitsTemplate(decoded.data, decoded.name)];
    else if (spec.type === "gps")
      templates = [await gpsTemplate(decoded.data, decoded.name)];
    /* «Полоска HP» (задача 2 ТЗ 11.10.2026). */
    else if (spec.type === "target-hp")
      templates = [await targetHpTemplate(decoded.data, decoded.name)];
    /* «Групповые метки» (задача 21 ТЗ 18.10.2026, вечер). */
    else if (spec.type === "group-markers")
      templates = [await groupMarkersTemplate(decoded.data, decoded.name)];
    /* «Дым из-под колёс» (ТЗ 11.10.2026, вечер). */
    else if (spec.type === "wheel-smoke")
      templates = [await wheelSmokeTemplate(decoded.data, decoded.name)];
    else if (spec.type === "wallbang")
      templates = [await wallbangTemplate(decoded.data, decoded.name)];
    else if (spec.type === "optimization")
      templates = [await optimizationTemplate(decoded.data, decoded.name)];
    else if (spec.recolor)
      templates = [
        await recolorTemplate(decoded.kind, decoded.data, decoded.name),
      ];
    else if (spec.perSlot)
      templates = [await gunTemplate(decoded.kind, decoded.data, decoded.name)];
    else if (spec.type === "sound-kit")
      templates = [await soundTemplate(decoded.data, decoded.name)];
    else templates = [await killTemplate(decoded.data, decoded.name)];
  }
  return {
    kind: templates[0]?.kind || decoded.kind,
    format: decoded.format,
    code: decoded.code,
    templates,
  };
}

/**
 * Шаблоны — в «Мои работы». Проект студии ложится в хранилище проектов
 * своим, новым проектом; плитка студии при этом продолжает работать над
 * тем, над чем работала (`studio-current.js`).
 *
 * Имя работа приносит в коде; переименовать её можно на карточке.
 */
export async function addWorkTemplates(templates) {
  const added = [];
  for (const template of templates) {
    const title = String(template.name || "").trim();
    if (template.project) {
      const { upsertWorkshopProject } = await loadStudio();
      const saved = upsertWorkshopProject({
        ...template.project,
        name: title || template.project.name,
      });
      addStudioWork(saved.id, { origin: "code" });
      added.push({ kind: template.kind, projectId: saved.id });
    } else {
      const work = addTemplateWork({
        kind: template.kind,
        name: title,
        state: template.state,
      });
      added.push({ kind: template.kind, workId: work.id });
    }
  }
  return added;
}

export { WorkCodeError };
