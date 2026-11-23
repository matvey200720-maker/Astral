import { createElement as h, useMemo } from "react";
import { markerIconCanvas } from "./gps-icons.js";

const ART_SIZE = 64;

// Холст -> PNG; нет холста или браузер не отдал картинку — пустая строка.
const pngOf = (canvas) => {
  if (!canvas) return "";
  try {
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
};

// Два вида значка: готовая картинка или пустой квадрат цвета метки.
const looks = {
  picture: (url) => ["img", { className: "gps-icon-art", src: url, alt: "" }],
  blank: (color) => ["span", { className: "gps-icon-art is-empty", style: color ? { background: color } : undefined }],
};

const GpsIconArt = ({ icon, color, stockImage, picture }) => {
  const url = useMemo(
    () => pngOf(markerIconCanvas({ icon, color, stockImage, picture, size: ART_SIZE })),
    [icon, color, stockImage, picture],
  );
  const [tag, tileProps] = url ? looks.picture(url) : looks.blank(color);
  return h(tag, tileProps);
};

export default GpsIconArt;
