// Есть ли в листе точки прозрачнее порога. Нужен частям «blend»: непрозрачный лист пишет глубину, иначе вывернутая оболочка ложится поверх ствола.
// Обход всего листа дорог, поэтому ответ считается один раз на лист и лежит в самой картинке: разбор считает его в потоке и несёт готовым,
// сцена считает сама только если ответа нет. Порог 250: сжатие BC оставляет у непрозрачного листа чуть меньше 255.
const SEE_THROUGH_BELOW = 250;

function scan({ rgba }) {
  for (let at = 3; at < rgba.length; at += 4) {
    if (rgba[at] < SEE_THROUGH_BELOW) return true;
  }
  return false;
}

export function seeThroughOf(image) {
  image.seeThrough ??= scan(image);
  return image.seeThrough;
}
