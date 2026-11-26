// Сколько слоя звукового пака тесно в слоте памяти игры — при сборке заявки, до публикации (20.11.2026).
//
// Игра грузит банк `weapons.awc` в слот памяти STATIC_WEAPONS, сделанный ровно по штатному банку (`@modovik/sound-studio`,
// `wave-slots.js`); так же устроены слоты ближнего боя (STATIC_MELEE) и банков ствола игрока (PLAYER_WEAPON). Слой пака, где дорожки длиннее штатных, не помещается: установка (`apps/desktop/src/audio-composer.js`) освобождает
// мёртвые дорожки, а не хватило — поднимает слот в audioconfig.dat4.rel и пересобирает update.rpf. Это не отказ: пометка в описи пака
// («нужен подъём слота на N»), чтобы куратор видел её до публикации, а человек — до установки. Отказ (`over`) — когда не хватит и
// потолка роста слота: такой пак не встанет, и это видно сразу, а не у тестера.
//
// Расчёт идёт по таблице штатных дорожек (`stock-awc-hashes.json`: отсчёты и данные каждой дорожки) без игры: данные растут на разницу
// длин, служебные чанки — на разницу пиков (по 2 байта на каждые 4096 отсчётов после первых 4096; формат дорожки — те же 24 байта).
import { awcPeakBytes, waveSlotOf } from "@modovik/sound-studio";
import {
  SLOT_GROWTH,
  chooseSpareDrops,
  raiseSlot,
  slotCeiling,
  slotMembers,
  slotRaiseEnabled,
} from "@modovik/sound-studio/slot-fit";
import { WEAPON_BANK_SPARE } from "@modovik/sound-studio/weapon-bank-spare";
import { awcStreamName } from "@modovik/awc";
import { awcStreamDigests } from "@modovik/awc/digest";
import { stockBankOf, stockTable } from "./stock-awc.js";

const KIB = 1024;

const sizeText = (bytes) =>
  bytes >= KIB
    ? `${String(Math.round((bytes / KIB) * 10) / 10).replace(".", ",")} КБ`
    : `${bytes} Б`;

/**
 * Что слой делает с банком: на сколько вырастут данные и служебные чанки против штатного банка.
 *
 * @param {{archive: string, bank: string, streams: Iterable<number>, source: Uint8Array}} layer
 * @returns {{ archive: string, bank: string, slot: string, outcome: string, dataGrowth: number, metadataGrowth: number, raise: object | null } | null}
 *   `null` — у банка нет сверенного слота; `outcome`: `fits` · `spare` (хватит мёртвых дорожек) · `raise` · `over` · `unknown` (штатного банка нет в таблице).
 */
export function slotNeedOfLayer(
  layer,
  {
    table = stockTable(),
    spare = WEAPON_BANK_SPARE,
    /* Подъём слота включён (`ASTRAL_SOUND_SLOT_RAISE`, `slot-fit.js`); выключен — вместо «нужен подъём» пак «не встанет сейчас». */
    raiseEnabled = slotRaiseEnabled(),
  } = {},
) {
  const entry = `${layer.bank}.awc`;
  const slot = waveSlotOf(layer.archive, entry);
  if (!slot) return null;
  const base = { archive: layer.archive, bank: layer.bank, slot: slot.name };
  const stock = stockBankOf(layer.archive, layer.bank, table);
  if (!stock || !layer.source)
    return {
      ...base,
      outcome: "unknown",
      dataGrowth: 0,
      metadataGrowth: 0,
      raise: null,
    };
  const author = awcStreamDigests(layer.source);
  let dataGrowth = 0;
  let metadataGrowth = 0;
  for (const id of layer.streams) {
    const own = author.get(id);
    const old = stock.streams.get(id);
    if (!own || !old) continue;
    dataGrowth += own.dataBytes - old.dataBytes;
    metadataGrowth += awcPeakBytes(own.samples) - awcPeakBytes(old.samples);
  }
  if (dataGrowth <= 0 && metadataGrowth <= 0)
    return {
      ...base,
      outcome: "fits",
      dataGrowth,
      metadataGrowth,
      raise: null,
    };
  /* У постоянных банков RESIDENT штатный банк занимает слот ровно (`wave-slots.js`): запас — то, что слот просторнее файла. */
  const slack = { bytes: Math.max(0, slot.bytes - stock.bytes), metadata: 0 };
  const budget = {
    header: slot.header,
    metadata: slot.metadata + Math.max(0, metadataGrowth) - slack.metadata,
    content: slot.bytes + Math.max(0, dataGrowth - slack.bytes),
  };
  const rows = spare[`${layer.archive}|${entry}`] || [];
  const claimed = new Set([...layer.streams].map((id) => awcStreamName(id)));
  const free = rows.filter((row) => !claimed.has(String(row[0]).toUpperCase()));
  if (chooseSpareDrops({ budget, slot, spare: free }) !== null)
    return {
      ...base,
      outcome: "spare",
      dataGrowth,
      metadataGrowth,
      raise: null,
    };
  const raised = raiseSlot(slot.name, budget, slot);
  if (raised.slot && !raiseEnabled)
    return {
      ...base,
      outcome: "over",
      raiseOff: true,
      dataGrowth,
      metadataGrowth,
      raise: null,
      wouldRaise: {
        bytes: raised.slot.bytes - slot.bytes,
        metadata: raised.slot.metadata - slot.metadata,
      },
    };
  if (!raised.slot)
    return {
      ...base,
      outcome: "over",
      dataGrowth,
      metadataGrowth,
      raise: null,
      over: raised.over,
      ceiling: slotCeiling(slot.name),
    };
  return {
    ...base,
    outcome: "raise",
    dataGrowth,
    metadataGrowth,
    raise: {
      bytes: raised.slot.bytes - slot.bytes,
      metadata: raised.slot.metadata - slot.metadata,
    },
  };
}

