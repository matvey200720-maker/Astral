/*
 * Данные табло «Расписание» для карты: значки сервера и строки сервера из
 * договора 3D-табло. Сгенерировано scripts/build-schedule-board-data.mjs —
 * руками не править; тест tests/vector-map-schedule-board.test.js сверяет с договором.
 */

/** Значки сервера: рисунок — чёрный на прозрачном, `url` — файл в `public`. */
export const SERVER_ICONS = Object.freeze([{"id":"parachute","label":"Парашют","url":"/assets/workshop/schedule/icons/parachute.png","width":256,"height":220},{"id":"chest","label":"Сундук","url":"/assets/workshop/schedule/icons/chest.png","width":256,"height":220},{"id":"handshake","label":"Рукопожатие","url":"/assets/workshop/schedule/icons/handshake.png","width":256,"height":220},{"id":"factory","label":"Завод","url":"/assets/workshop/schedule/icons/factory.png","width":256,"height":220},{"id":"island","label":"Остров","url":"/assets/workshop/schedule/icons/island.png","width":256,"height":220},{"id":"van","label":"Фургон","url":"/assets/workshop/schedule/icons/van.png","width":256,"height":220},{"id":"revolvers","label":"Револьверы","url":"/assets/workshop/schedule/icons/revolvers.png","width":256,"height":220}]);

/** Строки табло сервера: `[название, время, значок]`. */
export const STOCK_ROWS = Object.freeze([["AIRDROP","00:00","parachute"],["AIRDROP","04:00","parachute"],["AIRDROP","08:00","parachute"],["ТАЙНИКИ","10:00","chest"],["ДИЛЕРЫ","10:45","handshake"],["AIRDROP","12:00","parachute"],["ТАЙНИКИ","14:00","chest"],["ЗАХВАТ ЦЕХОВ","14:45","factory"],["ОСТРОВ/ФЗ","16:00","island"],["ТАЙНИКИ","18:00","chest"],["ДИЛЕРЫ","18:45","handshake"],["AIRDROP","20:00","parachute"],["ТАЙНИКИ","22:00","chest"],["ЗАХВАТ ЦЕХОВ","22:45","factory"],["ПОСТАВКИ","24/7","van"],["КАПТЫ","15-21:00","revolvers"]]);

/** Предел строк на табло. */
export const MAX_ROWS = 48;
