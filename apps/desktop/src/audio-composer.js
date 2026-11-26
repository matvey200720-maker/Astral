import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
/* Отпечаток основы из памяти (`file-fingerprint.js`): установка пересобирает все записи архива, и каждая читала двухгигабайтный update.rpf заново (02.11.2026). */
import { fingerprintSha256 as sha256File } from "@modovik/install-engine/file-fingerprint.js";
import { AUDIO_CONFIG_ARCHIVE, AUDIO_CONFIG_ENTRY, AUDIO_SLOTS_LAYER } from "@modovik/install-engine/audio-slot-layer.js";
import { ownRecordValue } from "@modovik/install-engine/state-record.js";
import {
  audioConfigSlot,
  budgetFits,
  chooseSpareDrops,
  raiseSlot,
  slotCeiling,
  slotGrowthOf,
  slotOverrun,
  slotRaiseEnabled,
  waveSlotBudget,
  waveSlotOf,
} from "@modovik/sound-studio";
import { WEAPON_BANK_SPARE } from "@modovik/sound-studio/weapon-bank-spare";
import { appLog } from "./app-log.js";
import {
  extractRpfEntry,
  inspectAwc,
  patchAwcStreams,
} from "./rpf-composer.js";

/*
 * Версия правил сборки банка: входит в отпечаток, чтобы банк, собранный
 * прежними правилами, не брался из кэша. 2 — банк сверяется со слотом
 * памяти игры целиком: таблица дорожек, служебные чанки, данные (27.09.2026).
 * 3 — слот берётся таким, какой записан в audioconfig игрока (штатный или
 * поднятый), мёртвые дорожки освобождают место, а не хватило — банк просит
 * слот выше (20.11.2026).
 */
const COMPOSITE_RULES = 3;

/* Запись слотов памяти звука в update.rpf и слой, которым Astral её правит (производный: считается из банка, а не ставится модом). */
export { AUDIO_CONFIG_ARCHIVE, AUDIO_CONFIG_ENTRY, AUDIO_SLOTS_LAYER };

/** Слой, который студия звука ставит из мастерской (свои звуки человека): его отказ про «свои звуки». */
const isOwnSoundLayer = (layer) => String(layer?.modId || "").startsWith("local-sound-");

function validateLayers(layers, entry) {
  const claimed = new Set();
  let completeBank = null;
  for (const layer of layers) {
    if (layer.merge?.strategy !== "awc-stream-layer-v1") {
      throw new Error(`Несовместимый звуковой слой в ${entry}.`);
    }
    if (layer.merge.completeBank) {
      if (completeBank) {
        throw new Error(
          `Банк ${entry} полностью занят несколькими звуковыми пакетами.`,
        );
      }
      completeBank = layer;
    }
    /* Убранная дорожка занята так же, как заменённая: второй слой не может
       ни заменить её, ни убрать ещё раз. */
    for (const stream of [...layer.merge.streams, ...(layer.merge.drop || [])]) {
      if (claimed.has(stream)) {
        throw new Error(`Звуковой поток ${stream} занят несколькими модами.`);
      }
      claimed.add(stream);
    }
  }
  if (completeBank && layers.some((layer) => layer.merge.drop?.length))
    throw new Error(`Банк ${entry} занят целиком — убирать из него дорожки некому.`);
  return completeBank;
}

const SLOT_MESSAGE = /AWC slot budget exceeded \(([^)]*)\): (.*)\./;

/* Помощник отказал по слоту? */
const isSlotRefusal = (error) => SLOT_MESSAGE.test(String(error?.message || error));

/** Сколько и чего не хватило, словами (из отказа помощника). */
function overrunParts(match) {
  return match[2].split(", ").map((item) => {
    const [kind, amounts] = item.split(" ");
    const [built, limit] = amounts.split("/").map(Number);
    const what =
      kind === "metadata"
        ? "служебные данные дорожек"
        : kind === "header"
          ? "таблица дорожек"
          : "сами звуки";
    return `${what} — ${built} байт при пределе ${limit}`;
  });
}

