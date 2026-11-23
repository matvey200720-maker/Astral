import { conflictingMods } from "../../utils/catalogConflicts.js";
import { isKeptMod, keptModIds, replacedConflicts, standsByParts } from "../../utils/plan-keeps.js";
import { looksLikeClothing, withSavedChoice } from "../clothing/saved-choice.js";
import { choiceFor } from "./build-choices.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/*
 * Почему мод сборки не встаёт — ключом, а не фразой.
 *
 * План считается один раз, а читают его на языке окна: всплывашка оболочки
 * и окно сборки (`blocked-copy.js`). Раньше причина приклеивалась к имени
 * по-русски («DRAGON Revolver: нет проверенного установочного пакета»), а
 * человек видел только общее «в сборке есть недоступные модификации» — без
 * имён и без того, что с этим делать.
 */
const blockedBy = (reason) => Object.assign(new Error(reason), { reason });

/*
 * Что видно без запроса к серверу: мода нет в каталоге или его пакет не
 * подписан ключом каталога (apps/api/src/trusted-catalog.js). Окно сборки
 * отмечает такие строки сразу, а не после щелчка «Установить».
 */
export function knownBlockReason(mod) {
  if (!mod) return "missing";
  if (mod.packageStatus === "unsigned") return "unsigned";
  return "";
}

/*
 * Что снимать отдельной операцией.
 *
 * Сборка встаёт вместо того, что стоит в игре. Мод, который встающий мод
 * заменяет (тот же слот или те же файлы), снимает сама установка — в одной
 * транзакции движка. Снимать его ещё и заранее нельзя: к началу установки
 * мода уже нет, и движок отвергает замену («Пакет не объявляет конфликт с
 * модификацией …») — сборка, меняющая, например, одну миникарту на другую,
 * не вставала никогда.
 */
export function separateRemovals(removals, additions) {
  const replaced = new Set(additions.flatMap((item) => item.replaceIds));
  return removals.filter((mod) => !replaced.has(mod.id));
}

/*
 * План вещи с сохранённым выбором: как у оболочки (`DesktopShell.install`) для `clothingChoice` — пакет замены пишет Desktop при установке, поэтому планировать пакет каталога и искать его
 * конфликты нечего; число файлов — текстуры вещи и модель.
 */
const clothingPlan = (mod) => ({
  summary: {
    fileCount: (mod.clothingChoice.target?.textures || 1) + 1,
    writeBytes: mod.sizeBytes || 0,
  },
  conflicts: [],
  clothing: true,
});

