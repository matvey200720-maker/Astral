/*
 * Потолок сцены каптов (решение ведущей 11.11.2026): сколько уникальных вершин и байт может весить сцена местности под шайбой. Дома стоят в сцене копиями, где они есть (сцена версии 3,
 * `scene-encode.mjs`: одинаковая сетка — один раз с матрицами мест), поэтому в потолок идут вершины, что лежат в файле и в видеопамяти, а не «нарисовано вершин» (число сборщика в отчёте).
 * Одни числа у сборщика (`scripts/prepare-capt-territory.mjs`) и у теста (`tests/capt-territory.test.js`).
 *
 * Цель — файл не больше 6 МБ и не больше 400 тыс. уникальных вершин. Влезли ангар, стройка и ветряки. Остальным десяти дома HD (0,7–1,0 млн вершин) целей не оставляют: одинаковых домов на настоящих
 * данных мало (повторы по геометрии: Церковь 0,1 %, Рокфорд 1,0 %, Завод 7 %, Мирор 28 %), а резать дома ведущая не разрешила («содержимое важнее бюджета», «ничего не выбрасывать молча»).
 * У них потолок — измеренное число сборки с запасом 3 % (ведущая: «не режь, напиши число»).
 */
export const URBAN_CAPT = Object.freeze(["cercov", "mirror", "muraveinik", "osobnyak", "pirc", "rockford", "tatu", "zavod", "paleto"]);

const TARGET = Object.freeze({ vertices: 400_000, bytes: 6_000_000 });

/** Измеренное выше цели: зона → `{ vertices, bytes }` (уникальные вершины и файл). */
const ABOVE = Object.freeze({
  cercov: { vertices: 1_046_000, bytes: 9_950_000 },
  farm: { vertices: 608_000, bytes: 6_740_000 },
  mirror: { vertices: 645_000, bytes: 7_830_000 },
  muraveinik: { vertices: 988_000, bytes: 9_870_000 },
  osobnyak: { vertices: 1_001_000, bytes: 9_800_000 },
  paleto: { vertices: 742_000, bytes: 7_240_000 },
  pirc: { vertices: 933_000, bytes: 8_550_000 },
  rockford: { vertices: 1_394_000, bytes: 13_850_000 },
  sandy: { vertices: 723_000, bytes: 8_960_000 },
  tatu: { vertices: 423_000, bytes: 4_560_000 },
  zavod: { vertices: 939_000, bytes: 8_960_000 },
});

/** Потолок сцены капта: `{ vertices, bytes }`. */
export function captSceneLimits(id) {
  return ABOVE[id] || TARGET;
}

/** Цель всех зон (400 тыс. уникальных вершин, 6 МБ): зоны выше неё названы в `ABOVE`. */
export const CAPT_TARGET = TARGET;
