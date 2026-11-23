/*
 * Предупреждение под кнопками редукса после «Вернуть как было», когда починка не приняла правки мастерской (`patchesNotAdopted` в ответе, 22.11.2026;
 * `features/catalog/redux-layer/ReduxLayerActions.jsx`). Блок отказа печатает «причина. совет», поэтому слова две записи. Те же слова, что в строке
 * «Проверить файлы игры» (`components/desktop/settings/game-copy.js`, `repairedPatchesLost`). Русская строка → [uk, en, de, pl]. Французский — `fr/zone-repair-patches-lost-2211.js`.
 */
export const zoneRepairPatchesLost2211 = {
  "Файлы возвращены, но правки мастерской (небо, фонари и другие) могли сброситься": [
    "Файли повернуто, але зміни майстерні (небо, ліхтарі та інші) могли скинутися",
    "Files restored, but your workshop changes (sky, street lights and others) may have been reset",
    "Dateien wiederhergestellt, aber Änderungen aus der Werkstatt (Himmel, Straßenlaternen und andere) wurden möglicherweise zurückgesetzt",
    "Pliki przywrócone, ale zmiany z warsztatu (niebo, latarnie i inne) mogły zostać cofnięte",
  ],
  "Примените их заново в мастерской": ["Застосуйте їх знову в майстерні", "Apply them again in the workshop", "Bitte in der Werkstatt erneut anwenden", "Należy zastosować je ponownie w warsztacie"],
};
