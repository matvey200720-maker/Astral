//! Место модели в мире: как игра ставит сущность карты. Те же выражения, что у `placement.js`
//! (`packages/climb-contract/recolor/placement.js`), в том же порядке и в `f64`: сцены зон и интерьеров получают от Rust **те же числа**,
//! что от JS (`js_math::hypot` повторяет `Math.hypot` V8; свёрток «умножить и сложить» у Rust нет, порядок действий сохраняется).
//!
//! Игра хранит у обычной сущности обратный кватернион, поэтому точка модели в мире — позиция плюс точка, повёрнутая обратным к записанному.
//! У экземпляра интерьера (`CMloInstanceDef`) кватернион не обращается.
//!
//! Сверка с JS — `fixtures/ars1/math/placement.json` (его делает `tests/helpers/placement-parity-set.js` настоящим `placement.js`).

use crate::js_math::hypot;

/// Сущность карты: позиция, записанный кватернион (x, y, z, w) и масштабы. Нулевой и нечисловой масштаб — единица (как `|| 1` в JS).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Entity {
    pub position: [f64; 3],
    pub rotation: [f64; 4],
    pub scale_xy: f64,
    pub scale_z: f64,
}

impl Entity {
    /// Сущность без поворота и масштаба.
    pub fn at(position: [f64; 3]) -> Entity {
        Entity {
            position,
            rotation: [0.0, 0.0, 0.0, 1.0],
            scale_xy: 1.0,
            scale_z: 1.0,
        }
    }
}

/// `value || 1`: ноль и NaN дают единицу.
fn or_one(value: f64) -> f64 {
    if value == 0.0 || value.is_nan() {
        1.0
    } else {
        value
    }
}

fn is_identity([x, y, z, w]: [f64; 4]) -> bool {
    x == 0.0 && y == 0.0 && z == 0.0 && w == 1.0
}

/// Точка модели → точка мира (`placementTransform`): готовое преобразование сущности.
#[derive(Debug, Clone, Copy)]
pub struct Placement {
    position: [f64; 3],
    quaternion: [f64; 4],
    scale: [f64; 3],
}

impl Placement {
    /// По записанному кватерниону сущности (с обращением).
    pub fn new(entity: &Entity) -> Placement {
        let [x, y, z, w] = entity.rotation;
        let q = if is_identity(entity.rotation) {
            [0.0, 0.0, 0.0, 1.0]
        } else {
            [-x, -y, -z, w]
        };
        let length = or_one(hypot(&q));
        Placement {
            position: entity.position,
            quaternion: q.map(|value| value / length),
            scale: [
                or_one(entity.scale_xy),
                or_one(entity.scale_xy),
                or_one(entity.scale_z),
            ],
        }
    }

    pub fn point(&self, point: [f64; 3]) -> [f64; 3] {
        let [qx, qy, qz, qw] = self.quaternion;
        let px = point[0] * self.scale[0];
        let py = point[1] * self.scale[1];
        let pz = point[2] * self.scale[2];
        // v' = v + w·t + q×t, где t = 2·(q×v): поворот единичным кватернионом.
        let tx = 2.0 * (qy * pz - qz * py);
        let ty = 2.0 * (qz * px - qx * pz);
        let tz = 2.0 * (qx * py - qy * px);
        [
            self.position[0] + px + qw * tx + (qy * tz - qz * ty),
            self.position[1] + py + qw * ty + (qz * tx - qx * tz),
            self.position[2] + pz + qw * tz + (qx * ty - qy * tx),
        ]
    }
}

/// `placementTransform`: преобразование обычной сущности (поворот обращается).
pub fn placement_transform(entity: &Entity) -> Placement {
    Placement::new(entity)
}

/// `mloInstanceTransform`: точка помещения → точка мира для экземпляра интерьера; кватернион экземпляра не обращается
/// (двойное обращение: здесь и в `placementTransform`).
pub fn mlo_instance_transform(instance: &Entity) -> Placement {
    let [x, y, z, w] = instance.rotation;
    let rotation = if is_identity(instance.rotation) {
        [0.0, 0.0, 0.0, 1.0]
    } else {
        [-x, -y, -z, w]
    };
    Placement::new(&Entity {
        rotation,
        ..*instance
    })
}

/// `placementRotation`: тот же поворот для направлений (нормалей), без сдвига и масштаба; результат приводится к единице.
#[derive(Debug, Clone, Copy)]
pub struct Rotation(Placement);

pub fn placement_rotation(entity: &Entity) -> Rotation {
    Rotation(Placement::new(&Entity {
        position: [0.0, 0.0, 0.0],
        scale_xy: 1.0,
        scale_z: 1.0,
        ..*entity
    }))
}

impl Rotation {
    pub fn direction(&self, vector: [f64; 3]) -> [f64; 3] {
        let [x, y, z] = self.0.point(vector);
        let length = or_one(hypot(&[x, y, z]));
        [x / length, y / length, z / length]
    }
}

/// Теневой прокси (`isShadowProxy`): флаг архетипа `0x800`; такую модель в кадр не кладут, игра рисует её только в карте теней.
pub fn is_shadow_proxy(flags: u32) -> bool {
    flags & 0x800 != 0
}

#[cfg(test)]
mod tests;
