import { packageUrlForRegion } from "../../../network-regions.js";
import { recordDesktopCatalogDownload } from "../../telemetry/index.js";
import { buildBlockedNotice } from "../../builds/logic.js";
import { packGuns } from "../../library/pack-card-model.js";
import { isGunpackPack } from "../../library/gunpack-state.js";
import { getCloudDownloadGrant, planLocalPackage } from "./bundle-api.js";
import { MAX_BATCH_PACKAGES, enqueueBatch, prepareBatch } from "./batch-install.js";

/*
 * Ганпак по стволам (библиотека по компонентам, 22.11.2026).
 *
 * Каталожный ганпак скачивается и ставится как один ганпак — одной строкой «Загрузок» и одной транзакцией движка, — а в игре и в библиотеке лежит по стволам: у каждого ствола своя запись
 * установки со своей корзиной (`origin.bundleId` — id пака, как у частей сборки редукса). Пакет самого пака при этом не ставится.
 *
 * Пакет пака — все стволы и ВСЕ обвесы; пакет ствола — только подходящие ему по таблице игры (`attachmentFitsWeapon`). Свои обвесы автора, которых нет в таблице, едут лишь в пакете пака:
 * их несёт служебная запись «прочее ганпака» (`apps/desktop/src/gunpack-extras.js`). Окно считает, что в неё идёт (`packRemainder`), главный процесс собирает пакет из подписанных файлов пака.
 *
 * Не раскладывается (`"legacy"` — ход прежний, пак одной записью): нет части состава в каталоге, пак больше предела пачки, «прочее» не годится в пакет ганпака (файл не из потока оружия,
 * тот же файл у ствола с другим содержимым). Модуль ленивый: оболочка берёт его по `import()` из `effects-install-run.js`, в стартовый кусок он не входит (потолок `main-*.js`).
 */

/** Цель файлов оружия в пакете каталога: Astral Weapons DLC (`GUNPACK_DLC_TARGET` движка). */
const WEAPON_DLC_TARGET = "update/x64/dlcpacks/astral_weapons/dlc.rpf";
/** Файл ствола и обвеса в потоке оружия — тот же разбор, что у «прочего» в главном процессе (`gunpack-extras.js`, проверяется тестом). */
const EXTRA_ENTRY = /^astral_stream\.rpf\/(w_[a-z]{2}_[a-z0-9_+]{1,80}\.(?:ydr|ytd))$/;
const MODEL_NAME = /^w_[a-z]{2}_[a-z0-9_]{1,60}$/;
const MAX_EXTRA_FILES = 400;
/** Размер файла строгого пакета ганпака: не меньше 16 байт и не больше 64 МиБ (`gunpack-manifest-trust.js`). */
const MIN_EXTRA_BYTES = 16;
const MAX_EXTRA_BYTES = 64 * 1024 * 1024;
const AFTER_MODEL = /[_+0-9]/;

const hex = (value) => String(value || "").replace(/^sha256:/i, "").toLowerCase();

export { isGunpackPack };

/**
 * Что из пакета пака не несёт ни один ствол: записи (`entry`) его файлов, которых нет у стволов с тем же содержимым.
 * @param {object} packManifest подписанный манифест пака
 * @param {object[]} childManifests манифесты стволов
 * @returns {{ entries: string[], bytes: number, conflicts: string[] }} `conflicts` — записи, что у ствола есть с ДРУГИМ содержимым: такой остаток не разложить
 */
export function packRemainder(packManifest, childManifests = []) {
  const carried = new Map();
  for (const manifest of childManifests)
    for (const file of manifest?.files || []) {
      if (file.action === "delete") continue;
      if (!carried.has(file.entry)) carried.set(file.entry, new Set());
      carried.get(file.entry).add(hex(file.sha256));
    }
  const entries = [];
  const conflicts = [];
  let bytes = 0;
  for (const file of packManifest?.files || []) {
    if (file.action === "delete") continue;
    const known = carried.get(file.entry);
    if (known?.has(hex(file.sha256))) continue;
    if (known) conflicts.push(file.entry);
    entries.push(file.entry);
    bytes += Number(file.size) || 0;
  }
  return { entries: entries.sort(), bytes, conflicts };
}

/** Модели файлов «прочего»: имя без расширения; файл с продолжением имени (`…_hi`, `+hi`) принадлежит короткой модели (`modelsOfFiles` главного процесса). */
export function extrasModelsOf(names) {
  const stems = [...new Set(names.map((name) => name.replace(/\.(?:ydr|ytd)$/, "")))].sort((left, right) => left.length - right.length || (left < right ? -1 : 1));
  const models = [];
  for (const stem of stems) if (!models.some((model) => stem === model || (stem.startsWith(model) && AFTER_MODEL.test(stem.charAt(model.length))))) models.push(stem);
  return models;
}

/** Годится ли остаток в строгий пакет ганпака: файлы оружия в Astral Weapons DLC допустимого размера, не больше предела, модели с допустимыми именами. */
export function extrasFit(packManifest, entries) {
  if (!entries.length || entries.length > MAX_EXTRA_FILES) return false;
  const byEntry = new Map((packManifest?.files || []).map((file) => [file.entry, file]));
  const names = [];
  for (const entry of entries) {
    const match = EXTRA_ENTRY.exec(entry);
    const record = byEntry.get(entry);
    if (!match || record?.target !== WEAPON_DLC_TARGET || !Number.isInteger(record.size) || record.size < MIN_EXTRA_BYTES || record.size > MAX_EXTRA_BYTES) return false;
    names.push(match[1]);
  }
  return extrasModelsOf(names).every((model) => MODEL_NAME.test(model));
}

