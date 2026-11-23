import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  buildMegaMallDesignArchive,
  canonicalJson,
  getMegaMallProfile,
  hashMegaMallDesign,
  inspectMegaMallDesignArchive,
  listMegaMallProfiles,
  normalizeMegaMallDesign,
} from "@modovik/mega-mall-contract";
import {
  compileMegaMallSurface,
  renderMegaMallSurface,
} from "@modovik/mega-mall-renderer";
import {
  createMegaMallSourceStore,
  MEGA_MALL_SOURCE_STORE_LIMITS,
} from "./mega-mall-source-store.js";
import { buildingIdForProfile } from "./mega-mall-building-model.js";

const PLAN_TTL_MS = 10 * 60 * 1000;

function exactObject(value, required, optional, pathLabel) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${pathLabel}: ожидался объект.`);
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${pathLabel}.${key}: неизвестное поле.`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${pathLabel}.${key}: поле обязательно.`);
    }
  }
  return value;
}

function boundedProjectId(value) {
  const result = String(value || "");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,127}$/.test(result)) {
    throw new TypeError("Некорректный Mega Mall projectId.");
  }
  return result;
}

function revisionMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("assetRevisions: ожидался объект.");
  }
  const result = new Map();
  for (const [assetId, revision] of Object.entries(value)) {
    if (!/^[a-z0-9][a-z0-9._:-]{0,95}$/.test(assetId)) {
      throw new TypeError("assetRevisions: некорректный assetId.");
    }
    if (
      !Number.isInteger(revision) ||
      revision < 1 ||
      revision > 2_147_483_647
    ) {
      throw new TypeError(`assetRevisions.${assetId}: некорректная ревизия.`);
    }
    result.set(assetId, revision);
  }
  return result;
}

function binaryResult(bytes) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
}

export function createMegaMallEditorService({
  sourceStore,
  chooseSource,
  chooseProjectArchive,
  saveProjectArchive,
  installAdapter = null,
  buildingModels = null,
  sectionModels = null,
  now = () => Date.now(),
} = {}) {
  if (!sourceStore)
    throw new TypeError("Mega Mall editor требует sourceStore.");
  const plans = new Map();

  const prunePlans = () => {
    const timestamp = now();
    for (const [planId, plan] of plans) {
      if (plan.expiresAt <= timestamp || plan.used) plans.delete(planId);
    }
  };

  const readAssets = async ({
    projectId,
    design,
    assetRevisions,
    surfaceId = null,
  }) => {
    const revisions = revisionMap(assetRevisions);
    const reachable = new Set();
    for (const surface of design.surfaces) {
      if (surfaceId && surface.surfaceId !== surfaceId) continue;
      for (const layer of surface.layers) {
        if (["image", "emblem"].includes(layer.type))
          reachable.add(layer.assetId);
      }
    }
    const descriptors = new Map(
      design.assets.map((asset) => [asset.id, asset]),
    );
    const assets = [];
    for (const assetId of [...reachable].sort()) {
      const descriptor = descriptors.get(assetId);
      const expectedRevision = revisions.get(assetId);
      if (!descriptor || !expectedRevision) {
        throw new TypeError(
          `Asset ${assetId} не имеет descriptor/revision envelope.`,
        );
      }
      const owned = await sourceStore.read({
        projectId,
        assetId,
        expectedSha256: descriptor.sha256,
        expectedRevision,
      });
      if (canonicalJson(owned.descriptor) !== canonicalJson(descriptor)) {
        throw new TypeError(`Asset ${assetId} не совпадает с проектом.`);
      }
      assets.push(owned);
    }
    return assets;
  };

  return Object.freeze({
    async capabilities() {
      const installed = installAdapter
        ? await installAdapter.installed()
        : Object.freeze([]);
      return Object.freeze({
        format: "astral.mega-mall-capabilities",
        version: 1,
        profiles: listMegaMallProfiles(),
        sourceLimits: MEGA_MALL_SOURCE_STORE_LIMITS,
        installAdapter: Boolean(installAdapter),
        installableProfiles: installAdapter
          ? listMegaMallProfiles({
              installableOnly: true,
            }).map((profile) => profile.id)
          : [],
        installed,
        cloudCustomAssets: false,
        buildingModel: Boolean(buildingModels),
        /* Секции карты целиком — здание вынимается из игры не одной
           моделью, а кварталом с расстановкой и LOD-подменами. */
        sectionModel: Boolean(sectionModels),
        sections: sectionModels ? sectionModels.sections() : Object.freeze([]),
        buildingModelProfiles: buildingModels
          ? listMegaMallProfiles()
              .filter((profile) =>
                buildingModels.supports(buildingIdForProfile(profile.id)),
              )
              .map((profile) => profile.id)
          : Object.freeze([]),
      });
    },

    async importSource(input) {
      exactObject(input, ["projectId", "rights"], [], "importSource");
      const projectId = boundedProjectId(input.projectId);
      const selected = await chooseSource?.();
      if (!selected) return null;
      return sourceStore.importFile({
        projectId,
        filePath: selected,
        rights: input.rights,
      });
    },

    async listSources(input) {
      exactObject(input, ["projectId"], [], "listSources");
      return sourceStore.list(boundedProjectId(input.projectId));
    },

    async releaseSource(input) {
      exactObject(input, ["projectId", "assetId"], [], "releaseSource");
      return sourceStore.release({
        projectId: boundedProjectId(input.projectId),
        assetId: String(input.assetId || ""),
      });
    },

    async exportProject(input) {
      exactObject(
        input,
        ["projectId", "design", "assetRevisions", "expectedDesignHash"],
        [],
        "exportProject",
      );
      if (typeof saveProjectArchive !== "function") {
        throw new TypeError("Main-owned Mega Mall exporter недоступен.");
      }
      const projectId = boundedProjectId(input.projectId);
      const profile = getMegaMallProfile(input.design?.profileId);
      if (!profile) throw new TypeError("Профиль Mega Mall не найден.");
      const design = normalizeMegaMallDesign(input.design, { profile });
      const designHash = hashMegaMallDesign(design, { profile });
      if (input.expectedDesignHash !== designHash) {
        throw new TypeError(
          "Mega Mall design изменился после команды экспорта.",
        );
      }
      const revisions = revisionMap(input.assetRevisions);
      const assets = [];
      for (const descriptor of design.assets) {
        const expectedRevision = revisions.get(descriptor.id);
        if (!expectedRevision) {
          throw new TypeError(
            `Asset ${descriptor.id} не имеет revision envelope.`,
          );
        }
        assets.push(
          await sourceStore.read({
            projectId,
            assetId: descriptor.id,
            expectedSha256: descriptor.sha256,
            expectedRevision,
          }),
        );
      }
      const archive = buildMegaMallDesignArchive({ design, assets });
      const saved = await saveProjectArchive({
        suggestedName: design.name,
        bytes: archive,
      });
      return saved
        ? Object.freeze({
            cancelled: false,
            designHash,
            sourceCount: assets.length,
          })
        : Object.freeze({ cancelled: true });
    },

    async importProject(input) {
      exactObject(input, ["projectId"], [], "importProject");
      if (typeof chooseProjectArchive !== "function") {
        throw new TypeError("Main-owned Mega Mall importer недоступен.");
      }
      const projectId = boundedProjectId(input.projectId);
      const selected = await chooseProjectArchive();
      if (!selected) return Object.freeze({ cancelled: true });
      const inspected = inspectMegaMallDesignArchive(selected.bytes);
      const design = normalizeMegaMallDesign({
        ...inspected.design,
        projectId,
        revision: inspected.design.revision + 1,
        updatedAt: new Date(now()).toISOString(),
      });
      const imported = await sourceStore.importCanonicalBatch({
        projectId,
        assets: inspected.assets,
      });
      return Object.freeze({
        cancelled: false,
        design,
        designHash: hashMegaMallDesign(design),
        sourceCount: imported.length,
        assetRevisions: Object.fromEntries(
          imported.map((entry) => [entry.assetId, entry.revision]),
        ),
      });
    },

    async renderPreview(input) {
      exactObject(
        input,
        ["projectId", "design", "surfaceId", "assetRevisions", "requestToken"],
        ["previewMaxEdge"],
        "renderPreview",
      );
      const projectId = boundedProjectId(input.projectId);
      const profile = getMegaMallProfile(input.design?.profileId);
      if (!profile) throw new TypeError("Профиль Mega Mall не найден.");
      const design = normalizeMegaMallDesign(input.design, { profile });
      const assets = await readAssets({
        projectId,
        design,
        assetRevisions: input.assetRevisions,
        surfaceId: input.surfaceId,
      });
      const rendered = await renderMegaMallSurface({
        design,
        profile,
        surfaceId: String(input.surfaceId),
        assets,
        previewMaxEdge: Number(input.previewMaxEdge || 1024),
      });
      return Object.freeze({
        requestToken: String(input.requestToken || "").slice(0, 128),
        surfaceId: rendered.surfaceId,
        width: rendered.width,
        height: rendered.height,
        png: binaryResult(rendered.png),
        pngSha256: rendered.pngSha256,
        rgbaSha256: rendered.rgbaSha256,
        recipeSha256: rendered.recipeSha256,
        diagnostics: rendered.diagnostics,
      });
    },

    /* Реальная геометрия здания из установленной игры. Ошибку сюда не
       поднимаем: без GTA или без нативного хоста превью обязано открыться и
       показать схему, а не упасть. */
    async buildingModel(input) {
      exactObject(
        input,
        [],
        ["profileId", "buildingId", "targetId"],
        "buildingModel",
      );
      /* Здание просят двумя способами: по профилю mega mall и напрямую по
         идентификатору — второе нужно там, где редактора поверхностей нет,
         например у заправок. */
      let buildingId = input.buildingId ? String(input.buildingId) : null;
      if (!buildingId && input.profileId) {
        const profile = getMegaMallProfile(input.profileId);
        if (!profile) throw new TypeError("Профиль Mega Mall не найден.");
        buildingId = buildingIdForProfile(profile.id);
      }
      if (!buildingId) {
        throw new TypeError("buildingModel требует profileId или buildingId.");
      }
      if (!buildingModels) {
        return Object.freeze({
          status: "unavailable",
          reason: "Извлечение моделей недоступно в этой сборке.",
        });
      }
      const result = await buildingModels.load({
        buildingId,
        targetId: input.targetId ? String(input.targetId) : undefined,
      });
      if (result.status !== "ready") return result;
      return Object.freeze({
        status: "ready",
        format: result.format,
        cached: result.cached,
        sha256: result.sha256,
        glb: binaryResult(result.bytes),
        /* Координаты ламп из самой игры: превью ставит источники по ним,
           а не по догадкам о геометрии. */
        lights: result.lights || Object.freeze([]),
        source: result.source,
      });
    },

    /*
     * Партия моделей одним запросом.
     *
     * Не «удобство вызывающего»: поштучный путь платит распаковкой архива и
     * запуском конвертера за КАЖДУЮ модель, а комната интерьера — это восемь
     * моделей с одним общим словарём текстур. Замерено на живой игре: 13,4 с
     * поштучно против 1,6 с партией.
     *
     * `lights: false` отключает разбор ламп: он читает ресурс целиком, а
     * редактору интерьеров лампы не нужны — он их из ответа даже не смотрит.
     */
    async buildingModelBatch(input) {
      exactObject(input, ["ids"], ["targetId", "lights"], "buildingModelBatch");
      const ids = Array.isArray(input.ids) ? input.ids.map(String) : [];
      if (!ids.length) throw new TypeError("buildingModels требует ids.");
      if (ids.length > 64)
        throw new RangeError("buildingModels принимает не больше 64 моделей.");
      if (!buildingModels) {
        return Object.freeze({
          status: "unavailable",
          reason: "Извлечение моделей недоступно в этой сборке.",
        });
      }
      const loaded = await buildingModels.loadMany({
        ids,
        targetId: input.targetId ? String(input.targetId) : undefined,
        lights: input.lights !== false,
      });
      const models = {};
      for (const [id, result] of Object.entries(loaded)) {
        models[id] =
          result.status === "ready"
            ? Object.freeze({
                status: "ready",
                format: result.format,
                cached: result.cached,
                sha256: result.sha256,
                glb: binaryResult(result.bytes),
                lights: result.lights || Object.freeze([]),
                source: result.source,
              })
            : result;
      }
      return Object.freeze({ status: "ready", models: Object.freeze(models) });
    },

    /*
     * Секция карты целиком: манифест расстановки и бандлы GLB.
     *
     * Манифест дешёвый (метаданные), бандл — распаковка и конвертация
     * десятков деталей, поэтому они просятся отдельно: сцена сначала
     * узнаёт, что и где стоит, а геометрию тянет бандлами по мере
     * надобности — сначала `hd`, подмены издалека потом.
     */
    async section(input) {
      exactObject(
        input,
        [],
        ["sectionId", "targetId", "rebuild", "warm"],
        "section",
      );
      if (!sectionModels) {
        return Object.freeze({
          status: "unavailable",
          reason: "Извлечение секций карты недоступно в этой сборке.",
        });
      }
      const common = {
        sectionId: input.sectionId ? String(input.sectionId) : undefined,
        targetId: input.targetId ? String(input.targetId) : undefined,
      };
      /* `warm` — прогрев кэша в фоне: манифест и перечисленные бандлы
         собираются заранее, байты в окно не едут. */
      if (Array.isArray(input.warm)) {
        const bundleIds = input.warm.map(String).slice(0, 8);
        return sectionModels.warm({ ...common, bundleIds });
      }
      return sectionModels.manifest({
        ...common,
        rebuild: input.rebuild === true,
      });
    },

    async sectionBundle(input) {
      exactObject(
        input,
        ["bundleId"],
        ["sectionId", "targetId", "head", "ifNoneMatch"],
        "sectionBundle",
      );
      if (!sectionModels) {
        return Object.freeze({
          status: "unavailable",
          reason: "Извлечение секций карты недоступно в этой сборке.",
        });
      }
      const head = input.head === true;
      /* Хэш разобранного бандла на стороне окна: совпал — байты не едут. */
      const ifNoneMatch = /^[0-9a-f]{64}$/i.test(
        String(input.ifNoneMatch || ""),
      )
        ? String(input.ifNoneMatch).toLowerCase()
        : "";
      const result = await sectionModels.bundle({
        sectionId: input.sectionId ? String(input.sectionId) : undefined,
        targetId: input.targetId ? String(input.targetId) : undefined,
        bundleId: String(input.bundleId),
        head,
        ifNoneMatch,
      });
      if (result.status !== "ready") return result;
      const unchanged = result.unchanged === true;
      return Object.freeze({
        status: "ready",
        sectionId: result.sectionId,
        bundleId: result.bundleId,
        cached: result.cached,
        bytes: result.bytes,
        sha256: result.sha256,
        unchanged,
        /* Без байтов — только сведения: у окна этот бандл уже разобран, либо
           оно спрашивало одни сведения. */
        glb: head || unchanged || !result.glb ? null : binaryResult(result.glb),
        report: result.report,
      });
    },

    async plan(input) {
      exactObject(
        input,
        ["projectId", "design", "assetRevisions", "gameRoot", "targetId"],
        [],
        "plan",
      );
      prunePlans();
      const projectId = boundedProjectId(input.projectId);
      const profile = getMegaMallProfile(input.design?.profileId);
      if (!profile) throw new TypeError("Профиль Mega Mall не найден.");
      const design = normalizeMegaMallDesign(input.design, { profile });
      const designHash = hashMegaMallDesign(design, { profile });
      const reasons = [];
      if (!installAdapter) reasons.push("install-adapter-unavailable");
      if (reasons.length) {
        return Object.freeze({
          ready: false,
          planId: null,
          designHash,
          profileId: profile.id,
          atomicSlot: profile.atomicSlot,
          reasons,
          message:
            "Установка недоступна: защищённый Astral overlay adapter не подключён. Редактор и канонический предпросмотр доступны.",
        });
      }
      const assets = await readAssets({
        projectId,
        design,
        assetRevisions: input.assetRevisions,
      });
      const artifacts = [];
      for (const surface of design.surfaces) {
        artifacts.push(
          await compileMegaMallSurface({
            design,
            profile,
            surfaceId: surface.surfaceId,
            assets,
          }),
        );
      }
      const adapterPlan = await installAdapter.plan({
        projectId,
        design,
        designHash,
        profile,
        artifacts,
        gameRoot: path.resolve(String(input.gameRoot || "")),
        targetId: String(input.targetId || "default"),
      });
      const planId = randomUUID();
      plans.set(planId, {
        planId,
        used: false,
        expiresAt: now() + PLAN_TTL_MS,
        projectId,
        designHash,
        profile,
        artifacts,
        adapterPlan,
      });
      return Object.freeze({
        ready: true,
        planId,
        designHash,
        profileId: profile.id,
        atomicSlot: profile.atomicSlot,
        expiresAt: new Date(now() + PLAN_TTL_MS).toISOString(),
        summary: adapterPlan.summary,
      });
    },

    async apply(input) {
      exactObject(input, ["planId"], [], "apply");
      prunePlans();
      const plan = plans.get(String(input.planId || ""));
      if (!plan || plan.used) {
        throw new TypeError(
          "План Mega Mall отсутствует, устарел или уже использован.",
        );
      }
      plan.used = true;
      try {
        return await installAdapter.apply(plan);
      } finally {
        plans.delete(plan.planId);
      }
    },

    async remove(input) {
      exactObject(input, ["modId", "gameRoot", "targetId"], [], "remove");
      if (!installAdapter) {
        throw new TypeError(
          "Удаление Mega Mall недоступно без install adapter.",
        );
      }
      return installAdapter.remove({
        modId: String(input.modId || ""),
        gameRoot: path.resolve(String(input.gameRoot || "")),
        targetId: String(input.targetId || "default"),
      });
    },
  });
}

export function registerMegaMallEditorIpc({
  IPC,
  handleIpc,
  trusted,
  safeInput,
  desktopStorage,
  dialog,
  fs,
  installAdapter,
  createBuildingModels = null,
  createSectionModels = null,
}) {
  let servicePromise = null;
  const service = async () => {
    if (!servicePromise) {
      servicePromise = desktopStorage()
        .installOptions()
        .then(({ stateDir }) => {
          const sourceStore = createMegaMallSourceStore({
            root: path.join(stateDir, "mega-mall-editor", "source-store"),
          });
          return createMegaMallEditorService({
            sourceStore,
            installAdapter,
            buildingModels: createBuildingModels
              ? createBuildingModels({
                  cacheRoot: path.join(
                    stateDir,
                    "mega-mall-editor",
                    "building-models",
                  ),
                })
              : null,
            sectionModels: createSectionModels
              ? createSectionModels({
                  cacheRoot: path.join(
                    stateDir,
                    "mega-mall-editor",
                    "section-models",
                  ),
                  stateDir,
                })
              : null,
            chooseSource: async () => {
              const result = await dialog.showOpenDialog({
                title: "Выберите изображение для Davis Mega Mall",
                properties: ["openFile"],
                filters: [
                  {
                    name: "Изображения",
                    extensions: ["png", "jpg", "jpeg", "webp"],
                  },
                ],
              });
              return result.canceled ? null : result.filePaths[0];
            },
            chooseProjectArchive: async () => {
              const result = await dialog.showOpenDialog({
                title: "Импорт проекта Davis Mega Mall",
                properties: ["openFile"],
                filters: [
                  { name: "Astral project", extensions: ["astralpack"] },
                ],
              });
              if (result.canceled || !result.filePaths[0]) return null;
              return { bytes: await fs.readFile(result.filePaths[0]) };
            },
            saveProjectArchive: async ({ suggestedName, bytes }) => {
              const safeName = String(suggestedName || "davis-mega-mall")
                .replace(/[^a-z0-9а-яё._ -]+/gi, "-")
                .slice(0, 80);
              const result = await dialog.showSaveDialog({
                title: "Экспорт проекта Davis Mega Mall",
                defaultPath: `${safeName || "davis-mega-mall"}.astralpack`,
                filters: [
                  { name: "Astral project", extensions: ["astralpack"] },
                ],
              });
              if (result.canceled || !result.filePath) return false;
              if (
                path.extname(result.filePath).toLowerCase() !== ".astralpack"
              ) {
                throw new TypeError("Mega Mall export требует .astralpack.");
              }
              await fs.writeFile(path.resolve(result.filePath), bytes);
              return true;
            },
          });
        });
    }
    return servicePromise;
  };

  const register = (channel, operation) =>
    handleIpc(channel, (event, input) =>
      trusted(event, async () => operation(await service(), safeInput(input))),
    );

  handleIpc(IPC.WORKSHOP_MEGA_MALL_CAPABILITIES, (event) =>
    trusted(event, async () => (await service()).capabilities()),
  );
  register(IPC.WORKSHOP_IMPORT_MEGA_MALL_SOURCE, (value, input) =>
    value.importSource(input),
  );
  register(IPC.WORKSHOP_LIST_MEGA_MALL_SOURCES, (value, input) =>
    value.listSources(input),
  );
  register(IPC.WORKSHOP_RELEASE_MEGA_MALL_SOURCE, (value, input) =>
    value.releaseSource(input),
  );
  register(IPC.WORKSHOP_EXPORT_MEGA_MALL_PROJECT, (value, input) =>
    value.exportProject(input),
  );
  register(IPC.WORKSHOP_IMPORT_MEGA_MALL_PROJECT, (value, input) =>
    value.importProject(input),
  );
  register(IPC.WORKSHOP_RENDER_MEGA_MALL_PREVIEW, (value, input) =>
    value.renderPreview(input),
  );
  register(IPC.WORKSHOP_MEGA_MALL_BUILDING_MODEL, (value, input) =>
    value.buildingModel(input),
  );
  register(IPC.WORKSHOP_MEGA_MALL_BUILDING_MODELS, (value, input) =>
    value.buildingModelBatch(input),
  );
  register(IPC.WORKSHOP_MEGA_MALL_SECTION, (value, input) =>
    value.section(input),
  );
  register(IPC.WORKSHOP_MEGA_MALL_SECTION_BUNDLE, (value, input) =>
    value.sectionBundle(input),
  );
  register(IPC.WORKSHOP_PLAN_MEGA_MALL, (value, input) => value.plan(input));
  register(IPC.WORKSHOP_APPLY_MEGA_MALL, (value, input) => value.apply(input));
  register(IPC.WORKSHOP_REMOVE_MEGA_MALL, (value, input) =>
    value.remove(input),
  );
}
