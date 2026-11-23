//! Матрицы 4x4 по столбцам: оси RAGE (Z вверх) и glTF (Y вверх).

/// (x, y, z) -> (x, z, -y).
pub(crate) const TO_GLTF: [f32; 16] = [
    1.0, 0.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0,
];

pub(crate) const FROM_GLTF: [f32; 16] = [
    1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0,
];

pub(crate) const IDENTITY: [f32; 16] = [
    1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
];

pub(crate) fn multiply(a: &[f32; 16], b: &[f32; 16]) -> [f32; 16] {
    std::array::from_fn(|i| {
        let (column, row) = (i / 4, i % 4);
        (0..4).fold(0.0f32, |sum, k| sum + a[k * 4 + row] * b[column * 4 + k])
    })
}

/// `TO_GLTF * m * FROM_GLTF`.
pub(crate) fn matrix_to_gltf(matrix: &[f32; 16]) -> [f32; 16] {
    multiply(&multiply(&TO_GLTF, matrix), &FROM_GLTF)
}

pub(crate) fn nearly_identity(matrix: &[f32; 16]) -> bool {
    matrix
        .iter()
        .zip(&IDENTITY)
        .all(|(value, unit)| (value - unit).abs() < 1e-6)
}

/// Кофакторы: шесть слагаемых (знак, i, j, k) — произведение `m[i]*m[j]*m[k]`.
/// Порядок слагаемых и сомножителей задаёт последний бит результата.
const COFACTORS: [[(f32, usize, usize, usize); 6]; 16] = [
    [
        (1.0, 5, 10, 15),
        (-1.0, 5, 11, 14),
        (-1.0, 9, 6, 15),
        (1.0, 9, 7, 14),
        (1.0, 13, 6, 11),
        (-1.0, 13, 7, 10),
    ],
    [
        (-1.0, 1, 10, 15),
        (1.0, 1, 11, 14),
        (1.0, 9, 2, 15),
        (-1.0, 9, 3, 14),
        (-1.0, 13, 2, 11),
        (1.0, 13, 3, 10),
    ],
    [
        (1.0, 1, 6, 15),
        (-1.0, 1, 7, 14),
        (-1.0, 5, 2, 15),
        (1.0, 5, 3, 14),
        (1.0, 13, 2, 7),
        (-1.0, 13, 3, 6),
    ],
    [
        (-1.0, 1, 6, 11),
        (1.0, 1, 7, 10),
        (1.0, 5, 2, 11),
        (-1.0, 5, 3, 10),
        (-1.0, 9, 2, 7),
        (1.0, 9, 3, 6),
    ],
    [
        (-1.0, 4, 10, 15),
        (1.0, 4, 11, 14),
        (1.0, 8, 6, 15),
        (-1.0, 8, 7, 14),
        (-1.0, 12, 6, 11),
        (1.0, 12, 7, 10),
    ],
    [
        (1.0, 0, 10, 15),
        (-1.0, 0, 11, 14),
        (-1.0, 8, 2, 15),
        (1.0, 8, 3, 14),
        (1.0, 12, 2, 11),
        (-1.0, 12, 3, 10),
    ],
    [
        (-1.0, 0, 6, 15),
        (1.0, 0, 7, 14),
        (1.0, 4, 2, 15),
        (-1.0, 4, 3, 14),
        (-1.0, 12, 2, 7),
        (1.0, 12, 3, 6),
    ],
    [
        (1.0, 0, 6, 11),
        (-1.0, 0, 7, 10),
        (-1.0, 4, 2, 11),
        (1.0, 4, 3, 10),
        (1.0, 8, 2, 7),
        (-1.0, 8, 3, 6),
    ],
    [
        (1.0, 4, 9, 15),
        (-1.0, 4, 11, 13),
        (-1.0, 8, 5, 15),
        (1.0, 8, 7, 13),
        (1.0, 12, 5, 11),
        (-1.0, 12, 7, 9),
    ],
    [
        (-1.0, 0, 9, 15),
        (1.0, 0, 11, 13),
        (1.0, 8, 1, 15),
        (-1.0, 8, 3, 13),
        (-1.0, 12, 1, 11),
        (1.0, 12, 3, 9),
    ],
    [
        (1.0, 0, 5, 15),
        (-1.0, 0, 7, 13),
        (-1.0, 4, 1, 15),
        (1.0, 4, 3, 13),
        (1.0, 12, 1, 7),
        (-1.0, 12, 3, 5),
    ],
    [
        (-1.0, 0, 5, 11),
        (1.0, 0, 7, 9),
        (1.0, 4, 1, 11),
        (-1.0, 4, 3, 9),
        (-1.0, 8, 1, 7),
        (1.0, 8, 3, 5),
    ],
    [
        (-1.0, 4, 9, 14),
        (1.0, 4, 10, 13),
        (1.0, 8, 5, 14),
        (-1.0, 8, 6, 13),
        (-1.0, 12, 5, 10),
        (1.0, 12, 6, 9),
    ],
    [
        (1.0, 0, 9, 14),
        (-1.0, 0, 10, 13),
        (-1.0, 8, 1, 14),
        (1.0, 8, 2, 13),
        (1.0, 12, 1, 10),
        (-1.0, 12, 2, 9),
    ],
    [
        (-1.0, 0, 5, 14),
        (1.0, 0, 6, 13),
        (1.0, 4, 1, 14),
        (-1.0, 4, 2, 13),
        (-1.0, 12, 1, 6),
        (1.0, 12, 2, 5),
    ],
    [
        (1.0, 0, 5, 10),
        (-1.0, 0, 6, 9),
        (-1.0, 4, 1, 10),
        (1.0, 4, 2, 9),
        (1.0, 8, 1, 6),
        (-1.0, 8, 2, 5),
    ],
];

