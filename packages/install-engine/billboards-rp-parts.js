/*
 * Билборды на GTA 5 RP частью (21.11.2026, слово владельца: «на GTA 5 RP все моды должны быть видны»): что из набора мест `billboards` едет контейнером `update.rpf`, а что нет.
 * Образец — `places-rp-parts.js` (здания) и `arena-rp-parts.js` (арена); здесь свои правила, потому что у билбордов нет «здания»: набор — листы рекламы в штатных моделях и словарях
 * районов (файлы игры под своими именами, перекрашенные), свои копии словарей щитов `astral_bb_<хеш>.ytd`, типы районов `*_strm.ytyp` со ссылками на копии и живые щиты-гифки
 * (`astral_billboardlive_*`).
 *
 * Едет контейнером:
 *   • файлы игры под своими именами, что лежат только в базе и `update.rpf` (модели `ydr`, словари `ytd`, дальние планы `ydd`, ткань `yft`): контейнер `update.rpf` перебивает базу по имени
 *     (так же едут стена арены и здания, снято на сервере);
 *   • файлы, у которых есть одноимённая копия в пакете игры, если пакет стоит в `dlclist.xml` не дальше `BILLBOARDS_RP_PROVEN_PACK_POSITION` (36): контейнер перекрывает пакеты до этого места — по пробам E8 и E9
 *     (20.11, сюжет; `rp-probes-2011/README.md`: словари у `patchday2ng` (13), `patchday8ng` (26) и зеркала `dlc_patch/mpheist4` (36)) и по шестому заходу на GTA 5 RP (21.11, `RP-VISIT-6-SHEET-2111.md`: остановка
 *     оранжевая; модели `prop_busstop_02/04/05.yft` есть и в `mpvalentines2` (31)); модели и словари у нас в этой границе считаются одинаково;
 *   • живые щиты `astral_billboardlive_m1…m16` с клипами, их типы и карта (пара «карта → типы» попадает в манифест контейнера, как у плашек зданий).
 * НЕ едет:
 *   • файлы, чей одноимённый в пакете стоит в `dlclist.xml` дальше 36-го места (`mpvinewood` 57, `mptuner` 64, `patchday27ng` 71, `mp2024_02` 89): дальше E9 проб нет, лист щита остаётся штатным, щит в счёт «видно» не идёт;
 *     граница — одна константа, её сдвинет проба (контрольные щиты приёмочного проекта, `BILLBOARDS-ACCEPT-2111.md`);
 *   • типы районов (`RECOLOR_SETS.billboards.overrides`, 31 файл, 25 из них лежат в `patchday*` / `mpvinewood`): типы и карты из контейнера пакеты не перекрывают (опыт 06.10), по имени в игре не снимался;
 *   • копии словарей `astral_bb_*.ytd`: они работают только через типы района (архетип щита смотрит на копию); без типов стоят без дела, щит остаётся штатным, дыры нет.
 *
 * Что показал заход в сюжете (21.11, набор `rel-billboards` на 417aff90a, кадры `arenasp-CRASHREL_BILLBOARDS`): контрольные щиты `sc1_10_ground02__318__1660` и `dt1_20_ground2__373__878` перекрашены, хотя `lr_sc1_10_ground02.ydr` и
 * `hei_dt1_20_ground2.ydr` из контейнера были сняты. Причина: лицо щита лежит в МОДЕЛИ района (`.ydr` со своими листами), а у такого щита два листа — базовая модель (`sc1_10_ground02.ydr`, `dt1_20_ground2.ydr`; она красится и в сюжете)
 * и вариант онлайн-карты (`lr_*` — лоурайдер, `hei_*` — Heist; игра рисует его, только когда сервер включил карту пакета). Поэтому сюжет НЕ проверяет, перекрывает ли контейнер модель из пакета; это покажет только сервер.
 * В сюжете подтверждено: контейнер красит базовые листы по имени. На сервере не снято: варианты `lr_*`, `hei_*` и все файлы пакетов.
 *
 * «Видно N из M щитов» считает не этот модуль, а `apps/desktop/src/billboards-rp-count.js`: щит виден, если ВСЕ файлы его листов (ближний, HD, дальние, свечение) едут (`billboardsRpHidden`
 * говорит, какой файл не едет). Список `BILLBOARDS_RP_PACK_OWNED` — по оглавлениям игры 1.0.3889.0 (135 архивов, 106 пакетов из `dlclist.xml`; `BILLBOARDS-RP-2111.md` в заметках ведущей) с местом
 * самого позднего пакета в `dlclist.xml`; пакет игры, что позже принесёт одноимённый файл, перекроет контейнер, а список этого не знает. Какие из пакетов клиент RAGE MP монтирует, в репозитории не записано.
 *
 * Модуль чистый: ввода-вывода нет. Имена — как в наборе, регистр не важен.
 */
