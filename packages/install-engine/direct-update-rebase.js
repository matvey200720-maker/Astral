import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolveInside } from "./manifest.js";
import { fingerprintSha256 } from "./file-fingerprint.js";
import {
  ASTRAL_CONTAINER_ROOT,
  astralContainerOf,
  astralContentRegistrations,
  astralDlcRegistrations,
} from "./astral-paths.js";
import {
  composeAstralContentRegistry,
  composeDirectDlcRegistry,
  ownedAstralContainers,
  touchesCarrierRegistry,
} from "./registry-composers.js";
import { noteReconcile } from "./reconcile-report.js";
import { movesAudioSlotLayer } from "./audio-slot-layer.js";
import { inOperation } from "./operation-scope.js";
import { throwIfAborted } from "./runtime-guard.js";
import {
  nativeTouchedEntries,
  ownRewindInProgress,
  reachedByOwnNativeChanges,
  rewoundEngineSteps,
} from "./native-history.js";
import { modsInArchives, parkMods } from "./parked-mods.js";
import { WAITING_FOR_VERSION, stockChangedLayers } from "./stock-guard.js";
import { copyAbsorbed, copyWorkOver, exists } from "./storage-state.js";
import { storedFileTimes } from "./chunk-store.js";
import { noteAbsorbed, noteLiveBefore } from "./engine-steps.js";
import { copyFileCancellable } from "./transaction.js";
import {
  SHIFT_AUDIT_FORMAT,
  ShiftBaseRefused,
  cleanDirectUpdateBase,
  directBaseReferences,
  healShiftEntries,
  resolveBaseTools,
} from "./direct-base-cleanup.js";


/*
 * Очистка основы — не повод уронить установку: без неё движок работает, как
 * до 27.09.2026 (основа с нашими записями, `carried`), и падает только там,
 * где собранной записи нужен прежний вид файла игры. Причина уходит в журнал
 * главного процесса.
 */
async function cleanOrNull(options) {
  try {
    return await cleanDirectUpdateBase(options);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    /* Отказ по сдвиговой записи — не повод работать «как до 27.09»: основа с вобранным сдвигом копила бы его при каждой сборке (10.11.2026). */
    if (error instanceof ShiftBaseRefused) throw error;
    console.warn(
      `[astral-engine] Основа update.rpf не очищена от записей Astral: ${error?.message || error}`,
    );
    return null;
  }
}

/*
 * Перемотка мимо вобранной правки (Т-170).
 *
 * Основа перебазирования вбирает то, что лежит в живом архиве под слоями движка, —
 * чаще всего работу мастерской на той же записи, что мод каталога (мини-карта поверх
 * мини-карты). Снятие работы перематывает архив к копии до неё, и движок
 * перебазируется снова: запись мода в перемотанном архиве доказана как файл слоя, и
 * прежний вид для неё брался из прежней основы — той, что вобрала снятую работу.
 * Работа возвращалась под мод и вылезала, когда мод уйдёт.
 *
 * Поэтому основа помнит, что вобрала, в какой операции и что было до этого
 * (`absorbed`: запись → `[{ source, step, prior }]`). Какие операции перемотаны, по
 * байтам архива не понять: перемотанный архив бывает побайтно равен более позднему
 * (работа под модом не меняет итога). Это знает снятие — оно помечает перематываемые
 * звенья (`rewoundEngineSteps`), и вобранное ими снимается со стопки: прежним видом
 * записи становится то, что было до него.
 */
async function rewoundPriors({ previous, gameRoot }) {
  const stacks = copyAbsorbed(previous?.absorbed) || {};
  /* Основа ничего не вобрала — перематывать нечего, историю точек отката (на настоящем ПК — секунды чтения) не читаем (22.11.2026: перебазирование теперь зовётся и при установке скина оружия и вещи одежды). */
  if (!Object.keys(stacks).length) return { overrides: {}, kept: {} };
  const rewound = await rewoundEngineSteps({ gameRoot });
  const overrides = {};
  const kept = {};
  for (const [entry, stack] of Object.entries(stacks)) {
    let depth = stack.length;
    while (depth > 0 && stack[depth - 1].step && rewound.has(stack[depth - 1].step)) depth -= 1;
    if (depth < stack.length) overrides[entry] = stack[depth].prior;
    if (depth > 0) kept[entry] = stack.slice(0, depth);
  }
  return { overrides, kept };
}

/**
 * Снятие перемотало операцию, правку которой основа вобрала: архив пересобрать
 * надо, даже если он побайтно тот, что движок собирал (`prepareAstralLayer`).
 */
export async function hasRewoundAbsorption({ target, gameRoot }) {
  const base = target?.resources?.["update/update.rpf"]?.compositionBase;
  if (!base?.absorbed) return false;
  const { overrides } = await rewoundPriors({ previous: base, gameRoot });
  return Object.keys(overrides).length > 0;
}

