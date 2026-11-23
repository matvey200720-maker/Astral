import { clamp } from "./values.js";
import { DEFAULT_RADAR_TILT, RADAR_CAR_COPY, RADAR_TILT_FIELDS, RADAR_TILT_STRENGTH } from "./defaults.js";

/** Наклон радара из проекта: выключатель и сила — целые проценты от машины в пределах `RADAR_TILT_STRENGTH`. */
export function normalizeRadarTilt(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    on: source.on === true,
    strength: Math.round(
      clamp(source.strength, RADAR_TILT_STRENGTH[0], RADAR_TILT_STRENGTH[1], DEFAULT_RADAR_TILT.strength),
    ),
  };
}

/**
 * Поля `minimap.ymt`, которые ставят «наклон как в машине»: `{ имя поля: значение }`. `stock` — числа блока Camera из файла игры
 * игрока (`fVehicleTilt`, `fVehicleOffset`, `fVehicleStaticZoom`…); `strength` — доля от машины, 40–100. Угол пешком и в машине один —
 * `fVehicleTilt × сила`; смещение и приближение переносятся с машины на пеший режим. Большой радар остаётся как в игре: его поля
 * (`RADAR_BIGMAP_STOCK_FIELDS`) здесь не возвращаются. Не нашли поле машины — ошибка, а не тихое «как получилось».
 */
export function radarCarFields(stock, strength = DEFAULT_RADAR_TILT.strength) {
  const read = (name) => {
    const value = Number(stock?.[name]);
    if (!Number.isFinite(value)) throw new Error(`В настройках мини-карты нет поля ${name}.`);
    return value;
  };
  const share = clamp(strength, RADAR_TILT_STRENGTH[0], RADAR_TILT_STRENGTH[1], DEFAULT_RADAR_TILT.strength) / 100;
  const angle = Math.round(read("fVehicleTilt") * share);
  const fields = {};
  for (const field of Object.values(RADAR_TILT_FIELDS)) fields[field] = angle;
  for (const [from, targets] of Object.entries(RADAR_CAR_COPY)) for (const target of targets) fields[target] = read(from);
  return fields;
}
