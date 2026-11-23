import {
  Float16BufferAttribute,
  InterleavedBufferAttribute,
  InterleavedBuffer,
  BufferAttribute,
  BufferGeometry,
} from "three";

// Номер материала группы — номер партии в списке, а не имя материала: потребитель делает по
// материалу на партию (model.batches.map(() => material)). Проверок нет: модель уже разобрана.
function build(m, position, normal, uv) {
  const g = new BufferGeometry()
    .setAttribute("position", position)
    .setAttribute("normal", normal)
    .setAttribute("uv", uv)
    .setIndex(new BufferAttribute(m.indices, 1));
  m.batches.forEach(({ first, count }, slot) => g.addGroup(first, count, slot));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// Float32 — мировые координаты для проверок.
export const geometryFromArs2 = (m) =>
  build(m, new BufferAttribute(m.positions, 3), new BufferAttribute(m.normals, 3), new BufferAttribute(m.uvs, 2));

// Квант как есть (6 + 4 + 4 байта на вершину). Рамка и шар такой геометрии — в долях рамки модели,
// считать их надо через узел с рамкой из applyArs2Frame. UV three копирует в свой Uint16Array.
export const geometryFromArs2Gpu = (m) =>
  build(
    m,
    new BufferAttribute(m.positions, 3, true),
    new InterleavedBufferAttribute(new InterleavedBuffer(m.normals, 4), 3, 0, true),
    new Float16BufferAttribute(m.uvs, 2),
  );

// Позиция узла — центр рамки, масштаб — полуоси; мировую матрицу не трогаем.
export function applyArs2Frame(node, { center, half }) {
  node.position.fromArray(center);
  node.scale.fromArray(half);
  node.updateMatrix();
  return node;
}
