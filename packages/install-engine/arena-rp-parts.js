/*
 * Арена на GTA 5 RP: что из набора `arenas` едет контейнером `update.rpf`, а что нет (21.11.2026, слово владельца: «на GTA 5 RP все моды должны быть видны»).
 *
 * Набору отказывало `overrides`: четыре файла типов Rockstar он перекрывает копиями (`v_int_62.ytyp` — зал GTA 5 RP, лежит только в базе `x64h`; `sanpedro_metadata_003.ytyp` и `…_004_strm.ytyp` —
 * лежат в `patchday1ng` и `patchday2ng`, пакет главнее контейнера; `astral_arenas_local.ytyp` — наш файл типов копий вещей) — и на RP арена вставала прежним пакетом `astral_places`, которого RAGE MP не
 * подключает: «установлено», а в игре ничего. Стендом лида 1 (контейнер, только файлы фасада) вывеска арены на GTA 5 RP была видна, значит всё «без перекрытий» едет контейнером.
 *
 * Едет: здание (`sp1_10_*`: листы стены, окон, крыши, дальние планы по штатным именам, полотна общим видом), зал по именам игры (`v_62_*`), плашки эмблем, щита, знака и надписей с типами, картой и
 * манифестом (`astral_arenas_emblem|cover|marks*`), свои модели снаружи (`astral_arenas_m*`, `astral_arenas_models*`). НЕ едет: четыре перекрытия и всё, что работает только вместе с ними, — иначе файлы
 * стоят без дела (словари полотен и копии дальних планов не на что навести) или хуже: звезда под штатным именем без правки сущности и архетипа смещена и теряется по рамке.
 *
 *   • «зал» (`v_int_62.ytyp`): вещи зала (кресла, автоматы, банкоматы, парковка, вещи по одной), звезда, картинки на полотнах внутри зала, свои модели внутри — копии вещей `astral_arenas_c00N`,
 *     `astral_arenas_item_rp_N`, плашки зала `astral_arenapanels_*`, модель и клипы звезды (`v_62_fos_props01.ydr`, `astral_arenas_star.ycd`), `astral_arenas_local.ytyp`;
 *   • полотна у арок по одному (`sanpedro_metadata_004_strm.ytyp`): словари `astral_arenas_b00…b17.ytd`;
 *   • вид арены с большого расстояния (`sanpedro_metadata_003.ytyp`): копии дальних планов `astral_arenas_sp1_*`.
 *
 * Выключатель зала `ASTRAL_ARENA_RP_HALL=1` (по умолчанию ВЫКЛЮЧЕН, для захода на GTA 5 RP): `v_int_62.ytyp` лежит только в базе `x64h`, пакеты Rockstar его не перебивают, значит копия в контейнере
 * должна быть главнее (в отличие от `sanpedro_metadata_*`, которые перебивают `patchday1ng` и `patchday2ng`). С ним едут `v_int_62.ytyp` и звезда (`v_62_fos_props01.ydr`, `astral_arenas_star.ycd`):
 * правки сущностей зала (убрать или заменить кресла, автоматы, банкоматы, парковку, наклейки колы, вещи по одной) и звезда обходятся без новых типов. НЕ едут и с ним: копии вещей (`astral_arenas_c00N`,
 * `astral_arenas_item_rp_N`, `astral_arenas_local.ytyp`) и плашки зала (`astral_arenapanels_*`): им нужны свои типы, а слой контейнера регистрирует только сам архив (`content.xml`, `RPF_FILE`), запроса
 * типов (`DLC_ITYP_REQUEST`), как у пакета мест, у него нет; сущности же в `v_int_62.ytyp` на такие копии уже наведены. Поэтому работа, где есть что-то из этого, и с выключателем остаётся как без него:
 * зал не кладётся целиком, чтобы сущности не смотрели на типы, которых игра не загрузит. Не проверено игрой: включим по умолчанию только после кадра с сервера.
 *
 * Модуль чистый: ввода-вывода нет. Имена — как в наборе (`RECOLOR_SETS.arenas`), регистр не важен.
 */
import { RECOLOR_SETS } from "./recolor-manifest-trust.js";

