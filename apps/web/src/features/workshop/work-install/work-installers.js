import { currentUiLanguage, tr } from "../../../locales/ui.js";
import { WORK_KINDS, gunSlotOf, installsAsEffects } from "../works/work-kinds.js";
import { readInstallRecord } from "../useInstallRecord.js";
import { applyKillEffectCustomization, applyTimecycleCustomization, desktopHost, setSkyRainbow, skyInstallerCurrent } from "../../../api.js";
import { REPLACING_INSTALL_STEPS, workSignature } from "../install-queue/index.js";
import { locateLegacyTarget } from "../install-queue/game-root.js";
import { installEditorWork } from "../install-queue/tasks/editor-work.js";
import { RECOLOR_INSTALL_KEYS, installRecolor } from "../install-queue/tasks/recolor.js";
import { LAMP_INSTALL_KEY, installLamps } from "../install-queue/tasks/lamps.js";
import { WALLBANG_INSTALL_KEY, installWallbang } from "../install-queue/tasks/wallbang.js";
import { SCREEN_HITS_INSTALL_KEY, installScreenHits } from "../install-queue/tasks/screen-hits.js";
import { GPS_INSTALL_KEY, gpsSignature, installGps } from "../install-queue/tasks/gps.js";
import { TARGET_HP_INSTALL_KEY, installTargetHp } from "../install-queue/tasks/target-hp.js";
import { GROUP_MARKERS_INSTALL_KEY, groupMarkersInstallSignature, installGroupMarkers } from "../install-queue/tasks/group-markers.js";
import { WHEEL_SMOKE_INSTALL_KEY, installWheelSmoke } from "../install-queue/tasks/wheel-smoke.js";

// ===== данные ==================================================================

const INSTALL_KEYS = {
  kill: "astral.kill-effect.install.v1",
  sky: "astral.timecycle.install.v1",
  effects: "astral.effects-studio.install.v1",
};
export const {
  kill: KILL_EFFECT_INSTALL_KEY,
  sky: TIMECYCLE_INSTALL_KEY,
  effects: EFFECTS_INSTALL_KEY,
} = INSTALL_KEYS;

const WHY = {
  needsEditor: "ставится из «Моих работ»: этой работе нужно окно её редактора",
  hitPicture: "своей картинки следа нет на этом компьютере",
  gpsIcon: "своей картинки значка метки нет на этом компьютере",
  markerPicture: "своей картинки метки нет на этом компьютере",
  skyStale: "Astral обновился — перезапустите его, чтобы поставить радугу и готовые облака",
  killMarker: "картинки знака на килле нет на этом компьютере",
  layerPictures: "свои картинки слоёв попаданий не переданы — ставится из «Моих работ»",
  soundHost: "звуки ставятся только в Astral Desktop",
  noSound: "в работе нет ни одного звука",
  skinRemoval: "скин снимается в мастерской оружия и одежды",
  skinHost: "скины ставятся только в Astral Desktop",
  noSkinProject: "в коде нет проекта скина",
  noPaint: "в скине нет покраски",
  noLayers: "в работе нет слоёв оптимизации",
};

// Наборы перекраски: вид и его слово (название по умолчанию и редактор).
const RECOLOR_WORDS = new Map([
  ["zones", "Запретные зоны"], ["factory", "Завод"], ["hangar", "Ангар"], ["mapping", "Маппинг"],
  ["water", "Вода"], ["vegetation", "Растительность"], ["arenas", "Арена"], ["megamall", "Мегамолл"],
  ["youtool", "Ашан / Икея"], ["vinewood", "Вайнвуд"], ["busstops", "Остановки"], ["mslzones", "МСЛ-зоны"],
  ["floatlogo", "Летающее лого"], ["airships", "Дирижабли"], ["shops", "Интерьеры"], ["billboards", "Билборды"],
  ["captzones", "Зоны каптов"], ["schedule", "Расписание"], ["flags", "Флаги"], ["atms", "Банкоматы"],
  ["projectinteriors", "Интерьеры проектов"], ["majesticinteriors", "Интерьеры Majestic RP"],
  ["roads", "Дороги"], ["fonts", "Шрифты"],
]);
const STUDIO_KINDS = ["minimap", "reticle", "world-map"];
const SKIN_EDITORS = { weapon: "Оружие", clothing: "Одежда" };

