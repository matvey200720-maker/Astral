/*
 * Свои пакеты дополнения Astral, устроенные одинаково: звук (`audio-dlc.js`),
 * растительность (`vegetation-dlc.js`, задача 10) и текстуры
 * (`textures-dlc.js`, задача 1 ТЗ 05.10.2026) и места мастерской
 * (`places-dlc.js`, фикс 1 ТЗ 06.10.2026) и дороги (`roads-dlc.js`, задача 6
 * ТЗ 07.10.2026). Архив пакета собирает хост
 * приложения, движок кладёт его в `dlcpacks` до записи архивов и
 * регистрирует в `dlclist.xml` update.rpf после.
 *
 * Раньше `plan-install.js` держал по два одинаковых шага на каждый пакет; с
 * каждым новым пакетом файл рос на тридцать строк. Здесь — один список, в
 * прежнем порядке: звук, растительность, текстуры, места, дороги.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { tracedStep } from "./install-trace.js";
import { astralDlcRegistrations } from "./astral-paths.js";
import { resolveInside } from "./manifest.js";
import { noteReconcile } from "./reconcile-report.js";
import { exists } from "./storage-state.js";
import { ASTRAL_UPDATE_TARGET } from "./registry-composers.js";
import {
  AUDIO_DLC_CAPABILITY,
  AUDIO_DLC_TARGET,
  prepareAudioDlc,
  registerAudioDlc,
} from "./audio-dlc.js";
import {
  VEGETATION_DLC_B_CAPABILITY,
  VEGETATION_DLC_B_TARGET,
  VEGETATION_DLC_C_CAPABILITY,
  VEGETATION_DLC_C_TARGET,
  VEGETATION_DLC_CAPABILITY,
  VEGETATION_DLC_TARGET,
  prepareVegetationDlc,
  prepareVegetationDlcB,
  prepareVegetationDlcC,
  registerVegetationDlc,
  registerVegetationDlcB,
  registerVegetationDlcC,
  vegetationBaseOverlays,
} from "./vegetation-dlc.js";
import {
  TEXTURES_DLC_B_CAPABILITY,
  TEXTURES_DLC_B_TARGET,
  TEXTURES_DLC_C_CAPABILITY,
  TEXTURES_DLC_C_TARGET,
  TEXTURES_DLC_CAPABILITY,
  TEXTURES_DLC_TARGET,
  prepareTexturesDlc,
  prepareTexturesDlcB,
  prepareTexturesDlcC,
  registerTexturesDlc,
  registerTexturesDlcB,
  registerTexturesDlcC,
} from "./textures-dlc.js";
import {
  ROADS_DLC_B_CAPABILITY,
  ROADS_DLC_B_TARGET,
  ROADS_DLC_CAPABILITY,
  ROADS_DLC_TARGET,
  prepareRoadsDlc,
  prepareRoadsDlcB,
  registerRoadsDlc,
  registerRoadsDlcB,
} from "./roads-dlc.js";
import {
  PLACES_DLC_CAPABILITY,
  PLACES_DLC_TARGET,
  placesBaseOverlays,
  preparePlacesDlc,
  registerPlacesDlc,
} from "./places-dlc.js";
import { tailCarriersOfState } from "./rpf-tail-switch.js";

const OWN_DLCS = Object.freeze([
  Object.freeze({
    capability: AUDIO_DLC_CAPABILITY,
    target: AUDIO_DLC_TARGET,
    host: "audioDlcHost",
    prepare: prepareAudioDlc,
    register: registerAudioDlc,
  }),
  Object.freeze({
    capability: VEGETATION_DLC_CAPABILITY,
    target: VEGETATION_DLC_TARGET,
    host: "vegetationDlcHost",
    prepare: prepareVegetationDlc,
    register: registerVegetationDlc,
    /* Записи основы, которые работа перекрывает (пустые типы копий «В разнобой»). */
    overlays: vegetationBaseOverlays,
  }),
  /* Второй пакет растительности — трава обеих зон «Травы по миру» (06.10.2026). */
  Object.freeze({
    capability: VEGETATION_DLC_B_CAPABILITY,
    target: VEGETATION_DLC_B_TARGET,
    host: "vegetationDlcBHost",
    prepare: prepareVegetationDlcB,
    register: registerVegetationDlcB,
  }),
  /* Третий пакет растительности — только у работ на три пакета (19.11.2026). */
  Object.freeze({
    capability: VEGETATION_DLC_C_CAPABILITY,
    target: VEGETATION_DLC_C_TARGET,
    host: "vegetationDlcCHost",
    prepare: prepareVegetationDlcC,
    register: registerVegetationDlcC,
  }),
  Object.freeze({
    capability: TEXTURES_DLC_CAPABILITY,
    target: TEXTURES_DLC_TARGET,
    host: "texturesDlcHost",
    prepare: prepareTexturesDlc,
    register: registerTexturesDlc,
  }),
  /* Второй пакет текстур — модели ЧБ-мира сверх первого (ТЗ 17.10.2026). */
  Object.freeze({
    capability: TEXTURES_DLC_B_CAPABILITY,
    target: TEXTURES_DLC_B_TARGET,
    host: "texturesDlcBHost",
    prepare: prepareTexturesDlcB,
    register: registerTexturesDlcB,
  }),
  /* Третий пакет текстур — мир на 256 px не лезет в два (ТЗ 17.10.2026, задача 10). */
  Object.freeze({
    capability: TEXTURES_DLC_C_CAPABILITY,
    target: TEXTURES_DLC_C_TARGET,
    host: "texturesDlcCHost",
    prepare: prepareTexturesDlcC,
    register: registerTexturesDlcC,
  }),
  Object.freeze({
    capability: PLACES_DLC_CAPABILITY,
    target: PLACES_DLC_TARGET,
    host: "placesDlcHost",
    prepare: preparePlacesDlc,
    register: registerPlacesDlc,
    /* Записи основы, которые место перекрывает (пустые постоянные типы). */
    overlays: placesBaseOverlays,
  }),
  /* Дороги — два пакета: словари всех частей больше 4 ГиБ (задача 6 ТЗ 07.10.2026). */
  Object.freeze({
    capability: ROADS_DLC_CAPABILITY,
    target: ROADS_DLC_TARGET,
    host: "roadsDlcHost",
    prepare: prepareRoadsDlc,
    register: registerRoadsDlc,
  }),
  Object.freeze({
    capability: ROADS_DLC_B_CAPABILITY,
    target: ROADS_DLC_B_TARGET,
    host: "roadsDlcBHost",
    prepare: prepareRoadsDlcB,
    register: registerRoadsDlcB,
  }),
]);

