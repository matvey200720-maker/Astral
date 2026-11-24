import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  checkedRecordKey,
  cleanId,
  ownRecordValue,
  setRecordValue,
} from "./state-record.js";
import { ASTRAL_UPDATE_TARGET, composeDirectDlcRegistry, touchesCarrierRegistry } from "./registry-composers.js";
import { adoptFreshUpdateBase, inspectModsShadow, MODS_SHADOW_ARCHIVE } from "./astral-layer.js";
import { forgetSupersededParked } from "./parked-mods.js";
import { assertNotWaitingSameVersion, recordStockUnderLayers } from "./stock-guard.js";
import { FAST_WEAPON_DLC_NAME, fastWeaponHostReady as checkFastWeaponHostReady } from "./fast-weapon-dlc.js";
import { CLOTHING_DLC_NAME, clothingHostReady as checkClothingHostReady } from "./clothing-dlc.js";
import { rebaseDirectUpdateIfNeeded } from "./direct-update-rebase.js";
import { movesAudioSlotLayer, packMovesAudioSlotLayer } from "./audio-slot-layer.js";
import { ownDlcsOf, prepareOwnDlcs, registerOwnDlcs } from "./own-dlcs.js";
import { supersedeInstalled } from "./mod-layers.js";
import {
  placeLayer,
  sharedManifestOwner,
  sharesIdenticalEntry,
  slidesUnderMerges,
} from "./merge-compatibility.js";
import {
  locallyTrusted,
  mayCarryNestedRpf,
  mayMaskEntries,
  mayStoreByLink,
} from "./local-trust.js";
import { copyBaseline, exists, missingBaseline } from "./storage-state.js";
import {
  isManagedOverlayTarget,
  resolveInside,
  validateManifest,
  verifyManifest,
} from "./manifest.js";
import { fingerprintSha256 as sha256File } from "./file-fingerprint.js"; /* из памяти, как у `index.js`: установка оружия читала update.rpf заново (02.11.2026) */
import { ensureArchiveResource } from "./resource-composition.js";
import { decideForeignEntries } from "./foreign-entries.js";
import { preparePackageFiles } from "./package-payload.js";
import { rebaseArchiveIfNeeded } from "./archive-rebase.js"; /*
 * Проверка и раскладка одного пакета в состояние цели — для установки пачкой (`installPackageBatch`,
 * 02.11.2026): вынесено из plan-install.js, чтобы тот оставался в пределах размера файла.
 */

/*
 * Происхождение установки — только известной формы, иначе ничего.
 *
 * `bundleId` — часть сборки каталога (Т-97). С Т-170 запись знает и откуда
 * пришла вещь: `source` — `catalog`, `workshop` или `build` (сборка
 * пользователя; тогда `buildId` и `buildName`), `title` — название для списка
 * «Что стоит в игре». Всё необязательно: старые записи его не несли и
 * остаются «неизвестными» — источник не угадывается.
 *
 * Пакет, который собрало приложение из мода каталога (замененка одежды на
 * вещь сервера, 14.10.2026), — под своим `local-…` id, а не под id мода:
 * `catalogModId` — какой мод каталога за ним стоит, `item` — на какую вещь
 * он лёг. По ним «Библиотека» рисует карточку мода на каждой вещи; `cover` —
 * sha256 его обложки (без каталога), `server` — проект, `itemPicture` — https-картинка вещи: пара «вещь → заменёнка» в «Библиотеке».
 */