import { RECOLOR_SETS } from "./recolor-manifest-trust.js";

export const BILLBOARDS_SET = "billboards";

/**
 * Самое далёкое место пакета в `dlclist.xml`, где контейнер `update.rpf` перекрывает одноимённый файл пакета, по пробам: E9 — зеркало `dlc_patch/mpheist4` (36), словари; шестой заход на GTA 5 RP — модели
 * остановок против `mpvalentines2` (31). Дальше проб нет: файлы пакетов с места 37 и дальше не едут.
 */
export const BILLBOARDS_RP_PROVEN_PACK_POSITION = 36;

/** Файлы игры из набора `billboards`, у которых есть одноимённый в пакете, подключённом позже базы (оглавления игры 1.0.3889.0): `[имя, самый поздний пакет, его место в dlclist.xml]`. */
export const BILLBOARDS_RP_PACK_OWNED = Object.freeze(
  [
    ["dt1_lod_fwy1a_slod2_children.ytd", "patchday27ng", 71],
    ["dt1_lod_slod3.ydr", "patchday27ng", 71],
    ["fwy_01_olimpsign.ytd", "patchday27ng", 71],
    ["fwy_01_olimpsign_lod.ytd", "patchday27ng", 71],
    ["hei_dt1_20_ground2+hidr.ytd", "mpheist", 10],
    ["hei_dt1_20_ground2.ydr", "mpheist", 10],
    ["hei_hw1_24_build2+hidr.ytd", "mpheist", 10],
    ["hei_hw1_24_build2.ydr", "mpheist", 10],
    ["hei_id2_14_building.ydr", "mpheist", 10],
    ["lr_sc1_02_build2+hidr.ytd", "mplowrider", 24],
    ["lr_sc1_02_build2.ydr", "mplowrider", 24],
    ["lr_sc1_02_sprayshop2+hidr.ytd", "mplowrider", 24],
    ["lr_sc1_02_sprayshop2.ydr", "mplowrider", 24],
    ["lr_sc1_10_ground02.ydr", "mplowrider", 24],
    ["m24_2_mp2024_02_additions_billboard.ydr", "mp2024_02", 89],
    ["m24_2_mp2024_02_additions_garment_lod.ytd", "mp2024_02", 89],
    ["m24_2_mp2024_02_additions_garment_slod.ytd", "mp2024_02", 89],
    ["sc1_20_building+hidr.ytd", "patchday2ng", 13],
    ["sc1_20_building.ydr", "patchday2ng", 13],
    ["sm_lod_slod2.ytd", "patchday27ng", 71],
    ["tr_id2_18_tuner_lod.ytd", "mptuner", 64],
    ["tr_id2_18_tuner_meetup_hd.ydr", "mptuner", 64],
    ["tr_id2_18_tuner_slod.ytd", "mptuner", 64],
    ["vw_casino_billboard.ytd", "mpvinewood", 57],
    ["vw_casino_billboard_lod.ytd", "mpvinewood", 57],
    ["vw_casino_billboard_slod.ytd", "mpvinewood", 57],
  ].map((row) => Object.freeze(row)),
);

/** Из них те, что не едут: пакет дальше границы проб (`BILLBOARDS_RP_PROVEN_PACK_POSITION`). */
export const BILLBOARDS_RP_PACK_BEYOND = Object.freeze(
  BILLBOARDS_RP_PACK_OWNED.filter(
    ([, , position]) => position > BILLBOARDS_RP_PROVEN_PACK_POSITION,
  ).map(([name]) => name),
);

/** Группы слов окна: видно / не видно (слова с числами — `apps/web/.../tasks/rp-billboards-copy.js`). */
export const BILLBOARDS_RP_SEEN_GROUPS = Object.freeze(["boards", "live"]);
export const BILLBOARDS_RP_HIDDEN_GROUPS = Object.freeze([
  "boards-packs",
  "boards-copies",
]);

