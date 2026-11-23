/*
 * Ключ памяти скинов оружия — отдельно от установщика: полка библиотеки и
 * сборки (`features/library/my-mods.js`) читают эту запись, а тянуть ради
 * одной строки мост к Desktop и очередь в стартовый кусок окна незачем.
 */
export const WEAPON_SKIN_INSTALLS_KEY = "astral.gun-studio.install.v1";