// Одиночные виды: слово по умолчанию, ключ записи, имя в подписи, где слово не переводится.
const SINGLE_WORDS = new Map([
  ["lamps", "Фонари"], ["screen-hits", "Эффекты попадания на экране"], ["gps", "Метки и GPS"],
  ["target-hp", "Полоска HP"], ["group-markers", "Групповые метки"], ["wheel-smoke", "Настройка автомобиля"],
  ["wallbang", "Прострелы"], ["sky", "Таймциклы"], ["kill", "Килл-эффект"],
]);
const NOT_TRANSLATED = new Set(["target-hp", "wheel-smoke"]);
const STRICT_STATE = new Set(["sky", "kill"]);
const RECORD_KEYS = {
  lamps: LAMP_INSTALL_KEY,
  "screen-hits": SCREEN_HITS_INSTALL_KEY,
  gps: GPS_INSTALL_KEY,
  "target-hp": TARGET_HP_INSTALL_KEY,
  "group-markers": GROUP_MARKERS_INSTALL_KEY,
  "wheel-smoke": WHEEL_SMOKE_INSTALL_KEY,
  wallbang: WALLBANG_INSTALL_KEY,
  sky: INSTALL_KEYS.sky,
  kill: INSTALL_KEYS.kill,
};
const SIGNATURE_BAGS = {
  lamps: "lamps", "screen-hits": "screenHits", "target-hp": "targetHp", "wheel-smoke": "wheelSmoke", wallbang: "wallbang",
};

// Порядок полей заявки и её spec.
const REQUEST_FIELDS = [
  "recordKey", "storageKey", "installedSignature", "alsoRemove", "spec",
  "isCurrent", "enqueue", "remove", "sharedParts", "soleInstalled",
];
const SPEC_FIELDS = [
  "key", "signature", "title", "editor", "coverSlotId", "coverState", "steps", "savedText", "run", "doneText",
];

// ===== помощники ===============================================================

export class WorkInstallUnsupported extends Error {
  constructor(reason) {
    super(reason);
    this.name = "WorkInstallUnsupported";
    this.reason = reason;
  }
}

const demand = (condition, reason) => {
  if (!condition) throw new WorkInstallUnsupported(reason);
};

const looseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

async function attempt(job) {
  try {
    return await job();
  } catch {
    return null;
  }
}

// Общий разбор состояния работы: строка — JSON, объект — как есть, неудача — пустой объект.
const workState = (state) => (state && typeof state === "object" ? state : looseJson(state)) || {};
const textOf = (state) => (typeof state === "string" ? state : JSON.stringify(state));
// Удары снимаются, если в наборе есть хоть одно включённое значение, а не просто ключ.
const hasTruthyValue = (group) => Object.values(group || {}).some(Boolean);
const hasKeys = (group) => Object.keys(group || {}).length > 0;
const stepOf = (id, label, hint) => ({ id, label, hint });
const mergeSpaces = async (...loaders) => Object.assign({}, ...(await Promise.all(loaders.map((load) => load()))));

// Поля идут строго в заданном порядке; чего нет в наборе, того нет и в объекте.
const arrange = (order, bag) =>
  order.reduce((out, name) => (name in bag ? { ...out, [name]: bag[name] } : out), {});

function fullRequest(plan) {
  const { kind, recordKey, title } = plan;
  const storageKey = plan.storageKey ?? recordKey;
  const spec = arrange(SPEC_FIELDS, {
    key: storageKey,
    signature: plan.signature,
    title,
    editor: plan.editor,
    coverSlotId: WORK_KINDS[kind]?.slotId || "",
    coverState: textOf(plan.state),
    steps: REPLACING_INSTALL_STEPS,
    savedText: `Ставим «${title}» в игру`,
    run: plan.run,
    doneText: plan.doneText ?? (() => `«${title}» установлена в GTA V`),
  });
  return arrange(REQUEST_FIELDS, {
    recordKey,
    storageKey,
    installedSignature: plan.installedSignature,
    spec,
    ...plan.extras,
  });
}

// Заявки без run и шагов: очередь ставит их сама через enqueue.
const queuedRequest = (plan) =>
  arrange(REQUEST_FIELDS, {
    recordKey: plan.recordKey,
    storageKey: plan.storageKey,
    installedSignature: () => null,
    spec: arrange(SPEC_FIELDS, {
      key: plan.storageKey,
      signature: plan.signature,
      title: plan.title,
      editor: plan.editor,
    }),
    ...plan.members,
  });