/*
 * Отказ helper'а о слоте — словами: что не поместилось и что делать. Свои звуки человека (студия) — «сократите их»; звуки пака
 * из каталога человек не делал, ему говорят, что не поместилось и что с этим делать. `raisable` — слот Astral умеет поднимать
 * (и этого не хватило).
 */
/*
 * Признак отказа для окна: помещается ли пак в слот ОДИН. `alone` — не помещается даже один (такой пак пока не встанет, снимать другие
 * паки бесполезно); `shared` — каждый слой один бы поместился, мешает сумма с уже стоящими паками звука (поможет снять их); `null` — не
 * выяснено. Окно получает только текст ошибки, поэтому признак ещё и метка в конце текста — как `(waiting-same-version)`: окно читает её, а не
 * догадывается по числам (`utils/installFailure.js`, семейства `sound-pack-slot-alone` и `sound-pack-slot-shared`).
 */
export const SLOT_FIT_ALONE = "alone";
export const SLOT_FIT_SHARED = "shared";

/* Метка без имён: имена слоёв (`slotPacks`) — для нас (поле ошибки, текст в журнале), а не слова для человека. */
const fitTag = (fit) => (fit === SLOT_FIT_ALONE ? " (sound-slot-alone)" : fit === SLOT_FIT_SHARED ? " (sound-slot-shared)" : "");

function slotBudgetError(entry, error, { catalog = false, raisable = false, raiseOff = false, fit = null, packs = [] } = {}) {
  const text = String(error?.message || error);
  const match = SLOT_MESSAGE.exec(text);
  if (!match) return error;
  const parts = overrunParts(match);
  if (!catalog)
    return new Error(
      `Звуки не помещаются в банк ${entry}: игра грузит его в слот памяти ${match[1]}, а в собранном банке ${parts.join("; ")}. ` +
        "Больший банк игра скопировала бы за край своей памяти и упала бы. Сократите свои звуки.",
    );
  const known = fit === SLOT_FIT_ALONE || fit === SLOT_FIT_SHARED;
  /* Что делать: при `alone` снимать другие паки бесполезно, при `shared` поможет, без признака — прежний совет. */
  const advice =
    fit === SLOT_FIT_ALONE
      ? "Звуки пака не изменены. Этот пак не помещается и один: Astral пока не умеет ставить такие паки."
      : fit === SLOT_FIT_SHARED
        ? `Звуки пака не изменены. Один этот пак поместился бы: снимите другие паки звуков оружия и поставьте его. Слои звука в сборке: ${packs.join(", ")}.`
        : null;
  const mark = (made, extra = {}) =>
    Object.assign(made, extra, known ? { slotFit: fit, slotPacks: packs } : {}, known ? { message: `${made.message}${fitTag(fit)}` } : {});
  /* Подъём слота выключен (`slotRaiseEnabled`): отдельный текст — пак не «слишком велик для игры», его слоту пока не дают расти. */
  if (raiseOff)
    return mark(
      new Error(
        `Пак звуков не помещается в банк ${entry}: игра грузит его в слот памяти ${match[1]}, а подъём слота звуков в этой версии Astral выключен — в собранном банке ${parts.join("; ")}. Больший банк игра скопировала бы за край своей памяти и упала бы. ` +
          (advice ||
            "Звуки пака не изменены. Снимите другие паки звуков оружия и поставьте этот один; если не помогло — этот пак пока не встанет: подъём слота звуков в Astral отключён до проверки."),
      ),
      { code: "sound-slot-raise-off" },
    );
  return mark(
    new Error(
      `Пак звуков не помещается в банк ${entry}: игра грузит его в слот памяти ${match[1]}, ${
        raisable ? "и даже поднятый до предела слот мал" : "а этот слот Astral не поднимает"
      } — в собранном банке ${parts.join("; ")}. Больший банк игра скопировала бы за край своей памяти и упала бы. ` +
        (advice || "Звуки пака не изменены. Снимите другие паки звуков оружия и поставьте этот один; если не помогло — этот пак слишком велик для игры."),
    ),
  );
}

/**
 * Банку нужен слот выше записанного, а в состоянии слот не поднят: установка сначала поднимает слот (`audio-slots.js`), и только потом
 * собирает банк. Сюда доходит сборка, которая слот не подняла (восстановление, повтор после сбоя): банк в игру не уходит.
 */
