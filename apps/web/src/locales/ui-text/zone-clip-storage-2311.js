/*
 * Слово плашки ролика, когда хранилище роликов недоступно (23.11.2026: в ~15:45–16:02 имя `cdn.astral-mods.online` не резолвилось, служба окна не достала ролик, а плашка говорила общее «Ролик не загрузился»):
 * честная строка про связь вместо общей, без адресов и кодов (`ui/ClipPlayer.jsx`, вид отказа `storage-unavailable` от `apps/api/src/cloud-clip.js`). `{0}` — слово кнопки «Повторить» (`tr`). Обращение — как у соседних слов:
 * ru/uk/fr на «вы», de — на «du», pl — повелительное. Русская строка → [uk, en, de, pl]; французский — `fr/zone-clip-storage-2311.js`.
 */
export const zoneClipStorage2311 = {
  "Нет связи с хранилищем роликов. Проверьте интернет и нажмите «{0}».": [
    "Немає зв’язку зі сховищем роликів. Перевірте інтернет і натисніть «{0}».",
    "No connection to the video storage. Check your internet and press “{0}”.",
    "Keine Verbindung zum Videospeicher. Prüfe dein Internet und klicke auf „{0}“.",
    "Brak połączenia z magazynem filmów. Sprawdź internet i naciśnij „{0}”.",
  ],
};
