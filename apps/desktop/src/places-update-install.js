import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { annotateRpFallback, rpFallbackInfo } from "./rp-fallback.js";
import path from "node:path";
import {
  PLACES_RP_MANIFEST,
  PLACES_RP_MANIFEST_PAYLOAD,
  placesRpHallEnabled,
  placesRpTypesEnabled,
  placesRpLine,
  placesRpManifestDependencies,
  placesRpSplit,
} from "@modovik/install-engine/places-rp-parts.js";
import { buildPlacesContainerManifest, isLocalPlacesContainerManifest } from "@modovik/install-engine/places-container-manifest-trust.js";
import { RECOLOR_SETS } from "@modovik/install-engine/recolor-manifest-trust.js";
import { PLACES_DLC_SETS } from "@modovik/install-engine/places-dlc.js";
import {
  PLACES_VIA_UPDATE_ENV,
  placesBudgetBytes,
  placesEligibility,
  placesPacksStanding,
  placesPartialSet,
  placesRefusalLine,
  placesRouteAuto,
  placesUpdateRouteEnabled,
  selectPlacesSet,
} from "@modovik/install-engine/places-update-route.js";

/*
 * Места мастерской через контейнер в `update.rpf` со стороны приложения (GTA 5 RP, 20.11.2026, `places-update-route.js`): выключатель `ASTRAL_PLACES_VIA_UPDATE=container`, проверка набора до сборки и
 * проверка собранного по настоящим размерам до первой записи в игру. Выключатель пуст — `placesContainerRequest` отдаёт `null`, сборка и установка идут прежним путём (пакет `astral_places`),
 * поведение прежнее байт в байт (для Majestic ничего не меняется). Набор едет целиком или отказ с кодом (`PlacesContainerRefusal`).
 * Если режим включён САМ (метка `ASTRAL_RP_MODE_AUTO`), отказ не доходит до человека: набор ставится прежним путём, а в журнал уходит строка с кодом (`placesViaUpdate`).
 * Арена (21.11.2026) едет ЧАСТЬЮ: четыре перекрытия типов игры и всё, что едет только с ними, на RP не кладутся (`arena-rp-parts.js`), остальное — контейнером; ответ плана несёт `chosen` / `refused` для слов окна.
 */

const MiB = 1024 * 1024;
const miB = (bytes) => Math.ceil(bytes / MiB);

/** Отказ режима: код (`PLACES_REFUSAL_CODES`) и строка журнала в сообщении. */
export class PlacesContainerRefusal extends Error {
  constructor(code, params = {}) {
    super(placesRefusalLine(code, params));
    this.name = "PlacesContainerRefusal";
    this.code = code;
    this.params = params;
  }
}

/**
 * Запрос режима для сборки набора мест: `{ setId, updateLength, auto }` или `null` (выключатель пуст или это не набор мест). Отказывает до сборки: набор с перекрытием карт и типов игры,
 * набор в архивах сетевой карты, набор уже стоит в пакете `astral_places`. Длину `update.rpf` не прочитать — ошибка: режим не гадает про бюджет.
 */
export async function placesContainerRequest({ env = process.env, setId, statUpdate, readState, targetId = "", stateDir = "" } = {}) {
  if (!placesUpdateRouteEnabled(env) || !PLACES_DLC_SETS.includes(setId)) return null;
  const answer = placesEligibility(setId);
  /* Набор с частичным маршрутом (арена, здания): `overrides` и `map-set` для него не отказ, а «часть едет, часть нет» (`finishPlacesContainer`). */
  const partial = !answer.ok && (answer.code === "overrides" || answer.code === "map-set") && placesPartialSet(setId);
  if (!answer.ok && !partial) throw new PlacesContainerRefusal(answer.code, { setId, count: answer.count });
  const state = await readState({ stateDir });
  const installed = state?.targets?.[targetId]?.installed || [];
  if (placesPacksStanding({ setId, installed })) throw new PlacesContainerRefusal("packs-standing", { setId });
  let updateLength;
  try {
    updateLength = Number(await statUpdate());
  } catch (error) {
    throw new Error(`Не прочитана длина update.rpf: ${error?.message || error}. Места через update.rpf без неё не планируются.`);
  }
  return { setId, updateLength, auto: placesRouteAuto(env), ...(partial ? { partial: true, code: answer.code, hall: placesRpHallEnabled(setId, env), types: placesRpTypesEnabled(setId, env) } : {}) };
}

