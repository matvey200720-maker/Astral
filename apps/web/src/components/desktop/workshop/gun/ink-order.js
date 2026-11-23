/*
 * Порядок отрисовки чернил тату (05.11.2026, владелец: «очки пропадают под некоторыми углами камеры», «на белой лямке чёрные треугольники»).
 *
 * Тату и блэкворк на теле — прозрачные сетки (`BLEND`, зоны `tattoo_*`, `astralDrawing`): рисунок лежит на коже, а в буфер глубины не пишет (`GLTFLoader` ставит `depthWrite: false` всем прозрачным). Таких же
 * прозрачных в кадре много: стёкла очков (`ped_alpha`), причёска, лямки и сетка тканей. Прозрачные сортируются по расстоянию от камеры до центра сетки, и у зоны головы центр где-то в середине черепа, а у стёкол — перед лицом:
 * под одними углами стёкла рисуются после грима и целы, под другими — раньше, и чернила, лежащие на коже за ними, ложатся поверх стёкол и стирают их. То же с чернилами на коже под тонкой прозрачной тканью: чёрные
 * пятна поверх лямки.
 *
 * Чернила лежат на коже и всегда глубже любой вещи и реквизита, поэтому рисуются первыми среди прозрачных (`renderOrder` меньше нуля): всё, что стоит перед кожей, ложится поверх них и перекрывает их там, где перекрывало бы по глубине.
 */

export const INK_RENDER_ORDER = -10;

/** Чернила тату на теле: материал с меткой `astralDrawing` у тела мастерской (`astralTattooBody`). */
export const isInkMaterial = (material) => Boolean(material?.userData?.astralDrawing && material.userData.astralTattooBody);

/** Нужный `renderOrder` у сетки: у чернил — первым среди прозрачных, у остальных — `null` (как было). */
export function inkRenderOrder(node) {
  const list = Array.isArray(node?.material) ? node.material : [node?.material];
  return list.some(isInkMaterial) ? INK_RENDER_ORDER : null;
}

/** Выставляет порядок чернилам во всём дереве `root`; возвращает, сколько сеток затронуто. */
export function orderInk(root) {
  let count = 0;
  root?.traverse?.((node) => {
    if (!node.isMesh) return;
    const order = inkRenderOrder(node);
    if (order === null) return;
    node.renderOrder = order;
    count += 1;
  });
  return count;
}
