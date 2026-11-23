/*
 * Слои одного ствола: почему у карабина «пять одинаковых дорожек».
 *
 * В `x64/audio/sfx/WEAPONS_PLAYER.rpf` у игры двадцать два банка, и каждый —
 * один ствол: `mgn_sml_sc__l` это карабин, `ptl_pistol` — пистолет,
 * `sht_pump` — помповый дробовик. Внутри банка дорожки названы хешами, и
 * список из пяти строк «Дорожка 1 … Дорожка 5» не говорит человеку ничего:
 * на слух они и правда одинаковые.
 *
 * Одинаковые они не случайно. Опись живых банков Legacy (`awc-inspect` по
 * настоящему архиву) показывает то, что и должна показывать раскладка
 * round-robin:
 *
 *   mgn_sml_sc__l    5 дорожек   все 0,15 с при 36003 Гц
 *   smg_micro       22 дорожки   все 0,08 с при 42010 Гц
 *   ptl_rubber       6 дорожек   все 0,12 с при 36004 Гц
 *   ptl_pistol       1 дорожка       1,00 с при 32000 Гц
 *
 * Это варианты одного и того же выстрела: игра берёт случайный на каждый
 * нажатый курок, чтобы очередь не звучала как метроном. Менять их по одному
 * бессмысленно — заменишь одну из пяти, и свой звук услышишь в среднем на
 * каждом пятом выстреле, а остальные останутся заводскими. Именно так и
 * ломались чужие попытки: «поменял, а в игре всё равно старый».
 *
 * Поэтому банк раскладывается не в список дорожек, а в слои: варианты одного
 * звука собираются вместе, и человек меняет слой целиком — одним файлом на
 * все варианты. Ровно это делают сборки звуков, которые ставят через OpenIV.
 *
 * КАК СОБИРАЮТСЯ СЛОИ
 *
 * Признака «это вариант того же» в контейнере нет — есть длина, частота и
 * хеш. Но варианты одного выстрела записаны одним дублем: у них совпадает
 * частота дискретизации и почти совпадает длина. Разные слои расходятся
 * заметно — у помпового дробовика 0,39 с и 1,35 с, у миниган 1,2 с и 2,8 с.
 * Поэтому дорожки группируются по частоте и по длине с допуском в треть.
 *
 * Порог в 1,3 не подобран на глаз, а снят с тех же живых банков: внутри
 * одного слоя разброс там не больше 1,2 (`lmg_mg_player`: 1,00 и 1,20 с),
 * между слоями — не меньше 1,3 (`sht_bullpup`: 0,39 и 0,51 с).
 *
 * КАК СЛОИ НАЗЫВАЮТСЯ
 *
 * Имён у слоёв в игре нет, выдумывать их нельзя — но и «Слой 2» человеку не
 * помогает. Название выводится из физики выстрела: главный слой (больше всего
 * вариантов) — сам выстрел; вдвое длиннее его в банке ствола может быть только
 * хвост и эхо; вдвое короче — механика: затвор, курок, гильза.
 *
 * Слой, который отличается от выстрела в полтора раза, не называется никак —
 * «Ещё слой», и это намеренно. У дробовика булл-пап рядом с выстрелом 0,39 с
 * лежит слой 0,51 с: назвать его хвостом было бы догадкой, а догадка в
 * названии дороже пустоты — по ней человек заменит не то, что думал. Послушать
 * его — одно нажатие ▶ в карточке.
 */

/* Разброс длины внутри одного слоя. Снят с живых банков: 1,2 внутри слоя
   против 1,3 между слоями — порог проходит ровно между ними. */
const SAME_LAYER_RATIO = 1.3;

/* Во сколько раз слой должен отличаться от выстрела, чтобы его можно было
   назвать. Вдвое длиннее — это уже отзвук, а не второй дубль выстрела; вдвое
   короче — щелчок механики. Всё, что между, остаётся без имени. */
const TAIL_RATIO = 2;
const MECHANISM_RATIO = 0.6;

/* Частота у вариантов одного дубля совпадает с точностью до единиц герц
   (36001 и 36007 — один и тот же слой), у разных записей расходится
   килогерцами. */
const rateBucket = (rate) => Math.round((Number(rate) || 0) / 1000);

/* Адрес дорожки: студия ключует замены по `hash`, опись помощника отдаёт то
   же значение и в `name`. Берётся первое, что есть. */
const streamId = (stream) => String(stream?.hash || stream?.name || "");

/**
 * Банк одного ствола — тот, что лежит в `WEAPONS_PLAYER.rpf`.
 *
 * Только у них банк равен стволу. Общий `weapons` из `RESIDENT.rpf` — это 516
 * дорожек всех стволов сразу, и раскладывать его на «слои выстрела» нельзя:
 * там их полсотни разных.
 */
export const WEAPON_BANK_ARCHIVE = "x64/audio/sfx/WEAPONS_PLAYER.rpf";

export const isWeaponBank = (archive) =>
  String(archive || "").toLowerCase() === WEAPON_BANK_ARCHIVE.toLowerCase();

const seconds = (stream) => {
  const value = Number(stream?.seconds);
  if (Number.isFinite(value) && value > 0) return value;
  const samples = Number(stream?.samples) || 0;
  const rate = Number(stream?.sampleRate) || 0;
  return rate > 0 ? samples / rate : 0;
};