/** Подписанный пакет пака: готовый манифест карточки или ссылка скачивания облака (как у одиночной установки). */
async function signedPackOf(pack, region) {
  const baseUrl = pack.manifest ? packageUrlForRegion(pack, region) : "";
  if (baseUrl) return { manifest: pack.manifest, baseUrl };
  const grant = await getCloudDownloadGrant(pack.id);
  recordDesktopCatalogDownload(pack.id);
  return { manifest: grant.manifest, baseUrl: grant.packageBaseUrl };
}

/**
 * «Установить» на карточке ганпака: пак встаёт по стволам — одна строка очереди, одна транзакция.
 * @param {object} pack карточка пака (`isGunpackPack`)
 * @param {object} shell состояние оболочки (`bundleShell`): `game, preparation, prepareGame, mods, installed, region, notify, notices, language, queue, setQueue, source`
 * @returns {Promise<"queued" | "legacy" | "stopped">} `legacy` — разложить нельзя, оболочка ставит пак по-старому; `stopped` — остановлено с объяснением человеку
 */
export async function installGunpackParts(pack, shell) {
  const { game, mods, installed, region, notify, language } = shell;
  if (!isGunpackPack(pack) || !game || shell.demoMode) return "legacy";
  const guns = packGuns(pack, mods);
  /* Состав неполон (части нет в каталоге) или не из стволов — по частям нельзя: потерялись бы стволы пака. */
  if (guns.length !== pack.includedModIds.length || guns.some((gun) => !gun?.domain?.weapon?.model || gun.domain.weapon.pack)) return "legacy";
  if (guns.length + 1 > MAX_BATCH_PACKAGES) return "legacy";
  /* Пак стоит прежней одной записью (id пака среди установленных, ни одного ствола от него нет): по частям его не доложить — прежний ход скажет «уже установлен». Пак по стволам стоит и «частично»:
     id пака в `installed` окно добавляет, пока стоит хоть один ствол (`engine-ids.js`), недостающие стволы ставятся этой же кнопкой. */
  if (installed.includes(pack.id) && !guns.some((one) => installed.includes(one.id))) return "legacy";

  if (shell.preparation.stockHold) await shell.prepareGame(game, { force: true, releaseStockHold: true });
  if (game.installReadiness !== "ready") {
    notify(shell.notices.finishPreparation);
    void shell.prepareGame(game, { force: true });
    return "stopped";
  }
  /* Скачивания считаются по паку (как раньше), а не по каждому из его стволов. */
  const prepared = await prepareBatch({
    name: pack.name,
    parts: guns,
    bundle: pack,
    installed,
    allMods: mods,
    region,
    game,
    getDownloadGrant: getCloudDownloadGrant,
    recordDownload: () => {},
    planPackage: planLocalPackage,
    packageURL: packageUrlForRegion,
  });
  if (prepared.blocked?.length) {
    notify(buildBlockedNotice({ build: pack.name, blocked: prepared.blocked, internalConflicts: prepared.internalConflicts }, language), "error");
    return "stopped";
  }
  /* Стволы одного пака несут одну и ту же запись (общий обвес: фонарь и рукоять у тяжёлой винтовки и «сайги» в таблице игры одни) — по стволам такой пак не разложить: два пакета одной
     записью не владеют. В 1.0.3 это был отказ «…меняют одно и то же в игре», и пак не вставал вовсе (жалоба 23.11.2026, «Ганпак matik74»); ход прежний — пак одной записью, как в 1.0.2. */
  if (prepared.internalConflicts?.length) {
    /* Пак уже стоит по стволам (id пака среди установленных): прежний ход ответил бы «уже установлен» и не поставил ничего — здесь честнее прежний отказ со словами, какие стволы спорят. */
    if (!installed.includes(pack.id)) return "legacy";
    notify(buildBlockedNotice({ build: pack.name, blocked: [], internalConflicts: prepared.internalConflicts }, language), "error");
    return "stopped";
  }
  if (prepared.tooBig) return "legacy";
  if (!prepared.item) {
    notify(shell.notices.alreadyInstalled(pack.name));
    return "stopped";
  }
  const { item } = prepared;
  /* «Прочее» считается только на полной установке: когда стоят не все стволы, служебная запись уже стоит с ними (снимается она вместе с последним стволом). */
  if (item.batch.packages.length === guns.length) {
    const signed = await signedPackOf(pack, region);
    const rest = packRemainder(signed.manifest, item.batch.packages.map((one) => one.manifest));
    if (rest.entries.length) {
      if (rest.conflicts.length || !extrasFit(signed.manifest, rest.entries)) return "legacy";
      item.batch.extras = { manifest: signed.manifest, baseUrl: signed.baseUrl, entries: rest.entries, label: pack.name };
    }
  }
  item.id = pack.id;
  enqueueBatch(item, shell);
  return "queued";
}
