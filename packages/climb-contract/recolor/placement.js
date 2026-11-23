/*
 * Место модели в мире: как игра ставит сущность карты.
 *
 * Одна арифметика на подготовку наборов (сцена кадра), установщик (отделка
 * ангара по стенам) и кадр: иначе узор на стене в игре лёг бы не так, как в
 * кадре.
 *
 * Игра хранит у обычной сущности обратный кватернион (CodeWalker
 * `YmapEntityDef`: `Orientation = Invert(rotation)`), поэтому точка модели в
 * мире — позиция плюс точка, повёрнутая обратным к записанному.
 */

/** Точка модели → точка мира: `entity` — `{ position, rotation, scaleXY, scaleZ }`. */
export function placementTransform(entity) {
  const [x, y, z, w] = entity.rotation;
  const identity = x === 0 && y === 0 && z === 0 && w === 1;
  const q = identity ? [0, 0, 0, 1] : [-x, -y, -z, w];
  const length = Math.hypot(...q) || 1;
  const [qx, qy, qz, qw] = q.map((value) => value / length);
  const scale = [entity.scaleXY || 1, entity.scaleXY || 1, entity.scaleZ || 1];
  const position = entity.position;
  return (point) => {
    const px = point[0] * scale[0];
    const py = point[1] * scale[1];
    const pz = point[2] * scale[2];
    /* v' = v + w·t + q×t, где t = 2·(q×v) — поворот единичным кватернионом. */
    const tx = 2 * (qy * pz - qz * py);
    const ty = 2 * (qz * px - qx * pz);
    const tz = 2 * (qx * py - qy * px);
    return [
      position[0] + px + qw * tx + (qy * tz - qz * ty),
      position[1] + py + qw * ty + (qz * tx - qx * tz),
      position[2] + pz + qw * tz + (qx * ty - qy * tx),
    ];
  };
}

/**
 * Точка помещения → точка мира для экземпляра интерьера (`CMloInstanceDef`
 * в карте). У экземпляра игра кватернион НЕ обращает (CodeWalker
 * `YmapEntityDef(…, CMloInstanceDef)`: обращение закомментировано), а у
 * сущностей внутри помещения — обращает, как у обычных (`placementTransform`).
 * Прежде рамка зала магазина в мире бралась обратным поворотом — у
 * повёрнутых магазинов она уезжала на другую сторону от входа (задача 5 ТЗ
 * 11.10.2026).
 */
export function mloInstanceTransform(instance) {
  const [x, y, z, w] = instance.rotation || [0, 0, 0, 1];
  return placementTransform({ ...instance, rotation: x === 0 && y === 0 && z === 0 && w === 1 ? [0, 0, 0, 1] : [-x, -y, -z, w] });
}

/** Тот же поворот для направлений (нормалей), без сдвига и масштаба. */
export function placementRotation(entity) {
  const turn = placementTransform({ ...entity, position: [0, 0, 0], scaleXY: 1, scaleZ: 1 });
  return (vector) => {
    const [x, y, z] = turn(vector);
    const length = Math.hypot(x, y, z) || 1;
    return [x / length, y / length, z / length];
  };
}

/**
 * Теневой прокси: модель с флагом архетипа `0x800` в кадр не рисуется, игра кладёт её только в карту теней (упрощённый силуэт здания или стены: `po1_09_landbb_s`,
 * `po1_06_seawalla_sb`, `sc1_29_shad`, `sc1_rd_rnd_tun01_shadow`, `sc1_32_prox`). Ни у одной такой модели (семь вокруг Ранчо и `po1_06_seawalla_sb` в порту) словаря листов нет
 * (`txd = 0`) — рисовать их листом нечем, и сцена получала сплошную коричневую заливку на сотни метров (стройка, 10.11.2026). Сборщики сцен их пропускают, как игра в кадре.
 */
export function isShadowProxy(archetype) {
  return Boolean(archetype) && ((archetype.flags >>> 0) & 0x800) !== 0;
}
