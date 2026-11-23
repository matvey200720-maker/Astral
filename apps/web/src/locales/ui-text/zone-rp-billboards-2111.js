/*
 * Слова «ни один щит не виден на GTA 5 RP» (21.11.2026): билборды в режиме RP, когда контейнером не едет ни один щит работы (листы в пакетах игры дальше границы проб, копии словарей и типы районов не едут).
 * Одна строка на два места окна (`features/workshop/install-queue/tasks/rp-update-notes.js`): причина отката на прежний пакет (`FALLBACK_REASONS["no-visible"]`) и отказ режима, включённого человеком
 * (`REFUSALS`). Слова «видно N из M щитов» зависят от числа и живут функцией (`rp-billboards-copy.js`). Русская строка → [uk, en, de, pl]; французский — `fr/zone-rp-billboards-2111.js`.
 */
export const zoneRpBillboards2111 = {
  "Ни один щит этой работы на GTA 5 RP не виден: текстуры этих щитов лежат в файлах игры, которые Astral для GTA 5 RP пока не меняет.":
    [
      "Жоден щит цієї роботи на GTA 5 RP не видно: текстури цих щитів лежать у файлах гри, які Astral для GTA 5 RP поки що не змінює.",
      "None of this work's billboards are visible on GTA 5 RP: their textures are in game files that Astral does not change for GTA 5 RP yet.",
      "Kein Billboard dieser Arbeit ist auf GTA 5 RP sichtbar: Die Texturen dieser Billboards liegen in Spieldateien, die Astral für GTA 5 RP noch nicht ändert.",
      "Żaden billboard z tej pracy nie jest widoczny na GTA 5 RP: tekstury tych billboardów leżą w plikach gry, których Astral dla GTA 5 RP na razie nie zmienia.",
    ],
};
