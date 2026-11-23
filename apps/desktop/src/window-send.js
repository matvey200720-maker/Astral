/*
 * Отправка в окна по одному (05.11.2026). `webContents.send` бросает у окна, чей рендерер уже ушёл или которое
 * закрывается, — и в общем цикле этот бросок обрывал рассылку: остальные окна не получали прогресс установки,
 * события обновлений и каталог. Сбой одного окна — его дело, остальные получают своё.
 */
export function sendEach(windows, channel, data) {
  let delivered = 0;
  for (const window of windows) {
    try {
      window.webContents.send(channel, data);
      delivered += 1;
    } catch {
      /* Окно ушло между проверкой и отправкой. */
    }
  }
  return delivered;
}