/*
 * update.rpf удалили руками (задача 1 ТЗ 10.10.2026: «ручное удаление
 * файлов»). У Astral есть копия игры без своих записей — «до Astral»
 * (`pristine`), очищенная основа (`withoutAstral`) или защищённая копия
 * первой подготовки, — она и кладётся на место, если снята после последнего
 * обновления игры (по времени GTA5.exe: копия прежней версии вернула бы
 * устаревший архив). Дальше установка идёт как обычно: слои лягут поверх.
 */
async function restoreMissingUpdate({ target, resource, livePath, root, signal }) {
  const executable = await fs.stat(path.join(root, "GTA5.exe")).catch(() => null);
  const candidates = [resource.pristine, resource.original, resource.compositionBase]
    .filter((item) => item?.exists && item.path && (item === resource.pristine || item.withoutAstral === true || /update-update\.rpf\.original\.rpf$/i.test(item.path)));
  for (const candidate of candidates) {
    /* Копия кусками собирается; время — исходного файла, а не сборки (`chunk-store.js`). */
    if (!(await exists(candidate.path))) continue;
    const stat = await storedFileTimes(candidate.path);
    if (!stat) continue;
    if (executable && executable.mtimeMs > (stat.birthtimeMs || stat.mtimeMs)) continue;
    await fs.mkdir(path.dirname(livePath), { recursive: true });
    const stage = `${livePath}.astral-stage-${randomUUID()}`;
    try {
      await copyFileCancellable(candidate.path, stage, signal, null, "", { durable: true });
      await fs.rename(stage, livePath);
    } catch (error) {
      await fs.rm(stage, { force: true }).catch(() => {});
      throw error;
    }
    noteReconcile(target, { kind: "update-restored", from: path.basename(candidate.path) });
    return true;
  }
  return false;
}

/* Метка папки слоя Astral (`astral-layer.js`; здесь своим именем — без
   кольца импортов). */
const LAYER_MARKER_ENTRY = `${ASTRAL_CONTAINER_ROOT}/astral_layer.json`;
const LAYER_MARKER_MOD_ID = "@astral-layer";

/*
 * Ушёл ли Astral из update.rpf (задача 2 ТЗ 10.10.2026). Архив сменили в
 * обход движка — это может быть наш же нативный патч (небо, мини-карта):
 * он переносит наш content.xml и папку `x64/astral` как есть. А проверка
 * файлов, обновление игры и лаунчер проекта кладут архив, в котором Astral
 * нет совсем: ни одного нашего контейнера и DLC в реестрах, ни метки папки.
 * Своя перемотка корзины библиотеки (копия из точки отката) — не проверка
 * файлов: о ней знает история (`ownRewindInProgress`).
 */
