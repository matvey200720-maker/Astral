import { migrateRpContainers, rpMigrateEnabled } from "@modovik/install-engine/rp-container-migrate.js";

/*
 * Перенос стоящих модов между пакетами `astral_*` и контейнерами `update.rpf` со стороны приложения (GTA 5 RP, 20.11.2026, `docs/RP-CONTAINER-MIGRATE.md`).
 *
 * Выключатель — `ASTRAL_RP_MIGRATE` (`1`, `true`, `on`); пуст — `null`, и в установку не попадает ничего: путь прежний байт в байт. Направление каждого
 * вида задаёт его режим (`ASTRAL_WEAPONS_VIA_UPDATE=container`, `ASTRAL_CLOTHING_VIA_UPDATE`, `ASTRAL_ROADS_VIA_UPDATE`): включён — стоящее в пакетах
 * переезжает в контейнер, выключен — контейнерное возвращается в пакеты. Нечего переносить — исполнитель выходит, ничего не записав.
 * Видимых человеку строк нет: строки уходят в журнал приложения (`note`).
 */

/** Инструменты сборки, которые нужны переносу (остальное в настройках установки ему не касается). */
const TOOL_KEYS = [
  "rpfComposer",
  "contentXmlProvider",
  "dlcListProvider",
  "tracerMaterializer",
  "ptfxTextureMaterializer",
  "awcMaterializer",
  "bloodRoutingMaterializer",
  "audioRelMaterializer",
  "audioChunkMaterializer",
];

/**
 * Исполнитель переноса для `installer-ipc` и стража: `{ run({ targetId, stateDir, signal, assertRuntimeSafety, onProgress, ...tools }) }` или `null`
 * (выключатель пуст). `migrate` — подмена для тестов.
 */
export function appRpMigrate({ env = process.env, note = () => {}, migrate = migrateRpContainers } = {}) {
  if (!rpMigrateEnabled(env)) return null;
  return {
    async run({ targetId, stateDir, signal = null, assertRuntimeSafety = null, onProgress = null, ...rest } = {}) {
      const tools = Object.fromEntries(TOOL_KEYS.filter((key) => rest[key] !== undefined).map((key) => [key, rest[key]]));
      return migrate({ targetId, stateDir, env, signal, assertRuntimeSafety, onProgress, note, ...tools });
    },
  };
}
