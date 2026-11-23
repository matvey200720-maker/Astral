/*
 * Установка замены анимаций в игру (ТЗ 29.10-d): пара «что заменили → чем» превращается в новый словарь `.ycd` цели и ставится в архив
 * игры нашим установщиком патчей (`install-rpf-patch`: точка отката, пересборка архива, проверка), как редакторы мастерской.
 *
 * Куда идёт файл — туда, откуда его читает игра. Словарь дополнения (`dlcpacks/<пак>/dlc.rpf`) игра берёт из заплатки в `update.rpf`
 * (`dlc_patch/<пак>/…`), если она там есть: тогда правится она, а не словарь пака — иначе замена не доехала бы. Нет заплатки — правится
 * сам `dlc.rpf` пака, у основного архива — `x64c.rpf` (его пересборка тяжёлая, и план называет размер архива). Сначала всегда читается то,
 * что лежит в игре сейчас: подмена строится от него.
 *
 * Состояние (`installed.json`): по каждому словарю — подлинные байты до замены (копия в `originals/<sha256>`), отпечаток поставленного и
 * список пар. Убрать одну замену — собрать словарь заново из подлинного с оставшимися парами; последняя убрана — в игру возвращаются
 * подлинные байты. Если файл в игре уже не тот, что мы ставили (проверка файлов Steam, чужой мод), состояние по нему сбрасывается:
 * подмена строится от того, что лежит сейчас, и чужое мы не затираем «подлинным».
 *
 * Точки отката (1.11.2026). `install-rpf-patch` кладёт перед каждой записью точку отката — прежний архив целиком — и отпечаток архива после записи. Состояние держит цепочку
 * точек по архиву (`restorePoints`, от старой к новой). Когда убрана последняя замена и в архиве больше нашего нет, архив не пересобирается заново (пересборка даёт тот же
 * словарь, но другие байты файла), а возвращается из точек, новая за старой, — файл игры становится ровно тем, каким был до первой установки, бит в бит. Точка проверяет сама,
 * что архив — тот, что оставили мы (`restore-rpf-point`: отпечаток «после»); не вышло — прежний путь, пересборка с подлинным словарём.
 *
 * Игра не запускается и файлы игры читаются через движок; пишет только `install-rpf-patch` и `restore-rpf-point` — после проверки, что игра закрыта.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { atomicWrite, clothingArchiveTools } from "../clothing-models.js";
import { provisionArchiveSupport } from "../loader-provisioner.js";
import { callNativeEngine } from "../native-engine.js";
import { animationsFolder } from "./animation-index.js";
import { checkEntry, dictionaryFile } from "./animation-track.js";
import { RIG_BUILD } from "./animation-rig.js";
import { readPedSkeleton } from "./ped-skeleton.js";
import { readOwnSources } from "./own-sources.js";
import { graftClip } from "./ycd-graft.js";

const STATE_VERSION = 1;
const MAX_PAIRS = 64;
const DLC = /^update\/x64\/dlcpacks\/([A-Za-z0-9_]{1,64})\/dlc\.rpf$/;
const HEAVY_BYTES = 512 * 1024 * 1024;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const unwrap = (answer) => answer?.result ?? answer ?? {};
const refusal = (code, message) => Object.assign(new Error(message), { code });

const defaultTools = (stateDir) => ({
  ...clothingArchiveTools(stateDir),
  native: callNativeEngine,
  archiveSupport: provisionArchiveSupport,
});

/* Состояние установленных замен игры. */
const stateFile = (stateDir, gameRoot) =>
  path.join(animationsFolder(stateDir, gameRoot), "installed.json");

export async function readInstalledState(stateDir, gameRoot) {
  const stored = await fs
    .readFile(stateFile(stateDir, gameRoot), "utf8")
    .then(JSON.parse)
    .catch(() => null);
  return stored?.version === STATE_VERSION &&
    stored.files &&
    typeof stored.files === "object"
    ? stored
    : { version: STATE_VERSION, files: {} };
}

async function writeInstalledState(stateDir, gameRoot, state) {
  const file = stateFile(stateDir, gameRoot);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await atomicWrite(file, Buffer.from(JSON.stringify(state)));
}

