/*
 * Совпадает ли сборка игры у архива и у чистой базы.
 *
 * Разница отпечатков честна только между двумя архивами одной сборки. Редукс
 * 2024 года против игры 2026-го — это четыре тысячи «вырезанных» и две тысячи
 * «изменённых» файлов, из которых авторских — десяток: остальное сделал
 * Rockstar обновлениями. Показать такое как находки значит утопить человека в
 * мусоре и подписать чужую версию `hud.gfx` авторской правкой.
 *
 * Признаки другой сборки прямые, без порогов на глаз:
 *   • в `dlc_patch/` есть паки, которых нет у другой стороны, — каждое
 *     обновление игры добавляет свой;
 *   • «вырезано» больше, чем автор мог вырезать руками: редукс правит
 *     десятки файлов, а не тысячи.
 */

const PACK = /^dlc_patch\/([^/]+)\//i;

function packsOf(index) {
  const packs = new Set();
  for (const entry of index?.entries || []) {
    const match = String(entry?.path || "")
      .replace(/\\/g, "/")
      .match(PACK);
    if (match) packs.add(match[1].toLowerCase());
  }
  return packs;
}

/**
 * Оценивает совпадение сборок по разнице и двум отпечаткам.
 *
 * `comparable: false` — базы нет вовсе (авторский пак): разницы как таковой
 * нет, всё содержимое — мод. `same: false` при `comparable: true` — база
 * есть, но от другой сборки: разнице доверять нельзя, опираться надо на
 * авторские контейнеры и известные маршруты.
 */
export function assessBuildMatch(diff, baseline, candidate) {
  const baseCount = baseline?.entries?.length || 0;
  if (!baseCount)
    return {
      comparable: false,
      same: false,
      removed: 0,
      missingPacks: [],
      extraPacks: [],
      reason: "Чистой базы нет: всё содержимое архива считается модом.",
    };
  const basePacks = packsOf(baseline);
  const candidatePacks = packsOf(candidate);
  const missingPacks = [...basePacks].filter(
    (pack) => !candidatePacks.has(pack),
  );
  const extraPacks = [...candidatePacks].filter((pack) => !basePacks.has(pack));
  const removed = diff?.removed?.length || 0;
  const tooManyRemoved = removed > Math.max(50, Math.round(baseCount * 0.01));
  const same = !missingPacks.length && !extraPacks.length && !tooManyRemoved;
  let reason = "";
  if (!same) {
    if (missingPacks.length)
      reason = `Архив собран под более раннюю сборку игры: в нём нет ${missingPacks.length} патч-паков (${missingPacks.slice(0, 3).join(", ")}${missingPacks.length > 3 ? "…" : ""}).`;
    else if (extraPacks.length)
      reason = `Архив собран под более новую сборку игры: в нём есть паки, которых нет в вашей (${extraPacks.slice(0, 3).join(", ")}).`;
    else
      reason = `Архив от другой сборки игры: вырезано ${removed} файлов — столько автор не удаляет.`;
  }
  return {
    comparable: true,
    same,
    removed,
    missingPacks,
    extraPacks,
    reason:
      reason ||
      "Сборка совпадает с вашей игрой: разница показывает только авторские правки.",
  };
}
