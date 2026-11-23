import { createContext } from "react";

// Сеттер шапки колонки редактора; вне каркаса null, и страница панели рисует «назад» у себя.
export const PanelPageContext = createContext(null);
