/*
 * Кадр экрана игрока в окне предпросмотра (ТЗ H1, 14.11.2026).
 *
 * Игра раскладывает HUD под свою форму (холст `view.canvas`), а монитор может быть другой формы: тогда картинка растягивается.
 * Рамка монитора (`gs-monitor`) вписывается в сцену редактора, а холст внутри неё растягивается по ширине на `view.stretch` —
 * ОДНО число, его даёт `stretchContentScale` контракта (`GAME_STRETCH_BEHAVIOUR`): режим «растягивается весь кадр» делает круглое
 * овальным, режим «только раскладка» (у фильмов HUD измерено замером H2 14.11.2026) оставляет `1`, и обёртка превращается в обычный кадр
 * формы игры. Внутри ставится `HudPreviewWindow`
 * со свойством `stretch={view.stretch}`: он считает слой в своих, нерастянутых точках.
 *
 * Перетаскивание и доли не страдают: `getBoundingClientRect` видит растяжение с обеих сторон дроби.
 */
export default function GameScreenFrame({ view, className = "", children }) {
  const stretch = view?.stretch > 0 ? view.stretch : 1;
  const stretched = stretch !== 1;
  return (
    <div
      className={`gs-monitor${className ? ` ${className}` : ""}`}
      data-stretched={stretched ? "true" : undefined}
      style={{ "--gs-monitor-aspect": view?.monitorAspect || 16 / 9 }}
    >
      <div
        className="gs-canvas"
        style={
          stretched
            ? { width: `${100 / stretch}%`, transform: `scaleX(${stretch})` }
            : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}
