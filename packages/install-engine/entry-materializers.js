/*
 * Сборщики записей архива по умолчанию.
 *
 * Часть записей `update.rpf` и звуковых архивов не лежит в пакете готовым
 * файлом: трассер, текстура ядра эффектов, звуковой банк, кровь, метаданные
 * звука собираются у игрока из его файла и всех установленных слоёв. Собирает
 * их приложение (им нужен помощник RPF), поэтому движок получает сборщики
 * снаружи.
 *
 * Раньше их передавал каждый вызов установки, удаления и плана — и тот, кто
 * забывал, ломал чужие моды: пересборка `update.rpf` ради большой карты
 * спотыкалась о слой трассера («Компонент композиции трассеров не
 * установлен»), который этот шаг даже не трогал. Установщиков, которые
 * пересобирают `update.rpf`, в приложении больше десяти, и помнить про пять
 * сборщиков каждому из них — ровно та работа, которую однажды забудут.
 *
 * Теперь приложение один раз регистрирует свой набор при запуске, а
 * композиция берёт его, если вызов не передал свой. Явно переданный сборщик
 * по-прежнему главнее: так тесты подкладывают заглушки.
 */

export const ENTRY_MATERIALIZER_NAMES = Object.freeze([
  "tracerMaterializer",
  "ptfxTextureMaterializer",
  "awcMaterializer",
  "bloodRoutingMaterializer",
  "audioRelMaterializer",
  /* Привязки следа к стволам в мете игрока (`weapons-meta-tracer-patch-v1`, Р2): `weapons.meta` и меты `dlc_patch` из файла игрока и слоёв. */
  "weaponsMetaMaterializer",
  /* Таймцикл поверх файла игрока и правок мастерской. Без него слои
     `timecycle-modifier-v1` складываются сами по себе (`timecycle-composition.js`). */
  "timecycleMaterializer",
  /* Звуковые метаданные пакета Astral (`astral-audio-chunk-v1`):
     переопределения стволов из всех установленных слоёв одним файлом. */
  "audioChunkMaterializer",
  /* Строки сетки кадров своих листов автора в ptxclipregions.dat (`ptx-clip-rows-v1`, «наш Core», этап 2). */
  "clipRowsMaterializer",
  /* `content.xml` штатного пака, в который движок вписывает свой overlay-RPF (`pack-overlay.js`). */
  "packContentMaterializer",
  /* Слой слотов памяти звука в `audioconfig.dat4.rel` (`apps/desktop/src/audio-slots.js`): растёт и убывает с банками паков звуков, 20.11.2026. */
  "audioSlotSettler",
  /* Сторож моделей-пустышек (`apps/desktop/src/model-safety-guard.js`, 21.11.2026): модель без группы шейдеров роняет Legacy 3889; запись такой модели слоя в архив не кладётся. Не передан — класть как есть. */
  "modelSafetyGuard",
]);

let defaults = Object.freeze({});

/**
 * Регистрирует сборщики приложения. Зовётся один раз при запуске главного
 * процесса; повторный вызов заменяет набор целиком.
 */
export function setDefaultEntryMaterializers(materializers = {}) {
  const next = {};
  for (const name of ENTRY_MATERIALIZER_NAMES) {
    const value = materializers?.[name];
    if (value == null) continue;
    if (typeof value !== "function")
      throw new TypeError(`Сборщик записи ${name} должен быть функцией.`);
    next[name] = value;
  }
  defaults = Object.freeze(next);
}

/** Набор сборщиков вызова: переданные явно, остальные — по умолчанию. */
export function resolveEntryMaterializers(explicit = {}) {
  return Object.fromEntries(
    ENTRY_MATERIALIZER_NAMES.map((name) => [
      name,
      typeof explicit?.[name] === "function"
        ? explicit[name]
        : defaults[name] || null,
    ]),
  );
}