// Подпись установленного по записи: разбор той же дорогой, что у заявки; сбой разбора — null.
const fromRecord = (read, stamp, strict = false) => (record) => {
  const text = record?.installedState;
  if (!text || (strict && typeof text !== "string")) return null;
  try {
    return stamp(read(text));
  } catch {
    return null;
  }
};

// Радуга неба снимается вне записи установки.
async function removeRainbow() {
  const host = desktopHost();
  if (!host || !host.setSkyRainbow) return false;
  const target = await locateLegacyTarget();
  const answer = await setSkyRainbow({ gameRoot: target.path, enabled: false });
  if (answer?.status === "failed") throw new Error(answer.error || tr("Радугу снять не удалось."));
  try {
    globalThis.localStorage.removeItem("astral.timecycle.rainbow.v1");
  } catch {
    // флаг не стёрся — радуга уже снята, падать не из-за чего
  }
  return answer?.status === "removed";
}

// ===== наборы перекраски =========================================================

async function recolorPlan({ kind, template }) {
  const contract = await import("@modovik/climb-contract/recolor/projects").then((space) => space.recolorProject(kind));
  demand(contract, WHY.needsEditor);
  const read = (text) => contract.normalize(contract.parse(text));
  const stamp = (project) => workSignature({ [kind]: contract.signature(project) });
  const project = read(template.state);
  const state = contract.serialize(project);
  const word = RECOLOR_WORDS.get(kind);
  const send = (extra) => installRecolor({ set: kind, project, state, ...extra });
  return fullRequest({
    kind,
    recordKey: RECOLOR_INSTALL_KEYS[kind],
    title: project.name || word,
    editor: word,
    signature: stamp(project),
    state,
    run: ({ report, signal, operationId }) => send({ report, signal, operationId }),
    installedSignature: fromRecord(read, stamp),
  });
}

// ===== одиночные виды ================================================================

// Нормализующие договоры (и килл-эффект) читают разобранное состояние; пустое — это {}.
const lenient = (normalize) => (text) => normalize(workState(text));

// Как читать состояние, как его писать и чем подписывать — по виду.
const CODECS = {
  lamps: async () => {
    const c = await import("@modovik/street-light-contract/lamps");
    return { read: lenient(c.normalizeLampProject), write: c.serializeLampProject, mark: c.lampProjectSignature };
  },
  wallbang: async () => {
    const c = await import("@modovik/climb-contract/wallbang");
    return {
      read: lenient(c.normalizeWallbangProject),
      write: c.serializeWallbangProject,
      mark: c.wallbangProjectSignature,
    };
  },
  "screen-hits": async () => {
    const c = await import("@modovik/kill-effects/screen-hits.js");
    return {
      read: lenient(c.normalizeScreenHitsProject),
      write: c.serializeScreenHitsProject,
      mark: c.screenHitsSignature,
    };
  },
  "target-hp": async () => {
    const c = await import("@modovik/reticle-contract");
    return { read: c.parseTargetHpProject, write: c.serializeTargetHpProject, mark: c.targetHpSignature };
  },
  "wheel-smoke": async () => {
    const c = await import("@modovik/ptfx-studio/wheel-smoke.js");
    return { read: c.parseWheelSmokeProject, write: c.serializeWheelSmokeProject, mark: c.wheelSmokeSignature };
  },
  gps: async () => {
    const c = await import("../gps-editor/gps-project.js");
    return { read: c.parseGpsProject, write: c.serializeGpsProject, workOf: c.gpsWorkOf };
  },
  "group-markers": async () => {
    const c = await import("../group-markers-editor/group-markers-project.js");
    return { read: c.parseGroupMarkersProject, write: c.serializeGroupMarkersProject, workOf: c.groupMarkersWorkOf };
  },
  sky: async () => {
    const c = await import("@modovik/timecycle");
    return { read: c.parseProject, write: c.serializeProject };
  },
  kill: async () => {
    const c = await import("@modovik/kill-effects");
    return { read: (text) => c.parseKillEffectProject(workState(text)), write: (project) => JSON.stringify(project) };
  },
};

