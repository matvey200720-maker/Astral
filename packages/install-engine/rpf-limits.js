/*
 * Предел размера архива игры — одно число на весь движок.
 *
 * update.rpf держит не больше 4 ГБ: смещения записей RPF7 (см. прежние
 * пояснения в `vegetation-dlc.js`, `roads-dlc.js`, `textures-dlc.js` — у
 * владельца архив был 2,9 ГБ, и целые стопки словарей поэтому едут своими
 * пакетами дополнения, а не в update.rpf). До 17.10.2026 число жило только в
 * этих пояснениях, и установка, которой места не хватало, узнавала об этом на
 * пересборке архива, спустя минуты. Теперь тот, кому нужно сверить размер
 * заранее, берёт предел и запас отсюда.
 *
 * Запас — на то, что не видно из размера файлов: выравнивание записей по 512
 * байт (до 1,2 МБ на 2 400 файлов набора), оглавление, `content.xml`,
 * `dlclist.xml` и регистрации слоя. Файлы пакетов кладутся как есть (ресурсы
 * уже сжаты, двоичные записи сжимаются, только если влезают в 24 бита:
 * `RpfCompressedSizeLimit` помощника RPF), поэтому архив растёт примерно на
 * сумму их размеров — измерено на копии игры 17.10.2026: +28,1 МБ на 28,2 МБ
 * файлов двух интерьеров.
 */

export const RPF7_ARCHIVE_LIMIT_BYTES = 4 * 1024 * 1024 * 1024;
export const RPF7_ARCHIVE_RESERVE_BYTES = 64 * 1024 * 1024;

/**
 * Хватит ли архиву места. `archiveBytes` — размер update.rpf сейчас,
 * `releasedBytes` — сколько освободит то, что установка заменяет (прежний
 * набор той же работы), `wantedBytes` — сколько добавится. Возвращает
 * `{ fits, freeBytes, needBytes, archiveBytes, limitBytes }`: `freeBytes` —
 * сколько ещё помещается за вычетом запаса (не меньше нуля).
 */
export function rpf7Room({ archiveBytes, releasedBytes = 0, wantedBytes = 0 }) {
  const current = Math.max(0, Number(archiveBytes) || 0);
  const released = Math.max(0, Math.min(Number(releasedBytes) || 0, current));
  const wanted = Math.max(0, Number(wantedBytes) || 0);
  const freeBytes = Math.max(0, RPF7_ARCHIVE_LIMIT_BYTES - RPF7_ARCHIVE_RESERVE_BYTES - (current - released));
  return {
    fits: wanted <= freeBytes,
    freeBytes,
    needBytes: wanted,
    archiveBytes: current,
    limitBytes: RPF7_ARCHIVE_LIMIT_BYTES,
  };
}
