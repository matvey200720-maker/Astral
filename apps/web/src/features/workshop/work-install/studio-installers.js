import { REPLACING_INSTALL_STEPS } from "../install-queue/index.js";
import { MINIMAP_INSTALL_KIND, installMinimap, minimapWarnings, minimapZoomNote } from "../install-queue/tasks/minimap.js";
import { RETICLE_INSTALL_KIND, installReticle } from "../install-queue/tasks/reticle.js";
import {
  WORLD_MAP_INSTALL_KIND,
  WORLD_MAP_INSTALL_STEPS,
  WORLD_MAP_STOCK_STEPS,
  installWorldMap,
  removeWorldMapInstalls,
} from "../install-queue/tasks/world-map.js";
import { recordProjectInstallation } from "../install-queue/project-installs.js";
import { rollBackInstall } from "../../library/retire-previous.js";
import { WORK_KINDS } from "../works/work-kinds.js";
import { addStudioWork } from "../works/workshop-works.js";
import { tr, trAny } from "../../../locales/ui.js";
import {
  withIslandNote,
  withPauseBlurNote,
  withRadarNote,
} from "../../../components/desktop/workshop/world-map-radar-note.js";
import { withBlipIconsNote } from "../../../components/desktop/workshop/world-map-icons-note.js";

export const STUDIO_INSTALL_KINDS = Object.freeze(["minimap", "reticle", "world-map"]);

export const canInstallStudioKind = (kind) => STUDIO_INSTALL_KINDS.includes(kind);

const MEMORY_KEY = "astral.build-works.studio.v1";
const RECORD_PREFIX = "studio:";
const WORK_ORIGIN = "build";
const STOCK_VARIANT = "stock";
const RESTART_TAIL = " — перезапустите GTA V";

// Что отличает три вида друг от друга; всё остальное у них общее.
const KIND_TABLE = {
  minimap: { editor: "Мини-карта", coverSlotId: "minimap", installKind: MINIMAP_INSTALL_KIND },
  reticle: { editor: "Прицел", coverSlotId: "crosshair", installKind: RETICLE_INSTALL_KIND },
  "world-map": { editor: "Большая карта", coverSlotId: "large-map", installKind: WORLD_MAP_INSTALL_KIND },
};

// Строки для doneText мини-карты, прицела и большой карты.
const DONE_TEXT = {
  minimap({ installed }) {
    const zoom = minimapZoomNote(installed);
    const head = zoom ? `${tr("Мини-карта в игре")}, ${zoom}` : tr("Мини-карта в игре");
    const warnings = minimapWarnings(installed);
    return warnings.length ? `${head}. ${[warnings].flat().join("; ")}` : head + RESTART_TAIL;
  },
  reticle: () => tr("Прицел в игре — перезапустите GTA V"),
  "world-map"({ tiles, radar, pauseBlur, island, icons, stock }) {
    if (stock) {
      return withBlipIconsNote(tr("В игре штатная карта Rockstar — перезапустите GTA V"), icons);
    }
    const plain = `Карта в игре: плиток записано ${tiles}${RESTART_TAIL}`;
    const notes = [
      [withRadarNote, radar],
      [withPauseBlurNote, pauseBlur],
      [withIslandNote, island],
      [withBlipIconsNote, icons],
    ];
    return notes.reduce((text, [addNote, value]) => addNote(text, value), trAny(plain) || plain);
  },
};