export const ARENA_RP_HALL_ENV = "ASTRAL_ARENA_RP_HALL";

/** Выключатель зала: слово `1`, `true`, `on` или `hall` (любой регистр); пусто и всё остальное — выключено. */
export const arenaRpHallEnabled = (env = {}) =>
  ["1", "true", "on", "hall"].includes(
    String(env?.[ARENA_RP_HALL_ENV] ?? "")
      .trim()
      .toLowerCase(),
  );

const lower = (name) => String(name).toLowerCase();

/* Группы «не видно» по порядку показа: id → правила (имена строчными). */
const NEVER_RULES = Object.freeze([
  [
    "cloths",
    (name) =>
      name === "sanpedro_metadata_004_strm.ytyp" ||
      /^astral_arenas_b\d\d\.ytd$/.test(name),
  ],
  [
    "far",
    (name) =>
      name === "sanpedro_metadata_003.ytyp" || /^astral_arenas_sp1_/.test(name),
  ],
]);
/* Зал, которому нужны свои типы (копии вещей, плашки): контейнер их не загружает, на RP не едут ни с выключателем, ни без. */
const HALL_OWN_TYPES_RULES = Object.freeze([
  [
    "hall-items",
    (name) =>
      name === "astral_arenas_local.ytyp" ||
      /^astral_arenas_c\d{3}\.(?:ydr|yft|ytd)$/.test(name) ||
      /^astral_arenas_item_rp_\d+\.(?:ydr|ytd)$/.test(name),
  ],
  ["hall-panels", (name) => /^astral_arenapanels_/.test(name)],
]);
/* Зал без новых типов: правка сущностей `v_int_62.ytyp` и звезда — едут только с выключателем зала (и только когда нет ничего из предыдущей группы). */
const HALL_SELF_RULES = Object.freeze([
  ["hall-items", (name) => name === "v_int_62.ytyp"],
  [
    "star",
    (name) =>
      name === "v_62_fos_props01.ydr" || name === "astral_arenas_star.ycd",
  ],
]);

/* Что мешает положить зал: копии вещей и плашки зала, а ещё свои модели (`astral_arenas_m*`, их типы): сущности зала в `v_int_62.ytyp` могут смотреть на них, а типы контейнер загружает только через карту. */
const arenaRpHallBlocker = (name) =>
  groupOf(HALL_OWN_TYPES_RULES, lower(name)) !== null ||
  /^astral_arenas_(?:m\d+|models)/.test(lower(name));

/** Порядок групп «не видно» в словах окна. */
export const ARENA_RP_HIDDEN_GROUPS = Object.freeze([
  "hall-items",
  "star",
  "hall-panels",
  "cloths",
  "far",
]);
/** Группы «видно» и их правила (по оставшимся именам), порядок — как в словах окна. */
const SEEN_RULES = Object.freeze([
  ["facade", (name) => /^sp1_/.test(name)],
  ["hall-colours", (name) => /^v_62_(?!fos_props01\.ydr$)/.test(name)],
  ["hall-items", (name) => name === "v_int_62.ytyp"],
  ["star", (name) => name === "v_62_fos_props01.ydr"],
  ["plates", (name) => /^astral_arenas_(?:emblem|cover|marks)/.test(name)],
  ["models", (name) => /^astral_arenas_(?:m\d+|models)/.test(name)],
]);
export const ARENA_RP_SEEN_GROUPS = Object.freeze(SEEN_RULES.map(([id]) => id));

const groupOf = (rules, name) =>
  rules.find(([, test]) => test(name))?.[0] ?? null;

/**
 * Группа «не видно» файла в режиме RP или `null`, если файл едет. `hall` — зал можно положить (выключатель включён и в работе нет копий вещей и плашек зала, `hallOk`): тогда `v_int_62.ytyp` и
 * звезда едут. Без `hall` — прежний ответ: весь зал не едет.
 */
export function arenaRpHiddenGroup(name, { hall = false } = {}) {
  const lowered = lower(name);
  return (
    groupOf(NEVER_RULES, lowered) ??
    groupOf(HALL_OWN_TYPES_RULES, lowered) ??
    (hall ? null : groupOf(HALL_SELF_RULES, lowered))
  );
}

