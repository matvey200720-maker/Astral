/*
 * Индексы словарей проектов — статический импорт JSON с атрибутом типа: тем же способом, каким приложение читает свои данные из `app.asar` (например `packages/vector-map/label-sets.js`),
 * и тем, что знает сборка закрытия JS (`scripts/protect/obfuscate-app.mjs`, `STATIC_JSON_IMPORT`: в тексте файла атрибут может стоять только у самих импортов, поэтому в комментариях его не пишем).
 * Файл грузится динамическим `import()` из `project-source.js` и только в главном процессе / потоке чтения — окно индекса не видит.
 */
import gta5rp from "./gta5rp.json" with { type: "json" };
import novarp from "./novarp.json" with { type: "json" };

export const PROJECT_INDEXES = Object.freeze({ gta5rp, novarp });