// Подпись версии: у большинства — по имени из таблицы, у остальных своя.
const CUSTOM_STAMPS = {
  gps: (codec, project) => workSignature({ gps: gpsSignature(codec.workOf(project)) }),
  "group-markers": (codec, project) =>
    workSignature({ groupMarkers: groupMarkersInstallSignature(codec.workOf(project)) }),
  sky: (codec, project) => workSignature({ sky: codec.write(project) }),
  kill: (_codec, project) => workSignature(project),
};
const stampOf = (kind, codec, project) =>
  kind in CUSTOM_STAMPS
    ? CUSTOM_STAMPS[kind](codec, project)
    : workSignature({ [SIGNATURE_BAGS[kind]]: codec.mark(project) });

// Что нужно найти до сборки заявки: картинки, кадры; без них работу поставить нельзя.
const GATHERS = {
  "screen-hits": async (project) => {
    if (project.shape !== "own") return { picture: null };
    const pictures = await import("../screen-hits-editor/screen-hit-pictures.js");
    const picture = await attempt(() => pictures.screenHitPicturePng(project.own.asset));
    demand(picture, WHY.hitPicture);
    return { picture };
  },
  gps: async (project, codec) => {
    const { marker } = codec.workOf(project);
    if (marker?.icon !== "custom") return { picture: null };
    const icons = await import("../gps-editor/gps-icons.js");
    const picture = await attempt(() => icons.gpsIconPicturePng(marker.assetId));
    demand(picture, WHY.gpsIcon);
    return { picture };
  },
  "group-markers": async (project, codec) => {
    const pictures = await import("../group-markers-editor/group-markers-pictures.js");
    const { pictures: found, missing } = await pictures.groupMarkerPicturesFor(codec.workOf(project));
    demand(!missing?.length, WHY.markerPicture);
    return { pictures: found };
  },
  sky: async (project) => {
    const wantsExtras = project.look?.weather?.rainbow || project.look?.clouds?.template;
    demand(!wantsExtras || (await skyInstallerCurrent()), WHY.skyStale);
    return {};
  },
  kill: async (project) => {
    if (!project.marker?.enabled) return { frames: null };
    const markerFrames = await import("../../../components/desktop/workshop/kill-marker-frames.js");
    const frames = await markerFrames.killMarkerSequence(project.marker.source);
    demand(frames?.canvases?.length, WHY.killMarker);
    return { frames, toInstallFrames: markerFrames.killMarkerInstallFrames };
  },
};

// Небо и килл-эффект ставятся через installEditorWork; различаются только параметрами.
const EDITOR_JOBS = {
  sky: {
    editor: "timecycle",
    storageKey: INSTALL_KEYS.sky,
    send: ({ project, gameRoot }) => applyTimecycleCustomization({ project, gameRoot }),
    describe: (result) => ({ files: result?.files?.length ?? 0 }),
  },
  kill: {
    editor: "kill-effect",
    storageKey: INSTALL_KEYS.kill,
    send: async ({ project, gameRoot, found }) =>
      applyKillEffectCustomization({
        project,
        gameRoot,
        markerFrames: found.frames ? await found.toInstallFrames(found.frames) : [],
      }),
    describe: (result) => ({
      fields: result?.fields ?? 0,
      markerSignature: result?.marker?.signature ?? null,
    }),
  },
};
const viaEditorWork = (job) => ({ project, state, found }) => ({ report }) =>
  installEditorWork({
    editor: job.editor,
    storageKey: job.storageKey,
    state,
    report,
    apply: async () => job.send({ project, gameRoot: (await locateLegacyTarget()).path, found }),
    details: job.describe,
  });

const reportOnly = (install) => ({ project, state }) => ({ report }) => install({ project, state, report });

const LAUNCHES = {
  lamps: reportOnly(installLamps),
  wallbang: reportOnly(installWallbang),
  "target-hp": reportOnly(installTargetHp),
  "wheel-smoke": reportOnly(installWheelSmoke),
  "screen-hits": ({ project, state, found }) => ({ report }) =>
    installScreenHits({ project, state, picture: found.picture, report }),
  gps: ({ project, state, found, codec }) => ({ report }) =>
    installGps({ work: codec.workOf(project), state, picture: found.picture, report }),
  "group-markers": ({ project, state, found, codec }) => ({ report }) => {
    // прежний проект читается в момент установки: запись могла смениться после подготовки
    const record = readInstallRecord(GROUP_MARKERS_INSTALL_KEY);
    return installGroupMarkers({
      work: codec.workOf(project),
      state,
      previous: record ? codec.workOf(codec.read(record.installedState)) : null,
      pictures: found.pictures,
      report,
    });
  },
  sky: viaEditorWork(EDITOR_JOBS.sky),
  kill: viaEditorWork(EDITOR_JOBS.kill),
};
const EXTRAS = { sky: () => ({ alsoRemove: removeRainbow }) };

