/*
 * Возврат на «Загрузки» из редактора (владелец, 16.11.2026): карандаш у строки библиотеки открывает редактор работы, «назад» из него ведёт на страницу
 * «Загрузки». Имя `"downloads"` оболочка знает (`navigate` открывает страницу), отдельного псевдонима не нужно.
 */

export const RETURN_DOWNLOADS = "downloads";

// Подпись кнопки «назад» в редакторе, открытом с «Загрузок».
const LABELS = {
  ru: "Назад в загрузки",
  uk: "Назад до завантажень",
  en: "Back to downloads",
  de: "Zurück zu den Downloads",
  pl: "Wróć do pobierań",
  fr: "Retour aux téléchargements",
};
export const downloadsReturnLabel = (locale = "ru") =>
  LABELS[locale] ?? LABELS.en;