export class AwcSlotRaise extends Error {
  constructor({ entry, need }) {
    super(
      `Слот памяти звуков устарел: банку ${entry} нужен слот ${need.slot} больше записанного (данные ${need.raised.bytes}, служебные ${need.raised.metadata}, таблица ${need.raised.header}). ` +
        "Снимите пак звуков и поставьте его заново — Astral поднимет слот и соберёт банк.",
    );
    this.name = "AwcSlotRaise";
    this.code = "awc-slot-raise";
    this.entry = entry;
    this.need = need;
  }
}

const HELPER_TOOLS = Object.freeze({
  extract: extractRpfEntry,
  inspect: inspectAwc,
  patch: patchAwcStreams,
});

const slashes = (value) => String(value || "").split("\\").join("/");

/** Мёртвые дорожки банка (строки таблицы) без тех, что заняты слоями. */
function spareOf(table, archive, entry, claimed) {
  const key = `${archive}|${slashes(entry).split("/").pop().toLowerCase()}`;
  return (table[key] || []).filter((row) => !claimed.has(String(row[0]).toUpperCase()));
}

/**
 * Слот, как он записан в игре игрока по состоянию установки: `audioconfig.dat4.rel` в update.rpf — верхний слой записи (наш или
 * от редукса со своим файлом); без слоя — файл игры, и слот штатный (`null`: берётся таблица). `withoutOwn` — без нашего слоя
 * (то, на что он ляжет).
 *
 * @returns {Promise<{bytes: number, header: number, metadata: number} | null>}
 */
export async function slotInState(target, slotName, { withoutOwn = false } = {}) {
  const entries = target?.archives?.[AUDIO_CONFIG_ARCHIVE]?.entries;
  const record = entries ? ownRecordValue(entries, AUDIO_CONFIG_ENTRY) : null;
  const top = (record?.layers || []).filter((layer) => !(withoutOwn && layer.modId === AUDIO_SLOTS_LAYER)).at(-1);
  if (!top?.cachePath || top.action === "delete") return null;
  /* Нет ни слота, ни семьи `<имя>_<номер>` — как без слоя: штатная таблица (24.11.2026; раньше — отказ, и пак с банком ствола
     игрока не вставал у каждого, кому 1.0.7 подняла STATIC_WEAPONS). */
  return audioConfigSlot(await fs.readFile(top.cachePath), slotName);
}

/*
 * Сборка одного звукового банка слоями: слой за слоем поверх банка игры, пределы слота сверяет helper.
 *
 *  • слот — штатный из таблицы или тот, что записан в audioconfig игрока (`slot`): банк обязан помещаться в слот, который
 *    будет в игре;
 *  • слот, который Astral умеет поднимать (STATIC_WEAPONS, `slot-fit.js`): банк сначала собирается без сверки с штатным
 *    слотом (с потолком роста); помещается — готово; нет — освобождаются мёртвые дорожки ровно в нужном числе; всё равно нет —
 *    результат просит слот выше (`need`), а решает установка (`audio-slots.js`).
 */