async function singlePlan({ kind, template }) {
  const codec = await CODECS[kind]();
  const project = codec.read(template.state);
  const state = codec.write(project);
  const gather = GATHERS[kind] || (async () => ({}));
  const found = await gather(project, codec);
  const word = SINGLE_WORDS.get(kind);
  const label = NOT_TRANSLATED.has(kind) ? word : tr(word);
  const stamp = (value) => stampOf(kind, codec, value);
  return fullRequest({
    kind,
    recordKey: RECORD_KEYS[kind],
    title: project.name || label,
    editor: label,
    signature: stamp(project),
    state,
    run: LAUNCHES[kind]({ project, state, found, codec }),
    installedSignature: fromRecord(codec.read, stamp, STRICT_STATE.has(kind)),
    extras: EXTRAS[kind]?.(),
  });
}

// ===== эффекты: трассеры, попадания, огонь ==============================================

const IMPACT_PART = "impact";

class EffectsWork {
  constructor(tools, context) {
    const { entry, kind, template } = context;
    this.tools = tools;
    this.kind = kind;
    this.part = WORK_KINDS[kind].part;
    this.draft = tools.fx.parseProject(workState(template.state));
    this.bundle = this.assemble(readInstallRecord(EFFECTS_INSTALL_KEY));
    this.layerKeys = this.layerKeysOf(this.bundle);

    const received = this.layerKeys.map((key) => [key, entry?.pictures?.[key]]);
    demand(
      received.every(([, picture]) => picture && picture.base64),
      WHY.layerPictures,
    );
    this.fingerprints = Object.fromEntries(received.map(([key, picture]) => [key, picture.key]));
    this.uploads = Object.fromEntries(
      received.map(([key, picture]) => [key, { base64: picture.base64, key: picture.key }]),
    );
    this.title = this.draft.name || this.part;
  }

  assemble(record) {
    const { eff } = this.tools;
    return eff.composeEffectsInstall({
      draft: this.draft,
      installed: eff.installedEffects(record),
      part: this.part,
    });
  }

  layerKeysOf(project) {
    if (this.part !== IMPACT_PART) return [];
    const { eff, fx } = this.tools;
    return eff.uploadLayers(project).map((slot) => fx.layerPictureKey(slot.zone, slot.layer));
  }

  signatureOf(bundle, keys, fingerprintOf) {
    const pictures = keys.map((key) => `${key}=${fingerprintOf(key) || ""}`).join(";");
    return workSignature({ part: this.part, set: bundle[this.part], pictures });
  }

  installedSignature(record) {
    const { known, project } = this.tools.eff.installedEffects(record);
    if (!known) return null;
    return this.signatureOf(project, this.layerKeysOf(project), (key) => record?.installedPictures?.[key]);
  }

  isSoleInstalled(record) {
    const { known, project } = this.tools.eff.installedEffects(record);
    if (!known || !project) return false;
    const parts = this.tools.library.installedEffectsParts(project);
    return parts.length === 1 && parts[0] === this.part;
  }

  async launch({ report }) {
    const record = readInstallRecord(EFFECTS_INSTALL_KEY);
    const fresh = this.assemble(record);
    const target = await locateLegacyTarget();
    return this.tools.eff.installEffectsSet({
      gameRoot: target.path,
      pictures: this.uploads,
      record,
      report,
      set: fresh,
    });
  }

  request() {
    const { fx, labels } = this.tools;
    return fullRequest({
      doneText: (outcome) => `Эффекты установлены: ${outcome?.result?.files?.length ?? 0} файлов`,
      editor: labels.partsLabel(this.bundle) || this.title,
      extras: {
        sharedParts: true,
        soleInstalled: (record) => this.isSoleInstalled(record),
      },
      installedSignature: (record) => this.installedSignature(record),
      kind: this.kind,
      recordKey: EFFECTS_INSTALL_KEY,
      run: (queueContext) => this.launch(queueContext),
      signature: this.signatureOf(this.bundle, this.layerKeys, (key) => this.fingerprints[key]),
      state: fx.serializeProject(this.draft),
      storageKey: `${EFFECTS_INSTALL_KEY}:${this.part}`,
      title: this.title,
    });
  }
}

