/*
 * Ракурсы штатных обложек: вид → камера (Хелпер 11, 25.10.2026). Один модуль для двух мест — съёмщика плиток мастерской
 * (`scripts/stock-covers-live/recipes.mjs`) и обложек частей редуксов в каталоге, — чтобы одна и та же вещь выходила с одной
 * стороны. Модуль без импортов: его читает и скрипт под Node, и приложение.
 *
 * Единицы — как у сцены модели (`features/workshop/model-stage/orbit-stage.js`, `ModelStage`):
 *   • `orbit` — камера на орбите вокруг центра сцены: `yaw` и `pitch` в радианах (yaw — вокруг вертикали, pitch — над горизонтом),
 *     `zoom` — расстояние в долях радиуса, в который вписана сцена («запас»): меньше — ближе, 1 — сцена целиком.
 *   • `inside` — глаз внутри помещения («Ангар», «Арена»): `eye` — `[x, y, z]` в метрах сцены, `yaw`/`pitch` в радианах,
 *     `fov` — вертикальный угол в градусах.
 *   • `light` — множители света кадра (`setDaylight`): `sun`, `ambient`, `environment`, `exposure`; без него светит студия.
 *   • `ground: false` — убрать пол, тень на нём и человека-мерку (`setGround`): вещь на ровном фоне кадра.
 *   • `parts` — какие части сцены показывать (`setParts`): плиту земли у статуи сцена несёт своей частью `ground`.
 * Цель орбиты — центр сцены (цель у `inside` — направление `yaw`/`pitch`).
 */

const LIT = Object.freeze({ sun: 1, ambient: 2.2, environment: 1, exposure: 2.4 });

export const COVER_VIEWS = Object.freeze({
  /* Остановки: все четыре вида в кадре, плакаты с подсветкой видны. */
  busstops: Object.freeze({ orbit: { yaw: -0.9, pitch: 0.14, zoom: 0.84 }, light: LIT }),
  /* Банкоматы: три настенных целиком, каждый с плитой стены и без обрезки (ТЗ 27.10.2026: «объект целиком, в полный размер»). */
  atms: Object.freeze({ orbit: { yaw: -0.2, pitch: 0.1, zoom: 0.86 } }),
  /* Мега Молл: фасад с вывеской. */
  megamall: Object.freeze({ orbit: { yaw: -2.0, pitch: 0.12, zoom: 0.47 } }),
  /* Ашан: здание целиком, фасад со входом (ТЗ 27.10.2026: объект не обрезан). */
  youtool: Object.freeze({ orbit: { yaw: 1.45, pitch: 0.2, zoom: 0.7 } }),
  /* Завод: целиком (как открывается редактор). */
  factory: Object.freeze({ orbit: { yaw: -0.72, pitch: 0.42, zoom: 0.72 } }),
  /* Арена: снаружи, целиком и с окружением (в редакторе — «Снаружи»). */
  arenas: Object.freeze({ orbit: { yaw: -0.62, pitch: 0.36, zoom: 1.35 } }),
  /* Ангар: изнутри, от входа; взгляд мимо открытого проёма ворот, чтобы в кадре не было пустоты за ним. */
  hangar: Object.freeze({ inside: { eye: [-9.58, -21.85, 2.2], yaw: -0.7, pitch: 0.1, fov: 90 } }),
  /* Надпись Vinewood: вся целиком, с запасом по краям. */
  vinewood: Object.freeze({ orbit: { yaw: 0, pitch: 0.15, zoom: 1 } }),
  /* Район зон MSL: вся сеть целиком сверху наискосок, на всю ширину кадра, без обрезки (ТЗ 27.10.2026). */
  mslzones: Object.freeze({ orbit: { yaw: -0.62, pitch: 0.62, zoom: 0.8 } }),
  /* Парящий логотип: статуя целиком на светлом свету, без плиты пола и человека-мерки под ногами (ТЗ 27.10.2026: «не плита»). */
  floatlogo: Object.freeze({ orbit: { yaw: -0.62, pitch: 0.22, zoom: 1.05 }, light: { sun: 1, ambient: 1.3, environment: 1, exposure: 1.5 }, ground: false, parts: ["statue", "surround"] }),
});

/** Поставить вид на сцену: `stage` — `ModelStage` (`setView`, `setPose`, `pose`, `setDaylight`). */
export function applyCoverView(stage, view) {
  if (!stage || !view) return;
  if (view.light) stage.setDaylight?.({ ...view.light });
  if (view.ground === false) stage.setGround?.(false);
  if (view.parts) {
    /* Части сцены у кадра — по номеру в `asset.parts`; здесь они названы по `id`. */
    const ids = (stage.asset?.parts || []).map((part) => part.id ?? part.name);
    stage.setParts?.(view.parts.map((name) => ids.indexOf(name)).filter((index) => index >= 0));
  }
  if (view.inside) stage.setPose?.({ view: stage.pose?.view, inside: { ...view.inside, eye: [...view.inside.eye] } });
  else if (view.orbit) stage.setView?.({ ...view.orbit });
}
