// Вид куска атласа для шейдера: масштаб и сдвиг по одной оси.
// Порядок аргументов (размер, начало) нужен, чтобы первым читался size: от него зависит
// текст TypeError при пустом куске.
function axisFit(size, start, direction) {
  const scale = (direction * 2) / size;
  const middle = start + size / 2;
  return { scale, shift: -middle * scale };
}

export function radarRectView(rect) {
  const across = axisFit(rect.width, rect.u, 1);
  const down = axisFit(rect.height, rect.v, -1);
  return { sx: across.scale, sy: down.scale, ox: across.shift, oy: down.shift };
}

// Точка в нормированных координатах шейдера -> пиксель холста по одной оси.
function axisToPixel(coord, scale, shift, extent, mirrored) {
  const ndc = coord * scale + shift;
  const unit = mirrored ? 1 - ndc : ndc + 1;
  return (unit / 2) * extent;
}

export function rectPixel(point, view, width, height) {
  return {
    x: axisToPixel(point.u, view.sx, view.ox, width, false),
    y: axisToPixel(point.v, view.sy, view.oy, height, true),
  };
}
