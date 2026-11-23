import * as Icons from "../../ui/icons.jsx";

// Знак Rockstar Games (apps/web/public/brands/rockstar-games.svg) для меню и результатов поиска: маска в цвет строки,
// размером с остальные значки (.settings-nav-mark) — рисунка в кусок окна не кладём.
const RockstarMark = (props) => <i className="settings-nav-mark" {...props} />;

// Значок раздела; раздел вне таблицы получает шестерёнку.
export const SECTION_ICON = Object.fromEntries([
  ["profile", Icons.UserCircle],
  ["general", Icons.GearSix],
  ["appearance", Icons.Palette],
  ["language", Icons.Translate],
  ["game", Icons.GameController],
  ["rockstar", RockstarMark],
  ["tools", Icons.Wrench],
  ["storage", Icons.HardDrives],
  ["logs", Icons.Scroll],
  ["maintenance", Icons.Stethoscope],
  ["about", Icons.Info],
]);
