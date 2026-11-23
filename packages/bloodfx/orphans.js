/*
 * Осиротевшие записи bloodfx.dat.
 *
 * Мастерская пишет в записи имя своего правила эффекта (`astral_impact_NNN`) и
 * при следующей установке снимает прежнюю правку по журналу
 * (`revertBloodRouting`). Но журнала может не быть: его не вела первая версия
 * мастерской, его теряет очищенное хранилище окна. Тогда в файле игрока
 * остаются записи с именем правила, которого в ядре уже нет — семейство
 * `astral_impact_*` пересобирается при каждой установке, — и попадание в такую
 * зону не показывало бы вообще ничего.
 *
 * Поэтому перед разбором проекта такие записи возвращаются к штатному виду.
 * Штатное — это имена правил и номера декалей самой игры по номерам записей
 * Legacy. Это адреса, а не содержимое: те же имена называет `core.ypt` любой
 * установки, те же номера — её `decals.dat`. Возвращается только то, что
 * мастерская умеет менять: имена правил, тон пятен, вероятность раны и
 * выключенные декали. Размеры, звук и прочие поля записи она не трогала.
 */

import { BLOODFX_EMPTY_NAME, BLOODFX_FIELD } from "./schema.js";
import { replaceToken } from "./document.js";

const NONE = BLOODFX_EMPTY_NAME;

/* Поля имён по порядку: тело, лёгкая броня, тяжёлая броня, под водой. */
const NAME_FIELDS = Object.freeze([
  BLOODFX_FIELD.fxSystem,
  BLOODFX_FIELD.fxSystemBodyArmour,
  BLOODFX_FIELD.fxSystemHeavyArmour,
  BLOODFX_FIELD.fxSystemUnderwater,
]);

/* Декали по порядку: пятно, пятно впитавшееся, брызги, брызги впитавшиеся,
   взвесь, взвесь впитавшаяся. */
const DECAL_FIELDS = Object.freeze([
  BLOODFX_FIELD.splatDecalNormal,
  BLOODFX_FIELD.splatDecalSoak,
  BLOODFX_FIELD.sprayDecalNormal,
  BLOODFX_FIELD.sprayDecalSoak,
  BLOODFX_FIELD.mistDecalNormal,
  BLOODFX_FIELD.mistDecalSoak,
]);

const NO_DECALS = Object.freeze(["0", "0", "0", "0", "0", "0"]);
const ENTRY_DECALS = Object.freeze(["1010", "1010", "1015", "1015", "0", "0"]);
const EXIT_DECALS = Object.freeze([
  "1010",
  "1010",
  "1015",
  "1015",
  "1017",
  "1017",
]);

const blunt = (name) => ({
  names: [name, NONE, NONE, NONE],
  decals: NO_DECALS,
});
const blade = (name) => ({
  names: [name, NONE, NONE, "blood_stab_uw"],
  decals: ENTRY_DECALS,
});
const firearm = (name) => ({
  names: [name, "blood_armour", "blood_armour_heavy", "blood_stab_uw"],
  decals: ENTRY_DECALS,
});
const exitWound = (name) => ({
  names: [name, NONE, NONE, NONE],
  decals: EXIT_DECALS,
});
/* Особые записи: резина, шокер, клоун, пришелец, скелет — без пятен, у клоуна
   и пришельца свой тон. */
const exotic = (names, tint) => ({ names, decals: NO_DECALS, tint });

const family = (ids, record) => ids.map((id) => [id, record]);

/* Входное отверстие: номер записи → штатный вид. */
const ENTRY_RULES = new Map([
  ...family(
    ["050", "060", "560", "070", "570", "080", "580", "081", "581"],
    blunt("blood_melee_blunt"),
  ),
  ...family(["062", "562"], blunt("blood_melee_punch")),
  ...family(
    [
      "051",
      "031",
      "065",
      "565",
      "052",
      "032",
      "075",
      "575",
      "053",
      "033",
      "085",
      "585",
    ],
    blade("blood_stab"),
  ),
  ...family(["054", "034", "086", "586"], blade("blood_throat")),
  ...family(["505"], firearm("blood_headshot")),
  ...family(
    [
      "401",
      "801",
      "402",
      "802",
      "403",
      "803",
      "404",
      "804",
      "405",
      "805",
      "406",
      "806",
    ],
    firearm("blood_chopper"),
  ),
  ...family(["108", "508"], firearm("blood_entry_shotgun")),
  ...family(["201", "701"], firearm("blood_entry_sniper")),
  ...family(["202", "702"], firearm("blood_entry_head_sniper")),
  ...family(
    ["295"],
    exotic(["bul_rubber_dust", "bul_rubber_dust", "bul_rubber_dust", NONE]),
  ),
  ...family(
    ["301"],
    exotic(["blood_stungun", "blood_stungun", "bul_stungun", NONE]),
  ),
  ...family(
    ["900"],
    exotic(["scr_clown_bul", NONE, NONE, NONE], ["206", "44", "204"]),
  ),
  ...family(
    ["950"],
    exotic(["scr_alien_impact_bul", NONE, NONE, NONE], ["0", "139", "185"]),
  ),
  ...family(
    ["960"],
    exotic([
      "bul_sb_hal_skel_bone",
      "bul_sb_hal_skel_bone",
      "bul_sb_hal_skel_bone",
      NONE,
    ]),
  ),
  ...family(
    ["965"],
    exotic([
      "bul_sb_hal_skel_armour",
      "bul_sb_hal_skel_armour",
      "bul_sb_hal_skel_armour",
      NONE,
    ]),
  ),
]);
/* Любая другая запись огнестрела — обычное входное отверстие. */
const ENTRY_DEFAULT = firearm("blood_entry");