/** Где игра читает словарь записи: архив, приставка пути записи (`архив:/`) и путь внутри. */
export async function effectiveLocation(entry, { gameRoot }, context, tools) {
  const archive = String(entry.archive || "");
  const inner = String(entry.entry || "");
  const dlc = DLC.exec(archive);
  if (dlc) {
    const patched = `dlc_patch/${dlc[1]}/${inner}`;
    const answer = unwrap(
      await tools
        .list(
          {
            gameRoot,
            archive: "update/update.rpf",
            filter: patched,
            maxEntries: 8,
          },
          context,
        )
        .catch(() => null),
    );
    if (
      (answer.entries || []).some(
        (item) =>
          String(item.path || "").toLowerCase() === patched.toLowerCase(),
      )
    )
      return {
        archive: "update/update.rpf",
        prefix: "update/update",
        inner: patched,
      };
  }
  return { archive, prefix: archive.replace(/\.rpf$/i, ""), inner };
}

const locationKey = (location) =>
  `${location.prefix}|${location.inner}`.toLowerCase();
const targetPath = (location) => `${location.prefix}:/${location.inner}`;

async function readLocation(location, { gameRoot, work }, context, tools) {
  const output = path.join(work, `${randomUUID()}.ycd`);
  await tools.read({ gameRoot, entry: targetPath(location), output }, context);
  const bytes = await fs.readFile(output);
  await fs.rm(output, { force: true });
  return bytes;
}

/* Что помним о паре: по этому описанию замена собирается заново (источник читается тем же путём, что окном). */
const pairRecord = (pair) => ({
  id: String(pair.id),
  target: {
    dictionary: pair.target.dictionary,
    clip: pair.target.clip,
    name: pair.target.name || pair.target.clip,
  },
  replacement: {
    id: pair.replacement.id,
    source: pair.replacement.source,
    dictionary: pair.replacement.dictionary,
    clip: pair.replacement.clip,
    name: pair.replacement.name || pair.replacement.clip,
    ...(pair.replacement.archive
      ? { archive: pair.replacement.archive, entry: pair.replacement.entry }
      : {}),
    ...(pair.replacement.file ? { file: pair.replacement.file } : {}),
    ...(pair.replacement.sha256
      ? { sha256: pair.replacement.sha256, bytes: pair.replacement.bytes }
      : {}),
  },
});

/*
 * Скелет человека: по нему видно, что обе анимации — человека. Окно «Анимации» берёт персонажа у мастерской одежды (03.11.2026) и своего файла со скелетом больше не пишет, поэтому теги читаются из того же скелета игры
 * (`ped-skeleton.js`, он общий у обеих мастерских); прежний файл тегов рядом с персонажем окна остаётся как был — по нему быстрее.
 */
export async function pedBonesOf(
  stateDir,
  gameRoot,
  { resolved, context, work } = {},
) {
  const stored = await fs
    .readFile(
      path.join(animationsFolder(stateDir, gameRoot), `rig.${RIG_BUILD}.json`),
      "utf8",
    )
    .then(JSON.parse)
    .catch(() => null);
  if (Array.isArray(stored?.tags) && stored.tags.length > 20)
    return stored.tags.map(Number);
  if (!resolved || !work) return null;
  try {
    const { tags } = await readPedSkeleton(
      { gameRoot, gender: "male" },
      resolved,
      context,
      work,
    );
    return tags.length > 20 ? tags.map(Number) : null;
  } catch {
    return null;
  }
}

async function ownRoots(stateDir, extra = []) {
  const sources = await readOwnSources(stateDir);
  return [
    ...sources.map((item) => path.resolve(item.path)),
    ...extra.map((item) => path.resolve(String(item))),
    path.join(stateDir, "animations", "own"),
  ];
}

/**
 * План: что будет записано. `install` — пары `{ id, target, replacement }` окна, `remove` — номера пар. Не пишет в игру: читает словари,
 * собирает новые и кладёт патч в папку данных. Ответ — `{ patch, files, results, nextState, gameRoot }`.
 */
