import React from "react";

// Палитра вместе с картой настроек весит ~30 КБ и не пускала главный кусок окна под потолок
// гейта бандлов (решение 18.10.2026), поэтому её кусок едет только по первому Ctrl+K.
const Palette = React.lazy(() => import("./CommandPalette.jsx"));

const subscribe = (type, handler) => {
  const release = () => window.removeEventListener(type, handler);
  window.addEventListener(type, handler);
  return release;
};

// Пока палитра не нужна, слушаем клавиши сами; после первого нажатия слушатель снимается навсегда,
// дальше палитра слушает себя. Код клавиши, а не key, — как у палитры, раскладка не мешает.
// Нажатие, ради которого едет кусок, палитра не увидит, поэтому она открывается сразу.
const CommandPaletteLauncher = (props) => {
  const [wanted, setWanted] = React.useState(false);
  React.useEffect(
    () =>
      wanted
        ? undefined
        : subscribe(
            "keydown",
            (e) => e.code === "KeyK" && (e.ctrlKey || e.metaKey) && (e.preventDefault(), setWanted(true)),
          ),
    [wanted],
  );
  return (
    wanted &&
    React.createElement(
      React.Suspense,
      { fallback: null },
      React.createElement(Palette, { ...props, defaultOpen: true }),
    )
  );
};

export default CommandPaletteLauncher;