/**
 * Хост своего пакета, на месте которого стоит запись `target`: до первой
 * установки пакета в игре нет, основа — архив, собранный приложением.
 */
export function ownDlcHostFor(target, hosts) {
  return hosts[OWN_DLCS.find((dlc) => dlc.target === target)?.host] || null;
}

/** Записи основы своего пакета, которые установка вправе перекрыть. */
export const ownDlcOverlaysFor = (target) => OWN_DLCS.find((dlc) => dlc.target === target)?.overlays?.() || [];

/** Какие свои пакеты включает манифест. */
export const ownDlcsOf = (parsed) =>
  OWN_DLCS.filter((dlc) => parsed.capabilities.includes(dlc.capability));

const PACK_NAME = /^update\/x64\/dlcpacks\/([a-z0-9_]+)\/dlc\.rpf$/i;

/* Строка журнала раздела install: движок сам журнала не ведёт, приложение подключает его при старте (`setOwnDlcHealNotice`). */
let healNotice = () => {};
export const setOwnDlcHealNotice = (notice) => {
  healNotice = typeof notice === "function" ? notice : () => {};
};

/**
 * Самопочинка регистрации своих пакетов (14.11.2026, «Дороги» не ставились на beta.103). Состояние помнит регистрацию пакета в `directDlcRegistrations`, а установка пишет её
 * в `dlclist.xml` один раз: если живой update.rpf строку потерял (проверка файлов Rockstar, возврат update.rpf, перемотка стопки), `register` отвечал «уже записано», архив не
 * пересобирался, и самопроверка (`dlc-archive-check.js`) каждый раз находила пакет вне dlclist.xml. Здесь перед подготовкой сверяем состояние с живым dlclist.xml и, когда
 * пакета в нём нет, забываем запись: пакет проходит обычную ветку первой установки, а `register` возвращает архив update.rpf в пересборку.
 * Нечем прочитать (нет провайдера, нет архива, чтение упало) — поведение прежнее. Живой dlclist.xml читается один раз на установку.
 * @returns {Promise<string[]>} имена пакетов, регистрацию которых вернули
 */
