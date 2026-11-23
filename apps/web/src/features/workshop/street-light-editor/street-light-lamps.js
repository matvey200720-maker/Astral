/*
 * Где у фонаря светят лампы.
 *
 * Чистая геометрия, без обращения к приложению: так её можно проверить на
 * настоящих моделях игры обычным скриптом, а не только глазами в превью.
 * Именно здесь пряталась ошибка с лишним конусом света в пустоте.
 */

/**
 * Где у фонаря лампы.
 *
 * Считать позиции по габаритам модели оказалось нельзя: у однорожковых фонарей
 * это вешало вторую лампу в пустоту рядом со столбом. Поэтому смотрим на
 * фактическую геометрию — плафон это отдельный меш у верхушки, невысокий и
 * стоящий в стороне от мачты.
 *
 * Мачту отсекаем по высоте: она тянется больше чем на половину фонаря, плафон
 * такой быть не может.
 */
export function lampAnchors(THREE, model) {
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const nearTop = bounds.max.y - size.y * 0.22;

  /* Ось мачты ищем по основанию, а не по самому высокому мешу: столб нередко
     смоделирован заодно с изогнутым кронштейном, и центр такого меша лежит
     посреди выноса — тогда «на оси» оказывается и плафон, и крышка сразу.
     Внизу же ничего кроме столба нет. */
  model.updateMatrixWorld(true);
  const footing = new THREE.Box3();
  const footingTop = bounds.min.y + size.y * 0.12;
  model.traverse((object) => {
    if (!object.isMesh) return;
    const box = new THREE.Box3().setFromObject(object);
    if (!Number.isFinite(box.max.y) || box.max.y > footingTop) return;
    footing.union(box);
  });
  const axis = footing.isEmpty()
    ? center
    : footing.getCenter(new THREE.Vector3());

  const found = [];
  model.traverse((object) => {
    if (!object.isMesh) return;
    const box = new THREE.Box3().setFromObject(object);
    if (!Number.isFinite(box.max.y) || box.max.y < nearTop) return;
    const extent = box.getSize(new THREE.Vector3());
    if (extent.y > size.y * 0.45) return; // мачта, а не плафон
    const point = box.getCenter(new THREE.Vector3());
    point.reach = Math.hypot(point.x - axis.x, point.z - axis.z);
    found.push(point);
  });

  /* Крышка на макушке столба тоже проходит по высоте, но стоит на оси —
     из-за неё в превью висел лишний конус света в пустоте. Оставляем только
     то, что реально вынесено вбок; если выноса нет ни у чего, значит
     светильник сидит прямо на столбе, и берём самый верхний. */
  const offAxis = found.filter(
    (point) => point.reach > Math.max(0.35, size.y * 0.045),
  );
  if (offAxis.length) {
    found.length = 0;
    found.push(...offAxis);
  } else if (found.length > 1) {
    const highest = found.reduce((a, b) => (a.y >= b.y ? a : b));
    found.length = 0;
    found.push(highest);
  }

  /* Плафон нередко разбит на несколько мешей — корпус, стекло, отражатель.
     Схлопываем близкие точки, иначе на одну лампу придётся три источника. */
  const merged = [];
  for (const point of found) {
    const near = merged.find(
      (existing) => existing.distanceTo(point) < Math.max(0.6, size.y * 0.09),
    );
    if (near) near.lerp(point, 0.5);
    else merged.push(point.clone());
  }

  if (merged.length) return merged;

  /* Запасной вариант — одна лампа над центром: лучше одна в правильном месте,
     чем две наугад. */
  return [
    new THREE.Vector3(
      center.x,
      bounds.max.y - Math.max(0.25, size.y * 0.045),
      center.z,
    ),
  ];
}