/** Все слои заявки: только те, что чего-то требуют от слота. */
export function slotNeedsOfLayers(layers, sources, options = {}) {
  return layers
    .map((layer) =>
      slotNeedOfLayer(
        { ...layer, source: sources.get(`${layer.archive}|${layer.bank}`) },
        options,
      ),
    )
    .filter(
      (need) => need && ["spare", "raise", "over"].includes(need.outcome),
    );
}

const describeNeed = (need) =>
  `${need.bank}.awc вырастет на ${sizeText(Math.max(0, need.dataGrowth))} звуков и ${Math.max(0, need.metadataGrowth)} Б служебных данных`;

/* Что сделает установка со слотом банка; у семьи (три слота ствола игрока) растёт каждый, поэтому назван и общий прирост. */
function raiseWords({ slot, raise }) {
  const members = slotMembers(slot);
  const each = `${sizeText(raise.bytes)} данных и ${raise.metadata} Б служебных`;
  return members > 1
    ? `поднимет ${members === 3 ? "три" : members} слота памяти ${slot}_0…${members - 1}, каждый на ${each} (всего на ${sizeText(raise.bytes * members)} данных)`
    : `поднимет слот памяти ${slot} на ${each}`;
}

/** Пометки в опись заявки: `{ code, severity, message }` — их видит куратор до публикации. */
export function slotProblems(needs) {
  return needs.map((need) => {
    if (need.outcome === "over" && need.raiseOff)
      return {
        code: "sound-slot-raise-off",
        severity: "warn",
        message: `Не встанет сейчас: ${describeNeed(need)}, для этого пришлось бы поднять слот памяти ${need.slot} на ${sizeText(need.wouldRaise.bytes)} данных, а подъём слота звуков в этой версии Astral выключен. Пак нужно пересобрать с более короткими звуками или ждать, пока подъём включат.`,
      };
    if (need.outcome === "over")
      return {
        code: "sound-slot-over",
        severity: "warn",
        message: `Не встанет: ${describeNeed(need)}, а слот памяти ${need.slot} (${sizeText(SLOT_GROWTH[need.slot]?.bytes ?? 0)} запаса роста у Astral) такого не вместит. Пак нужно пересобрать с более короткими звуками.`,
      };
    if (need.outcome === "raise")
      return {
        code: "sound-slot-raise",
        severity: "info",
        message: `Нужен подъём слота: ${describeNeed(need)}; установка ${raiseWords(need)} и пересоберёт update.rpf (около минуты).`,
      };
    return {
      code: "sound-slot-spare",
      severity: "info",
      message: `${describeNeed(need)}: слот ${need.slot} занят штатным банком впритык, установка освободит мёртвые дорожки банка (слот не меняется).`,
    };
  });
}

/** Фраза для описания карточки: человек видит её до установки; ничего — если слот не трогается. */
export function slotNote(needs) {
  const raises = needs.filter((need) => need.outcome === "raise");
  if (!raises.length) return "";
  /* Прибавка памяти, а не сумма по банкам: слот поднимается под самый тесный из своих банков, а у семьи растёт каждый слот. */
  const widest = new Map();
  for (const need of raises)
    widest.set(need.slot, Math.max(widest.get(need.slot) || 0, need.raise.bytes));
  let slots = 0;
  let bytes = 0;
  for (const [name, growth] of widest) {
    slots += slotMembers(name);
    bytes += growth * slotMembers(name);
  }
  const many = slots > 1;
  return `Звуки этого пака длиннее штатных: при установке Astral поднимет ${many ? "слоты" : "слот"} памяти звуков оружия (${many ? "всего на" : "на"} ${sizeText(bytes)}) и пересоберёт update.rpf — это займёт около минуты; снятие пака вернёт ${many ? "слоты как были" : "слот как был"}.`;
}
