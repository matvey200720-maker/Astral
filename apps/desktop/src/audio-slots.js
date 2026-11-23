/*
 * Слоты памяти звуковых банков: слой Astral в `audioconfig.dat4.rel`, который растёт и убывает вместе с банками.
 *
 * ЗАЧЕМ. Паки звуков оружия каталога собираются из чужих банков, и `weapons.awc` с их дорожками длиннее штатного — а слот
 * STATIC_WEAPONS в игре сделан ровно по штатному банку (`wave-slots.js`). Мёртвые дорожки освобождают немного (`slot-fit.js`);
 * если банк всё равно больше, слот поднимается в `update.rpf/x64/audio/config/audioconfig.dat4.rel` ровно под собранный банк.
 *
 * ЧТО ЭТО ЗА СЛОЙ. Производный, как реестры `content.xml` и `dlclist.xml` (`registry-composers.js`): запись `audioconfig.dat4.rel`
 * в update.rpf получает слой `@astral-audio-slots` (действие `replace`, файл — то, что лежало под ним, с поднятыми числами).
 * Слой не принадлежит ни одному моду и пересчитывается из состояния при каждой установке и снятии:
 *   • поставили или сняли пак звуков — банк пересобран, слот пересчитан (поднят, понижен или слой снят совсем);
 *   • поставили или сняли редукс со своим `audioconfig.dat4.rel` — слой ложится на ЕГО файл (верхний слой записи, а без слоёв —
 *     файл игры из основы update.rpf), потому что слот игрок получает из того файла, что лежит в игре, и поднимать надо его;
 *   • «Вернуть GTA V без модов» и восстановление после проверки файлов игры сносят слои целиком — слой уходит вместе с ними.
 * Банк при сборке сверяется со слотом из состояния (`slotInState`), поэтому «банк больше слота» после чужой установки не
 * проходит: сборка просит слот выше (`AwcSlotRaise`), а не отдаёт банк в игру.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fingerprintSha256 as sha256File } from "@modovik/install-engine/file-fingerprint.js";
import { takeStrippedAudioSlotsLayers } from "@modovik/install-engine/audio-slot-layer.js";
import { ensureBaseFile } from "@modovik/install-engine/base-recovery.js";
import { ensureArchiveResource } from "@modovik/install-engine/resource-composition.js";
import {
  ownRecordValue,
  setRecordValue,
} from "@modovik/install-engine/state-record.js";
import {
  patchAudioConfigSlots,
  readAudioConfigSlots,
} from "@modovik/sound-studio";
import {
  AUDIO_CONFIG_ARCHIVE,
  AUDIO_CONFIG_ENTRY,
  AUDIO_SLOTS_LAYER,
  planAwcEntry,
  slotInState,
} from "./audio-composer.js";
import { appLog } from "./app-log.js";
import { extractRpfEntry } from "./rpf-composer.js";

/* Банки, чей слот Astral умеет поднимать: слот → архив и запись банка. */
const GROWABLE_BANKS = Object.freeze([
  Object.freeze({
    slot: "STATIC_WEAPONS",
    archive: "x64/audio/sfx/RESIDENT.rpf",
    entry: "weapons.awc",
  }),
]);

const ownLayers = (layers) =>
  (layers || []).filter((layer) => layer?.modId === AUDIO_SLOTS_LAYER);

/**
 * Слой слотов под текущие слои звуковых банков. Меняет состояние цели на месте.
 *
 * @returns {Promise<{ changed: boolean, raised: Record<string, {bytes: number, header: number, metadata: number}> }>}
 *   `changed` — слой в update.rpf появился, исчез или поменялся: архив надо собрать заново.
 */