async function astralLeftUpdate({
  target,
  archiveTarget,
  resource,
  livePath,
  liveHash,
  liveContainers,
  liveDlcs,
  baseTools,
  signal,
}) {
  const archive = target.archives?.[archiveTarget];
  const modded = Object.values(archive?.entries || {}).some((state) =>
    (state?.layers || []).some((layer) => layer?.modId && !String(layer.modId).startsWith("@")),
  );
  const dlcMods = Object.keys(target.directDlcRegistrations || {}).length > 0;
  if (!modded && !dlcMods) return false;
  if (await ownRewindInProgress({ gameRoot: target.gameRoot })) return false;
  const ownedContainers = ownedAstralContainers(archive).map((entry) =>
    entry.slice(ASTRAL_CONTAINER_ROOT.length + 1),
  );
  if (ownedContainers.some((name) => liveContainers.includes(name))) return false;
  const ownedDlcs = Object.keys(target.directDlcRegistrations || {}).map((name) => name.toLowerCase());
  if (liveDlcs && ownedDlcs.some((name) => liveDlcs.includes(name))) return false;
  const marker = archive?.entries?.[LAYER_MARKER_ENTRY]?.layers?.at(-1);
  const markerExpected = marker?.modId === LAYER_MARKER_MOD_ID && marker.action !== "delete";
  const tools = resolveBaseTools(baseTools);
  if (markerExpected && tools) {
    throwIfAborted(signal);
    try {
      const found = await tools.entryProbe({
        archivePath: livePath,
        entries: [LAYER_MARKER_ENTRY],
        archiveTarget,
        edition: target.edition,
        gameRoot: target.gameRoot,
        signal,
      });
      return ![...(found || [])].some((entry) => String(entry).toLowerCase() === LAYER_MARKER_ENTRY);
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  /* Метки не спросить: наши контейнеры и DLC были — и ни одного не осталось. */
  if (ownedContainers.length || (liveDlcs && ownedDlcs.length)) return true;
  /* Только заменённые записи игры: Astral ушёл, если архив снова тот, что был до нас. */
  const stock = [resource.pristine?.sha256, resource.original?.sha256].filter(Boolean);
  return stock.includes(liveHash);
}

/*
 * Регистрации Astral в живом архиве: контейнеры `x64/astral` из content.xml и
 * свои DLC из dlclist.xml. По ним видно, остался ли Astral в игре, и какие
 * из них — следы, которых состояние не знает.
 */
async function readLiveRegistrations({ target, archiveTarget, livePath, liveHash, directory, contentXmlProvider, dlcListProvider }) {
  await fs.mkdir(directory, { recursive: true });
  const contentStage = path.join(directory, `${liveHash}.content.xml.stage`);
  const dlcListStage = path.join(directory, `${liveHash}.dlclist.xml.stage`);
  let foreignContainers = [];
  let foreignDlcs = [];
  let liveContainers = [];
  let liveDlcs = null;
  try {
    await contentXmlProvider({
      baseArchive: livePath,
      gameRoot: target.gameRoot,
      edition: target.edition,
      output: contentStage,
    });
    const owned = ownedAstralContainers(target.archives?.[archiveTarget]).map(
      (entry) => entry.slice(ASTRAL_CONTAINER_ROOT.length + 1),
    );
    liveContainers = astralContentRegistrations(
      await fs.readFile(contentStage, "utf8"),
    );
    foreignContainers = liveContainers.filter((name) => !owned.includes(name));
    if (typeof dlcListProvider === "function") {
      await dlcListProvider({
        baseArchive: livePath,
        gameRoot: target.gameRoot,
        edition: target.edition,
        output: dlcListStage,
      });
      liveDlcs = astralDlcRegistrations(await fs.readFile(dlcListStage, "utf8"));
      /* Свой DLC, в хосте которого стоят вещи Astral (стволы, одежда), —
         наш, даже если подготовка успела забыть его регистрацию: она звала
         оружейный хост с `activate: false` и снимала её в состоянии, а в
         dlclist.xml игры строка оставалась (07.10.2026). Регистрация
         возвращается в состояние — она и есть правда об игре. Только если
         строка в живом dlclist.xml есть (14.11.2026): иначе «возвращённая»
         запись говорила установке «пакет уже записан», и потерянная строка
         не возвращалась (дороги на beta.103). */
      for (const name of ownHostsInUse(target)) {
        target.directDlcRegistrations ||= {};
        if (!target.directDlcRegistrations[name] && liveDlcs.includes(name.toLowerCase()))
          target.directDlcRegistrations[name] = {
            owner: "@astral-own-host",
            registeredAt: new Date().toISOString(),
            restored: true,
          };
      }
      const ownedDlcs = Object.keys(target.directDlcRegistrations || {}).map(
        (name) => name.toLowerCase(),
      );
      foreignDlcs = liveDlcs.filter((name) => !ownedDlcs.includes(name));
    }
  } finally {
    await fs.rm(contentStage, { force: true }).catch(() => {});
    await fs.rm(dlcListStage, { force: true }).catch(() => {});
  }
  return { foreignContainers, foreignDlcs, liveContainers, liveDlcs };
}

/* Astral ушёл из архива — моды этого архива уходят в «снятые проверкой файлов». */
async function parkIfAstralLeft({ target, archiveTarget, resource, livePath, liveHash, liveContainers, liveDlcs, baseTools, signal }) {
  if (!(await astralLeftUpdate({ target, archiveTarget, resource, livePath, liveHash, liveContainers, liveDlcs, baseTools, signal })))
    return [];
  const parked = parkMods(target, {
    modIds: modsInArchives(target, [archiveTarget]),
    reason: liveHash === (resource.pristine?.sha256 || resource.original?.sha256) ? "restored" : "replaced",
    archives: [archiveTarget],
  });
  if (parked.length) noteReconcile(target, { kind: "restored-by-launcher", modIds: parked, archive: archiveTarget });
  return parked;
}

/*
 * Обновление игры изменило штатный файл под слоем мода «целиком» (`stock-guard.js`): мод ждёт новой версии и на новую основу не накладывается. Идущие слои
 * снимаются в «снятые» с причиной `waiting-for-version`; уже снятые проверкой файлов (Steam вернул штатный архив) помечаются так же, чтобы «Установить снова»
 * не положило их старые файлы поверх нового штатного. Прежней основы на диске нет и отпечатка у слоя нет — слой кладётся, как раньше (`stock-unchecked` в журнал).
 * Возвращает `{ changed, unchecked, modIds }`.
 */
export async function parkModsWaitingForVersion({ target, archiveTarget, previous, baseline, paths, baseTools, signal }) {
  let result = { changed: [], unchecked: [], modIds: [] };
  try {
    result = await stockChangedLayers({ target, archiveTarget, previous, baseline, stateDir: paths?.root, tools: resolveBaseTools(baseTools), signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    /* Сверка — забота о сборке, а не условие обновления: не вышло прочитать — слои кладутся, как до неё. */
    console.warn(`[astral-engine] Штатные записи под слоями не сверены: ${error?.message || error}`);
    return result;
  }
  if (!result.modIds.length) {
    if (result.unchecked.length) noteReconcile(target, { kind: "stock-unchecked", modIds: [...new Set(result.unchecked.map((item) => item.modId))].sort(), entries: result.unchecked.length });
    return result;
  }
  const waiting = {};
  for (const item of result.changed) (waiting[item.modId] ||= []).push({ entry: item.entry, was: item.was, now: item.now });
  const live = result.modIds.filter((modId) => !result.changed.some((item) => item.modId === modId && item.parked));
  parkMods(target, { modIds: live, reason: WAITING_FOR_VERSION, archives: [archiveTarget], waiting });
  for (const item of Array.isArray(target.parked) ? target.parked : []) {
    if (!result.modIds.includes(item.modId) || (item.reason === WAITING_FOR_VERSION && item.waiting?.length)) continue;
    item.reason = WAITING_FOR_VERSION;
    item.waiting = waiting[item.modId] || [];
  }
  noteReconcile(target, { kind: WAITING_FOR_VERSION, modIds: [...result.modIds].sort(), entries: result.changed.slice(0, 12).map((item) => item.entry) });
  return result;
}

/* Хост своего DLC: `update/x64/dlcpacks/astral_<имя>/dlc.rpf`. */
const OWN_HOST = /^update\/x64\/dlcpacks\/(astral_[a-z0-9_]+)\/dlc\.rpf$/i;

/** Свои DLC, в хостах которых стоит хоть одна вещь Astral. */
export function ownHostsInUse(target) {
  const names = [];
  for (const [archiveTarget, archive] of Object.entries(target?.archives || {})) {
    const match = OWN_HOST.exec(archiveTarget);
    if (!match) continue;
    if (Object.values(archive?.entries || {}).some((entry) => (entry?.layers || []).length > 0))
      names.push(match[1].toLowerCase());
  }
  return names;
}

/* Стопки новой основы: то, что осталось после перемотки, и то, что вобрано сейчас. */
function nextAbsorbed(kept, absorbedNow, live, step, own = false) {
  const out = { ...kept };
  for (const [entry, prior] of Object.entries(absorbedNow || {}))
    out[entry] = [...(out[entry] || []), { source: live, step, prior, ...(own ? { own: true } : {}) }];
  return copyAbsorbed(out);
}

/*
 * `pristine` — игра «до Astral», цель «Вернуть GTA V без модов» (Т-162).
 * `original` — архив без слоёв движка: его снятие последнего мода кладёт в
 * игру, и после нашей нативной правки он обязан её нести. Пока правки наши,
 * эти двое расходятся: `pristine` держит прежний оригинал. Чужая правка
 * (обновление игры) — новая игра, и `pristine` уходит. `undefined` — не
 * трогать (повторная очистка той же основы).
 */
function adoptBaseline(target, resource, baseline, pristine) {
  resource.base = baseline;
  resource.compositionBase = baseline;
  resource.original = baseline;
  resource.clean = { ...baseline, verified: false };
  if (pristine !== undefined) {
    if (pristine?.exists) resource.pristine = pristine;
    else delete resource.pristine;
  }
  if (target.archives?.["update/update.rpf"])
    delete target.archives["update/update.rpf"].lastBuilt;
}

/*
 * Лечение основы со вобранным сдвигом (10.11.2026). Основа с меткой `withoutAstral` больше не очищалась, поэтому сдвиг слоя «Окружения», вобранный
 * ею при `keep` (13 раз у владельца), лежал в ней вечно. Раз на основу (метка `shiftAudit`) сдвиговые записи сверяются с защищённой копией игры
 * и, если отличаются, возвращаются штатными; слой потом ложится один раз при сборке. `true` — основа заменена.
 */
async function healShiftBase({ target, resource, paths, targetKey, gameRoot, baseTools, signal }) {
  const base = resource.compositionBase;
  if (!base?.exists || !base.path || base.withoutAstral !== true || base.shiftAudit === SHIFT_AUDIT_FORMAT) return false;
  const references = await directBaseReferences({ resource, gameRoot, paths, targetKey, previous: null });
  const healed = await healShiftEntries({ target, base, references, paths, targetKey, baseTools, signal });
  /* Лечение читает основу, а её может не быть (чистка кэша: ни файла, ни описи кусков; опись есть, а куски потеряны). Перебазирование зовут снятие работы из носителя, пак звуков и «Установить снова» (22.11.2026), и чтение
     пропавшей основы роняло бы всю операцию. «Нет основы» (`missing`) определяет `healShiftEntries` — ровно ответом `false` у `ensureStoredFile`, и только когда основу читать всё же надо; отмена и нехватка места наружу. Тогда: предупреждение,
     лечение сдвига пропущено, основа и её метки не тронуты (проверка повторится), операция идёт дальше; пропавшую основу поднимает сборка (`ensureBaseFile`). Любая другая ошибка чтения (EBUSY, сбой движка) — не «основы нет»:
     лечение не пропускается молча, иначе сборка ляжет поверх невылеченного сдвига, и операция падает, как раньше. */
  if (healed.missing) {
    console.warn(`[astral-engine] Основа update.rpf не проверена на сдвиг слоя «Окружения»: основы нет (${path.basename(base.path)}), её поднимет сборка`);
    return false;
  }
  if (!healed.audited) return false;
  if (!healed.changed) {
    /* Проверена и чиста: метка ставится на основу, больше её не смотрим. */
    const checked = { ...base, shiftAudit: SHIFT_AUDIT_FORMAT };
    for (const key of ["base", "compositionBase", "original"])
      if (resource[key]?.path && base.path && path.resolve(resource[key].path) === path.resolve(base.path)) resource[key] = checked;
    return false;
  }
  const absorbed = copyAbsorbed(base.absorbed);
  const workOver = copyWorkOver(base.workOver);
  adoptBaseline(target, resource, {
    exists: true,
    path: healed.path,
    sha256: healed.sha256,
    verified: true,
    withoutAstral: true,
    shiftAudit: SHIFT_AUDIT_FORMAT,
    ...(base.liveSha256 ? { liveSha256: base.liveSha256 } : {}),
    ...(absorbed ? { absorbed } : {}),
    ...(workOver ? { workOver } : {}),
  });
  noteReconcile(target, { kind: "shift-healed", entries: healed.healed.map((item) => item.entry) });
  return true;
}

/*
 * Основа, снятая перебазированием до 27.09.2026, несёт записи движка — те,
 * что лежали в живом архиве. Они вычищаются один раз, когда движок в
 * следующий раз смотрит на update.rpf; основа с меткой `withoutAstral`
 * больше не проверяется.
 */
async function removeOwnEntriesFromAdoptedBase({
  target,
  resource,
  paths,
  targetKey,
  liveHash,
  baseTools,
  materializers,
  signal,
}) {
  const base = resource.compositionBase;
  const adopted = path.join(paths.bases, targetKey, "update-rebases");
  if (!base?.exists || base.withoutAstral === true || !base.path) return false;
  const relative = path.relative(
    path.resolve(adopted),
    path.resolve(base.path),
  );
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    return false;
  const cleaned = await cleanOrNull({
    target,
    source: { path: base.path, sha256: base.sha256, carried: base.carried },
    references: await directBaseReferences({
      resource,
      gameRoot: target.gameRoot,
      paths,
      targetKey,
      exclude: base.path,
    }),
    paths,
    targetKey,
    baseTools,
    materializers,
    signal,
  });
  if (!cleaned) return false;
  /* Повторная очистка той же основы ничего нового не вбирает: что основа помнит,
     остаётся при ней. */
  const absorbed = copyAbsorbed(base.absorbed);
  /* И запись «работа поверх слоя»: новой она при повторной очистке не берётся (образцов
     и истории здесь нет), прежняя остаётся при основе. */
  const workOver = copyWorkOver(base.workOver);
  adoptBaseline(
    target,
    resource,
    cleaned.changed
      ? {
          exists: true,
          path: cleaned.path,
          sha256: cleaned.sha256,
          verified: true,
          withoutAstral: true,
          liveSha256: liveHash,
          ...(absorbed ? { absorbed } : {}),
          ...(workOver ? { workOver } : {}),
        }
      : {
          exists: true,
          path: base.path,
          sha256: base.sha256,
          verified: true,
          withoutAstral: true,
          ...(absorbed ? { absorbed } : {}),
          ...(workOver ? { workOver } : {}),
        },
  );
  return cleaned.changed;
}

/**
 * Перебазирование перед снятием мода.
 *
 * update.rpf мог смениться в обход движка — нативным патчем неба, мини-карты
 * или прицела. Снятие собирается поверх живого архива, как и установка:
 * иначе пересборка из прежней основы молча стёрла бы небо, поставленное
 * минутой раньше тем же «Применить». Зовётся до того, как слои мода сняты:
 * его записи ещё числятся за ним, и основа запоминает их как свои, чтобы
 * убрать.
 */
export async function rebaseBeforeUninstall({
  target,
  installed,
  touchesDirectDlc,
  paths,
  targetKey,
  contentXmlProvider,
  dlcListProvider,
  signal,
  baseTools,
  materializers,
}) {
  /* Работа, все записи которой лежат в носителе (`update2.rpf`), в `update/update.rpf` записей не имеет, но её снятие уберёт регистрацию контейнера из `content.xml` и соберёт `update.rpf` заново (`addCarrierRegistryArchive`):
     без перебазирования сборка шла бы из прежней основы и стирала правки мастерской, сделанные после установки (Г2, 22.11.2026). Условие то же, что у самой регистрации (`touchesCarrierRegistry`). */
  const touchesUpdate =
    (installed?.archiveEntries || []).some(
      (item) => String(item.target).toLowerCase() === "update/update.rpf",
    ) ||
    touchesDirectDlc ||
    /* Пак звуков со слотом памяти: снятие пересчитает слой слотов и соберёт update.rpf заново (`settleAudioSlotLayer`), хотя записей в update.rpf у пака нет (К3, 22.11.2026). */
    movesAudioSlotLayer(target, installed) ||
    touchesCarrierRegistry(target, new Set((installed?.archiveEntries || []).map((item) => item.target)));
  if (
    !touchesUpdate ||
    !target.resources?.["update/update.rpf"] ||
    typeof contentXmlProvider !== "function"
  )
    return false;
  return rebaseDirectUpdateIfNeeded({
    target,
    root: target.gameRoot,
    paths,
    targetKey,
    contentXmlProvider,
    dlcListProvider,
    signal,
    baseTools,
    materializers,
  });
}

/*
 * Чем кончилось последнее перебазирование цели: архив пришёл от наших правок или подменён снаружи.
 * Журналу подготовки (`prepare-log.js` приложения) нужно знать, чья это подмена; состояние это не
 * хранит, поэтому — в памяти, по цели.
 */
const lastRebases = new WeakMap();

/** `{ own }` последнего перебазирования цели в этой операции или `null`, если архив не менялся. */
export const lastRebaseOf = (target) => lastRebases.get(target) || null;

/**
 * Приводит основу update.rpf к живому архиву, если его сменили в обход
 * движка, — и держит её без записей Astral (`direct-base-cleanup.js`).
 *
 * `baseTools` и `materializers` — для тестов; приложение регистрирует свои
 * наборы по умолчанию при запуске.
 *
 * Одна операция (`operation-scope.js`): вопросы к истории точек отката внутри неё — пять и больше — разбирают стопку один раз.
 *
 * @returns {Promise<boolean>} основа сменилась
 */
export function rebaseDirectUpdateIfNeeded(options) {
  return inOperation(() => rebaseDirectUpdate(options));
}

async function rebaseDirectUpdate({
  target,
  root,
  paths,
  targetKey,
  contentXmlProvider,
  dlcListProvider,
  signal,
  baseTools = {},
  materializers = {},
  /* Ушёл ли Astral из архива (проверка файлов, обновление игры, лаунчер
     проекта), — моды уходят в «снятые проверкой файлов» (`parked-mods.js`,
     задача 2 ТЗ 10.10.2026). Выключено у «Установить снова»: там слои
     возвращаются нарочно. */
  parkRestored = true,
}) {
  const archiveTarget = "update/update.rpf";
  const resource = target.resources?.[archiveTarget];
  if (!resource) return false;
  lastRebases.delete(target);
  const livePath = resolveInside(root, archiveTarget);
  /* Архив вернул сам Astral (его удалили руками) — моды не «сняты проверкой
     файлов»: они ложатся обратно этой же операцией. */
  let restoredByAstral = false;
  if (!(await exists(livePath))) {
    restoredByAstral = await restoreMissingUpdate({ target, resource, livePath, root, signal });
    if (!restoredByAstral)
      throw new Error(
        "update/update.rpf is missing. Repair GTA V before installing mods.",
      );
  }
  throwIfAborted(signal);
  /* Отпечаток по записи файла (задача 8): архив, который движок сам только
     что положил и сверил, не перечитывается. */
  const liveHash = await fingerprintSha256(livePath);
  /* Звено истории (`engine-steps.js`): с какого архива операция началась. */
  const step = noteLiveBefore({ bases: paths.bases, targetKey, sha256: liveHash });
  const expectedHash =
    resource.layers?.at(-1)?.sha256 || resource.compositionBase?.sha256;
  /* Снятие перемотало операции, правку которых основа вобрала: основу надо снять
     заново — даже если перемотанный архив побайтно тот, что движок собрал. */
  const previous = resource.compositionBase;
  const { overrides, kept } = await rewoundPriors({
    previous,
    gameRoot: target.gameRoot || root,
  });
  const rewound = Object.keys(overrides).length > 0;
  /* Очищенная основа отличается от живого архива, с которого снята, пока
     поверх неё не собрано: это тот же архив, а не правка снаружи. */
  if (
    !rewound &&
    (liveHash === expectedHash ||
      liveHash === resource.compositionBase?.liveSha256)
  ) {
    /* Живой архив — тот, с которого основа снята, а собранного Astral в
       игре нет: проверка файлов вернула архив, каким он был до первой
       сборки (задача 2 ТЗ 10.10.2026). Моды не ложатся обратно молча. */
    if (
      liveHash !== expectedHash &&
      expectedHash &&
      parkRestored &&
      !restoredByAstral &&
      typeof contentXmlProvider === "function"
    ) {
      const live = await readLiveRegistrations({
        target,
        archiveTarget,
        livePath,
        liveHash,
        directory: path.join(paths.bases, targetKey, "update-rebases"),
        contentXmlProvider,
        dlcListProvider,
      });
      await parkIfAstralLeft({ target, archiveTarget, resource, livePath, liveHash, ...live, baseTools, signal });
    }
    if (
      await healShiftBase({ target, resource, paths, targetKey, gameRoot: target.gameRoot || root, baseTools, signal })
    )
      return true;
    return removeOwnEntriesFromAdoptedBase({
      target,
      resource,
      paths,
      targetKey,
      liveHash,
      baseTools,
      materializers,
      signal,
    });
  }
  if (typeof contentXmlProvider !== "function") {
    throw new Error("Astral cannot verify the externally changed update.rpf.");
  }
  const directory = path.join(paths.bases, targetKey, "update-rebases");
  /*
   * Архив сменили в обход движка, а в нём стоят регистрации Astral. Чаще
   * всего это наш же нативный патч (небо, мини-карта, прицел): он
   * пересобирает update.rpf целиком и переносит в него наш content.xml как
   * есть. Такие строки наши — движок пишет их заново поверх очищенной
   * основы (`ensureAstralContentBase`).
   *
   * Строка контейнера или DLC, которых состояние не знает, — тоже след
   * Astral: `x64/astral/*` и `dlcpacks:/astral_*` создаёт только он. Это
   * update.rpf из старой копии игры или резервной копии, слой прежней
   * установки Astral, другой профиль. Раньше движок на этом отказывал
   * («update.rpf was changed outside Astral…»), и человек оставался без
   * единой установки, хотя никто, кроме Astral, архив не трогал (задача 1 ТЗ
   * 10.10.2026). Теперь следы убираются: их файлы — из основы
   * (`cleanDirectUpdateBase`, `foreignContainers`), строки — из реестров,
   * которые собираются заново без строк Astral, — и это пишется в отчёт.
   */
  const { foreignContainers, foreignDlcs, liveContainers, liveDlcs } = await readLiveRegistrations({
    target,
    archiveTarget,
    livePath,
    liveHash,
    directory,
    contentXmlProvider,
    dlcListProvider,
  });
  throwIfAborted(signal);
  if (parkRestored && !restoredByAstral)
    await parkIfAstralLeft({ target, archiveTarget, resource, livePath, liveHash, liveContainers, liveDlcs, baseTools, signal });
  /*
   * Новая основа — живой архив без того, что положил в него сам движок:
   * чужая правка остаётся, наши записи получают прежний вид из прежней
   * основы (`direct-base-cleanup.js`). Иначе основа несла бы собранное
   * прошлым «Применить», и правка, которой нужен файл игры, на нём не встала
   * бы.
   */
  /* Живой архив получен из собранного движком нашими же нативными правками — слои в нём лежат. */
  const layersInLive =
    liveHash === expectedHash ||
    (await reachedByOwnNativeChanges({ gameRoot: target.gameRoot || root, known: [expectedHash], live: liveHash }));
  const cleaned = await cleanOrNull({
    target,
    source: { path: livePath, sha256: liveHash, carried: previous?.carried },
    references: await directBaseReferences({
      resource,
      gameRoot: root,
      paths,
      targetKey,
      previous,
    }),
    overrides,
    trackAbsorbed: true,
    watch: await nativeTouchedEntries({ gameRoot: target.gameRoot || root }),
    previousWorkOver: previous?.workOver,
    layersInLive,
    foreignContainers,
    paths,
    targetKey,
    baseTools,
    materializers,
    signal,
  });
  /* След для разбора: какие собранные записи очистка оставила в основе и почему (10.11.2026: пятнадцатое накопление сдвига нечем было датировать —
     причины жили только в возврате функции). В окне события этого вида не показываются. */
  const keptBuilt = (cleaned?.kept || []).filter((item) => /^(сборка на образцах|нет сборщика|нет надёжного образца)/.test(String(item?.reason || "")));
  if (keptBuilt.length)
    noteReconcile(target, { kind: "base-kept", kept: keptBuilt.slice(0, 12).map((item) => ({ entry: item.entry, reason: String(item.reason).slice(0, 200) })) });
  /* Наша нативная правка или чужая — по цепочке точек отката от архива, который движок знает.
     Архив, который движок собрал сам (перемотка вернула его побайтно), — наш. */
  const own = liveHash === expectedHash || await reachedByOwnNativeChanges({
    gameRoot: target.gameRoot || root,
    known: [
      expectedHash,
      previous?.sha256,
      previous?.liveSha256,
      resource.original?.sha256,
      resource.pristine?.sha256,
    ],
    live: liveHash,
  });
  /* Вобранное нашей правкой помечается: его `prior` — штатный вид записи, на нём считается отпечаток слоя «целиком» (`stock-guard.js`). */
  const absorbed = nextAbsorbed(kept, cleaned?.absorbed, liveHash, step, own);
  if (cleaned?.absorbed && Object.keys(cleaned.absorbed).length)
    noteAbsorbed({ bases: paths.bases, targetKey });
  /* Работа мастерской поверх слоя каталога («последний применённый побеждает»): только если
     архив пришёл от наших же правок или снятие работы перемотало его к нашей точке отката
     (`rewound`). Чужая подмена (обновление игры, проверка файлов) — не работа: слои там
     раскладывает установка по своим правилам. */
  const workOver = own || rewound ? copyWorkOver(cleaned?.workOver) : null;
  lastRebases.set(target, { own });
  let baseline;
  if (cleaned?.changed) {
    baseline = {
      exists: true,
      path: cleaned.path,
      sha256: cleaned.sha256,
      verified: true,
      withoutAstral: true,
      shiftAudit: SHIFT_AUDIT_FORMAT,
      liveSha256: liveHash,
      ...(absorbed ? { absorbed } : {}),
      ...(workOver ? { workOver } : {}),
    };
  } else {
    const baselinePath = path.join(directory, `${liveHash}.rpf`);
    if (!(await exists(baselinePath))) {
      const stage = `${baselinePath}.${randomUUID()}.stage`;
      await copyFileCancellable(livePath, stage, signal);
      await fs.rename(stage, baselinePath);
    }
    /*
     * Очистить не вышло (нет помощника) — основа несёт записи движка, и
     * их надо помнить: контейнеры `x64/astral` и всё, что ставилось через
     * `import` (то есть чего до нас в архиве не было). Новая установка той
     * же записи ляжет поверх (а не упрётся в «import target already
     * exists»), а снятие мода уберёт запись из основы — иначе снятая радуга
     * так и лежала бы в архиве после первого же нативного патча неба.
     * Подменённые файлы самой игры сюда не входят: их удаление вынуло бы из
     * игры её собственный файл.
     */
    const previouslyCarried = new Set(previous?.carried || []);
    const carried = cleaned
      ? []
      : Object.entries(target.archives?.[archiveTarget]?.entries || {})
          .filter(([entry, record]) => {
            const layers = record?.layers || [];
            const top = layers.at(-1);
            if (!top || top.action === "delete") return false;
            return (
              Boolean(astralContainerOf(entry)) ||
              entry.startsWith(`${ASTRAL_CONTAINER_ROOT}/`) ||
              previouslyCarried.has(entry) ||
              layers.some((layer) => layer?.action === "import")
            );
          })
          .map(([entry]) => entry)
          .sort();
    baseline = {
      exists: true,
      path: baselinePath,
      sha256: liveHash,
      verified: true,
      /* Очистка прошла и своего не нашла: живой архив и есть игра (сдвиговых записей очистка не оставляет — `ShiftBaseRefused`). */
      ...(cleaned ? { withoutAstral: true, shiftAudit: SHIFT_AUDIT_FORMAT } : {}),
      ...(carried.length ? { carried } : {}),
      ...(absorbed ? { absorbed } : {}),
      ...(workOver ? { workOver } : {}),
    };
  }
  const pristine = own
    ? resource.pristine?.exists
      ? resource.pristine
      : resource.original?.exists
        ? { ...resource.original }
        : null
    : null;
  /* Чужая правка, и это не возврат к игре «до Astral» (так откатывает копия
     Rockstar Games Launcher), — новая версия игры, принятая основой (Т-168).
     Точки работ мастерской до неё перемотать уже нельзя: уборка снимет с
     них копии и скажет об этом словами. */
  const knownOriginal = resource.pristine?.sha256 || resource.original?.sha256 || "";
  if (!own && liveHash !== knownOriginal) {
    /* Пока прежняя основа ещё на диске: слои «целиком», у которых Rockstar изменили штатный файл, на новую основу не ложатся.
       Перемотка нашего же нативного шага (снятие работы мастерской) — не новая версия игры: штатное под слоем у неё то же, каким было до работы. */
    const stock = rewound
      ? { changed: [], unchecked: [], modIds: [] }
      : await parkModsWaitingForVersion({ target, archiveTarget, previous, baseline, paths, baseTools, signal });
    resource.adoptedUpdate = {
      liveSha256: liveHash,
      at: new Date().toISOString(),
      ...(stock.changed.length ? { stockChanged: stock.changed.map(({ modId, entry, was, now }) => ({ modId, entry, was, now })) } : {}),
    };
  }
  adoptBaseline(target, resource, baseline, pristine);
  resource.layers = [];
  /*
   * Слои записей архива остаются: моды по-прежнему установлены, и композиция
   * положит их поверх новой основы. Но в новой основе наша запись может и
   * остаться — очистка не прошла или не доказала, что запись наша (метка
   * папки `x64/astral`, плитки карты, поставленные раньше). Слой с действием
   * `import` требует, чтобы записи в основе не было, и helper отвечал «RPF
   * import target already exists» — так падала каждая установка через
   * движок после того, как архив менял нативный патч мини-карты или прицела.
   * После перебазирования единственно честное действие у такого слоя —
   * `upsert`: запись кладётся, есть она в основе или нет.
   */
  for (const record of Object.values(
    target.archives?.[archiveTarget]?.entries || {},
  ))
    for (const layer of record?.layers || [])
      if (layer?.action === "import") layer.action = "upsert";
  /* Следы Astral, которых состояние не знает: строки реестров собираются
     заново без них (основа реестра — без строк Astral), и человеку —
     строка в отчёте, что Astral их нашёл и убрал. */
  if (foreignContainers.length || foreignDlcs.length) {
    noteReconcile(target, {
      kind: "astral-traces-removed",
      containers: foreignContainers,
      dlcs: foreignDlcs,
    });
    await composeAstralContentRegistry({
      target,
      targetKey,
      paths,
      contentXmlProvider,
      archiveTarget,
    });
    if (foreignDlcs.length && typeof dlcListProvider === "function")
      await composeDirectDlcRegistry({
        target,
        targetKey,
        paths,
        dlcListProvider,
        archiveTarget,
      });
  }
  return true;
}
