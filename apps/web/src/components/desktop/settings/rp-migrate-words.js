import { tr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";

/*
 * Слова строки «Моды для серверов RAGE MP» (`RpMigrateRow.jsx`, 20.11.2026): чистая функция по ответу `rpMigrateStatus`/`rpMigrateRun`. Шесть языков — записи `locales/ui-text/zone-rp-migrate-2011.js`
 * и `fr/zone-rp-migrate-2011.js`. Русские строки — ключи словаря: вставки `{0}`, `{1}` подставляются после перевода (`trFill`).
 */

const GiB = 1024 ** 3;
const gb = (bytes) => Math.max(1, Math.ceil((Number(bytes) || 0) / GiB));

/** Слова строки по состоянию: `idle` (предложение), `running`, `done`, `refused` (нет места), `failed`. */
export function rpMigrateWords({
  offer = {},
  phase = "idle",
  result = null,
  error = "",
} = {}) {
  const base = {
    title: tr("Моды для серверов RAGE MP"),
    action: tr("Пересобрать"),
    later: tr("Позже"),
    working: tr("Пересобираю…"),
  };
  if (phase === "running")
    return {
      ...base,
      note: tr("Пересобираю установленное, не закрывайте Astral."),
    };
  if (phase === "done")
    return {
      ...base,
      note: trFill(
        "Готово: перенесено модов — {0} из {1}.",
        result?.mods ?? 0,
        result?.total ?? 0,
      ),
    };
  if (phase === "failed")
    return { ...base, note: trFill("Не вышло: {0}", error) };
  if (phase === "refused" && result?.reason === "space")
    return {
      ...base,
      note: trFill(
        "Не хватает места на диске: нужно около {0} ГБ свободно.",
        gb(result.needBytes),
      ),
    };
  const parts = [
    trFill(
      "Чтобы моды были видны на серверах RAGE MP, Astral пересоберёт установленное: модов {0}, около {1} мин. Дороги, оружие, одежда; растительность — переустановкой.",
      offer.mods ?? 0,
      offer.minutes ?? 0,
    ),
  ];
  if ((offer.kept ?? 0) > 0)
    parts.push(
      trFill(
        "Переедет {0} из {1}, остальное останется в пакетах Astral, и сервер RAGE MP его не увидит.",
        offer.mods ?? 0,
        offer.total ?? 0,
      ),
    );
  if (offer.spaceOk === false)
    parts.push(
      trFill(
        "Не хватает места на диске: нужно около {0} ГБ свободно.",
        gb(offer.needBytes),
      ),
    );
  return { ...base, note: parts.join(" ") };
}
