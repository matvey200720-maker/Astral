/*
 * Экран игры игрока для мини-карты (ТЗ 11.10.2026, день, задача 1). С 14.11.2026 он один на все редакторы HUD
 * (мини-карта, значки, прицел, патроны, урон) и живёт в `features/workshop/game-screen/`: один запрос на окно, общий ответ.
 * Здесь остался прежний адрес — реэкспорт.
 */
export {
  gameAspectLabel,
  useGameScreen,
} from "../../../../features/workshop/game-screen/useGameScreen.js";