// Память «что уже поставили из сборки»: JSON-объект «ключ заявки → подпись».
function recallInstalled() {
  try {
    const parsed = JSON.parse(globalThis.localStorage.getItem(MEMORY_KEY));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeMemory(change) {
  try {
    globalThis.localStorage.setItem(MEMORY_KEY, JSON.stringify(change(recallInstalled())));
  } catch {
    // нет хранилища или оно полно: следующая «Установить» поставит работу заново
  }
}

const rememberInstalled = (key, signature) => writeMemory((memory) => ({ ...memory, [key]: signature }));

const forgetInstalled = (key) =>
  writeMemory((memory) => Object.fromEntries(Object.entries(memory).filter(([name]) => name !== key)));

// Последняя активная установка нужного вида в записи проекта или undefined.
const lastActiveInstall = (project, installKind) =>
  (project?.installations ?? []).findLast((one) => one.kind === installKind && one.status === "active");

// Настройки большой карты → данные для installWorldMap, пока всё тяжёлое грузится по требованию.
async function prepareWorldMap({ saved, report }) {
  const config = saved.modules["world-map"];
  const base = config.base;
  const [game, vector, baseModule, templates, render, measure, tones] = await Promise.all([
    import("../../../components/desktop/workshop/world-map-game.js"),
    import("@modovik/vector-map"),
    import("../../../components/desktop/workshop/world-map-base.js"),
    import("../../../components/desktop/workshop/world-map-templates.js"),
    import("../../../components/desktop/workshop/world-map-render.js"),
    import("../../../components/desktop/workshop/world-map-text-measure.js"),
    import("../../../components/desktop/workshop/world-map-label-tones.js"),
  ]);

  // 1. Плитки: у «игры» и «шаблона» они из игрока, у остальных основ их нет.
  let read = null;
  if (base.source === "game" || base.source === "template") {
    read = await game.loadWorldMapGameTiles({ chooseGame: false });
    if (!read) {
      throw new Error("Карта ещё не прочитана из игры: плиток большой карты нет в вашей GTA V — проверьте файлы игры.");
    }
  }
  const tiles = read ? read.tiles : [];
  const landTiles = read ? read.landTiles : [];
  const atlas = read?.atlas ?? (tiles.length ? vector.atlasFromTiles(tiles) : vector.DEFAULT_ATLAS);
  const geometry = read?.geometry ?? null;

  // 2. Шаблон и обработчик растра.
  const template = base.source === "template" ? templates.mapTemplateSource(base.templateId, atlas) : null;
  const processor = baseModule.createMapBaseProcessor();
  report?.({ step: "tiles", note: tr("Готовим подложку карты") });
  processor.loadTiles(tiles, landTiles);
  processor.setGeometry(geometry, atlas);
  processor.setTemplate(template);

  // 3. Геометрия шаблона; карта мода без неё не собирается.
  if (template) {
    const templateGeometry = await templates.loadMapTemplateGeometry(template.id, base.packOrigin);
    if (template.id === vector.MOD_PACK_TEMPLATE && !templateGeometry) {
      const title = base.packOrigin?.title || tr("из каталога");
      throw new Error(`Карта мода «${title}» недоступна: мода нет в каталоге или его файлы не прочитались.`);
    }
    processor.setTemplateGeometry(templates.geometryForConfig(templateGeometry, config));
  }
  processor.loadPicture(template ? template.image : null);
  processor.loadTexture(null);

  // 4. Сцены: источник данных установки, сцена для шрифтов и сцена для тонов подписей.
  if (vector.majesticMarksOn(config.majestic)) {
    await vector.loadMajesticMarks();
  }
  await vector.ensureLabelMeshes(config);
  const sceneContext = { atlas, tiles, landTiles, assets: {}, baseImage: null, template };
  const sceneFor = (extra) => vector.buildMapScene(config, { ...sceneContext, ...extra });
  const bare = { baseRaster: null, baseProcessed: false };

  const sourceScene = sceneFor(bare);
  try {
    await render.loadSceneFonts(sceneFor(bare));
    sceneContext.textAdvance = measure.measureTextAdvance;
  } catch {
    sceneContext.textAdvance = null;
  }

  const measureTones = async () => {
    const snapshot = await processor.preview(base, "draft");
    const href = snapshot?.href ?? null;
    const measured = await tones.computeLabelTones(sceneFor({ baseRaster: href, baseProcessed: Boolean(snapshot) }));
    if (href) {
      URL.revokeObjectURL(href);
    }
    return measured ?? null;
  };
  // тоны подписей — украшение: без них установка идёт дальше
  sceneContext.labelTones = await measureTones().catch(() => null);

  const payload = game.worldMapGamePayload({
    config,
    sceneContext,
    processor,
    source: sourceScene.source,
    loadRadarColours: game.loadWorldMapRadarColours,
    loadIsland: game.loadWorldMapIsland,
    radarGeometry: geometry,
  });
  const release = () => {
    try {
      processor.dispose();
    } finally {
      game.releaseWorldMapGameTiles(read);
    }
  };
  return { payload, release };
}

// Что делает «Установить» для каждого вида; результат установки возвращается как есть.
const INSTALLERS = {
  minimap: ({ saved, report }) =>
    installMinimap({ project: saved, configuration: saved.modules.minimap ?? {}, report }),
  reticle: ({ saved, report }) => installReticle({ project: saved, report }),
  async "world-map"(context) {
    const { payload, release } = await prepareWorldMap(context);
    try {
      return await installWorldMap({ ...payload, project: context.saved, report: context.report });
    } finally {
      release();
    }
  },
};

export async function studioRequest(kind, template, options = {}) {
  const incomingModules = template.project.modules;
  const create = options.create === undefined ? true : options.create;

  const moduleName = WORK_KINDS[kind].modules[0];
  const [store, apply] = await Promise.all([
    import("../../../components/desktop/workshop/workshop-project.js"),
    import("../../../components/desktop/workshop/workshop-studio/apply/studio-apply.js"),
  ]);
  const stock =
    kind === "world-map" &&
    (await import("../../../components/desktop/workshop/world-map-game.js")).worldMapIsStock(incomingModules["world-map"]);
  const variant = stock ? STOCK_VARIANT : "";
  const { editor, coverSlotId, installKind } = KIND_TABLE[kind];

  // Проект по коду работы: уже заведённый такой же или новый, сразу ставший работой.
  const incoming = store.migrateWorkshopProject(template.project);
  const sameWork = (one) =>
    one.sourceModId === incoming.sourceModId &&
    one.name === incoming.name &&
    apply.studioWorkSignature(one, moduleName) === apply.studioWorkSignature(incoming, moduleName);
  const enrol = () => {
    const created = store.upsertWorkshopProject({ ...incoming });
    addStudioWork(created.id, { origin: WORK_ORIGIN });
    return created;
  };
  const project = store.readWorkshopProjects().find(sameWork) ?? (create ? enrol() : null);

  const projectId = project ? project.id : template.project.id;
  const key = `${apply.studioInstallKind(moduleName)}:${projectId}`;
  const title = template.project.name || tr(editor);
  const storedProject = () => (project ? store.readWorkshopProjects().find((one) => one.id === project.id) : undefined);

  const spec = {
    key,
    signature: apply.studioWorkSignature(project ?? incoming, moduleName, variant),
    title,
    editor: tr(editor),
    coverSlotId,
    coverProjectId: projectId,
    steps: kind === "world-map" ? (stock ? WORLD_MAP_STOCK_STEPS : WORLD_MAP_INSTALL_STEPS) : REPLACING_INSTALL_STEPS,
    ...(stock ? { savedText: `«${title}» — возвращаем игре штатную карту` } : null),
    save: async () => project ?? enrol(),
    async run(context) {
      const result = await INSTALLERS[kind](context);
      rememberInstalled(key, spec.signature);
      return result;
    },
    doneText: DONE_TEXT[kind],
  };

  return {
    recordKey: RECORD_PREFIX + key,
    storageKey: key,
    installedSignature: () => null,
    isCurrent: () =>
      Boolean(lastActiveInstall(storedProject(), installKind)) && recallInstalled()[key] === spec.signature,
    async remove() {
      const stored = storedProject();
      const install = lastActiveInstall(stored, installKind);
      if (!install) {
        return;
      }
      if (kind === "world-map") {
        // карту ставит движок отдельным модом, точки восстановления у неё нет
        await removeWorldMapInstalls({ project: stored });
      } else {
        const gameRoot = typeof install.gameRoot === "string" && install.gameRoot ? { gameRoot: install.gameRoot } : null;
        await rollBackInstall({ install, ...gameRoot });
        recordProjectInstallation(stored.id, {
          ...install,
          status: "rolled-back",
          rolledBackAt: new Date().toISOString(),
        });
      }
      forgetInstalled(key);
    },
    spec,
  };
}
