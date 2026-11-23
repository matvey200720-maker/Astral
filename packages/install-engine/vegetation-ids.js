/*
 * Имя и признак «это работа растительности» без тяжёлых описей: список файлов растительности (`vegetation-files.js` и соседи, ≈ 270 КБ) нужен только строгой проверке формы манифеста
 * (`vegetation-manifest-trust.js`), а признак id, имя выключателя третьего пакета и символ доверия нужны на старте главного процесса (каналы, удаление из библиотеки, слои оптимизации).
 * Здесь они лежат отдельно, чтобы старт не грузил описи; `vegetation-manifest-trust.js` переиздаёт их под прежними именами.
 */
export const LOCAL_VEGETATION_TRUST = Symbol("local-vegetation-package");
export const VEGETATION_THIRD_PACK_ENV = "ASTRAL_VEGETATION_THIRD_PACK";
export const VEGETATION_MOD_ID = /^local-legacy-vegetation-([a-f0-9]{12})$/;
export const isVegetationModId = (value) => VEGETATION_MOD_ID.test(String(value || ""));