async function effectsPlan(context) {
  const [fx, eff, library, labels] = await Promise.all([
    import("@modovik/ptfx-studio"),
    import("../../../components/desktop/workshop/effects-install-state.js"),
    import("../../../workshop-library.js"),
    import("../../../components/desktop/workshop/effects-parts.js"),
  ]);
  return new EffectsWork({ fx, eff, library, labels }, context).request();
}

// ===== звуки ============================================================================

class SoundWork {
  constructor(host, apply, kit) {
    Object.assign(this, { host, apply, kit });
  }

  waiting() {
    return this.apply.soundKitPending(this.kit, this.apply.soundKitInstalls());
  }

  isCurrent() {
    return this.apply.soundKitPendingCount(this.waiting()) === 0;
  }

  enqueue({ notify }) {
    const { weapons, hits, mix } = this.waiting();
    // снятий в очередь работа не кладёт никогда
    const pending = {
      weapons,
      removals: [],
      hits: hits === "install" ? "install" : null,
      mix: mix === "install" ? "install" : null,
    };
    this.apply.queueSoundKit({ host: this.host, kit: this.kit, pending, notify });
    return this.apply.soundKitPendingCount(pending);
  }

  // Снимается только то, что поставила работа: стволы, затем попадания, затем микс.
  async remove() {
    const { host, apply, kit } = this;
    const steps = [
      ...Object.keys(kit.weapons || {}).map((weaponId) => () => apply.removeWeaponSound({ host, weaponId })),
      ...(hasTruthyValue(kit.hits) ? [() => apply.removeHitSounds({ host })] : []),
      ...(hasKeys(kit.mix?.levels) ? [() => apply.removeSoundMix({ host })] : []),
    ];
    for (const step of steps) await step();
  }
}

async function soundPlan({ template }) {
  const host = desktopHost();
  demand(host, WHY.soundHost);
  const [model, apply] = await Promise.all([
    import("../../../components/desktop/workshop/sound/sound-kit-model.js"),
    import("../../../components/desktop/workshop/sound/sound-kit-apply.js"),
  ]);
  const kit = model.soundKitFromWorkState(template.state);
  demand(!model.soundKitIsEmpty(kit), WHY.noSound);
  const work = new SoundWork(host, apply, kit);
  const word = tr("Звуки");
  return queuedRequest({
    editor: word,
    members: {
      enqueue: (args) => work.enqueue(args),
      isCurrent: () => work.isCurrent(),
      remove: () => work.remove(),
    },
    recordKey: model.SOUND_KIT_INSTALL_KEY,
    signature: workSignature(kit),
    storageKey: model.SOUND_KIT_INSTALL_KEY,
    title: template.name || word,
  });
}

// ===== скины оружия и одежды ======================================================================

// Что делать с ответом студии скинов; неизвестный статус — обычная ошибка.
const SKIN_VERDICTS = new Map([
  ["queued", () => 1],
  [
    "unsupported",
    (reason) => {
      throw new WorkInstallUnsupported(reason);
    },
  ],
]);

async function skinPlan({ kind, template, create }) {
  demand(create, WHY.skinRemoval);
  demand(desktopHost(), WHY.skinHost);
  const saved = looseJson(template.state);
  const slot = saved && typeof saved === "object" ? gunSlotOf(saved) : "";
  demand(slot && saved.project, WHY.noSkinProject);

  const studio = await import("@modovik/gun-studio");
  const project = studio.parseGunProject(saved.project);
  demand(studio.projectTouchesTextures(project), WHY.noPaint);

  const title = template.name || project.name || WORK_KINDS[kind]?.part || tr("Скин");
  const recordKey = `astral.gun-studio.install:${slot}`;
  const enqueue = async ({ notify }) => {
    const gunHost = await import("../../../components/desktop/workshop/gun/gun-skin-host.js");
    const snapshot = JSON.parse(studio.serializeGunProject(project));
    const answer = await gunHost.installGunSkinHeadless({
      kind,
      name: title,
      notify,
      project: snapshot,
      slot,
    });
    const verdict = SKIN_VERDICTS.get(answer.status);
    if (verdict) return verdict(answer.reason);
    throw new Error(answer.reason || tr("скин не встал в очередь"));
  };

  return queuedRequest({
    editor: tr(SKIN_EDITORS[kind]),
    members: { enqueue },
    recordKey,
    signature: workSignature({ slot, model: project.modelId, project }),
    storageKey: recordKey,
    title,
  });
}