export async function materializeAnimations(
  input,
  context,
  stateDir,
  tools = {},
) {
  const resolved = { ...defaultTools(stateDir), ...tools };
  const gameRoot = String(input?.gameRoot || "");
  if (!gameRoot || !path.isAbsolute(gameRoot))
    throw refusal("ANIMATION_GAME", "Выберите папку GTA V Legacy.");
  const install = Array.isArray(input?.install)
    ? input.install.slice(0, MAX_PAIRS)
    : [];
  const remove = new Set(
    (Array.isArray(input?.remove) ? input.remove : []).map(String),
  );
  if (!install.length && !remove.size)
    throw refusal("ANIMATION_EMPTY", "Нечего ставить и нечего убирать.");
  const roots = await ownRoots(stateDir, input?.extra || []);
  const work = path.join(stateDir, "animations", "work", randomUUID());
  await fs.mkdir(work, { recursive: true });
  const state = await readInstalledState(stateDir, gameRoot);
  const results = [];
  const pedBones =
    resolved.pedBones === undefined
      ? await pedBonesOf(stateDir, gameRoot, { resolved, context, work })
      : resolved.pedBones;
  try {
    /* Куда относится каждая пара. */
    const touched = new Map();
    const touch = (key, location) => {
      if (!touched.has(key))
        touched.set(key, { location, add: [], drop: new Set() });
      return touched.get(key);
    };
    for (const pair of install) {
      try {
        const target = checkEntry(pair?.target, roots);
        const replacement = checkEntry(pair?.replacement, roots);
        if (target.source !== "game")
          throw refusal(
            "ANIMATION_TARGET",
            "Эта анимация не из вашей игры: заменять её на этом ПК нечем.",
          );
        if (!pair?.id) throw refusal("ANIMATION_ENTRY", "У замены нет номера.");
        const location = await effectiveLocation(
          target,
          { gameRoot },
          context,
          resolved,
        );
        touch(locationKey(location), location).add.push({
          ...pair,
          target: { ...pair.target, ...target },
          replacement: { ...pair.replacement, ...replacement },
        });
      } catch (error) {
        results.push({
          id: String(pair?.id || ""),
          status: "refused",
          code: error?.code || "",
          why: "",
          reason: String(error?.message || error),
          notes: [],
        });
      }
    }
    for (const [key, file] of Object.entries(state.files))
      if (file.pairs.some((pair) => remove.has(pair.id)))
        touch(key, {
          archive: file.archive,
          prefix: file.prefix,
          inner: file.inner,
        }).drop = new Set(
          file.pairs
            .filter((pair) => remove.has(pair.id))
            .map((pair) => pair.id),
        );
    for (const id of remove)
      if (
        !Object.values(state.files).some((file) =>
          file.pairs.some((pair) => pair.id === id),
        )
      )
        results.push({ id, status: "unchanged", reason: "Замена не стоит." });

    const patchDirectory = path.join(
      stateDir,
      "animations",
      "patches",
      randomUUID(),
    );
    const payloadDirectory = path.join(patchDirectory, "payload");
    const actions = [];
    const files = [];
    const nextState = { version: STATE_VERSION, files: { ...state.files } };
    const originals = [];
    /* Куда вернуть архив точками отката, если убрано всё: словарь, его архив, цепочка точек и подлинный отпечаток словаря. */
    const rollbacks = [];
    let index = 0;
    for (const [key, group] of touched) {
      const { location } = group;
      const current = await readLocation(
        location,
        { gameRoot, work },
        context,
        resolved,
      );
      const currentSha = sha256(current);
      const known = state.files[key];
      /* Подлинные байты: наши, если в игре всё ещё поставленное нами, иначе то, что лежит сейчас. */
      const ours = known && known.currentSha256 === currentSha;
      const original = ours
        ? await fs.readFile(known.originalFile).catch(() => null)
        : null;
      const pristine = original || current;
      const keptPairs = ours && original ? known.pairs : [];
      const wanted = [
        ...keptPairs.filter(
          (pair) =>
            !group.drop.has(pair.id) &&
            !group.add.some(
              (added) =>
                added.target.clip === pair.target.clip &&
                added.target.dictionary === pair.target.dictionary,
            ),
        ),
        ...group.add.map(pairRecord),
      ];
      const fresh = new Map(group.add.map((pair) => [String(pair.id), pair]));
      let bytes = pristine;
      const used = [];
      /* Уже стоящая пара, чей источник сейчас не читается (нет сети и кэша для словаря проекта, файл ушёл), не теряется молча: пересборка этого архива останавливается с причиной,
         архив и состояние остаются как были (ревью 14.11, п. 11). Новая пара с недоступным источником — отказ только ей, как раньше. */
      let blocked = null;
      for (const record of wanted) {
        try {
          const added = fresh.get(record.id);
          let sourceBytes;
          try {
            const sourceEntry = added
              ? added.replacement
              : sourceEntryOf(record.replacement, roots);
            sourceBytes = await readSource(
              sourceEntry,
              { gameRoot, stateDir },
              context,
              resolved,
            );
          } catch (error) {
            if (added) throw error;
            blocked ??= { record, error };
            continue;
          }
          const grafted = (resolved.graft || graftClip)({
            target: bytes,
            targetClip: record.target.clip,
            source: sourceBytes,
            sourceClip: record.replacement.clip,
            pedBones,
          });
          bytes = grafted.bytes;
          used.push(record);
          if (added)
            results.push({
              id: record.id,
              status: "installed",
              warnings: grafted.report.warnings || [],
              notes: grafted.report.noteCodes || [],
              facts: grafted.report.facts,
            });
        } catch (error) {
          results.push({
            id: record.id,
            status: "refused",
            code: error?.code || "",
            why: error?.report?.errorCodes?.[0] || "",
            reason: String(error?.message || error),
            notes: error?.report?.noteCodes || [],
          });
        }
      }
      if (blocked) {
        /* Ничего не писать: ни архив, ни состояние. Строки этой группы — отказы с причиной недоступного источника (словарь проекта: сеть, раздача, подмена). */
        const why = {
          code: blocked.error?.code || "ANIMATION_SOURCE",
          why: "",
          reason: String(blocked.error?.message || blocked.error),
          notes: [],
        };
        for (const row of results.splice(0, results.length)) {
          if (
            row.status === "installed" &&
            group.add.some((pair) => String(pair.id) === row.id)
          )
            results.push({ id: row.id, status: "refused", ...why });
          else results.push(row);
        }
        for (const id of group.drop)
          results.push({ id, status: "refused", ...why });
        continue;
      }
      for (const id of group.drop) results.push({ id, status: "removed" });
      const nextSha = sha256(bytes);
      if (used.length) {
        if (nextSha === currentSha) {
          for (const record of used) {
            const row = results.find(
              (item) => item.id === record.id && item.status === "installed",
            );
            if (row) row.status = "unchanged";
          }
          nextState.files[key] = known
            ? { ...known, pairs: used }
            : nextState.files[key];
          continue;
        }
      } else if (ours && original && known.restorePoints?.length) {
        rollbacks.push({
          location,
          archive: location.archive,
          points: known.restorePoints,
          originalSha256: known.originalSha256,
        });
      }
      if (!used.length && (!ours || !original)) {
        /* Нечего ставить и своего здесь нет: файл не трогаем. */
        delete nextState.files[key];
        continue;
      }
      index += 1;
      const name = `${String(index).padStart(3, "0")}.ycd`;
      await fs.mkdir(payloadDirectory, { recursive: true });
      await fs.writeFile(path.join(payloadDirectory, name), bytes, {
        flag: "wx",
      });
      actions.push({
        Type: "Replace",
        TargetPath: targetPath(location),
        SourcePath: `payload/${name}`,
        Size: bytes.length,
        Sha256: nextSha,
        IsWholeReplaceNestedRpf: false,
      });
      const archiveBytes = await fs
        .stat(path.join(gameRoot, location.archive))
        .then(
          (stat) => stat.size,
          () => 0,
        );
      files.push({
        target: targetPath(location),
        archive: location.archive,
        size: bytes.length,
        sha256: nextSha,
        previousSha256: currentSha,
        archiveBytes,
        heavy: archiveBytes > HEAVY_BYTES,
        restores: !used.length,
      });
      if (used.length) {
        const originalFile = path.join(
          animationsFolder(stateDir, gameRoot),
          "originals",
          `${sha256(pristine)}.ycd`,
        );
        originals.push({ file: originalFile, bytes: pristine });
        nextState.files[key] = {
          archive: location.archive,
          prefix: location.prefix,
          inner: location.inner,
          originalSha256: sha256(pristine),
          originalFile,
          currentSha256: nextSha,
          restorePoints: ours ? [...(known.restorePoints || [])] : [],
          pairs: used,
        };
      } else delete nextState.files[key];
    }
    if (!actions.length)
      return {
        patch: null,
        gameRoot,
        files,
        results,
        nextState,
        originals,
        rollbacks,
      };
    await fs.mkdir(patchDirectory, { recursive: true });
    await fs.writeFile(
      path.join(patchDirectory, "manifest.json"),
      `${JSON.stringify({ ReduxName: "Astral animations", ParsedAt: new Date().toISOString(), TotalPatchSize: files.reduce((sum, file) => sum + file.size, 0), Actions: actions }, null, 2)}\n`,
      { flag: "wx" },
    );
    return {
      patch: patchDirectory,
      gameRoot,
      files,
      results,
      nextState,
      originals,
      rollbacks,
    };
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/* Запись источника из описания пары, что осталась в состоянии (путь собственного файла проверяется заново). */
function sourceEntryOf(replacement, roots) {
  return checkEntry({ ...replacement }, roots);
}

async function readSource(entry, { gameRoot, stateDir }, context, tools) {
  return fs.readFile(
    await dictionaryFile(entry, { gameRoot, stateDir }, context, tools),
  );
}

/** План без записи: что и куда встанет, чему отказано и почему. */
export async function planAnimationInstall(
  input,
  context,
  stateDir,
  tools = {},
) {
  const plan = await materializeAnimations(input, context, stateDir, tools);
  let validation = null;
  if (plan.patch) {
    const native = tools.native || callNativeEngine;
    validation = await native(
      "validate-rpf-patch",
      { patch: plan.patch },
      context,
    );
    await fs.rm(plan.patch, { recursive: true, force: true }).catch(() => {});
  }
  return {
    gameRoot: plan.gameRoot,
    files: plan.files,
    results: plan.results,
    validation,
    willWrite: plan.files.length > 0,
  };
}

/**
 * Вернуть архивы точками отката, когда убрано всё и в архиве больше нет наших замен: цепочка от новой точки к старой приводит файл игры к тому, каким он был до первой
 * установки (бит в бит), а не к пересборке с тем же словарём. Условия: каждое действие плана — снятие последней замены, у каждого словаря есть цепочка, у словарей одного
 * архива она одна и та же, в архиве не осталось других наших словарей. После возврата словарь читается из архива и сверяется с подлинным отпечатком. Что-то не так (точки нет,
 * архив с тех пор менялся, отпечаток не сошёлся) — `null`: дальше идёт прежний путь, пересборка. Ответ — `{ restored: [id…], archives }`.
 */
async function rollBack(plan, resolved, context, { gameRoot, work }) {
  if (!plan.rollbacks?.length || plan.rollbacks.length !== plan.files.length)
    return null;
  const chains = new Map();
  for (const item of plan.rollbacks) {
    const chain = item.points.join(">");
    if (chains.has(item.archive) && chains.get(item.archive) !== chain)
      return null;
    chains.set(item.archive, chain);
    if (
      Object.values(plan.nextState.files).some(
        (file) => file.archive === item.archive,
      )
    )
      return null;
  }
  const done = [];
  try {
    for (const item of [
      ...new Map(
        plan.rollbacks.map((entry) => [entry.archive, entry]),
      ).values(),
    ])
      for (const id of [...item.points].reverse()) {
        await resolved.native(
          "restore-rpf-point",
          { restorePointId: id },
          context,
        );
        done.push(id);
      }
    for (const item of plan.rollbacks) {
      const bytes = await readLocation(
        item.location,
        { gameRoot, work },
        context,
        resolved,
      );
      if (sha256(bytes) !== item.originalSha256) return null;
    }
  } catch {
    return null;
  }
  return { restored: done, archives: [...chains.keys()] };
}

/** Поставить и/или убрать пары: пересборка архива игры с точкой отката (или возврат архива точками, когда убрано всё). Игра должна быть закрыта (`assertRuntimeSafety`). */
export async function applyAnimationInstall(
  input,
  context,
  stateDir,
  { assertRuntimeSafety, ...tools } = {},
) {
  const resolved = { ...defaultTools(stateDir), ...tools };
  const plan = await materializeAnimations(input, context, stateDir, tools);
  if (!plan.patch)
    return {
      gameRoot: plan.gameRoot,
      files: [],
      results: plan.results,
      written: false,
    };
  try {
    await assertRuntimeSafety?.(plan.gameRoot);
    const work = path.join(stateDir, "animations", "work", randomUUID());
    await fs.mkdir(work, { recursive: true });
    const returned = await rollBack(plan, resolved, context, {
      gameRoot: plan.gameRoot,
      work,
    }).finally(() =>
      fs.rm(work, { recursive: true, force: true }).catch(() => {}),
    );
    if (returned) {
      await writeInstalledState(stateDir, plan.gameRoot, plan.nextState);
      return {
        id: returned.restored.at(-1),
        restoredPoints: returned.restored,
        archives: returned.archives,
        gameRoot: plan.gameRoot,
        files: plan.files,
        results: plan.results,
        written: true,
      };
    }
    const support = await resolved.archiveSupport({ stateDir });
    const installed = await resolved.native(
      "install-rpf-patch",
      {
        patch: plan.patch,
        gameRoot: plan.gameRoot,
        archiveFix: path.join(support.directory, "ArchiveFix.exe"),
        keys: support.directory,
      },
      context,
    );
    /* Точка отката этой записи — в цепочку каждого нашего словаря того же архива (точка принадлежит архиву целиком). */
    const pointId = installed?.id || installed?.restorePointId;
    if (pointId)
      for (const file of Object.values(plan.nextState.files))
        if (!installed.archives || installed.archives.includes(file.archive))
          file.restorePoints = [...(file.restorePoints || []), pointId];
    /* Подлинные байты — на диск до записи состояния: без них «убрать» вернуло бы нечего. */
    for (const original of plan.originals) {
      await fs.mkdir(path.dirname(original.file), { recursive: true });
      await atomicWrite(original.file, original.bytes);
    }
    await writeInstalledState(stateDir, plan.gameRoot, plan.nextState);
    return {
      ...installed,
      gameRoot: plan.gameRoot,
      files: plan.files,
      results: plan.results,
      written: true,
    };
  } finally {
    await fs.rm(plan.patch, { recursive: true, force: true }).catch(() => {});
  }
}

/** Что из замен стоит в игре: по состоянию и, с `verify`, по отпечаткам файлов в игре. */
export async function listInstalledAnimations(
  input,
  context,
  stateDir,
  tools = {},
) {
  const gameRoot = String(input?.gameRoot || "");
  if (!gameRoot || !path.isAbsolute(gameRoot)) return { items: [] };
  const state = await readInstalledState(stateDir, gameRoot);
  const resolved = { ...defaultTools(stateDir), ...tools };
  const work = path.join(stateDir, "animations", "work", randomUUID());
  const items = [];
  try {
    await fs.mkdir(work, { recursive: true });
    for (const file of Object.values(state.files)) {
      let present = true;
      if (input?.verify !== false) {
        const bytes = await readLocation(
          file,
          { gameRoot, work },
          context,
          resolved,
        ).catch(() => null);
        present = Boolean(bytes) && sha256(bytes) === file.currentSha256;
      }
      for (const pair of file.pairs)
        items.push({
          id: pair.id,
          target: pair.target,
          replacement: pair.replacement,
          present,
          archive: file.archive,
        });
    }
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
  return { items };
}
