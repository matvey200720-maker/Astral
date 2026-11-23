import { getCloudDownloadGrant, planLocalPackage } from "./bundle-api.js";
import { cloudCatalogIDPattern } from "../../../catalog-utils.js";
import { packageUrlForRegion } from "../../../network-regions.js";
import { buildBlockedNotice } from "../../builds/logic.js";
import { recordDesktopCatalogDownload } from "../../telemetry/index.js";
import { bundleCopy, bundlePartsLabel } from "./bundle-copy.js";
import { prepareBuildInstallPlan } from "../../builds/install-plan.js";
import { isVectorMapPart } from "../part-map.js";
import { bundleChoices } from "./bundle-choices.js";
import { releaseHeldGame } from "../install-prepare-wait.js";
import { bundleComponents, componentGroupOf } from "./component-choices.js";
import { readOwnWorks } from "./component-works.js";
import { bundlePartsOf } from "./component-state.js";
import { partMapWorks } from "./map-works.js";
import { batchItemOf, enqueueBatch, withinBatchLimits } from "./batch-install.js";
import { isSettingsPackage, versionSwitchPlan } from "./batch-plan.js";

// Свои карты игрока ищутся только для больших векторных карт состава:
// у остальных частей выбор «своей карты» в план не попадает.
async function mapWorksOfBundle(bundle, mods) {
  const included = bundle.includedModIds || [];
  const bigMaps = mods.filter((mod) => included.includes(mod.id) && isVectorMapPart(mod));
  const lists = await Promise.all(bigMaps.map((mod) => partMapWorks(mod.id)));
  const byPart = {};
  bigMaps.forEach((mod, position) => {
    byPart[mod.id] = lists[position];
  });
  return byPart;
}

// Облачным профиль считается, если хотя бы у одной устанавливаемой части id —
// uuid каталога. Ложный или пустой id проверяется как пустая строка.
function isCloudProfile(parts) {
  return parts.some((part) => cloudCatalogIDPattern.test(part.id || ""));
}

// Свои работы мастерской читаются, только если человек поставил хоть одну на место компонента.
async function ownWorksOf(components) {
  if (!Object.keys(components.work).length) return [];
  return readOwnWorks();
}

/**
 * План установки сборки редукса (Т-81d): тот же расчёт, что у «Сборок», но
 * сборка только добавляет. Части-работы и выбранные свои карты в план не
 * входят: их возвращает ответ отдельно, ставит очередь мастерской.
 */
export async function prepareBundleInstall({
  bundle,
  mods,
  installed,
  region,
  game,
  getDownloadGrant,
  recordDownload,
  planPackage,
  packageURL,
  bundleOf = {},
}) {
  const mapWorks = await mapWorksOfBundle(bundle, mods);
  // Выбор версий читается в момент вызова: сделанный до него виден плану.
  const choices = bundleChoices(bundle.id);
  // Отключённые и замещённые компоненты читаются так же, в момент вызова.
  const components = bundleComponents(componentGroupOf(bundle));
  const ownWorks = await ownWorksOf(components);
  const { parts, works, catalogWorks, componentWorks, missingIds } = bundlePartsOf(bundle, mods, { installed, choices, mapWorks, components, ownWorks });

  const profile = {
    name: bundle.name,
    modIds: [...parts.map((part) => part.id), ...missingIds],
    cloud: isCloudProfile(parts),
    items: parts.map((part) => ({ modId: part.id, releaseId: part.releaseId })),
  };

  const plan = await prepareBuildInstallPlan({
    profile,
    desiredMods: parts,
    missingIds,
    installed,
    allMods: mods,
    region,
    game,
    getDownloadGrant,
    recordDownload,
    planPackage,
    packageURL,
  });

  /* Смена версии: стоят пакеты другой версии этой же карточки, которых в выбранной нет, — их снимет та же пачка (`switchOf`). */
  const removal = versionSwitchPlan({ bundle, mods, installed, bundleOf, resolvedIds: profile.modIds });
  return { ...plan, profile, works, catalogWorks, componentWorks, removal };
}

/**
 * Смена версии редукса одной пачкой (этап 2): пакеты выбранной версии, которых ещё нет, и снятие пакетов прежней, которых в выбранной нет, — одной транзакцией.
 * Пакеты настроек игры (`gta-settings`) в пачку не идут: их ставят и снимают отдельно, как раньше.
 * @returns {null | { item: object | null, settingsAdds: object[], settingsRemoveIds: string[], looseRemoveIds: string[] }} `null` — менять версию не нужно (ничего чужого не стоит);
 * `item` — строка очереди с пачкой (`null`, если ставить в пачке нечего: тогда лишнее снимается обычным снятием, `looseRemoveIds`)
 */