// ===== оптимизация ===========================================================================

async function optimizationPlan({ template }) {
  const requested = Array.isArray(template.state?.layers) ? template.state.layers : [];
  demand(requested.length > 0, WHY.noLayers);

  const [layerIds, levelInfo, syncApi, queueApi] = await Promise.all([
    import("@modovik/optimizer/layer-ids.js"),
    import("@modovik/optimizer/texture-levels.js"),
    mergeSpaces(
      () => import("../../../components/desktop/workshop/optimizer/optimizer-sync.js"),
      () => import("../install-queue/tasks/optimization-set.js"),
    ),
    import("../install-queue/index.js"),
  ]);

  const valuesOf = (listing) =>
    listing && typeof listing[Symbol.iterator] === "function" ? [...listing] : Object.values(listing ?? {});
  const skipped = new Set(valuesOf(levelInfo.TEXTURE_LEVEL_LAYERS));
  const allowed = new Set(valuesOf(layerIds.OPTIMIZATION_LAYER_IDS).filter((id) => !skipped.has(id)));
  const strangers = requested.filter((layer) => !allowed.has(layer));
  demand(
    strangers.length === 0,
    tr("в этой версии Astral нет слоёв оптимизации: {0}").replace("{0}", () => strangers.join(", ")),
  );

  const signature = requested.join(",");
  const storageKey = `astral.optimization.work.${workSignature(signature)}`;
  const word = tr("Оптимизация");
  const title = template.name || word;
  const switchLayers = (on) =>
    syncApi.syncOptimizationLayers(Object.fromEntries(requested.map((layer) => [layer, on])));

  return queuedRequest({
    editor: word,
    members: {
      enqueue() {
        const language = currentUiLanguage();
        const names = requested.map((layer) => layerIds.optimizationLayerTitle(layer, language));
        queueApi.enqueueWorkshopInstall({
          editor: word,
          key: storageKey,
          run: () => switchLayers(true),
          signature,
          steps: [
            stepOf("prepare", tr("Подготовка"), tr("Astral проверяет, что игра закрыта, и сверяет то, что уже стоит")),
            stepOf(
              "layers",
              names.join(", "),
              tr("Слои оптимизации Astral из сборки — вместе с теми, что уже стоят, одним набором"),
            ),
          ],
          title,
        });
        return 1;
      },
      isCurrent() {
        const installed = syncApi.installedOptimizationLayers();
        return requested.every((layer) => installed.has(layer));
      },
      async remove() {
        return switchLayers(false);
      },
    },
    recordKey: layerIds.OPTIMIZATION_SET_RECORD_KEY,
    signature,
    storageKey,
    title,
  });
}

// ===== студийные виды ===============================================================================

// Заявку студийных видов собирает studio-installers.js.
async function studioPlan({ kind, template, create }) {
  const studio = await import("./studio-installers.js");
  return studio.studioRequest(kind, template, { create });
}

// ===== выбор установщика ==============================================================================

// Точное совпадение имени: Map не приводит ключ к строке, поэтому массив из одной строки не подходит.
const BUILDERS = new Map([
  ...[...RECOLOR_WORDS.keys()].map((kind) => [kind, recolorPlan]),
  ...STUDIO_KINDS.map((kind) => [kind, studioPlan]),
  ...Object.keys(SKIN_EDITORS).map((kind) => [kind, skinPlan]),
  ...[...SINGLE_WORDS.keys()].map((kind) => [kind, singlePlan]),
  ["sound", soundPlan],
  ["optimization", optimizationPlan],
]);

// Эффекты определяются по типу записи справочника, а справочник спрашивается по приведённому ключу.
const installerFor = (kind) => BUILDERS.get(kind) || (installsAsEffects(kind) ? effectsPlan : null);

export const canInstallWorkKind = (kind) => installerFor(kind) !== null;

export async function prepareWorkInstall(kind, template, options = {}) {
  const create = options.create === undefined ? true : options.create;
  const entry = options.entry === undefined ? null : options.entry;
  const build = installerFor(kind);
  demand(build, WHY.needsEditor);
  return build({ kind, template, create, entry });
}
