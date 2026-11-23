/*
 * Данные меток Majestic одним модулем: `majestic-marks.js` подгружает его
 * отдельным куском сборки (`import()` без вложений — так JSON доезжает и в
 * браузер, и в Node, где у JSON-модуля должен быть тип).
 */
import MAJESTIC_MARKS from "./majestic-marks.json" with { type: "json" };

export default MAJESTIC_MARKS;
