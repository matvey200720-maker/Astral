import {
  tr,
} from "../../../locales/ui.js";
import {
  installMapWorks,
  blockedMapWorks,
} from "./map-works.js";
import {
  bundleCopy,
} from "./bundle-copy.js";
import {
  optimizationLayerTitle,
} from "@modovik/optimizer/layer-ids.js";
import {
  bundleOptimizationLayers,
} from "@modovik/optimizer/bundle-domain.js";

// Тяжёлые соседи (очередь, сверка слоёв, установщики работ) тянут api.js,
// поэтому грузятся только в тот момент, когда до них дошло дело.
function layersJob(bundle, layers, language) {
  const names = [];
  const flags = {};
  for (const id of layers) {
    names.push(optimizationLayerTitle(id, language));
    flags[id] = true;
  }
  const steps = [
    ["prepare", tr("Подготовка"), tr("Astral проверяет, что игра закрыта, и сверяет то, что уже стоит")],
    ["layers", names.join(", "), tr("Слои оптимизации Astral из сборки — вместе с теми, что уже стоят, одним набором")],
  ].map(([id, label, hint]) => ({ id, label, hint }));
  return {
    key: "bundle-optimization:" + bundle.id,
    signature: String(layers),
    // хвост названия всегда русский: его не переводят ни на каком языке окна
    title: (bundle.name || tr("Сборка")) + " \u2014 оптимизация Astral",
    editor: tr("Оптимизация"),
    steps,
    run() {
      return import("../../../components/desktop/workshop/optimizer/optimizer-sync.js").then(({ syncOptimizationLayers }) => syncOptimizationLayers({ ...flags }));
    },
  };
}

export async function queueBundleOptimization(bundle, options = {}) {
  const { language = "ru" } = options;
  const layers = bundleOptimizationLayers(bundle);
  if (!layers.length) return layers;
  const { enqueueWorkshopInstall } = await import("../../workshop/install-queue/index.js");
  enqueueWorkshopInstall(layersJob(bundle, layers, language));
  return layers;
}

// Один установщик: пустой список пропускается, ответ превращается в список названий.
async function runStage(list, loadInstaller, notify, ledgerOf = (answer) => answer) {
  if (list.length === 0) return [];
  const install = await loadInstaller();
  const answer = await install(list, { notify: (text) => notify(text, "error") });
  return ledgerOf(answer)?.queued ?? [];
}

export async function queueBundleWorkshop(bundle, options = {}) {
  const {
    notify = () => {},
    works = [],
    language = "ru",
    installed = [],
    catalogWorks: catalogList = [],
    componentWorks: ownList = [],
  } = options;
  const queued = await queueBundleOptimization(bundle, { language });

  // Свою карту нельзя поставить, пока в игре стоит большая карта самого мода.
  const blocked = blockedMapWorks(works, installed);
  const free = [];
  for (const work of works) {
    if (!blocked.includes(work)) {
      free.push(work);
      continue;
    }
    const reason = bundleCopy(language).removeMapFirst(work.name);
    notify(reason, "error");
  }

  queued.push(...(await runStage(free, () => installMapWorks, notify)));
  queued.push(...(await runStage(catalogList, () => import("./catalog-works.js").then((m) => m.installCatalogWorks), notify)));
  queued.push(...(await runStage(ownList, () => import("./component-works.js").then((m) => m.installComponentWorks), notify, ({ ledger }) => ledger)));
  return queued;
}
