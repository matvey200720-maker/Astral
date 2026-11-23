/*
 * Слой крови зависит от правил ядра эффектов (10.11.2026).
 *
 * Маршрут крови (`blood-routing-v1`) ведёт запись `bloodfx.dat` на правило частиц; правила живут в `core.ypt`. Маршрут на правило, которого в игре нет,
 * молча ничего не нарисует — поэтому сборщик крови сверяет правила с ядром (`bloodfx-composer.js`). Сверять надо с ядром, которое ЛЯЖЕТ В АРХИВ после этой
 * сборки (слои ядра автора, `ypt-own-rules-v1`, тот же проход), а не с ядром основы: иначе порядок пакетов в пачке решает, встанет ли кровь, а снятие
 * ядра оставляет кровь стоять на несуществующих правилах.
 *
 * `EffectRulesMissing` — отказ сборки крови по недостающим правилам. Прямую установку слоя без правил он отклоняет, как и раньше; а слои, что стояли
 * раньше и лишились правил из-за снятия или замены ядра, движок снимает той же транзакцией (`composeArchiveResource`, `dependents.js`).
 */

/* Ядро эффектов основного пака — запись `update.rpf`, по которой сверяются правила частиц. */
export const EFFECTS_CORE_ENTRY = "x64/patch/data/effects/ptfx.rpf/core.ypt";

export class EffectRulesMissing extends Error {
  /**
   * @param {string} message
   * @param {{ dependents: Array<{ modId: string, missing: string[] }>, missing: string[] }} details
   *   `dependents` — слои, которым правил не хватает; `missing` — все недостающие правила
   */
  constructor(message, details) {
    super(message);
    this.name = "EffectRulesMissing";
    this.code = "effect-rules-missing";
    this.dependents = details.dependents;
    this.missing = details.missing;
  }
}

/** Запись — ядро эффектов (регистр и косые не важны). */
export const isEffectsCoreEntry = (entry) =>
  String(entry || "").replaceAll("\\", "/").toLowerCase() === EFFECTS_CORE_ENTRY;
