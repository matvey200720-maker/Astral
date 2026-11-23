/*
 * Эффекты машин по классам — `x64/data/effects/vfxvehicleinfo.ymt` в
 * update.rpf (ТЗ 17.10.2026, второй заход, задача 8: огонь выхлопа).
 *
 * Файл — PSO: запись `CVfxVehicleInfo` на класс машины (76 записей у
 * Legacy), в ней именем-хешем (atHashString) названы эффекты — выхлопа,
 * хлопков, заднего огня, запуска двигателя… Редактор «Настройка автомобиля»
 * красит задний огонь и хлопки клонами правил ядра (`astral_wheel_*`), а
 * здесь классам машин вместо штатного имени правила ставится имя клона.
 * Длина файла не меняется — пишутся только 4-байтные значения полей, сумма
 * CHKS пересчитывается (`remapPsoHashes`).
 *
 * Правка обратима без памяти основы: клон → штатное имя по тому же списку
 * правил. «Как в игре» — тот же вызов со штатными значениями. Поле, в
 * котором стоит чужое имя (другой мод), не трогается.
 */

import { joaat, remapPsoHashes } from "@modovik/optimizer/pso.js";

const STRUCTURE = "CVfxVehicleInfo";

/**
 * `vehicleVfx` из `compileWheelSmoke`: `{ fields, effects: [{ stock, clone,
 * value }] }`. Ответ — `{ bytes, instances, matched, changed }`: `matched` —
 * сколько полей назвали одно из наших правил (штатное или клон); ноль при
 * включённом огне значит, что в файле другая сборка игры или его правил чужой
 * мод, и «Применить» откажет.
 */
export function retargetVehicleVfx(bytes, vehicleVfx) {
  const wanted = new Map();
  for (const effect of vehicleVfx.effects) {
    const value = joaat(effect.value);
    wanted.set(joaat(effect.stock), value);
    wanted.set(joaat(effect.clone), value);
  }
  return remapPsoHashes(bytes, STRUCTURE, vehicleVfx.fields, (hash) => wanted.get(hash));
}
