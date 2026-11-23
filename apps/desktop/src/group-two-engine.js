import * as installEngine from "@modovik/install-engine";
import * as restoreChain from "./native-restore-chain.js";
import * as composer from "./rpf-composer.js";

// Проверки пакетов грузятся по первому вызову: статически сюда ничего из этого списка не попадает.
// Слово модуля записи -> загрузка файла.
const LOADERS = {
  "sky-rainbow": () => import("./sky-rainbow.js"),
  "arena-customizer": () => import("./arena-customizer.js"),
  "climb-customizer": () => import("./climb-customizer.js"),
  "interior-customizer": () => import("./interior-customizer.js"),
  "lamp-lights-package": () => import("./lamp-lights-package.js"),
  "recolor-customizer": () => import("./recolor-customizer.js"),
  "wallbang-customizer": () => import("./wallbang-customizer.js"),
  "world-map-customizer": () => import("./world-map-customizer.js"),
  "optimization-layers": () => import("./optimization-layers.js"),
  "optimization-textures": () => import("./optimization-layers.js"),
  "server-tattoos": () => import("./server-tattoo-replay.js"),
  "tattoo-paint": () => import("./tattoo-paint-replay.js"),
  "clothing-skin": () => import("./clothing-skin-replay.js"),
  "clothing-replace": () => import("./clothing-replace-replay.js"),
  "sound-packs": () => import("./sound-pack-replay.js"),
  "weapon-skin": () => import("./weapon-skin.js"),
};

// Слово модуля записи -> имя функции проверки в загруженном файле.
const FUNCTION_NAMES = new Map(
  `
  sky-rainbow:skyRainbowReplayPackage arena-customizer:arenaReplayPackage climb-customizer:climbReplayPackage
  interior-customizer:interiorReplayPackage lamp-lights-package:lampLightsReplayPackage
  recolor-customizer:recolorReplayPackage wallbang-customizer:wallbangReplayPackage
  world-map-customizer:worldMapReplayPackage optimization-layers:optimizationReplayPackage
  optimization-textures:texturesReplayPackage server-tattoos:serverTattooReplayPackage
  tattoo-paint:tattooPaintReplayPackage clothing-skin:clothingSkinReplayPackage
  clothing-replace:clothingReplaceReplayPackage sound-packs:soundPackReplayPackage
  weapon-skin:weaponSkinReplayPackage
  `
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(":")),
);

// Проверка этого модуля не берёт папку состояния, только запись.
const WITHOUT_STATE_DIR = "world-map-customizer";

export const GROUP_TWO_MODULES = Object.freeze(Object.keys(LOADERS));

const notWiredText = (work) => `Работа «${work}»: переигрывание движком для неё не подключено.`;

const lazyVerifier = (load, functionName, takesStateDir) => async (stateDir, replay) => {
  const verifyPackage = (await load())[functionName];
  return verifyPackage(...(takesStateDir ? [stateDir, replay] : [replay]));
};

// Обычный объект нарочно: поиск по нему идёт вместе с прототипом.
const PACKAGE_VERIFIERS = Object.fromEntries(
  Object.entries(LOADERS).map(([word, load]) => [word, lazyVerifier(load, FUNCTION_NAMES.get(word), word !== WITHOUT_STATE_DIR)]),
);

async function verifyReplay(stateDir, verifiers, replay) {
  const verifyPackage = verifiers[replay?.module];
  if (!verifyPackage) throw new Error(notWiredText(replay?.workId ?? "?"));
  const found = await verifyPackage(stateDir, replay);
  installEngine.assertReplayInside(stateDir, found?.packageRoot, replay?.workId);
  return found;
}

export function groupTwoEngineRestore(stateDir, options = {}) {
  const install = options.install === undefined ? composer.installRpfPrebuilt : options.install;
  const pointsRoot = options.pointsRoot === undefined ? restoreChain.nativeRestorePointsRoot() : options.pointsRoot;
  const verifiers = options.verifiers === undefined ? PACKAGE_VERIFIERS : options.verifiers;

  const accepts = (replay) => installEngine.engineInstallEnabled(String(replay?.module || ""));
  const verify = (replay) => verifyReplay(stateDir, verifiers, replay);

  return { install, pointsRoot, accepts, verify };
}