export function switchOf({ bundle, additions = [], removal, packageURL, region }) {
  if (!removal || (!removal.removeModIds.length && !removal.settingsRemoveIds.length)) return null;
  const batchAdds = additions.filter((one) => !isSettingsPackage(one.mod));
  const settingsAdds = additions.filter((one) => isSettingsPackage(one.mod));
  const built = batchAdds.length ? batchItemOf({ bundle, additions: batchAdds, removeModIds: removal.removeModIds, packageURL, region }) : null;
  /* Больше пределов пачки движка (64 пакета, 64 снимаемых) — менять версию по-старому, пакет за пакетом. */
  if (built && !withinBatchLimits(built)) return null;
  const item = built;
  return { item, settingsAdds, settingsRemoveIds: removal.settingsRemoveIds, looseRemoveIds: item ? [] : removal.removeModIds };
}

/**
 * Сборка редукса одной кнопкой (Т-81d): план «Сборок» по её частям; часть ставится с `origin: { bundleId }` в записи движка (Т-97), и «Снять сборку» снимает только такие.
 * Сбой одной части снимает остальные с очереди (`dropBundleRest`). Стоит другая версия этой же карточки — пакеты выбранной ставятся, а лишние прежней снимаются одной
 * пачкой (`switchOf`); пакеты настроек игры — отдельно, как раньше. Модуль ленивый: оболочка берёт его по `import()` и даёт своё состояние (`shell`).
 * @param {object} shell `language, game, preparation, prepareGame, mods, installed, region, bundleOf, notify, enqueueInstall, removeInstalled` и состояние очереди (`enqueueBatch`)
 */
export async function installBundle(bundle, shell) {
  const { language, game, installed, region, notify } = shell;
  const words = bundleCopy(language);
  if (shell.preparation.stockHold) await releaseHeldGame({ game, prepareGame: shell.prepareGame, notify }, bundle);
  const { additions, blocked, internalConflicts, works, catalogWorks, componentWorks, removal, choosing } = await prepareBundleInstall({
    bundleOf: shell.bundleOf,
    bundle,
    mods: shell.mods,
    installed,
    region,
    game,
    getDownloadGrant: getCloudDownloadGrant,
    recordDownload: recordDesktopCatalogDownload,
    planPackage: planLocalPackage,
    packageURL: packageUrlForRegion,
  });
  if (blocked.length || internalConflicts.length) {
    notify(buildBlockedNotice({ build: bundle.name, blocked, internalConflicts }, language), "error");
    return;
  }
  /* Вещь одежды вида «одна вещь на замену» ставится только после выбора, на что поставить (владелец, 15.11.2026): из сборки она не уходит в очередь «как дополнение» без выбора — остальные части встают, а
     такие вещи названы в слове: их ставят из своих карточек. */
  const choosingList = choosing.length ? (await import("../../clothing/needs-choice.js")).choosingNames(choosing) : "";
  const byCard = () => notify(words.clothingByCard(bundle.name, choosingList));
  /* Слои оптимизации Astral сборки (задачи 7–8 ТЗ 07.10.2026) и свои карты вместо её большой карты (11.10) — очередью мастерской. */
  const optimization = bundle.domain?.optimization || works.length || catalogWorks.length || componentWorks.length ? await (await import("./bundle-optimization.js")).queueBundleWorkshop(bundle, { language, works, catalogWorks, componentWorks, installed, notify }) : [];
  if (!additions.length) {
    if (choosing.length) byCard();
    else if (!optimization.length) notify(words.nothingToInstall(bundle.name));
    return;
  }
  const switched = switchOf({ bundle, additions, removal, packageURL: packageUrlForRegion, region });
  if (switched) {
    if (switched.item) enqueueBatch(switched.item, shell);
    const loose = [...switched.looseRemoveIds, ...switched.settingsRemoveIds];
    if (loose.length) shell.removeInstalled(loose);
  }
  for (const item of switched ? switched.settingsAdds : additions) shell.enqueueInstall({ ...item.mod, bundleId: bundle.id, bundleName: bundle.name }, item.replaceIds, item.plan);
  const queuedParts = bundlePartsLabel(additions.length, language);
  /* Одно слово: два `notify` подряд в один такт — второе затирает первое («поставлено в очередь» пропадало). */
  notify(choosing.length ? words.queuedByCard(bundle.name, choosingList) : words.queued(bundle.name, queuedParts));
}
