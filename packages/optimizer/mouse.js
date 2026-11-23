/*
 * Чувствительность мыши игры: номера настроек и границы шкалы (ТЗ 29.10.2026,
 * круг 6). Одно место для окна (ползунок) и главного процесса (запись в
 * `Profiles/<профиль>/pc_settings.bin`, `apps/desktop/src/mouse-settings.js`).
 *
 * Номера — таблица профильных настроек GTA V (FiveM, `GetProfileSetting`) и
 * профили на компьютере владельца: 754 «Mouse Look Sensitivity» (обзор и
 * прицел), 755 «Mouse Driving Sensitivity». У обоих по умолчанию 50, у
 * владельца обзор стоит на 10 — нижней строке меню игры.
 *
 * `MOUSE_MENU_MIN` — нижняя строка меню по профилям владельца (10, 10 и 20
 * при умолчании 50); границу в меню игры подтверждает замер на стенде: если
 * она иная, правится здесь одним числом.
 */

/** Настройки мыши профиля: ключ в приложении, номер в файле, значение игры по умолчанию. */
export const MOUSE_SETTINGS = Object.freeze([
  Object.freeze({ key: "look", id: 754, fallback: 50 }),
  Object.freeze({ key: "driving", id: 755, fallback: 50 }),
]);

export const MOUSE_MENU_MIN = 10;
export const MOUSE_VALUE_MIN = 1;
export const MOUSE_VALUE_MAX = 100;

/** Ниже нижней строки меню игры. */
export const mouseBelowMenu = (value) => Number.isFinite(value) && value < MOUSE_MENU_MIN;
