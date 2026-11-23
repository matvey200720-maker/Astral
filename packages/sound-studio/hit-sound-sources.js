/*
 * Снято с метаданных игры скриптом `scripts/build-weapon-voices.mjs`
 * (GTA V Legacy). Руками не править: игра обновила звук оружия —
 * таблица снимается заново.
 *
 * Откуда установщик собирает переопределение звука попадания:
 * `chunks` — файлы метаданных: [архив, путь, место в порядке загрузки].
 *
 * Запасные дорожки банка collision: на них не ведёт ни один звук игры
 * (вся очередь загрузки). Под пики длинного звука человека план
 * убирает их из банка столько, сколько нужно (`hit-sounds.js`).
 */

export const HIT_SOUND_SOURCES = Object.freeze({
  chunks: [["update/update.rpf","x64/audio/config/sounds.dat54.rel",0],["update/x64/dlcpacks/mpbiker/dlc.rpf","x64/audio/dlcbiker_sounds.dat54.rel",38],["update/x64/dlcpacks/mpsum2/dlc.rpf","x64/audio/dlcmpsum2_sounds.dat54.rel",70]],
});

export const HIT_SOUND_SPARE_WAVES = Object.freeze(["0X00887ED9","0X020D755F","0X0271B1AE","0X04F6522D","0X051F26B8","0X0A67220B","0X0BB8DCD2","0X114CA3E6","0X156EAE26","0X1678DCBE","0X1A720D33","0X1B7F5959","0X1DC093F9","0X1E449946"]);