/** Файл, которого строгая форма манифеста контейнера не пускает ни при каком выключателе: перекрытия, что перебивает пакет Rockstar, и зал со своими типами. */
export const arenaRpNeverByContainer = (name) =>
  groupOf(NEVER_RULES, lower(name)) !== null ||
  groupOf(HALL_OWN_TYPES_RULES, lower(name)) !== null;

/**
 * Разбор собранных файлов набора для режима RP: `names` — имена файлов сборки. Ответ: `{ kept, dropped, chosen, refused }` — что едет контейнером, что снято, группы «видно» (по именам, что остались) и
 * «не видно» (по именам, что сняты; `[{ id }]`, как у дорог). Имя, которого нет в наборе, не едет и в `dropped` не попадает: набор строгий, лишнее не пускаем (`unknown`).
 */
export function arenaRpSplit(names, { hall = false } = {}) {
  const allowed = new Set(
    [...RECOLOR_SETS.arenas.files, ...RECOLOR_SETS.arenas.extra].map(lower),
  );
  const kept = [];
  const dropped = [];
  const unknown = [];
  const hidden = new Set();
  /* Зал кладётся, только если выключатель включён и в работе нет ничего, что требует своих типов: иначе сущности в `v_int_62.ytyp` смотрели бы на копии, которых игра не загрузит. */
  const hallOk = hall && !names.some((name) => arenaRpHallBlocker(name));
  for (const name of names) {
    if (!allowed.has(lower(name))) {
      unknown.push(name);
      continue;
    }
    const group = arenaRpHiddenGroup(name, { hall: hallOk });
    if (group) {
      dropped.push(name);
      hidden.add(group);
    } else kept.push(name);
  }
  const seen = new Set(
    kept.map((name) => groupOf(SEEN_RULES, lower(name))).filter(Boolean),
  );
  return {
    kept,
    dropped,
    unknown,
    chosen: ARENA_RP_SEEN_GROUPS.filter((id) => seen.has(id)),
    refused: ARENA_RP_HIDDEN_GROUPS.filter((id) => hidden.has(id)).map(
      (id) => ({ id }),
    ),
  };
}

/** Имя манифеста контейнера и его запасное имя в пакете сборки (`payload/_manifest.rp.ymf`): полный манифест сборки лежит под своим именем, частичный — рядом, они не мешают друг другу. */
export const ARENA_RP_MANIFEST = "_manifest.ymf";
export const ARENA_RP_MANIFEST_PAYLOAD = "_manifest.rp.ymf";

/* Связи «карта → типы», что собирает сборка арены: плашки эмблем (`marks`, и дальняя карта `_lod` тех же типов) и свои модели; плашки зала (`arenapanels`) на RP не едут. */
const MANIFEST_PAIRS = Object.freeze([
  ["astral_arenas_marks_map", "astral_arenas_marks"],
  ["astral_arenas_marks_map_lod", "astral_arenas_marks"],
  ["astral_arenas_models_map", "astral_arenas_models"],
]);

/**
 * Связи для манифеста контейнера по едущим файлам (`kept`): пара «карта → типы» попадает в манифест, только если лежат ОБА файла (`<карта>.ymap` и `<типы>.ytyp`). Так в манифесте нет ни одного имени, которого
 * нет в контейнере (манифест полного набора называл типы и карты, которых на RP не кладут). Ответ для `compile-manifest`: `[{ map, types: [..] }]`; пусто — манифест не нужен.
 */
export function arenaRpManifestDependencies(kept) {
  const have = new Set(kept.map(lower));
  return MANIFEST_PAIRS.filter(
    ([map, types]) => have.has(`${map}.ymap`) && have.has(`${types}.ytyp`),
  ).map(([map, types]) => ({ map, types: [types] }));
}

/** Строка журнала: арена ставится частью (что легло, что снято, какие группы не видны). */
export function arenaRpLine({ kept, dropped, refused }) {
  const groups = refused.map(({ id }) => id).join(", ");
  return `Места через update.rpf: арена GTA 5 RP ставится частью — легло файлов ${kept.length}, снято ${dropped.length} (перекрытия типов игры и то, что едет только с ними${groups ? `: ${groups}` : ""}).`;
}