/**
 * Манифест контейнера частичной арены, собранный заново по едущим файлам (`compile-manifest` без основы): в нём только связи «карта → типы», обе стороны которых лежат в контейнере. Манифест полной
 * сборки называет и снятые типы (плашки зала, копии вещей) — такого имени в контейнере нет, а список с отсутствующим именем — тот класс поломок, от которого падал сюжет. Связей нет — манифест не нужен (`null`).
 * Файл ложится в пакет сборки под именем `_manifest.rp.ymf`: полный `_manifest.ymf` пакета остаётся как был.
 */
async function partialPlacesManifest({ setId, built, kept, compile }) {
  const dependencies = placesRpManifestDependencies(setId, kept);
  if (!dependencies.length) return null;
  if (typeof compile !== "function") throw new Error("Манифест арены для GTA 5 RP не собран: нет нативного хоста.");
  const payload = path.join(built.packageRoot, "payload");
  const staging = path.join(built.packageRoot, "rp-manifest");
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(staging, { recursive: true });
  try {
    const input = path.join(staging, "manifest.json");
    const output = path.join(staging, PLACES_RP_MANIFEST);
    await fs.writeFile(input, JSON.stringify({ format: "astral.compile-manifest", version: 1, dependencies }));
    await compile("compile-manifest", { input, output });
    const bytes = await fs.readFile(output).catch(() => null);
    if (!bytes?.length) throw new Error("Манифест арены для GTA 5 RP не собрался.");
    await fs.writeFile(path.join(payload, PLACES_RP_MANIFEST_PAYLOAD), bytes);
    return { name: PLACES_RP_MANIFEST, payload: PLACES_RP_MANIFEST_PAYLOAD, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Проверка собранного по настоящим размерам и манифест контейнерной формы вместо манифеста пакета. До первой записи в игру: не влезло — `PlacesContainerRefusal("over-budget")`.
 * `built` — результат сборки набора (`{ manifest, packageRoot, payloadFiles, summary }`), `statSize` — подмена чтения размера файла (тесты).
 */
export async function finishPlacesContainer({ built, request, statSize = async (file) => (await fs.stat(file)).size, compile = null }) {
  const { setId } = request;
  const payload = path.join(built.packageRoot, "payload");
  /* Частичный набор: в контейнер идёт только то, что без перекрытий; снятое остаётся в сборке (пакетная форма) и в манифест контейнера не попадает. */
  const split = request.partial ? placesRpSplit(setId, (built.payloadFiles || []).map((file) => file.name), { hall: request.hall === true, types: request.types === true }) : null;
  const carried = split ? new Set(split.kept) : null;
  /* Билборды (21.11.2026): «видно N из M щитов» — по проекту работы, а не по файлам (`billboards-rp-count.js`, по требованию: сборка щитов в стартовый граф не входит). */
  const shields = split && setId === "billboards" && request.project ? (await import("./billboards-rp-count.js")).billboardsRpShields(request.project, split.kept) : null;
  const files = [];
  for (const file of built.payloadFiles || [])
    if ((!carried || carried.has(file.name)) && !(split && file.name === PLACES_RP_MANIFEST)) files.push({ name: file.name, sha256: file.sha256, size: await statSize(path.join(payload, file.name)) });
  if (!files.length) {
    /* Снято всё: нечего положить на RP — отказ с тем же кодом, что у набора целиком (`overrides` или `map-set`; режим включён сам — прежний путь и слова «на GTA 5 RP не видно»). */
    if (split) throw new PlacesContainerRefusal(setId === "billboards" ? "no-visible" : request.code || "overrides", { setId, count: split.dropped.length, total: shields?.total });
    throw new Error("Места через update.rpf: сборка не дала ни одного файла.");
  }
  /* Ни один щит работы на RP не виден (все листы в пакетах игры или щитам нужны копии и типы районов): класть нечего — отказ, как при «снято всё». */
  if (shields && shields.total > 0 && shields.seen === 0) throw new PlacesContainerRefusal("no-visible", { setId, count: split.dropped.length, total: shields.total });
  const budget = placesBudgetBytes({ updateLength: request.updateLength });
  let keptNow = split ? split.kept : null;
  let shown = shields;
  /* Билборды не влезли в предел (контейнер 1 ГиБ или бюджет `update.rpf`): едут целые щиты, пока влезают, остальные остаются как в игре; в словах «видно N из M» и «не влезло K» (`billboardsRpFit`). Ни один не влез — отказ с кодом размера. */
  if (shields && shields.total > 0) {
    const probe = selectPlacesSet({ setId, files, budget });
    if (!probe.fits) {
      const { billboardsRpFit } = await import("./billboards-rp-count.js");
      /* Манифест контейнера ещё не собран: запас под него в пробе. */
      const fitted = billboardsRpFit({ project: request.project, files, fits: (list) => selectPlacesSet({ setId, files: [...list, { name: PLACES_RP_MANIFEST, size: 65536 }], budget }).fits });
      if (!fitted.seen) throw new PlacesContainerRefusal(probe.code, { setId, needMiB: miB(probe.cost), budgetMiB: miB(budget) });
      files.splice(0, files.length, ...files.filter((file) => fitted.names.has(file.name.toLowerCase())));
      keptNow = split.kept.filter((name) => fitted.names.has(name.toLowerCase()));
      shown = { seen: fitted.seen, total: fitted.total, limited: fitted.limited };
    }
  }
  /* Манифест частичного набора — заново по едущим файлам (полный называл бы снятые типы). */
  if (split && carried.has(PLACES_RP_MANIFEST)) {
    const manifest = await partialPlacesManifest({ setId, built, kept: keptNow, compile });
    if (manifest) files.push(manifest);
  }
  const answer = selectPlacesSet({ setId, files, budget });
  if (!answer.fits) throw new PlacesContainerRefusal(answer.code, { setId, needMiB: miB(answer.cost), budgetMiB: miB(budget) });
  const manifest = buildPlacesContainerManifest(setId, files);
  if (!isLocalPlacesContainerManifest(manifest, "Legacy")) throw new Error("Собранный набор не прошёл строгую проверку доверия (форма контейнера).");
  return { ...built, manifest, summary: { ...(built.summary || {}), ...(split ? { files: files.length } : {}), entry: `x64/astral/${RECOLOR_SETS[setId].container}`, archive: "update/update.rpf", viaUpdate: { set: setId, bytes: answer.bytes, cost: answer.cost, budget, lines: split ? [placesRpLine(setId, split)] : [], ...(split ? { chosen: split.chosen, refused: split.refused, droppedParts: [] } : {}), ...(shown ? { shields: shown } : {}) } }, viaUpdate: true };
}

/**
 * Сборка набора мест с режимом контейнера. `build()` — прежняя сборка (как без режима). Режим выключен — ровно её результат. Режим включён: проверка набора до сборки, сборка, проверка и манифест
 * контейнерной формы. Отказ: включённый человеком — ошибка с кодом; включённый САМ (метка режима RP) — результат прежней сборки (пакет) и строка журнала `note`.
 */
export async function placesViaUpdate({ env = process.env, setId, statUpdate, readState, targetId, stateDir, build, note = (line) => console.warn(`[astral] ${line}`), statSize, compile, project = null } = {}) {
  let request = null;
  try {
    request = await placesContainerRequest({ env, setId, statUpdate, readState, targetId, stateDir });
  } catch (error) {
    if (!(error instanceof PlacesContainerRefusal) || !placesRouteAuto(env)) throw error;
    note(`${error.message} Режим включён автоматически: набор ставится прежним путём (пакет astral_places).`);
    return annotateRpFallback(await build(), rpFallbackInfo("places", error.code));
  }
  const built = await build();
  if (!request) return built;
  try {
    const done = await finishPlacesContainer({ built, request: project ? { ...request, project } : request, ...(statSize ? { statSize } : {}), ...(compile ? { compile } : {}) });
    for (const line of done.summary?.viaUpdate?.lines || []) note(line);
    return done;
  } catch (error) {
    if (!(error instanceof PlacesContainerRefusal) || !request.auto) throw error;
    note(`${error.message} Режим включён автоматически: набор ставится прежним путём (пакет astral_places).`);
    return annotateRpFallback(built, rpFallbackInfo("places", error.code));
  }
}

export { PLACES_VIA_UPDATE_ENV };