const lower = (name) => String(name).toLowerCase();
const beyond = new Set(BILLBOARDS_RP_PACK_BEYOND.map(lower));
const copyName = /^astral_bb_[0-9a-f]{8}\.ytd$/;
const liveName = /^astral_billboardlive_/;

let overridesCache = null;
const overrides = () =>
  (overridesCache ??= new Set(
    RECOLOR_SETS[BILLBOARDS_SET].overrides.map(lower),
  ));

/**
 * Опыт (по умолчанию ВЫКЛЮЧЕН): типы районов и копии словарей щитов тоже едут контейнером (`ASTRAL_BILLBOARDS_RP_TYPES=1`). Нужен, чтобы кадром отличить, читает ли игра тип района из контейнера по имени: щит с копией
 * словаря и типом района (`ap1_04_billssss01__733__2123` — тип только в базе, `cs1_04_bank_bb__97_6456` — тип и в `patchday1ng`/`patchday2ng`) покрасится, если читает, и останется штатным, если нет. Без выключателя типы и копии
 * не едут никогда: проб нет, опыт 06.10 говорит «не читает».
 */
export const BILLBOARDS_RP_TYPES_ENV = "ASTRAL_BILLBOARDS_RP_TYPES";
export const billboardsRpTypesEnabled = (env = {}) =>
  String(env?.[BILLBOARDS_RP_TYPES_ENV] ?? "").trim() === "1";

/** Группа «не видно» файла набора билбордов (`boards-packs`: одноимённый файл в пакете дальше границы проб; `boards-copies`: копия словаря и типы района) или `null`, если файл едет. `types` — опыт с типами. */
export function billboardsRpHidden(name, { types = false } = {}) {
  const lowered = lower(name);
  if (beyond.has(lowered)) return "boards-packs";
  if (!types && (overrides().has(lowered) || copyName.test(lowered)))
    return "boards-copies";
  return null;
}

/** Файл, которого строгая форма манифеста контейнера не пускает ни при каком выключателе: файлы пакетов дальше границы проб; типы и копии пускает только опыт, а какие из них едут, решает разбор (`billboardsRpSplit`). */
export const billboardsRpNeverByContainer = (name) =>
  billboardsRpHidden(name, { types: true }) !== null;

/** Группа «видно» оставшегося файла (`live` — живые щиты, `boards` — листы щитов в файлах игры) или `null`. */
function seenGroup(name) {
  const lowered = lower(name);
  if (liveName.test(lowered)) return "live";
  if (!lowered.startsWith("astral_") && /\.(?:ydr|yft|ytd|ydd)$/.test(lowered))
    return "boards";
  return null;
}

/** Разбор собранных файлов набора для режима RP: `{ kept, dropped, unknown, chosen, refused }` (форма как у `placesRpSplit`). */
export function billboardsRpSplit(names, { types = false } = {}) {
  const set = RECOLOR_SETS[BILLBOARDS_SET];
  const allowed = new Set([...set.files, ...set.extra].map(lower));
  const kept = [];
  const dropped = [];
  const unknown = [];
  const hidden = new Set();
  const seen = new Set();
  for (const name of names) {
    const lowered = lower(name);
    if (!allowed.has(lowered)) {
      unknown.push(name);
      continue;
    }
    const group = billboardsRpHidden(lowered, { types });
    if (group) {
      dropped.push(name);
      hidden.add(group);
    } else {
      kept.push(name);
      const shown = seenGroup(lowered);
      if (shown) seen.add(shown);
    }
  }
  return {
    kept,
    dropped,
    unknown,
    chosen: BILLBOARDS_RP_SEEN_GROUPS.filter((id) => seen.has(id)),
    refused: BILLBOARDS_RP_HIDDEN_GROUPS.filter((id) => hidden.has(id)).map(
      (id) => ({ id }),
    ),
  };
}

/** Строка журнала: набор билбордов ставится частью (что легло, что снято). */
export function billboardsRpLine(split) {
  return `Места через update.rpf: набор ${BILLBOARDS_SET} ставится частью — легло файлов ${split.kept.length}, снято ${split.dropped.length} (файлы пакетов игры дальше границы проб, типы районов и копии словарей щитов).`;
}
