/*
 * Кадр большой карты: что видно на холсте и как это двигать.
 *
 * Вынесено из `WorldMapStage.jsx` не ради порядка, а потому что обе прошлые
 * поломки были арифметическими, а проверить их внутри компонента нельзя: в
 * jsdom нет раскладки, `getBoundingClientRect` возвращает нули, и ошибка в
 * этих десяти строках не ловится ничем.
 *
 * Что было не так.
 *
 * Форму кадру задавала карта: холст держал пропорцию атласа (два к трём), и на
 * широком окне это был узкий столбец с чёрными полями по бокам. На «весь штат»
 * так и должно выглядеть — карта вертикальная, — но на приближении человек
 * продолжал смотреть на город в ту же щель, пока половина редактора пустовала.
 * Теперь форму задаёт окно, а карта целиком помещается в кадр при зуме 1.
 *
 * Перетаскивание считало смещение в координатах сцены, которые само же и
 * меняло: точка нажатия переводилась в сцену по старому кадру, точка под
 * курсором — по новому, уже сдвинутому. Карта отставала от руки и на каждом
 * следующем движении откатывалась почти в начало. Смещение считается в
 * пикселях экрана от точки нажатия — величине, которую перетаскивание не
 * трогает.
 */

/*
 * Размер того, что кадр держит в руках: атлас, а с островом Кайо-Перико (задача 42Б) — атлас, продолженный до дальнего
 * края острова (`scene.extent`, единицы сцены; оно только больше атласа и растёт вправо и вниз, начало то же).
 */
export const reachOf = (scene) => ({
  width: Math.max(scene.width, scene.extent?.width || 0),
  height: Math.max(scene.height, scene.extent?.height || 0),
});

/** Пропорция окна; до первого замера — пропорция карты. */
export function frameAspect(scene, viewport) {
  const reach = reachOf(scene);
  return viewport.width > 0 && viewport.height > 0
    ? viewport.width / viewport.height
    : reach.width / reach.height;
}

/** Высота кадра, при которой карта видна целиком, как бы ни было повёрнуто окно. */
export function fitHeight(scene, viewport) {
  const reach = reachOf(scene);
  return Math.max(reach.height, reach.width / frameAspect(scene, viewport));
}

export function frameSize(zoom, scene, viewport) {
  const height = fitHeight(scene, viewport) / zoom;
  return { width: height * frameAspect(scene, viewport), height };
}

/*
 * Кадр шире карты — карта стоит посередине, и тянуть её некуда: иначе она
 * уезжала бы в угол и оттуда не возвращалась.
 */
export const clampAxis = (value, size, extent) =>
  extent >= size
    ? (size - extent) / 2
    : Math.min(Math.max(value, 0), size - extent);

export function clampView(view, scene, viewport) {
  const size = frameSize(view.zoom, scene, viewport);
  const reach = reachOf(scene);
  return {
    zoom: view.zoom,
    x: clampAxis(view.x, reach.width, size.width),
    y: clampAxis(view.y, reach.height, size.height),
  };
}

/** Кадр целиком: положение и размер, из них получается viewBox. */
export function resolveFrame(view, scene, viewport) {
  const size = frameSize(view.zoom, scene, viewport);
  const reach = reachOf(scene);
  return {
    ...size,
    zoom: view.zoom,
    x: clampAxis(view.x, reach.width, size.width),
    y: clampAxis(view.y, reach.height, size.height),
  };
}

/**
 * Кадр, приближенный к точке окна до масштаба `zoom`: `at` — доля окна по
 * ширине и высоте (0..1), где стоит курсор. Точка карты под ней остаётся под
 * ней — если кадр не упёрся в край карты (`clampView`).
 *
 * Точка берётся долей окна, а не точкой холста: холст на живом кадре жеста
 * едет трансформом, и его положение — это кадр, который был нарисован, а не
 * тот, что виден сейчас.
 */
export function zoomAround(view, at, zoom, scene, viewport) {
  const before = resolveFrame(view, scene, viewport);
  const size = frameSize(zoom, scene, viewport);
  const pointX = before.x + at.x * before.width;
  const pointY = before.y + at.y * before.height;
  return clampView(
    { zoom, x: pointX - at.x * size.width, y: pointY - at.y * size.height },
    scene,
    viewport,
  );
}

/**
 * Плавное приближение колесом (14.10, «карту трясёт»): масштаб на этом кадре
 * экрана по пути от `zoom` к цели `target`. Ход — по логарифму масштаба, доля
 * пути за кадр зависит от его длительности `dt` (`tau` — постоянная времени,
 * мс): долгий кадр догоняет больше, и скорость не скачет с частотой кадров.
 * Цель не перелетает никогда — зум монотонный, без отскока. Последние доли
 * процента — сразу в цель: хвост экспоненты бесконечен.
 */
export function glideZoom(zoom, target, dt, tau) {
  if (!(tau > 0) || !(zoom > 0) || !(target > 0)) return target;
  const gap = Math.log(target / zoom);
  const next = zoom * Math.exp(gap * (1 - Math.exp(-Math.max(0, dt) / tau)));
  return Math.abs(Math.log(target / next)) < 5e-4 ? target : next;
}

/**
 * Кадр после перетаскивания.
 *
 * `origin` — кадр в момент нажатия, `delta` — смещение указателя в пикселях
 * экрана от точки нажатия. Обе величины неподвижны, поэтому повторный расчёт
 * от той же точки нажатия даёт тот же ответ, сколько бы кадров ни прошло.
 */
export function panFrame(origin, delta, rect, scene, viewport) {
  if (!rect?.width || !rect?.height) return origin;
  return clampView(
    {
      zoom: origin.zoom,
      x: origin.x - (delta.x / rect.width) * origin.width,
      y: origin.y - (delta.y / rect.height) * origin.height,
    },
    scene,
    viewport,
  );
}

/**
 * Где стоит всплывашка наведения: правее и ниже курсора (`gap`), но целиком в
 * окне — с полем `margin` у правого и нижнего края. `room` — размер окна,
 * `box` — размер подсказки; пока кого-то из них не измерили, подсказка просто
 * идёт за курсором.
 */
export function tooltipPlace(left, top, room, box, gap = { x: 14, y: 12 }, margin = 8) {
  const along = (point, step, space, size) => {
    const wanted = point + step;
    return space > 0 && size > 0 ? Math.max(0, Math.min(wanted, space - size - margin)) : wanted;
  };
  return {
    x: along(left, gap.x, room.width, box.width),
    y: along(top, gap.y, room.height, box.height),
  };
}