/* Выходное отверстие: частицы в оригинале есть только у снайперских записей. */
const EXIT_RULES = new Map([
  ...family(["201", "701"], exitWound("blood_entry")),
  ...family(["202", "702"], exitWound("blood_entry_head_sniper")),
  ...family(["900"], exotic([NONE, NONE, NONE, NONE], ["206", "44", "204"])),
  ...family(["950"], exotic([NONE, NONE, NONE, NONE], ["0", "139", "185"])),
]);
const EXIT_DEFAULT = exitWound(NONE);

/* Тон пятен и вероятность раны у штатных записей крови одинаковы; свой тон
   только у клоуна и пришельца. */
const VANILLA_TINT = Object.freeze(["50", "0", "0"]);

function formatLike(sample, value) {
  const text = String(sample);
  const dot = text.indexOf(".");
  if (dot < 0) return String(Math.round(value));
  return value.toFixed(text.length - dot - 1);
}

/**
 * Возвращает к штатному виду записи, в которых стоит имя правила под одной из
 * приставок снятого семейства. Возвращает номера вылеченных записей.
 */
export function healOrphanedBloodRules(document, prefixes) {
  const wanted = (Array.isArray(prefixes) ? prefixes : [prefixes])
    .map((prefix) => String(prefix || "").toLowerCase())
    .filter(Boolean);
  const healed = [];
  if (!wanted.length) return healed;
  const orphan = (name) =>
    wanted.some((prefix) =>
      String(name ?? "")
        .toLowerCase()
        .startsWith(prefix),
    );

  /*
   * Выходная запись без частиц имени правила не несёт, и «без пятен» в ней
   * выдаёт только номер: её входная запись-тёзка осиротела, а все шесть
   * декалей в нуле.
   */
  const orphanedEntries = new Set();
  for (const [section, rules, fallback] of [
    ["entry", ENTRY_RULES, ENTRY_DEFAULT],
    ["exit", EXIT_RULES, EXIT_DEFAULT],
  ]) {
    const records = document.records?.[section];
    for (const id of records?.order || []) {
      const row = records.rows.get(id);
      if (!row) continue;
      const named = NAME_FIELDS.some((index) =>
        orphan(row.tokens[index]?.text),
      );
      if (named && section === "entry") orphanedEntries.add(id);
      const sibling =
        section === "exit" &&
        orphanedEntries.has(id) &&
        DECAL_FIELDS.every((index) => row.tokens[index]?.text === "0");
      if (!named && !sibling) continue;
      const vanilla = rules.get(id) || fallback;
      const set = (index, value) => {
        if (row.tokens[index] === undefined) return;
        if (row.tokens[index].text === value) return;
        replaceToken(document, row.line, row.tokens, index, value);
      };
      NAME_FIELDS.forEach((index, position) => {
        /* Поле, в котором стоит чужое имя (другой редукс), не наше — остаётся. */
        if (orphan(row.tokens[index]?.text))
          set(index, vanilla.names[position]);
      });
      if (named) {
        [
          BLOODFX_FIELD.tintRed,
          BLOODFX_FIELD.tintGreen,
          BLOODFX_FIELD.tintBlue,
        ].forEach((index, position) =>
          set(index, (vanilla.tint || VANILLA_TINT)[position]),
        );
        const probability = row.tokens[BLOODFX_FIELD.fxProbability];
        if (probability)
          set(BLOODFX_FIELD.fxProbability, formatLike(probability.text, 1));
      }
      /* Все шесть декалей в нуле у записи крови — это наше «без пятен»:
         штатная запись с кровью без декалей не бывает. */
      if (DECAL_FIELDS.every((index) => row.tokens[index]?.text === "0"))
        DECAL_FIELDS.forEach((index, position) =>
          set(index, vanilla.decals[position]),
        );
      healed.push({ section, id });
    }
  }
  return healed;
}
