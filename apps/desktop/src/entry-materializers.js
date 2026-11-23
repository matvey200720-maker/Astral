/*
 * Сборщики записей update.rpf, которые установщик складывает из слоёв.
 *
 * Трассер, текстура ядра эффектов, звуковой банк, кровь и метаданные звука
 * не лежат в пакете готовым файлом: запись собирается у игрока из его
 * собственного файла и всех установленных слоёв. Пересобирает архив не
 * только установка мода — ещё подготовка оружейного и одежного DLC и папки
 * Astral, большая карта, залазы, арена, радуга, — и каждому такому месту
 * нужен полный набор сборщиков: без одного из них пересборка споткнётся о
 * чужой слой, которого этот шаг даже не касался.
 *
 * Поэтому набор регистрируется в движке установки как набор по умолчанию —
 * при первом импорте этого файла, который главный процесс делает при
 * запуске. Вызов, передающий свой сборщик, по-прежнему главнее.
 */
import { setDefaultEntryMaterializers } from "@modovik/install-engine";
/* Там же регистрируются чтение и пересборка основы update.rpf: перебазирование
   держит её без записей Astral, и сборщикам ниже нужен файл игры, а не наш. */
import "./direct-base-tools.js";
/*
 * Сборщики — переходники: настоящий модуль грузится на первом вызове (30.10.2026). Каждый тянет за собой редакторы (трассер — сборку эффектов и их правила на
 * ~600 КБ исходников), а старт главного процесса держит все модули в памяти до конца, хотя собираются записи только при установке и снятии мода. Переходник
 * ведёт себя как сам сборщик: все они асинхронные, аргументы и результат — те же. Модуль грузится один раз (кэш `import()`), следующие вызовы идут без задержки.
 */
export const ENTRY_MATERIALIZERS = Object.freeze({
  tracerMaterializer: async (...args) => (await import("./tracer-composer.js")).materializeTracerEntry(...args),
  ptfxTextureMaterializer: async (...args) => (await import("./ptfx-texture-composer.js")).materializePtfxTextureEntry(...args),
  awcMaterializer: async (...args) => (await import("./audio-composer.js")).materializeAwcEntry(...args),
  bloodRoutingMaterializer: async (...args) => (await import("./bloodfx-composer.js")).materializeBloodRoutingEntry(...args),
  audioRelMaterializer: async (...args) => (await import("./audio-rel-composer.js")).materializeAudioRelEntry(...args),
  weaponsMetaMaterializer: async (...args) => (await import("./weapons-meta-composer.js")).materializeWeaponsMetaEntry(...args),
  timecycleMaterializer: async (...args) => (await import("./timecycle-composer.js")).materializeTimecycleEntry(...args),
  audioChunkMaterializer: async (...args) => (await import("./audio-chunk-composer.js")).materializeAudioChunkEntry(...args),
  clipRowsMaterializer: async (...args) => (await import("./ptfx-clip-rows.js")).materializeClipRowsEntry(...args),
  packContentMaterializer: async (...args) => (await import("./clothing-pack-place.js")).readPackContentXml(...args),
  /* Слой слотов звука в audioconfig.dat4.rel под банки паков (`audio-slots.js`, 20.11.2026). */
  audioSlotSettler: async (...args) => (await import("./audio-slots.js")).settleAudioSlots(...args),
  /* Сторож моделей-пустышек на пути каталога и редуксов (`model-safety-guard.js`, 21.11.2026). */
  modelSafetyGuard: async (...args) => (await import("./model-safety-guard.js")).guardModelEntry(...args),
});

setDefaultEntryMaterializers(ENTRY_MATERIALIZERS);