export async function settleAudioSlots({
  target,
  targetKey,
  paths,
  edition = target?.edition,
  gameRoot = target?.gameRoot,
  signal = null,
  onProgress = null,
  /* Только в тестах. */
  tools = { extract: extractRpfEntry },
  planner = planAwcEntry,
}) {
  if (!target || !paths?.root || !targetKey)
    throw new Error("Слот звукового банка: нет состояния установки.");
  const archive = target.archives?.[AUDIO_CONFIG_ARCHIVE];
  const record = archive
    ? ownRecordValue(archive.entries || {}, AUDIO_CONFIG_ENTRY)
    : null;
  /* Слой, снятый установкой до проверок владения, — тоже «прежний»: иначе тот же слой выглядел бы новым. */
  const before = [
    ...ownLayers(record?.layers),
    ...takeStrippedAudioSlotsLayers(target),
  ];
  /* Что банки просят: слот → числа. */
  const raised = {};
  for (const bank of GROWABLE_BANKS) {
    const bankRecord = ownRecordValue(
      target?.archives?.[bank.archive]?.entries || {},
      bank.entry,
    );
    const layers = (bankRecord?.layers || []).filter(
      (layer) => layer?.merge?.strategy === "awc-stream-layer-v1",
    );
    if (!layers.length) continue;
    /* Копия основы за дни остывает — уходит в куски и опись (`chunk-store.js`), файла нет; планировщик читает её отпечатком и распаковкой записи: вернуть до чтения (журнал тестера beta.109, 22.11.2026). */
    await ensureBaseFile({ target, archiveTarget: bank.archive, paths, targetKey, gameRoot, signal });
    const resource = target.resources?.[bank.archive];
    const baseArchive = (resource?.compositionBase || resource?.base)?.path;
    if (!baseArchive) continue;
    const plan = await planner({
      layers,
      entry: bank.entry,
      archiveTarget: bank.archive,
      baseArchive,
      targetKey,
      edition,
      gameRoot,
      stateDir: paths.root,
      signal,
      /* Слот, на который ляжет наш слой: файл игрока без него. */
      slot: await slotInState(target, bank.slot, { withoutOwn: true }),
    });
    if (plan.need) raised[bank.slot] = plan.need.raised;
  }
  const wanted = Object.keys(raised).length > 0;
  if (!wanted && !before.length) return { changed: false, raised };
  if (!wanted) {
    record.layers = (record.layers || []).filter(
      (layer) => layer?.modId !== AUDIO_SLOTS_LAYER,
    );
    appLog.record({
      level: "info",
      source: "sound-slot",
      message:
        "Слот памяти звука возвращён штатным: паков звуков, которым он тесен, не осталось.",
    });
    return { changed: true, raised };
  }

  /* Под слоем — файл, который лежал бы в игре без него: верхний чужой слой записи, а без него — файл основы update.rpf. */
  const { archive: updateArchive } = await ensureArchiveResource({
    target,
    archiveTarget: AUDIO_CONFIG_ARCHIVE,
    root: gameRoot,
    paths,
    targetKey,
    signal,
    onProgress,
  });
  /* Основа update.rpf — тоже могла остыть: файл `audioconfig.dat4.rel` берётся из неё. */
  await ensureBaseFile({ target, archiveTarget: AUDIO_CONFIG_ARCHIVE, paths, targetKey, gameRoot, signal });
  const entries =
    updateArchive?.entries || target.archives[AUDIO_CONFIG_ARCHIVE].entries;
  const entryRecord =
    ownRecordValue(entries, AUDIO_CONFIG_ENTRY) ||
    setRecordValue(entries, AUDIO_CONFIG_ENTRY, { layers: [] });
  const under = (entryRecord.layers || [])
    .filter((layer) => layer?.modId !== AUDIO_SLOTS_LAYER)
    .at(-1);
  let underPath =
    under?.cachePath && under.action !== "delete" ? under.cachePath : null;
  const directory = path.join(paths.payloads, "_audio-slots", targetKey);
  await fs.mkdir(directory, { recursive: true });
  if (!underPath) {
    const resource = target.resources[AUDIO_CONFIG_ARCHIVE];
    const baseArchive = (resource.compositionBase || resource.base).path;
    const baseSha = await sha256File(baseArchive);
    underPath = path.join(
      directory,
      `under-${createHash("sha256").update(baseSha).digest("hex").slice(0, 16)}.rel`,
    );
    if (
      !(await fs.stat(underPath).then(
        (stat) => stat.isFile() && stat.size > 16,
        () => false,
      ))
    ) {
      const staged = `${underPath}.${randomUUID()}.stage`;
      await tools.extract({
        archivePath: baseArchive,
        entry: AUDIO_CONFIG_ENTRY,
        output: staged,
        archiveTarget: AUDIO_CONFIG_ARCHIVE,
        edition,
        gameRoot,
      });
      await fs.rename(staged, underPath);
    }
  }
  const underBytes = await fs.readFile(underPath);
  const slots = readAudioConfigSlots(underBytes);
  /* Поднимается слот, которого в файле нет, — файл не тот (иная сборка игры): отказ словами. */
  for (const name of Object.keys(raised))
    if (!slots.has(name))
      throw new Error(
        `В audioconfig.dat4.rel игрока нет слота ${name}: слот памяти для звукового банка не поднять.`,
      );
  const patched = patchAudioConfigSlots(underBytes, raised);
  const fingerprint = createHash("sha256").update(patched).digest("hex");
  const output = path.join(directory, `${fingerprint}.rel`);
  if (
    !(await fs.stat(output).then(
      (stat) => stat.isFile(),
      () => false,
    ))
  ) {
    const staged = `${output}.${randomUUID()}.stage`;
    await fs.writeFile(staged, patched);
    await fs.rename(staged, output);
  }
  const layer = {
    modId: AUDIO_SLOTS_LAYER,
    version: fingerprint.slice(0, 12),
    action: "replace",
    cachePath: output,
    sha256: fingerprint,
  };
  /*
   * Слой всегда лежит верхним, поэтому «тот же» — тот же файл: что лежит под ним, другой установке видно по её собственным слоям. Но
   * слой в состоянии не значит слой в игре: проверка файлов Steam или другая программа могли вернуть update.rpf к штатному, и тогда
   * банк, собранный под поднятый слот, лёг бы в игру при штатном. Поэтому «тот же» — только если живой update.rpf — ровно та сборка,
   * что движок записал последней (`lastBuilt.sha256`; отпечаток читается из памяти и дорог лишь у файла, что изменился). Иначе
   * update.rpf собирается заново: лишняя минута, но не рассинхрон «банк больше слота».
   */
  const built = target.archives?.[AUDIO_CONFIG_ARCHIVE]?.lastBuilt?.sha256;
  const liveIsLastBuild =
    typeof built === "string" &&
    built.length > 0 &&
    (await sha256File(path.join(gameRoot, "update", "update.rpf")).catch(
      () => "",
    )) === built;
  const same =
    before.length === 1 && before[0].sha256 === fingerprint && liveIsLastBuild;
  entryRecord.layers = [
    ...(entryRecord.layers || []).filter(
      (item) => item?.modId !== AUDIO_SLOTS_LAYER,
    ),
    layer,
  ];
  if (!same)
    appLog.record({
      level: "info",
      source: "sound-slot",
      message: `Слот памяти звука поднят под банк пака: ${Object.entries(raised)
        .map(
          ([name, slot]) =>
            `${name} — данные ${slot.bytes}, служебные ${slot.metadata}, таблица ${slot.header}`,
        )
        .join("; ")}.`,
      detail: JSON.stringify({ raised, layer: fingerprint.slice(0, 12) }),
    });
  return { changed: !same, raised };
}