const BUNDLE_ID = /^[a-z0-9][a-z0-9._-]{0,95}$/i;
const CATALOG_MOD_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const ORIGIN_SOURCES = new Set(["catalog", "workshop", "build"]);
const PICTURE_URL = /^https:\/\/[a-z0-9][a-z0-9.-]{0,120}\/[^\s"'<>\\]{1,240}$/i;
const ITEM_NAME_LANGUAGES = ["ru", "en", "de", "fr", "pl"];
const label = (value, limit) =>
  typeof value === "string"
    ? value.replace(/\p{Cc}/gu, " ").trim().slice(0, limit)
    : "";
function installOrigin(origin) {
  const bundleId = String(origin?.bundleId || "");
  const buildId = String(origin?.buildId || "");
  const catalogModId = String(origin?.catalogModId || "");
  const releaseId = String(origin?.releaseId || "");
  const source = ORIGIN_SOURCES.has(origin?.source) ? origin.source : "";
  const title = label(origin?.title, 120);
  const item = label(origin?.item, 120);
  /* Названия вещи на языках игры (17.11.2026): «Библиотека» называет вещь на языке окна. Языки игры, у которых есть у Astral, и непустые строки. */
  const itemNames = Object.fromEntries(ITEM_NAME_LANGUAGES.map((language) => [language, label(origin?.itemNames?.[language], 120)]).filter(([, text]) => text));
  const buildName = label(origin?.buildName, 120);
  const cover = String(origin?.cover || "").toLowerCase();
  const kept = {
    ...(BUNDLE_ID.test(bundleId) ? { bundleId } : {}),
    ...(source ? { source } : {}),
    ...(title ? { title } : {}),
    ...(CATALOG_MOD_ID.test(catalogModId) ? { catalogModId } : {}),
    /* Релиз мода каталога, с которого ставили (А10, шаг 3): окно сверяет его с текущим релизом, когда компонент ждёт новой версии. */
    ...(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(releaseId) ? { releaseId: releaseId.toLowerCase() } : {}),
    ...(item ? { item } : {}),
    ...(Object.keys(itemNames).length ? { itemNames } : {}),
    ...(PICTURE_URL.test(String(origin?.itemPicture || "")) ? { itemPicture: origin.itemPicture } : {}),
    ...(/^[a-f0-9]{64}$/.test(cover) ? { cover } : {}),
    ...(/^[a-z0-9_-]{1,32}$/.test(String(origin?.server || "")) ? { server: origin.server } : {}),
    ...(BUNDLE_ID.test(buildId) ? { buildId } : {}),
    ...(buildName && BUNDLE_ID.test(buildId) ? { buildName } : {}),
  };
  return Object.keys(kept).length ? { origin: kept } : {};
}

/* Подпись, форма манифеста и право на удаления и вложенные архивы — у каждого пакета до любой записи. */
export function checkPackage(
  { manifest, packageRoot, replaceModIds = [], origin = null, _internalTrust = null },
  { edition, publicKey, requireSignature, allowGameRootWrites, settingsInstaller },
) {
  const signatureValid = verifyManifest(manifest, publicKey);
  // Символ доверия засчитывается только вместе с повторной строгой
  // проверкой манифеста (`local-trust.js`): сам факт вызова обёртки
  // пакету никаких послаблений не даёт.
  const trusted = locallyTrusted(_internalTrust, manifest, edition);
  if (
    (requireSignature || allowGameRootWrites) &&
    !signatureValid &&
    !trusted
  )
    throw new Error("Цифровая подпись пакета недействительна.");
  const parsed = validateManifest(manifest, edition, { allowGameRootWrites });
  if (
    parsed.adapter === "gta-settings" &&
    typeof settingsInstaller !== "function"
  )
    throw new Error(
      "Пакеты gta-settings требуют защищённый settings-manager.",
    );
  const deletes = parsed.files.filter((file) => file.action === "delete");
  if (
    deletes.length &&
    !signatureValid &&
    /* Маски скина ствола (Т-107b, `local-trust.js`). */
    !(
      trusted &&
      mayMaskEntries(_internalTrust) &&
      deletes.every((file) => file.allowMissing === true)
    )
  )
    throw new Error(
      "Удаление RPF-entry разрешено только подписанному пакету.",
    );
  if (
    parsed.files.some(
      (file) => path.posix.extname(file.entry || "").toLowerCase() === ".rpf",
    ) &&
    !signatureValid &&
    /* Исключение ровно на один известный контейнер — minimap.rpf большой
       карты (`local-trust.js`). */
    !(trusted && mayCarryNestedRpf(_internalTrust))
  )
    throw new Error(
      "Операции с вложенным RPF-контейнером разрешены только подписанному пакету.",
    );
  return {
    manifest,
    parsed,
    trusted,
    sourceRoot: path.resolve(packageRoot),
    replaceModIds,
    origin,
    _internalTrust,
  };
}

/*
 * Один пакет — в состояние цели: слои записей, запись установки, регистрации своих DLC. Архивы игры
 * здесь не собираются: их собирает установка один раз на все пакеты (`installPackageBatch`).
 * `affectedPaths` — общий список архивов, которые сменит транзакция.
 */
export async function stagePackage(
  { parsed, trusted, sourceRoot, replaceModIds, coveredModIds = [], origin, _internalTrust },
  {
    root,
    target,
    targetKey,
    paths,
    stateDir,
    signal,
    onProgress,
    rpfProbe,
    contentXmlProvider,
    dlcListProvider,
    foreignDetector,
    engineInstall,
    moveDownloads,
    affectedPaths,
    hosts,
    settleStale,
    removeModIds = [],
  },
) {
  if (
    parsed.capabilities.includes("direct-weapon-dlc-v1") &&
    !(await checkFastWeaponHostReady(target, {
      resolveInside,
      sha256File,
      allowPrepared: true,
    }))
  ) {
    throw new Error(
      "Astral Weapons DLC не подготовлен или изменён. Перезапустите подготовку GTA V в Astral.",
    );
  }
  if (
    parsed.capabilities.includes("direct-clothing-dlc-v1") &&
    !(await checkClothingHostReady(target, {
      resolveInside,
      sha256File,
      allowPrepared: true,
    }))
  ) {
    throw new Error(
      "Astral Clothing DLC не подготовлен или изменён. Перезапустите подготовку GTA V в Astral.",
    );
  }
  /*
   * Хосты оружия и одежды (22.11.2026, находка слабого ПК): их регистрация в `dlclist.xml` пересобирает update.rpf из основы. Подготовка хоста выходит «готово» раньше перебазирования, когда живой архив
   * достижим по цепочке нативных правок (`ownUpdateArchive`), — и прямые правки мастерской (фонари, небо), сделанные после, стирались. Основа вбирает их здесь, как у пакетов `direct-update-entries-v1`.
   */
  if (
    (parsed.capabilities.includes("direct-weapon-dlc-v1") || parsed.capabilities.includes("direct-clothing-dlc-v1")) &&
    !parsed.capabilities.includes("direct-update-entries-v1")
  )
    await rebaseDirectUpdateIfNeeded({ target, root, paths, targetKey, contentXmlProvider, dlcListProvider, signal });
  /*
   * Пак звуков со слотом памяти (`awc-stream-layer-v1`, К3, 22.11.2026): прав `direct-update-entries-v1` и своего DLC у него нет, а слой слотов в audioconfig.dat4.rel внутри update.rpf растёт вместе с банком, и update.rpf
   * пересобирается (`settleAudioSlotLayer`, plan-install.js). Основа вбирает правки мастерской здесь, до любого изменения состояния, как у пакетов `direct-update-entries-v1`. Без поставщика content.xml перебазирование невозможно
   * (оно бросает при изменённом снаружи архиве): вызовы движка без поставщиков (тесты слоя слотов) идут как прежде, приложение поставщиков передаёт всегда.
   */
  if (packMovesAudioSlotLayer(parsed, target) && !parsed.capabilities.includes("direct-update-entries-v1") && typeof contentXmlProvider === "function")
    await rebaseDirectUpdateIfNeeded({ target, root, paths, targetKey, contentXmlProvider, dlcListProvider, signal });
  if (parsed.capabilities.includes("direct-update-entries-v1")) {
    /*
     * Тень mods проверяется и здесь, а не только при подготовке: загрузчик
     * ставят когда угодно, в том числе после неё. Установка в архив, который
     * игра больше не читает, — это не «почти получилось», а тихая пустышка.
     */
    const shadow = await inspectModsShadow(root, exists);
    if (shadow.shadowed) {
      throw new Error(
        `Игра читает ${MODS_SHADOW_ARCHIVE}, а не свой update.rpf: рядом стоит загрузчик (${[
          ...shadow.hooks,
          ...shadow.plugins,
        ].join(
          ", ",
        )}). Уберите копию архива из папки mods или отключите загрузчик — иначе установленное в игре не появится.`,
      );
    }
    await rebaseDirectUpdateIfNeeded({
      target,
      root,
      paths,
      targetKey,
      contentXmlProvider,
      dlcListProvider,
      signal,
    });
    // Первая прямая запись в update.rpf этого профиля: живой архив станет
    // «оригиналом» — без следов прежней установки Astral, которых профиль
    // не помнит (см. astral-layer.js, «потерянный профиль»). Подготовка
    // слоя делает то же раньше; здесь — на случай установки без неё.
    if (!target.resources?.[ASTRAL_UPDATE_TARGET])
      await adoptFreshUpdateBase({
        target,
        root,
        paths,
        targetKey,
        contentXmlProvider,
        dlcListProvider,
        rpfProbe,
        resolveInside,
        signal,
        onProgress,
      });
  }
  /* Мод ждёт новой версии, а пакет несёт тот же файл целиком (склад ещё не пересобрал) — отказ до любой записи и до вопроса человеку (`stock-guard.js`). */
  await assertNotWaitingSameVersion({ target, parsed, sourceRoot, origin });
  await settleStale();
  /* Сборка человека (задача 1 ТЗ 07.10.2026): вопрос «оставить своё или
     заменить» до первой записи в игру (`foreign-entries.js`). */
  const keepsForeign = await decideForeignEntries({
    target,
    parsed,
    paths,
    stateDir,
    targetKey,
    detector: foreignDetector,
    signal,
  });
  /* Остальные архивы игры (звук, штатные пакеты дополнений): правку,
     сделанную в них после Astral, пересборка больше не стирает —
     основа берёт её из живого архива (`archive-rebase.js`). */
  if (parsed.adapter === "rpf-entry")
    for (const archiveTarget of new Set(parsed.files.map((file) => file.target)))
      await rebaseArchiveIfNeeded({ target, archiveTarget, paths, targetKey, signal });
  /* Свои пакеты Astral — звук, растительность, текстуры (`own-dlcs.js`):
     архива в игре до первой установки нет, его основа — хост приложения;
     регистрация — в dlclist.xml update.rpf. */
  const ownDlcs = ownDlcsOf(parsed);
  await prepareOwnDlcs(
    ownDlcs,
    {
      parsed,
      target,
      targetKey,
      paths,
      root,
      contentXmlProvider,
      dlcListProvider,
      rpfProbe,
      signal,
      onProgress,
    },
    hosts,
  );
  const replacementIds = new Set(
    (Array.isArray(replaceModIds) ? replaceModIds : [])
      .map(cleanId)
      .filter((id) => id && id !== parsed.id),
  );
  const allowedReplacementIds = new Set();
  for (const file of parsed.files) {
    /* Второй манифест в том же контейнере — конфликт (`merge-compatibility.js`). */
    const entryState = target.archives?.[file.target]?.entries?.[file.entry];
    if (file.merge && !sharedManifestOwner(file, entryState, parsed.id)) continue;
    if (sharesIdenticalEntry(parsed, file, entryState)) continue;
    const slide = slidesUnderMerges(parsed, file, entryState);
    const owner =
      parsed.adapter === "rpf-entry"
        ? slide
          ? slide.owner
          : entryState?.layers?.at(-1)?.modId
        : target.resources?.[file.target]?.layers?.at(-1)?.modId;
    if (owner && owner !== parsed.id) allowedReplacementIds.add(owner);
  }
  if (parsed.adapter === "managed-addon-dlc") {
    const owner = target.dlcRegistrations?.[parsed.dlcName]?.modId;
    if (owner && owner !== parsed.id) allowedReplacementIds.add(owner);
  }
  for (const installed of target.installed || []) {
    if (
      installed.modId !== parsed.id &&
      (installed.slots || []).some((slot) => parsed.slots.includes(slot))
    ) {
      allowedReplacementIds.add(installed.modId);
    }
  }
  /* Работы, которые целиком перекрыла запись нового пакета в хосте («новое заменяет старое», `host-standing.js`): их называет сам движок, слот у них может не совпасть. */
  for (const id of coveredModIds) allowedReplacementIds.add(id);
  /* Заменяемый мод, которого уже нет среди установленных, — не чужой пакет,
     а ушедший: начало этой же установки сверило update.rpf с памятью, увидело
     штатный архив после лаунчера проекта или проверки файлов и перенесло моды
     в «снятые» (`parked-mods.js`), а окно собрало список замены до того.
     Заменять нечего — id просто выпадает; отказом здесь была «Арена» в
     мастерской: «Пакет не объявляет конфликт с модификацией local-legacy-…»
     на каждом «Применить» (бета 14.10). Установленный чужой мод по-прежнему
     отвергается. */
  const installedIds = new Set(
    (target.installed || []).map((item) => item.modId),
  );
  const unrelatedReplacement = [...replacementIds].find(
    (id) => !allowedReplacementIds.has(id) && installedIds.has(id),
  );
  if (unrelatedReplacement) {
    throw new Error(
      `Пакет не объявляет конфликт с модификацией ${unrelatedReplacement}.`,
    );
  }
  for (const id of replacementIds)
    if (!allowedReplacementIds.has(id) && !installedIds.has(id))
      replacementIds.delete(id);
  /* Моды, которые уходят в этой же установке без пересечения с пакетом (смена варианта сборки): их файлы и слоты пакета
     не трогают, отдельной проверки «объявил конфликт» им не нужно — список составляет вызывающий (`installPackageBatch`). */
  for (const id of removeModIds.map(cleanId))
    if (id && id !== parsed.id) replacementIds.add(id);
  /* Пути этого пакета — свои: запись переигрывания ниже судит по ним, а не по общему списку транзакции. */
  const ownPaths = new Set();
  let dlcRegistryChanged = false;
  const supersededIds = new Set([...replacementIds, parsed.id]);
  /*
   * Вытесняется работа из носителя (`update2.rpf`): её контейнер уйдёт, регистрация — строка в `content.xml` — тоже, и `update.rpf` пересоберётся (`addCarrierRegistryArchive` в `plan-install.js`).
   * Перебазирование нужно ДО `supersedeInstalled` (пока записи вытесняемой работы числятся за ней) и не зависит от вида вытесняющего пакета: у пакетов дополнения оно условное, по первой регистрации
   * пакета, и при уже стоящих регистрациях правки мастерской, сделанные после прежней установки, стирались (Г2, 22.11.2026). Без вытеснения такой работы — ничего не меняется.
   */
  /*
   * Одно перебазирование перед вытеснением/снятием (К6 и аудит, 22.11.2026). Три случая, когда сборка update.rpf после вытеснения пойдёт из прежней основы и сотрёт правки мастерской:
   *  1) носитель: у вытесняемой работы записи в `update2.rpf` с регистрацией в content.xml (`touchesCarrierRegistry`) — любой вид вытесняющего пакета;
   *  2) у вытесняемой или снимаемой через `removeModIds` работы есть записи прямо в `update/update.rpf`;
   *  3) вытесняется пак звуков со слотом памяти (`movesAudioSlotLayer`): слой слотов уходит, `settleAudioSlotLayer` соберёт update.rpf.
   * Случаи 2 и 3 — только для пакета без прав `direct-update-entries-v1`: у такого перебазирование уже выполнено выше, второй раз не зовём; без поставщика content.xml или слоя Astral в update.rpf
   * (`resources`) перебазирование невозможно, и вызовы движка без поставщиков идут как прежде.
   */
  const withoutDirectRights = !parsed.capabilities.includes("direct-update-entries-v1") && typeof contentXmlProvider === "function" && Boolean(target.resources?.[ASTRAL_UPDATE_TARGET]);
  if (
    (target.installed || []).some((item) => {
      if (!supersededIds.has(item.modId)) return false;
      const targets = (item.archiveEntries || []).map((entry) => entry.target);
      return (
        touchesCarrierRegistry(target, new Set(targets)) ||
        (withoutDirectRights && (targets.some((name) => String(name).toLowerCase() === ASTRAL_UPDATE_TARGET) || movesAudioSlotLayer(target, item)))
      );
    })
  )
    await rebaseDirectUpdateIfNeeded({ target, root, paths, targetKey, contentXmlProvider, dlcListProvider, signal });
  if (supersededIds.size)
    dlcRegistryChanged = supersedeInstalled(target, supersededIds, ownPaths);
  const layers = [];
  const archiveEntries = [];
  /* Проверка и укладка файлов — разом (`package-payload.js`); состояние
     меняется ниже — строго по порядку, как раньше. */
  const prepared = await preparePackageFiles({
    files: parsed.files,
    root,
    sourceRoot,
    payloadDir: path.join(paths.payloads, parsed.id),
    stateDir,
    link: trusted && mayStoreByLink(_internalTrust),
    moveSources: moveDownloads === true,
    signal,
  });
  for (const [fileIndex, file] of parsed.files.entries()) {
    if (file.action === "delete") {
      const { archive } = await ensureArchiveResource({
        target,
        archiveTarget: file.target,
        root,
        paths,
        targetKey,
        signal,
        onProgress,
      });
      const entryKey = checkedRecordKey(file.entry, "Archive entry");
      let entryState = ownRecordValue(archive.entries, entryKey);
      if (!entryState) {
        entryState = setRecordValue(archive.entries, entryKey, {
          layers: [],
        });
      }
      entryState.layers = (entryState.layers || []).filter(
        (layer) => layer.modId !== parsed.id,
      );
      entryState.layers.push({
        modId: parsed.id,
        version: parsed.version,
        action: "delete",
        cachePath: null,
        sha256: null,
        allowDelete: true,
        ...(file.allowMissing ? { allowMissing: true } : {}),
      });
      archiveEntries.push({ target: file.target, entry: file.entry });
      ownPaths.add(file.target);
      continue;
    }
    const { actualHash, cachePath } = prepared[fileIndex];
    /* Человек оставил свою правку этой записи — слоя Astral на ней нет. */
    if (parsed.adapter === "rpf-entry" && keepsForeign(file)) continue;
    if (parsed.adapter === "rpf-entry") {
      const { archive } = await ensureArchiveResource({
        target,
        archiveTarget: file.target,
        root,
        paths,
        targetKey,
        signal,
        onProgress,
      });
      const entryKey = checkedRecordKey(file.entry, "Archive entry");
      let entryState = ownRecordValue(archive.entries, entryKey);
      if (!entryState) {
        entryState = setRecordValue(archive.entries, entryKey, {
          layers: [],
        });
      }
      const slide = slidesUnderMerges(parsed, file, entryState);
      entryState.layers = placeLayer(
        (entryState.layers || []).filter((layer) => layer.modId !== parsed.id),
        {
          modId: parsed.id,
          version: parsed.version,
          action: file.action,
          cachePath,
          sha256: actualHash,
          ...(file.merge ? { merge: file.merge } : {}),
          ...(parsed.capabilities.includes("astral-content-rpf-v1")
            ? { astralContent: true }
            : {}),
        },
        slide,
      );
      archiveEntries.push({ target: file.target, entry: file.entry });
      ownPaths.add(file.target);
      continue;
    }
    const livePath = resolveInside(root, file.target);
    const resourceKey = checkedRecordKey(file.target, "Resource target");
    let resource = ownRecordValue(target.resources, resourceKey);
    if (!resource) {
      const basePath = path.join(
        paths.bases,
        targetKey,
        createHash("sha256").update(file.target.toLowerCase()).digest("hex"),
      );
      const baseExists = await exists(livePath);
      if (baseExists) {
        await fs.mkdir(path.dirname(basePath), { recursive: true });
        await fs.copyFile(livePath, basePath);
      }
      const original = {
        exists: baseExists,
        path: baseExists ? basePath : null,
        sha256: baseExists ? await sha256File(livePath) : null,
        verified: true,
      };
      const clean =
        isManagedOverlayTarget(file.target) ||
        parsed.capabilities.includes("loader-install-v1")
          ? missingBaseline()
          : { ...copyBaseline(original), verified: false };
      resource = {
        base: original,
        compositionBase: original,
        original,
        clean,
        layers: [],
      };
      setRecordValue(target.resources, resourceKey, resource);
    }
    resource.layers = (resource.layers || []).filter(
      (layer) => layer.modId !== parsed.id,
    );
    resource.layers.push({
      modId: parsed.id,
      version: parsed.version,
      cachePath,
      sha256: actualHash,
    });
    layers.push(file.target);
    ownPaths.add(file.target);
  }
  /* Штатные записи под слоями «целиком» (`stock-guard.js`): после обновления игры по ним видно, что Rockstar изменили файл, поверх которого собран мод. */
  if (parsed.adapter === "rpf-entry") await recordStockUnderLayers({ target, modId: parsed.id, stateDir, signal });
  target.installed = (target.installed || []).filter(
    (item) => item.modId !== parsed.id,
  );
  /* Игрок сам поставил мод — игра больше не «штатная до установки»
     (`stockHold`, index.js), а «снятые» той же работы не нужны. */
  delete target.stockHold;
  forgetSupersededParked(target, { modId: parsed.id, slots: parsed.slots });
  target.installed.push({
    modId: parsed.id,
    version: parsed.version,
    adapter: parsed.adapter,
    slots: parsed.slots,
    targetId: targetKey,
    resources: layers,
    installedAt: new Date().toISOString(),
    mode: "transactional",
    /* Нужна ли этой работе пара загрузчиков (`loader-need.js`): по ней пара уходит, когда не нужна никому. */
    needsLoader: parsed.needsLoader === true,
    ...(archiveEntries.length ? { archiveEntries } : {}),
    ...(parsed.dlcName ? { dlcName: parsed.dlcName } : {}),
    ...installOrigin(origin),
    /* Запись переигрывания (`replay.json` точки) — только если движок подменял update.rpf: снятый
       мод возвращает её вместе с записью, и «Установить снова» переигрывает без пересборки. */
    ...(engineInstall && engineInstall.opsOnly !== true && (engineInstall.multi === true || (ownPaths.size === 1 && ownPaths.has("update/update.rpf")))
      ? { engineReplay: engineInstall.replay }
      : {}),
  });
  const activatesFastWeaponDlc = parsed.capabilities.includes("direct-weapon-dlc-v1");
  const needsFastWeaponActivation =
    activatesFastWeaponDlc &&
    (target.fastWeaponDlc?.preparedOnly === true ||
      !target.directDlcRegistrations[FAST_WEAPON_DLC_NAME]);
  if (needsFastWeaponActivation) {
    target.directDlcRegistrations[FAST_WEAPON_DLC_NAME] = {
      owner: "@astral-fast-weapon-host",
      registeredAt: new Date().toISOString(),
    };
    await composeDirectDlcRegistry({
      target,
      targetKey,
      paths,
      dlcListProvider,
      archiveTarget: "update/update.rpf",
    });
    target.fastWeaponDlc.preparedOnly = false;
    ownPaths.add("update/update.rpf");
  }
  await registerOwnDlcs(ownDlcs, { target, targetKey, paths, dlcListProvider }, ownPaths);
  const activatesClothingDlc = parsed.capabilities.includes("direct-clothing-dlc-v1");
  const needsClothingActivation =
    activatesClothingDlc &&
    (target.clothingDlc?.preparedOnly === true ||
      !target.directDlcRegistrations[CLOTHING_DLC_NAME]);
  if (needsClothingActivation) {
    target.directDlcRegistrations[CLOTHING_DLC_NAME] = {
      owner: "@astral-clothing-host",
      registeredAt: new Date().toISOString(),
    };
    await composeDirectDlcRegistry({
      target,
      targetKey,
      paths,
      dlcListProvider,
      archiveTarget: "update/update.rpf",
    });
    target.clothingDlc.preparedOnly = false;
    ownPaths.add("update/update.rpf");
  }
  for (const place of ownPaths) affectedPaths.add(place);
  return { ownDlcs, dlcRegistryChanged, activatesFastWeaponDlc };
}
