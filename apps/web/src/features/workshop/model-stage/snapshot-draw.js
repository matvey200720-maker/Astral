/*
 * Снимок на холст обложки — один на поток кодирования и на окно без потока (`snapshot-encode.js`): кусок `from` во всю картинку `to`, а с `place` — кадр
 * на этом месте, поля цветом самого кадра (угловая точка, растянутая на всё поле).
 */
export function drawCover(context, bitmap, { from, to, place = null }) {
  context.imageSmoothingQuality = "high";
  if (place) {
    context.drawImage(bitmap, 2, 2, 1, 1, 0, 0, to[0], to[1]);
    context.drawImage(bitmap, from[0], from[1], from[2], from[3], place[0], place[1], place[2], place[3]);
    return;
  }
  context.drawImage(bitmap, from[0], from[1], from[2], from[3], 0, 0, to[0], to[1]);
}