pub(crate) fn invert(m: &[f32; 16]) -> Option<[f32; 16]> {
    let mut inv: [f32; 16] = std::array::from_fn(|i| {
        COFACTORS[i]
            .iter()
            .map(|&(sign, a, b, c)| sign * m[a] * m[b] * m[c])
            .reduce(|sum, term| sum + term)
            .unwrap_or(0.0)
    });
    let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
    if det.abs() < 1e-12 {
        return None;
    }
    let scale = 1.0 / det;
    inv.iter_mut().for_each(|v| *v *= scale);
    Some(inv)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NAN: f32 = f32::NAN;

    fn t(x: f32, y: f32, z: f32) -> [f32; 16] {
        let mut m = IDENTITY;
        m[12..15].copy_from_slice(&[x, y, z]);
        m
    }

    fn s(x: f32, y: f32, z: f32) -> [f32; 16] {
        let mut m = IDENTITY;
        (m[0], m[5], m[10]) = (x, y, z);
        m
    }

    fn a() -> [f32; 16] {
        std::array::from_fn(|i| (i + 1) as f32)
    }

    fn b() -> [f32; 16] {
        std::array::from_fn(|i| ((3 * i) % 7) as f32 - 2.0)
    }

    #[test]
    fn multiply_examples() {
        assert_eq!(multiply(&a(), &IDENTITY), a());
        assert_eq!(multiply(&IDENTITY, &a()), a());
        assert_eq!(
            multiply(&a(), &b()),
            [39., 42., 45., 48., -10., -8., -6., -4., 60., 68., 76., 84., 4., 4., 4., 4.]
        );
        assert_eq!(
            multiply(&b(), &a()),
            [3., 19., 0., 9., 7., 43., 16., 17., 11., 67., 32., 25., 15., 91., 48., 33.]
        );
        assert_eq!(
            multiply(&t(1., 2., 3.), &s(2., 3., 4.)),
            [2., 0., 0., 0., 0., 3., 0., 0., 0., 0., 4., 0., 1., 2., 3., 1.]
        );
        assert_eq!(
            multiply(&s(2., 3., 4.), &t(1., 2., 3.)),
            [2., 0., 0., 0., 0., 3., 0., 0., 0., 0., 4., 0., 2., 6., 12., 1.]
        );
        assert_eq!(
            multiply(&t(1., 2., 3.), &t(10., 20., 30.)),
            t(11., 22., 33.)
        );
        assert!(multiply(&[NAN; 16], &IDENTITY).iter().all(|v| v.is_nan()));
        assert!(multiply(&[0.0; 16], &[f32::INFINITY; 16])[0].is_nan());
        assert_eq!(multiply(&TO_GLTF, &FROM_GLTF), IDENTITY);
    }

    #[test]
    fn to_gltf_examples() {
        assert_eq!(matrix_to_gltf(&IDENTITY), IDENTITY);
        assert_eq!(
            matrix_to_gltf(&t(1., 2., 3.)),
            [1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 1., 3., -2., 1.]
        );
        assert_eq!(
            matrix_to_gltf(&s(2., 3., 4.)),
            [2., 0., 0., 0., 0., 4., 0., 0., 0., 0., 3., 0., 0., 0., 0., 1.]
        );
        assert_eq!(
            matrix_to_gltf(&a()),
            [1., 3., -2., 4., 9., 11., -10., 12., -5., -7., 6., -8., 13., 15., -14., 16.]
        );
        assert_eq!(
            matrix_to_gltf(&b()),
            [-2., 4., -1., 0., 1., 0., -4., 3., -3., -2., -1., 2., -1., -2., -2., 1.]
        );
        let rotation = [
            0., 1., 0., 0., -1., 0., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.,
        ];
        assert_eq!(
            matrix_to_gltf(&rotation),
            [0., 0., -1., 0., 0., 1., 0., 0., 1., 0., 0., 0., 0., 0., 0., 1.]
        );
    }

    #[test]
    fn nearly_identity_examples() {
        let with = |i: usize, v: f32| {
            let mut m = IDENTITY;
            m[i] = v;
            m
        };
        assert!(nearly_identity(&IDENTITY));
        assert!(nearly_identity(&with(3, 1e-7)));
        assert!(!nearly_identity(&with(3, 1e-6)));
        assert!(nearly_identity(&with(3, 9.9e-7)));
        assert!(nearly_identity(&with(0, 1.0 - 5e-7)));
        assert!(!nearly_identity(&t(1., 0., 0.)));
        assert!(!nearly_identity(&with(5, NAN)));
    }

    #[test]
    fn invert_examples() {
        assert_eq!(invert(&IDENTITY), Some(IDENTITY));
        assert_eq!(
            invert(&s(2., 4., 8.)),
            Some([0.5, 0., 0., 0., 0., 0.25, 0., 0., 0., 0., 0.125, 0., 0., 0., 0., 1.])
        );
        assert_eq!(invert(&t(1., 2., 3.)), Some(t(-1., -2., -3.)));
        assert_eq!(invert(&[0.0; 16]), None);
        assert_eq!(invert(&s(1., 1., 0.)), None);
        assert_eq!(invert(&s(1e-3, 1e-3, 1e-3)).unwrap()[0], 999.99994);
        assert_eq!(invert(&s(1e-3, 1e-3, 1e-4)).unwrap()[0], 999.99994);
        assert_eq!(invert(&s(1e-3, 1e-3, 1e-6)).unwrap()[0], 999.99994);
        assert_eq!(invert(&s(1e-3, 1e-3, 5e-7)), None);
        assert_eq!(invert(&s(1e-3, 1e-3, 1.1e-6)).unwrap()[0], 999.9999);
        let flip = invert(&s(-1., -1., -1.)).unwrap();
        assert_eq!((flip[0], flip[5], flip[10]), (-1., -1., -1.));
    }

    #[test]
    fn invert_non_finite() {
        let mut m = IDENTITY;
        m[0] = NAN;
        assert!(invert(&m).unwrap()[0].is_nan());
        m[0] = f32::INFINITY;
        let r = invert(&m).unwrap();
        assert_eq!(r[0], 0.0);
        assert!(r[5].is_nan() && r[15].is_nan());
    }

    #[test]
    fn invert_general_matrix() {
        let m = [
            2., 0., 0., 0., 0., 3., 1., 0., 0., -1., 4., 0., 5., 6., 7., 1.,
        ];
        let inv = invert(&m).unwrap();
        assert_eq!(
            inv,
            [
                0.5,
                0.,
                0.,
                0.,
                0.,
                0.30769232,
                -0.07692308,
                0.,
                0.,
                0.07692308,
                0.23076925,
                0.,
                -2.5,
                -2.3846154,
                -1.1538461,
                1.
            ]
        );
        assert_eq!(
            multiply(&m, &inv),
            [1., 0., 0., 0., 0., 1.0000001, 0., 0., 0., 0., 1.0000001, 0., 0., 0., 0., 1.]
        );
    }

    #[test]
    fn invert_singular_and_dense() {
        let twin = [
            1., 2., 3., 4., 1., 2., 3., 4., 5., 6., 7., 8., 9., 1., 2., 3.,
        ];
        assert_eq!(invert(&twin), None);
        let twin = [
            1., 2., 3., 4., 1., 2., 3., 4., 0., 0., 1., 0., 0., 0., 0., 1.,
        ];
        assert_eq!(invert(&twin), None);
        assert_eq!(invert(&a()), None);
        let rounded: Vec<f32> = invert(&b())
            .unwrap()
            .iter()
            .map(|v| (v * 1000.0).round() / 1000.0)
            .collect();
        let expect = [
            -0.143, 0.143, 0.143, -0.143, 0.143, 0.286, 0.0, 0.571, 0.143, 0.0, 0.071, -0.214,
            -0.143, -0.429, 0.286, -0.714,
        ];
        for (got, want) in rounded.iter().zip(expect) {
            assert!((got - want).abs() < 1e-6, "{got} != {want}");
        }
    }
}