export async function healLostOwnRegistrations(dlcs, { target, root, paths, targetKey, dlcListProvider, signal } = {}) {
  const remembered = dlcs
    .map((dlc) => PACK_NAME.exec(dlc.target)?.[1])
    .filter((name) => name && target?.directDlcRegistrations?.[name]);
  if (!remembered.length || typeof dlcListProvider !== "function" || !root || !paths?.bases || !targetKey) return [];
  const livePath = resolveInside(root, ASTRAL_UPDATE_TARGET);
  if (!(await exists(livePath))) return [];
  const directory = path.join(paths.bases, targetKey, "astral-layer");
  const stage = path.join(directory, `${randomUUID()}.heal-dlclist.xml.stage`);
  let live = null;
  try {
    await fs.mkdir(directory, { recursive: true });
    await dlcListProvider({ baseArchive: livePath, gameRoot: target.gameRoot || root, edition: target.edition, output: stage, signal });
    live = astralDlcRegistrations(await fs.readFile(stage, "utf8"));
  } catch (error) {
    if (signal?.aborted) throw error;
    return [];
  } finally {
    await fs.rm(stage, { force: true }).catch(() => {});
  }
  const lost = remembered.filter((name) => !live.includes(name.toLowerCase()));
  for (const name of lost) {
    delete target.directDlcRegistrations[name];
    noteReconcile(target, { kind: "dlc-registration-restored", dlc: name });
    healNotice({ level: "warn", message: `регистрация ${name} пропала из dlclist.xml — возвращаю` });
  }
  return lost;
}

/** Положить пакеты в `dlcpacks` — до записи архивов. */
export async function prepareOwnDlcs(dlcs, context, hosts) {
  await healLostOwnRegistrations(dlcs, context);
  for (const dlc of dlcs)
    await dlc.prepare({ ...context, host: hosts[dlc.host] });
}

/** Зарегистрировать пакеты в `dlclist.xml` — после записи архивов. */
export async function registerOwnDlcs(dlcs, context, affectedPaths) {
  for (const dlc of dlcs) {
    const registered = await dlc.register(context);
    if (registered) affectedPaths.add(registered);
  }
}

/**
 * Игра откроет собранные пакеты? Перед подменой файлов игры их перечитывает проверка приложения (`dlcVerifier`,
 * `dlc-archive-check.js`, Хелперы 15 и 16, 26.10.2026): отказ — в игру ничего не записано, а карточка не ложится в библиотеку.
 * `archives` — `{ relativePath, livePath, sourcePath }` изменённых архивов установки; `target` — состояние игры в движке:
 * записи работы, что оно числит в каждом пакете, должны лежать в собранном архиве.
 */
export async function verifyOwnDlcPacks(verifier, dlcs, archives, { target = null, root = "", signal = null, layerVerifier = null } = {}) {
  /* Контейнеры слоя Astral в update.rpf — той же проверкой перед подменой (`verifyAstralLayers`), даже когда своих пакетов дополнения нет. */
  await verifyAstralLayers(layerVerifier, archives, { target, signal });
  if (typeof verifier !== "function" || !dlcs.length) return;
  const expectedEntries = new Map(
    dlcs.map((dlc) => [
      dlc.target.toLowerCase(),
      Object.entries(target?.archives?.[dlc.target]?.entries || {})
        .filter(([, entryState]) => {
          const top = entryState?.layers?.at(-1);
          return top && top.action !== "delete";
        })
        .map(([entry]) => entry.toLowerCase()),
    ]),
  );
  await tracedStep("проверка пакетов дополнения", () => verifier({ affected: archives, ownTargets: dlcs.map((dlc) => dlc.target), expectedEntries, root, signal }));
}

/**
 * Игра увидит контейнеры слоя Astral (`x64/astral/*.rpf` в update.rpf)? Тот же хук-проверка, что у пакетов дополнения, но для
 * записей, что состояние числит за слоем в update.rpf: арена автора, залазы, интерьеры, моды каталога (`layerVerifier`,
 * `dlc-archive-check.js: verifyLayerContainers`, 26.10.2026). `archives` — изменённые архивы установки; update.rpf берётся собранный.
 */
export async function verifyAstralLayers(verifier, archives, { target = null, signal = null } = {}) {
  if (typeof verifier !== "function") return;
  /* Носители хвоста кроме update.rpf (`update/update2.rpf`): среди изменённых — проверка хвоста перед подменой (контейнеры слоя у них не по content.xml). */
  const tailCarriers = tailCarriersOfState(target);
  for (const item of archives) {
    const carrier = item.relativePath.toLowerCase();
    if (carrier === "update/update.rpf" || !tailCarriers.includes(carrier)) continue;
    await tracedStep(`проверка хвоста ${carrier}`, () => verifier({ file: item.sourcePath || item.livePath, entries: [], archiveTarget: carrier, signal }));
  }
  const update = archives.find((item) => item.relativePath.toLowerCase() === "update/update.rpf");
  if (!update) return;
  const entries = Object.entries(target?.archives?.["update/update.rpf"]?.entries || {})
    .filter(([entry, entryState]) => /^x64\/astral\/[^/]+\.rpf\//i.test(entry) && entryState?.layers?.at(-1) && entryState.layers.at(-1).action !== "delete")
    .map(([entry]) => entry.toLowerCase());
  if (!entries.length) return;
  await tracedStep("проверка контейнеров Astral", () => verifier({ file: update.sourcePath || update.livePath, entries, signal }));
}