export async function prepareBuildInstallPlan({
  profile,
  desiredMods: listed,
  missingIds,
  installed,
  allMods,
  region,
  game,
  getDownloadGrant,
  recordDownload,
  planPackage,
  packageURL,
}) {
  /* Выбор, «на что поставить», сохранённый у этой сборки (`build-choices.js`), подмешивается к карточке до разбора — так же, как «Повторить» у строки очереди (`withSavedChoice`): вещь с выбором идёт в `additions` как обычная, без выбора остаётся в `choosing`. */
  const desiredMods = profile.choices
    ? listed.map((mod) => {
        const choice = choiceFor(profile, mod.id);
        return choice && looksLikeClothing(mod)
          ? withSavedChoice(mod, { clothingChoice: choice })
          : mod;
      })
    : listed;
  const savedReleaseByMod = new Map(
    (profile.items || []).map((item) => [item.modId, item.releaseId]),
  );
  const staleMods = desiredMods.filter(
    (mod) => profile.cloud && savedReleaseByMod.get(mod.id) !== mod.releaseId,
  );
  const blocked = [
    ...staleMods.map((mod) => ({ ...mod, reason: "stale" })),
    ...missingIds.map((id) => ({ id, name: "", reason: "missing" })),
  ];
  /* Вещь одежды «одна вещь на замену» ставится только после выбора, на что поставить (15.11.2026): сборка выбора не хранит — такие вещи в план не идут, их называет `choosing` (слово — `bundleCopy().clothingByCard`). */
  const choosing = desiredMods.some(looksLikeClothing)
    ? /* Уже установленная вещь не «ждёт выбора»: сборка с ней активна, слово «не ставятся сами» было бы неправдой (ревью 16.11.2026, находка 2). */
      (await import("../clothing/needs-choice.js")).modsNeedingChoice(desiredMods).filter((mod) => !installed.includes(mod.id))
    : [];
  const additions = [];
  for (const mod of desiredMods.filter(
    (item) =>
      !installed.includes(item.id) &&
      !staleMods.includes(item) &&
      !choosing.includes(item),
  )) {
    try {
      let installable = mod;
      if (!installable.manifest || !packageURL(installable, region)) {
        const savedReleaseID = savedReleaseByMod.get(mod.id);
        if (
          !profile.cloud ||
          installable.packageStatus !== "preview" ||
          !uuidPattern.test(mod.id || "") ||
          !uuidPattern.test(savedReleaseID || "")
        ) {
          throw blockedBy(knownBlockReason(installable) || "no-package");
        }
        const grant = await getDownloadGrant(mod.id);
        if (grant.releaseId !== savedReleaseID) {
          throw blockedBy("release-mismatch");
        }
        recordDownload?.(mod.id);
        installable = {
          ...mod,
          manifest: grant.manifest,
          packageBaseUrl: grant.packageBaseUrl,
          packageStatus: "ready",
          sizeBytes: grant.bytes,
          artifactSha256: grant.sha256,
          signingKeyId: grant.signingKeyId,
        };
      }
      /* Вещь с выбором ставится пакетом замены, который пишет Desktop: плана пакета каталога, загрузчика и конфликтов у неё нет (как у оболочки). */
      if (installable.clothingChoice) {
        additions.push({
          mod: installable,
          plan: clothingPlan(installable),
          replaceIds: [],
        });
        continue;
      }
      if (
        game.installReadiness !== "ready" &&
        installable.manifest.scope !== "game-root" &&
        installable.manifest.requiresLoader !== false
      ) {
        throw blockedBy("loader");
      }
      const plan = await planPackage({
        manifest: installable.manifest,
        gameRoot: game.path,
        targetId: game.id,
        edition: game.edition,
        allowGameRootWrites: installable.manifest.scope === "game-root",
      });
      /* Работа, у которой остаются слоты, каких нет у этого пакета (ганпак из трёх стволов и часть на один), к замене не называется (`plan-keeps.js`). */
      const kept = keptModIds(plan);
      const replaceIds = [
        ...new Set([
          ...replacedConflicts(plan).map((item) => item.modId),
          ...conflictingMods(installable, installed, allMods)
            .filter((item) => !isKeptMod(kept, item) && !standsByParts(item, installed))
            .map((item) => item.id),
        ]),
      ];
      additions.push({ mod: installable, plan, replaceIds });
    } catch (error) {
      /* Отказ сервера или движка (сеть, запущенная игра) — своими словами
         (`describeInstallFailure`), причина — «пакет сейчас не получить». */
      blocked.push(
        error.reason
          ? { ...mod, reason: error.reason }
          : { ...mod, reason: "unavailable", failure: error },
      );
    }
  }

  /*
   * Моды одной сборки, которые не уживутся друг с другом.
   *
   * Владелец — то же, что у движка (plan-install.js): у записи в архиве это
   * сам архив и имя записи, а не один архив — иначе два ствола в разных
   * записях update.rpf считались бы спором. Слияния (`merge`) не владеют
   * файлом: их правки складываются.
   */
  const targetOwners = new Map();
  const internalConflicts = [];
  for (const mod of additions
    .filter((item) => !item.plan.clothing)
    .map((item) => item.mod)) {
    for (const file of mod.manifest.files || []) {
      if (file.merge) continue;
      const key = [file.target, file.entry]
        .filter(Boolean)
        .join("::")
        .toLowerCase();
      const owner = targetOwners.get(key);
      if (owner && owner.id !== mod.id) {
        if (
          !internalConflicts.some(
            (item) =>
              item.target === key &&
              item.first.id === owner.id &&
              item.second.id === mod.id,
          )
        ) {
          internalConflicts.push({ target: key, first: owner, second: mod });
        }
      } else targetOwners.set(key, mod);
    }
  }
  /* Встающий мод заменил бы мод той же сборки, который уже стоит: после
     установки того в игре не осталось бы, и сборка не встала бы целиком. */
  for (const { mod, replaceIds } of additions) {
    for (const first of desiredMods.filter((item) =>
      replaceIds.includes(item.id),
    ))
      internalConflicts.push({ target: "", first, second: mod });
  }
  /* Слово «вещи одежды из сборки не ставятся сами» на языке окна — по `import()`: в стартовый кусок словарь сборок не входит. */
  const choosingWord = async (language) => {
    const [{ bundleCopy }, { choosingNames }] = await Promise.all([import("../catalog/bundles/bundle-copy.js"), import("../clothing/needs-choice.js")]);
    return bundleCopy(language).clothingByCard(profile.name, choosingNames(choosing));
  };
  /* Когда сборка и ставится (есть что поставить или снять), и вещи ждут выбора, слово одно — «остальное в очереди; вещи одежды не ставятся сами — …»: два `showNotice` подряд затирали первое («сборка в очереди» пропадало). */
  const choosingQueuedWord = async (language) => {
    const [{ bundleCopy }, { choosingNames }] = await Promise.all([import("../catalog/bundles/bundle-copy.js"), import("../clothing/needs-choice.js")]);
    return bundleCopy(language).queuedByCard(profile.name, choosingNames(choosing));
  };
  return { additions, blocked, internalConflicts, choosing, choosingWord, choosingQueuedWord };
}
