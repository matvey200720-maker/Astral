// Поворот модели ствола: дуло в +X, верх в +Y (так лежат стволы полки).
import * as THREE from "three";

const SAMPLING = Object.freeze({ perMesh: 4000, atLeast: 8, strip: 0.08 });

// Облако вершин мира; из каждой сетки берётся не больше ~4000 точек.
class Silhouette {
  constructor(root) {
    root.updateMatrixWorld(true);
    this.points = [];
    root.traverse((node) => this.#take(node));
  }

  #take(node) {
    const attribute = node.isMesh && node.geometry?.attributes?.position;
    if (!attribute) return;
    const stride = Math.max(1, Math.floor(attribute.count / SAMPLING.perMesh));
    for (let index = 0; index < attribute.count; index += stride) {
      const point = new THREE.Vector3().fromBufferAttribute(attribute, index);
      this.points.push(point.applyMatrix4(node.matrixWorld));
    }
  }

  get sparse() {
    return this.points.length < SAMPLING.atLeast;
  }

  // Размах и среднее по оси `high` среди точек, чьё значение по оси `along` проходит `inside`.
  band(along, high, inside) {
    const values = this.points
      .filter((point) => inside(point.getComponent(along)))
      .map((point) => point.getComponent(high));
    const [low, top] = values.reduce(([lo, hi], value) => [Math.min(lo, value), Math.max(hi, value)], [
      Infinity,
      -Infinity,
    ]);
    return {
      spread: values.length ? top - low : Infinity,
      mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    };
  }

  meanOf(axis) {
    return this.points.reduce((sum, point) => sum + point.getComponent(axis), 0) / this.points.length;
  }
}

// Оси по убыванию размера; при равенстве — в порядке X, Y, Z.
const rankAxes = (size) =>
  [0, 1, 2].sort((a, b) => size.getComponent(b) - size.getComponent(a) || a - b);

const signedUnit = (axis, sign) => new THREE.Vector3().setComponent(axis, sign);

export function orientation(root) {
  const shape = new Silhouette(root);
  const identity = new THREE.Quaternion();
  if (shape.sparse) return identity;

  const box = new THREE.Box3().setFromPoints(shape.points);
  const [along, high] = rankAxes(box.getSize(new THREE.Vector3()));
  const middle = box.getCenter(new THREE.Vector3());
  if (along === 0 && shape.meanOf(1) >= middle.y) return identity;

  const [floor, ceiling] = [box.min, box.max].map((corner) => corner.getComponent(along));
  const margin = (ceiling - floor) * SAMPLING.strip;
  const rear = shape.band(along, high, (value) => value <= floor + margin);
  const front = shape.band(along, high, (value) => value >= ceiling - margin);
  const muzzle = front.spread <= rear.spread ? { sign: 1, ...front } : { sign: -1, ...rear };

  const forward = signedUnit(along, muzzle.sign);
  const up = signedUnit(high, muzzle.mean >= middle.getComponent(high) ? 1 : -1);
  const side = new THREE.Vector3().crossVectors(forward, up);
  const basis = new THREE.Matrix4().makeBasis(forward, up, side);
  return new THREE.Quaternion().setFromRotationMatrix(basis).invert();
}
