/*
 * Ключ памяти покраски стволов паков — отдельно от установщика, как
 * `weapon-skin-key.js`: полка библиотеки и сборки (`features/library`) читают
 * эту запись, а мост к Desktop и очередь в стартовый кусок окна тянуть незачем.
 */
export const PACK_SKIN_INSTALLS_KEY = "astral.gun-studio.pack-install.v1";
