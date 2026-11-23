/*
 * Привязки следа к стволам в мете игрока (`weapons-meta-tracer-patch-v1`, Р2, дополнение 2; 10.11.2026).
 *
 * Редукс несёт свои `weapons.meta` и оружейные меты `dlc_patch`: из них важны три поля у ствола — правило следа (`TracerFx`) и шансы
 * (`TracerFxChanceSP`, `TracerFxChanceMP`). Файл автора целиком в игру не кладётся: он привязан к его версии игры и перетёр бы всё остальное
 * (урон, разброс). Пакет несёт JSON привязок на один файл меты игрока в `update.rpf`, а установщик собирает файл из файла игрока: по имени
 * `WEAPON_*` заменяет эти три поля (`apps/desktop/src/weapons-meta-composer.js`, режим помощника RPF `weapons-meta-tracer-patch`).
 * Снятие пакета — сборка заново без его слоя: прежние значения возвращаются сами.
 *
 * Файл-полезная нагрузка:
 *   { "schema": 1, "bindings": [ { "weapon": "WEAPON_CARBINERIFLE", "tracerFx": "bullet_tracer", "chanceSP": 0.5, "chanceMP": 1 } ] }
 * `tracerFx` пустая строка — след убран (`<TracerFx />`); шанс `null` — шанс ствола не трогается.
 */

export const WEAPONS_META_STRATEGY = "weapons-meta-tracer-patch-v1";
export const WEAPONS_META_SCHEMA = 1;
export const WEAPONS_META_MAX_BINDINGS = 512;
export const WEAPONS_META_MAX_FILES = 128;

/**
 * Файл меты оружия внутри `update.rpf`: `common/data/ai/weapons*.meta` (базовые стволы) или мета пакета дополнения
 * `dlc_patch/<пакет>/common/data/ai/<имя>.meta` (игра берёт её первой, `tracer-weapons.js`). Меты техники в привязках не участвуют.
 */
export const WEAPONS_META_ENTRY = /^(?:common\/data\/ai\/weapons[a-z0-9_]*\.meta|dlc_patch\/[a-z0-9_]{1,64}\/common\/data\/ai\/(?!vehicle)[a-z0-9_]{1,64}\.meta)$/i;

const WEAPON_NAME = /^WEAPON_[A-Z0-9_]{1,60}$/;
const RULE_NAME = /^[A-Za-z0-9_]{0,96}$/;
const KEYS = ["weapon", "tracerFx", "chanceSP", "chanceMP"];

function readChance(value, label) {
  if (value === null || value === undefined) return null;
  const number = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(number) || number < 0 || number > 1)
    throw new Error(`Привязки трассеров: ${label} должен быть числом от 0 до 1 или null.`);
  return Math.round(number * 1e6) / 1e6;
}

/** Проверенные привязки из текста JSON; любое отступление от формы — отказ с причиной. */
export function parseWeaponsMetaBindings(text) {
  let data;
  try {
    data = JSON.parse(String(text));
  } catch {
    throw new Error("Привязки трассеров: файл не JSON.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some((key) => key !== "schema" && key !== "bindings"))
    throw new Error("Привязки трассеров: у файла должны быть только поля schema и bindings.");
  if (data.schema !== WEAPONS_META_SCHEMA) throw new Error("Привязки трассеров: неизвестная схема файла.");
  const list = data.bindings;
  if (!Array.isArray(list) || list.length < 1 || list.length > WEAPONS_META_MAX_BINDINGS)
    throw new Error(`Привязки трассеров: нужно от 1 до ${WEAPONS_META_MAX_BINDINGS} привязок.`);
  const seen = new Set();
  return list.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some((key) => !KEYS.includes(key)))
      throw new Error("Привязки трассеров: у привязки только поля weapon, tracerFx, chanceSP, chanceMP.");
    if (typeof item.weapon !== "string" || !WEAPON_NAME.test(item.weapon)) throw new Error("Привязки трассеров: имя ствола должно быть вида WEAPON_*.");
    if (typeof item.tracerFx !== "string" || !RULE_NAME.test(item.tracerFx))
      throw new Error("Привязки трассеров: правило следа — буквы, цифры и _, до 96 знаков (пусто — след убран).");
    if (seen.has(item.weapon)) throw new Error(`Привязки трассеров: ствол ${item.weapon} назван дважды.`);
    seen.add(item.weapon);
    return {
      weapon: item.weapon,
      tracerFx: item.tracerFx,
      chanceSP: readChance(item.chanceSP, `chanceSP у ${item.weapon}`),
      chanceMP: readChance(item.chanceMP, `chanceMP у ${item.weapon}`),
    };
  });
}

/** Текст файла привязок: тот, что разбирает `parseWeaponsMetaBindings` (порядок стволов как дан). */
export function weaponsMetaPayload(bindings) {
  const checked = parseWeaponsMetaBindings(JSON.stringify({ schema: WEAPONS_META_SCHEMA, bindings }));
  return `${JSON.stringify({ schema: WEAPONS_META_SCHEMA, bindings: checked })}\n`;
}