export async function planAwcEntry({
  layers,
  entry,
  archiveTarget,
  baseArchive,
  targetKey,
  edition,
  gameRoot,
  stateDir,
  signal,
  /* Слот, записанный в игре (`slotInState`); `null` — штатный из таблицы. */
  slot = null,
  /* Помощник RPF и таблица мёртвых дорожек — подменяются только в тестах. */
  tools = HELPER_TOOLS,
  spareTable = WEAPON_BANK_SPARE,
  /* Подъём слота включён (`ASTRAL_SOUND_SLOT_RAISE` или умолчание в `slot-fit.js`); тесты подставляют своё. */
  raiseEnabled = slotRaiseEnabled(),
}) {
  const completeBank = validateLayers(layers, entry);
  const archive = slashes(archiveTarget);
  const ordered = [...layers].sort((left, right) =>
    left.modId.localeCompare(right.modId),
  );
  const catalog = ordered.some((layer) => !isOwnSoundLayer(layer));
  const known = completeBank ? null : waveSlotOf(archive, entry);
  const growth = known ? slotGrowthOf(known.name) : null;
  const written = known
    ? { slot: known.name, bytes: slot?.bytes ?? known.bytes, header: slot?.header ?? known.header, metadata: slot?.metadata ?? known.metadata }
    : null;
  const base = await sha256File(baseArchive);
  const keyOf = (extra) =>
    createHash("sha256")
      .update(
        JSON.stringify({
          rules: COMPOSITE_RULES,
          base,
          entry,
          layers: ordered.map((layer) => ({
            modId: layer.modId,
            sha256: layer.sha256,
            streams: layer.merge.streams,
            drop: layer.merge.drop || [],
            completeBank: layer.merge.completeBank === true,
          })),
          /* Слот у банка, что не растёт, входит в отпечаток; у растущего его решает отдельный шаг ниже. */
          ...(growth ? extra : { slot: written ? [written.bytes, written.header, written.metadata] : null, ...extra }),
        }),
      )
      .digest("hex");
  const entryKey = createHash("sha256")
    .update(entry.toLowerCase())
    .digest("hex");
  const directory = path.join(stateDir, "payloads", "_awc-composites", targetKey, entryKey);
  const outputOf = (fingerprint) => path.join(directory, `${fingerprint}.awc`);
  const fresh = async (output) => {
    try {
      const stat = await fs.lstat(output);
      return stat.isFile() && stat.size > 16;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return false;
    }
  };
  await fs.mkdir(directory, { recursive: true });
  const work = path.join(directory, `.stage-${randomUUID()}`);
  await fs.mkdir(work, { recursive: true });
  const baseBank = path.join(work, "base.awc");
  let baseReady = false;
  const ensureBase = async () => {
    if (baseReady) return;
    baseReady = true;
    if (completeBank) {
      const inspection = await tools.inspect({
        input: completeBank.cachePath,
        edition,
        gameRoot,
      });
      const actual = (inspection.resource?.streams || [])
        .map((stream) => String(stream.hash || stream.name).toUpperCase())
        .sort();
      if (
        JSON.stringify(actual) !== JSON.stringify(completeBank.merge.streams)
      ) {
        throw new Error(
          `Полная декларация звукового банка ${entry} не совпадает с AWC payload.`,
        );
      }
      await fs.copyFile(completeBank.cachePath, baseBank);
    } else {
      await tools.extract({
        archivePath: baseArchive,
        entry,
        output: baseBank,
        archiveTarget,
        edition,
        gameRoot,
      });
    }
  };
  const patchesOf = (extraDrop = []) => {
    const list = ordered
      .filter((layer) => layer !== completeBank)
      .map((layer) => ({
        source: layer.cachePath,
        sha256: layer.sha256,
        streams: layer.merge.streams,
        drop: layer.merge.drop || [],
      }));
    if (extraDrop.length && list.length) list[0] = { ...list[0], drop: [...list[0].drop, ...extraDrop] };
    return list;
  };
  /* Одна сборка helper'ом: результат в кэш по отпечатку, опись банка — рядом (`.json`). */
  const build = async (fingerprint, { limits, extraDrop = [] }) => {
    const output = outputOf(fingerprint);
    const staged = path.join(work, `result-${fingerprint.slice(0, 12)}.awc`);
    await ensureBase();
    const result = await tools
      .patch({ input: baseBank, output: staged, edition, gameRoot, patches: patchesOf(extraDrop), limits })
      .catch((error) => {
        if (isSlotRefusal(error)) throw Object.assign(new Error(String(error?.message || error)), { slotRefusal: true });
        throw error;
      });
    if (signal?.aborted) throw signal.reason || new Error("Операция отменена.");
    await fs.rename(staged, output);
    const budget =
      result && Number.isFinite(Number(result.contentBytes))
        ? { header: Number(result.headerBytes), metadata: Number(result.metadataBytes), content: Number(result.contentBytes) }
        : null;
    if (budget) await fs.writeFile(`${output}.json`, JSON.stringify({ budget, dropped: extraDrop }));
    return { output, budget, dropped: extraDrop };
  };
  const cached = async (fingerprint, extraDrop = []) => {
    const output = outputOf(fingerprint);
    if (!(await fresh(output))) return null;
    const sidecar = await fs.readFile(`${output}.json`, "utf8").then(JSON.parse, () => null);
    return { output, budget: sidecar?.budget || null, dropped: sidecar?.dropped || extraDrop };
  };
  try {
    if (!ordered.some((layer) => layer !== completeBank)) {
      const fingerprint = keyOf({ copy: true });
      const output = outputOf(fingerprint);
      if (!(await fresh(output))) {
        await ensureBase();
        await fs.copyFile(baseBank, path.join(work, "copy.awc"));
        await fs.rename(path.join(work, "copy.awc"), output);
      }
      return { output, budget: null, dropped: [], need: null };
    }
    /* Один слой поверх основы с теми же пределами — только чтобы узнать, помещается ли пак один. */
    const soloPatch = (single, limits) =>
      tools.patch({
        input: baseBank,
        output: path.join(work, `solo-${randomUUID()}.awc`),
        edition,
        gameRoot,
        patches: [{ source: single.cachePath, sha256: single.sha256, streams: single.merge.streams, drop: single.merge.drop || [] }],
        limits,
      });
    /* Признак для слов отказа: `fitsAlone(слой)` — `true`, `false` или `null` (выяснить не удалось). */
    const slotFitFact = async (fitsAlone) => {
      const sound = ordered.filter((layer) => layer !== completeBank);
      const packs = sound.map((layer) => layer.modId);
      if (sound.length <= 1) return { fit: SLOT_FIT_ALONE, packs };
      const verdicts = [];
      for (const single of sound) verdicts.push(await fitsAlone(single));
      if (verdicts.includes(false))
        return { fit: SLOT_FIT_ALONE, packs: sound.filter((_, at) => verdicts[at] === false).map((layer) => layer.modId) };
      return verdicts.every((verdict) => verdict === true) ? { fit: SLOT_FIT_SHARED, packs } : { fit: null, packs };
    };

    /* Банк, чей слот Astral не растит: предел — записанный слот, а у банка без сверенного слота (музыка, потоки, дополнения) — сам банк игры. Опись основы нужна только ему. */
    if (!growth) {
      const fingerprint = keyOf({});
      const hit = await cached(fingerprint);
      if (hit) return { ...hit, need: null };
      await ensureBase();
      const own = completeBank || known ? {} : (await tools.inspect({ input: baseBank, edition, gameRoot }))?.resource || {};
      const limits = known
        ? { slot: known.name, bytes: written.bytes, header: written.header, metadata: written.metadata }
        : waveSlotBudget(archive, entry, own, { completeBank: Boolean(completeBank) });
      const built = await build(fingerprint, { limits }).catch(async (error) => {
        if (!error.slotRefusal) throw error;
        /* Совет в отказе зависит от того, помещается ли пак один (25.11.2026: раньше здесь всегда советовали снять другие паки — и паку вдвое больше слота). */
        const fitsLimits = (single) => soloPatch(single, limits).then(() => true, (failure) => (isSlotRefusal(failure) ? false : null));
        throw slotBudgetError(entry, error, { catalog, ...(catalog ? await slotFitFact(fitsLimits) : {}) });
      });
      return { ...built, need: null };
    }

    /* Слот, который Astral умеет поднимать. 1. Сборка до потолка роста — меряет, сколько банку нужно. */
    const ceiling = slotCeiling(known.name);
    /* Помещается ли слой один: та же сверка, что у банка (потолок роста, мёртвые дорожки), но слой в одиночку. `null` — выяснить не удалось. Зовётся только при отказе. */
    const fitsAlone = async (single) => {
      try {
        const result = await soloPatch(single, ceiling);
        /* Потолок не отказал: слою хватает слота с подъёмом. Без подъёма — только если он входит в записанный слот сам или с мёртвыми дорожками. */
        if (raiseEnabled) return true;
        if (!result || !Number.isFinite(Number(result.contentBytes))) return null;
        const budget = { header: Number(result.headerBytes), metadata: Number(result.metadataBytes), content: Number(result.contentBytes) };
        if (budgetFits(budget, written)) return true;
        const own = new Set([...single.merge.streams, ...(single.merge.drop || [])].map((id) => String(id).toUpperCase()));
        return chooseSpareDrops({ budget, slot: written, spare: spareOf(spareTable, archive, entry, own) }) !== null;
      } catch (error) {
        return isSlotRefusal(error) ? false : null;
      }
    };
    const measureKey = keyOf({ measure: [ceiling.bytes, ceiling.header, ceiling.metadata] });
    let measured = await cached(measureKey);
    if (!measured) {
      measured = await build(measureKey, { limits: ceiling }).catch(async (error) => {
        if (!error.slotRefusal) throw error;
        throw slotBudgetError(entry, error, { catalog, raisable: true, raiseOff: !raiseEnabled, ...(catalog ? await slotFitFact(fitsAlone) : {}) });
      });
    }
    if (!measured.budget) throw new Error(`Помощник не назвал размер собранного банка ${entry}: слот сверить нечем.`);
    if (budgetFits(measured.budget, written)) return { ...measured, need: null };

    /* 2. Мёртвые дорожки: убрать из банка столько, сколько нужно, чтобы он вошёл в записанный слот. */
    const claimed = new Set(
      ordered.flatMap((layer) => [...layer.merge.streams, ...(layer.merge.drop || [])]).map((id) => String(id).toUpperCase()),
    );
    const spare = spareOf(spareTable, archive, entry, claimed);
    const choice = chooseSpareDrops({ budget: measured.budget, slot: written, spare });
    const attempts = [];
    if (choice?.length) attempts.push(choice);
    if (spare.length && (!choice || choice.length < spare.length)) attempts.push(spare.map((row) => row[0]));
    for (const drop of attempts) {
      const dropKey = keyOf({ measure: [ceiling.bytes, ceiling.header, ceiling.metadata], spare: drop, slot: [written.bytes, written.header, written.metadata] });
      const hit = await cached(dropKey, drop);
      if (hit) return { ...hit, need: null };
      try {
        const built = await build(dropKey, { limits: written, extraDrop: drop });
        appLog.record({
          level: "info",
          source: "sound-slot",
          message: `Банк ${entry} не помещался в слот ${written.slot}: убрано мёртвых дорожек — ${drop.length} (${drop.join(", ")}), слот не менялся.`,
        });
        return { ...built, need: null };
      } catch (error) {
        if (!error.slotRefusal) throw error;
      }
    }

    /* 3. Не хватило и этого: слот надо поднять ровно под банк — решает установка. Подъём выключен — отказ словами, слот не трогается. */
    if (!raiseEnabled)
      throw slotBudgetError(entry, new Error(`AWC slot budget exceeded (${known.name}): ${Object.keys(slotOverrun(measured.budget, written)).map((key) => `${key === "bytes" ? "content" : key} ${measured.budget[key === "bytes" ? "content" : key]}/${written[key]}`).join(", ")}.`), { catalog, raisable: true, raiseOff: true, ...(catalog ? await slotFitFact(fitsAlone) : {}) });
    const raised = raiseSlot(known.name, measured.budget, written);
    if (!raised.slot)
      throw slotBudgetError(entry, new Error(`AWC slot budget exceeded (${known.name}): ${Object.entries(raised.over).map(([key, value]) => `${key === "bytes" ? "content" : key} ${value}/0`).join(", ")}.`), { catalog, raisable: true, ...(catalog ? await slotFitFact(fitsAlone) : {}) });
    return { ...measured, need: { slot: known.name, raised: raised.slot, budget: measured.budget } };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

export async function materializeAwcEntry({
  /* Состояние цели установки: из него берётся слот, записанный в audioconfig игрока. */
  target = null,
  ...options
}) {
  const known = options.layers?.some((layer) => layer?.merge?.completeBank) ? null : waveSlotOf(options.archiveTarget, options.entry);
  const slot = known ? await slotInState(target, known.name) : null;
  const plan = await planAwcEntry({ ...options, slot });
  if (plan.need) throw new AwcSlotRaise({ entry: options.entry, need: plan.need });
  return plan.output;
}