/**
 * Слои банка ствола.
 *
 * Возвращает от одного слоя (пистолет — одна дорожка) до трёх (дробовик —
 * выстрел, механика, хвост). Дорожки внутри слоя идут в том же порядке, в
 * каком лежат в банке: замена ставится на все сразу, и порядок ни на что не
 * влияет, но одинаковый ответ на одинаковый вход читать проще.
 */
export function weaponLayers(streams) {
  const list = (Array.isArray(streams) ? streams : [])
    .filter((stream) => stream && seconds(stream) > 0)
    .map((stream) => ({ stream, seconds: seconds(stream) }))
    .sort(
      (left, right) =>
        left.seconds - right.seconds ||
        streamId(left.stream).localeCompare(streamId(right.stream)),
    );
  if (!list.length) return [];

  const clusters = [];
  for (const item of list) {
    const open = clusters.at(-1);
    const sameRate =
      open &&
      rateBucket(open.items[0].stream.sampleRate) ===
        rateBucket(item.stream.sampleRate);
    if (sameRate && item.seconds / open.items[0].seconds <= SAME_LAYER_RATIO) {
      open.items.push(item);
      continue;
    }
    clusters.push({ items: [item] });
  }

  /*
   * Главный слой — тот, у которого больше вариантов: round-robin заводят
   * ради самого выстрела, а не ради хвоста. При равенстве берётся короткий:
   * выстрел короче своего эха, а не наоборот.
   */
  let main = 0;
  for (let index = 1; index < clusters.length; index += 1) {
    const better =
      clusters[index].items.length > clusters[main].items.length ||
      (clusters[index].items.length === clusters[main].items.length &&
        clusters[index].items[0].seconds < clusters[main].items[0].seconds);
    if (better) main = index;
  }

  const mainSeconds = clusters[main].items[0].seconds;
  /*
   * Выстрел идёт первым, остальное — за ним по длине. Порядок по длине,
   * который получился при сборке, ставил бы у дробовика два щелчка механики
   * впереди самого выстрела: человек пришёл менять выстрел, а первым видит
   * не его.
   */
  return clusters
    .map((cluster, index) => ({ cluster, index }))
    .sort(
      (left, right) =>
        (left.index === main ? 0 : 1) - (right.index === main ? 0 : 1) ||
        left.cluster.items[0].seconds - right.cluster.items[0].seconds,
    )
    .map(({ cluster, index }) => {
      const ratio = cluster.items[0].seconds / mainSeconds;
      const role =
        index === main
          ? "fire"
          : ratio >= TAIL_RATIO
            ? "tail"
            : ratio <= MECHANISM_RATIO
              ? "mechanism"
              : "extra";
      return {
        id: cluster.items.map((item) => streamId(item.stream)).join("+"),
        role,
        title: LAYER_TITLES[role],
        hint: LAYER_HINTS[role],
        seconds: cluster.items[0].seconds,
        sampleRate: Number(cluster.items[0].stream.sampleRate) || 0,
        streams: cluster.items.map((item) => item.stream),
      };
    })
    .map(numberSameRole);
}

/*
 * Два слоя одной роли разводятся номером.
 *
 * У помпового дробовика рядом с выстрелом лежат две механики — 0,39 с и
 * 0,51 с — и обе карточки назывались одинаково. Человек меняет одну,
 * возвращается через день — и не знает, какую менял.
 *
 * Номер, а не смысл: какой из щелчков затвор, а какой гильза,
 * в банке не написано, а название-догадка дороже пустоты. Сама
 * роль при этом остаётся в `role` нетронутой — номер живёт только в
 * названии, которое читают глазами.
 */
function numberSameRole(layer, _index, all) {
  const sameRole = all.filter((other) => other.role === layer.role);
  if (sameRole.length < 2) return layer;
  return {
    ...layer,
    title: `${layer.title} ${sameRole.indexOf(layer) + 1}`,
  };
}

const LAYER_TITLES = Object.freeze({
  fire: "Выстрел",
  tail: "Хвост и эхо",
  mechanism: "Механика",
  extra: "Ещё слой",
});

const LAYER_HINTS = Object.freeze({
  fire: "Сам звук выстрела — то, что слышно при нажатии на курок",
  tail: "Отзвук после выстрела: эхо и раскат",
  mechanism: "Затвор, курок, гильза — короткие механические звуки",
  extra: "Ещё один звук того же ствола — послушайте, чтобы понять какой",
});

/**
 * Строка под названием слоя: сколько вариантов и какой они длины.
 *
 * Число вариантов — не украшение: именно оно объясняет, почему замена одной
 * дорожки не слышна, и почему Astral кладёт файл на все сразу.
 */
export function describeWeaponLayer(layer) {
  const count = layer?.streams?.length || 0;
  const length = `${(layer?.seconds || 0).toFixed(2).replace(".", ",")} с`;
  if (count <= 1) return length;
  return `${length} · ${count} ${variantWord(count)}`;
}

function variantWord(count) {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return "вариантов";
  const last = count % 10;
  if (last === 1) return "вариант";
  if (last >= 2 && last <= 4) return "варианта";
  return "вариантов";
}
