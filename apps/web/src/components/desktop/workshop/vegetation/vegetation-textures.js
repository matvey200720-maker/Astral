/*
 * Зелень, нарисованная без игры.
 *
 * Настоящие травинки, листву и кору достаёт из установленной игры пакет
 * `@modovik/gta-preview-assets`; его может не быть вовсе — игра не подключена,
 * извлечение не запускали, стоит сборка без нужного архива. Редактор обязан
 * работать и тогда, поэтому здесь лежит замена.
 *
 * ГЛАВНОЕ ПРО ЭТУ ЗАМЕНУ: у неё есть альфа, и в ней лежит форма.
 *
 * У асфальта замену можно нарисовать шумом — там разница между игрой и не-игрой
 * в зерне. У листвы разница в силуэте: RGB несёт только цвет прямоугольника, а
 * вырез кроны и просвет между травинками живут в четвёртом канале. Замена без
 * альфы — это не «похуже», это поле зелёных карточек вместо травы, и по такому
 * кадру нельзя настроить ни плотность, ни высоту, ни разброс. Поэтому здесь
 * рисуется именно маска, а цвет к ней прилагается.
 *
 * Рисуется в массив байт, а не на `canvas`: `getContext("2d")` в jsdom отдаёт
 * null, и текстуры, нарисованные холстом, превращают любой тест со сценой в
 * падение на пустом месте. Массив работает всюду одинаково.
 *
 * Строка 0 массива — низ карточки. `DataTexture` в three приходит с
 * `flipY = false`, то есть первая строка данных ложится на `v = 0`, а `v = 0` у
 * нашей геометрии — это земля. Перевернуть здесь значит посадить траву
 * метёлками вниз.
 */

/*
 * Цвета замены. Подобраны по средним тонам настоящих текстур игры и совпадают
 * с `PREVIEW_FALLBACK.vegetation` в пакете ассетов. Пакет сюда не импортируется
 * намеренно: он может отсутствовать, а связь с ним по контракту односторонняя
 * (см. `preview/preview-assets.js`).
 */
const PALETTE = Object.freeze({
  grass: Object.freeze({ base: [0.13, 0.19, 0.07], tip: [0.42, 0.55, 0.22] }),
  /*
   * У листвы четыре тона, а не два, и это не щедрость.
   *
   * Крона — это не одна зелёная краска разной яркости: лист в глубине ветки
   * почти чёрный, лист снаружи вдвое светлее, а часть листьев всегда уходит в
   * жёлтое. Двумя тонами получается ровное пятно, по которому нельзя понять ни
   * глубины кроны, ни того, сколько в ней слоёв, — ровно то, из-за чего листва
   * читалась мультяшными кляксами.
   */
  leaf: Object.freeze({
    deep: [0.042, 0.07, 0.026],
    base: [0.09, 0.15, 0.05],
    tip: [0.23, 0.34, 0.105],
    warm: [0.31, 0.3, 0.09],
  }),
  /*
   * Борозда тёмная, гребень светлый — но гребень не белый.
   *
   * Тон 0.35 на солнце в двадцать килолюкс уходит за единицу яркости ещё до
   * тонового отображения, и освещённый бок ствола выходит бледной доской:
   * зерно на нём есть, но оно всё в пересвете, и глаз читает столб. Гребень
   * опущен до 0.3 и уведён в тёплый серо-коричневый — это тон сухой дубовой
   * коры на солнце.
   *
   * Борозда, наоборот, ПОДНЯТА с 0.055: при размахе впятеро дно борозды на
   * свету ещё читается корой, а в собственной тени ствола уходит в чистый
   * чёрный, и кора там не тёмная, а никакая. Размах втрое — это тот предел,
   * за которым борозда остаётся видна на обоих боках ствола.
   */
  bark: Object.freeze({
    base: [0.085, 0.068, 0.052],
    tip: [0.3, 0.253, 0.194],
  }),
  litter: Object.freeze({
    base: [0.1, 0.13, 0.05],
    tip: [0.33, 0.41, 0.15],
    flower: Object.freeze([0.66, 0.6, 0.31]),
  }),
  ground: Object.freeze({
    lawn: [0.09, 0.14, 0.05],
    steppe: [0.24, 0.21, 0.11],
    meadow: [0.11, 0.14, 0.06],
    dirt: [0.15, 0.12, 0.09],
  }),
});

const hash = (x, y, seed) => {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return value - Math.floor(value);
};

function valueNoise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

const wrap = (value, period) => ((value % period) + period) % period;

/**
 * Тот же шум, но замкнутый в кольцо.
 *
 * Кора — единственная текстура здесь, которая обязана стыковаться сама с собой:
 * развёртка ствола обходит его по кругу, и незамкнутый шум оставляет по всей
 * высоте вертикальный шов. На тонком стволе он читается как трещина, идущая
 * ровно по одной образующей, — то есть как поломка, а не как кора. Решётка шума
 * берётся по модулю числа ячеек, а число ячеек целое, поэтому левый край
 * картинки продолжается правым, а верхний нижним.
 */
function tiledNoise(x, y, across, along, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(wrap(ix, across), wrap(iy, along), seed);
  const b = hash(wrap(ix + 1, across), wrap(iy, along), seed);
  const c = hash(wrap(ix, across), wrap(iy + 1, along), seed);
  const d = hash(wrap(ix + 1, across), wrap(iy + 1, along), seed);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

/* В текстуру уходит sRGB — three вернёт её в линейный свет по `colorSpace`.
   Писать линейные байты значило бы потерять точность в тенях, где живёт вся
   листва. */
const encode = (linear) =>
  Math.round(Math.min(Math.max(linear, 0), 1) ** (1 / 2.2) * 255);

const mix = (from, to, amount) => from + (to - from) * amount;

function blank(width, height) {
  return { data: new Uint8Array(width * height * 4), width, height };
}

/*
 * Затухание к краю карточки — по бокам и сверху, но не снизу.
 *
 * Клякса листа, дошедшая до края картинки, обрезается ровной линией, и на
 * просвет карточка читается прямоугольником с листьями внутри. Заметно это
 * только вблизи и только против солнца — то есть ровно в том кадре, ради
 * которого просвечивание и заводили. Низ не гасится: растение растёт из нижней
 * кромки, и мягкий низ оторвал бы его от земли.
 */
function edgeFade(x, y, size) {
  const sides = Math.min(x + 1, size - x) / (size * 0.07);
  const top = (size - y) / (size * 0.05);
  return Math.min(1, Math.max(0, sides)) * Math.min(1, Math.max(0, top));
}

/**
 * Карточка травы: несколько травинок, растущих со дна карточки.
 *
 * Травинка — не прямоугольник и не треугольник, а дуга: у земли она стоит
 * вертикально, к вершине заваливается. Без этого завала поле выглядит
 * частоколом, и ветер по нему не читается — гнуть в шейдере нечего, если
 * силуэт и так прямой.
 */
export function bladePixels({ size = 256, blades = 9, seed = 3 } = {}) {
  const pixels = blank(size, size);
  const { data } = pixels;
  const colours = PALETTE.grass;

  for (let index = 0; index < blades; index += 1) {
    const rootX = (hash(index, 1, seed) * 0.86 + 0.07) * size;
    const top = (0.45 + hash(index, 2, seed) * 0.5) * size;
    const lean = (hash(index, 3, seed) - 0.5) * 0.55 * size;
    const thick = (0.012 + hash(index, 4, seed) * 0.016) * size;
    const shade = 0.75 + hash(index, 5, seed) * 0.5;

    for (let y = 0; y < top; y += 1) {
      const t = y / top;
      /* Дуга: смещение растёт как квадрат высоты — так же, как её потом гнёт
         ветер в вершинном шейдере, и силуэт с движением не спорит. */
      const centre = rootX + lean * t * t;
      /* Травинка сходит на нет к вершине, но не в точку: одна текселя ширины
         на верхушке — это то, что мип-уровень сотрёт первым, и кончики
         пропадут раньше самой травы. */
      const half = thick * (1 - t * 0.82) + 0.6;
      const from = Math.floor(centre - half - 1);
      const to = Math.ceil(centre + half + 1);
      for (let x = from; x <= to; x += 1) {
        if (x < 0 || x >= size) continue;
        const away = Math.abs(x + 0.5 - centre);
        /* Мягкий край в один тексель: жёсткая ступенька на альфа-тесте даёт
           лесенку по всей длине травинки, и её видно даже в мипах. */
        const cover = Math.min(1, Math.max(0, half + 0.5 - away));
        if (cover <= 0) continue;
        const offset = (y * size + x) * 4;
        const previous = data[offset + 3] / 255;
        if (cover <= previous) continue;
        const light = mix(0.35, 1, t) * shade;
        for (let channel = 0; channel < 3; channel += 1) {
          data[offset + channel] = encode(
            mix(colours.base[channel], colours.tip[channel], t) * light,
          );
        }
        data[offset + 3] = Math.round(cover * 255);
      }
    }
  }
  return pixels;
}

/**
 * Карточка листвы: побег с сучками и листьями на них.
 *
 * ЧТО ЗДЕСЬ БЫЛО НЕ ТАК. Листья рисовались кляксами — сплюснутыми эллипсами
 * случайного размера, разбросанными вокруг ветки. В кадре это читается ровно
 * как названо: мультяшные пятна. Настоящая карточка листвы из игры устроена
 * иначе, и разница не в разрешении, а в СТРОЕНИИ: у неё есть побег, от побега
 * отходят сучки, и уже на сучках сидят листья — попарно, вдоль сучка, с
 * черешками в одну сторону. Глаз читает это строение мгновенно и с любой
 * дистанции, потому что оно повторяется во всяком растении, которое он видел.
 *
 * Второе: лист — не эллипс. У него есть черешок (ширина ноль), самое широкое
 * место около трети длины, острый кончик, зазубренный край и светлая жилка
 * посередине. Эллипс отличается от него ровно теми признаками, по которым лист
 * и опознаётся.
 *
 * Третье: порядок. Листья пишутся в холст ПО ГЛУБИНЕ, от дальних к ближним,
 * а не «у кого альфа больше». Прежний способ давал листья, просвечивающие друг
 * сквозь друга краями; здесь дальний лист темнее и честно перекрыт ближним, и
 * у карточки появляется толщина.
 *
 * Кроне при этом важно не как выглядит отдельный лист, а сколько между листьями
 * ДЫРОК: сквозь настоящую крону видно небо, и именно этим она отличается от
 * зелёного щита.
 */
export function leafPixels({
  size = 512,
  leaves = 54,
  seed = 11,
  /* Докуда идёт побег и откуда начинаются листья. У кроны побег длинный —
     карточка висит на нём; у куста короткий, потому что куст растёт от земли
     сразу листвой, и длинная голая ветка превращает его в деревце на палочке.
     Ровно так он и выглядел, пока карточка была одна на обоих. */
  stem = 0.72,
  lowest = 0.12,
} = {}) {
  const colours = PALETTE.leaf;
  const centreX = size / 2;

  /*
   * Холст в линейном свете и с раздельной альфой.
   *
   * Смешивать по-честному в байтах значило бы на каждый пиксель раскодировать
   * из sRGB обратно, сложить и закодировать снова, — а перекрытий тут по
   * десятку на пиксель. Здесь всё складывается в линейных числах, и в байты
   * уходит один раз в конце.
   */
  const shade = new Float32Array(size * size * 4);

  const paint = (x, y, cover, rgb) => {
    if (x < 0 || x >= size || y < 0 || y >= size || cover <= 0) return;
    const at = (y * size + x) * 4;
    const alpha = Math.min(1, cover);
    const keep = shade[at + 3] * (1 - alpha);
    const total = alpha + keep;
    if (total <= 0) return;
    for (let channel = 0; channel < 3; channel += 1) {
      shade[at + channel] =
        (rgb[channel] * alpha + shade[at + channel] * keep) / total;
    }
    shade[at + 3] = total;
  };

  /*
   * Один лист.
   *
   * `turn` — куда смотрит кончик, `length` и `wide` — в текселях. Профиль
   * ширины: синус по корню доли длины даёт ноль у черешка, максимум около
   * трети и острый кончик — то, чем лист отличается от эллипса. Зазубрины —
   * рябь по тому же профилю; без них силуэт слишком правильный, и лист
   * читается лепестком.
   */
  const leaf = (cx, cy, length, wide, turn, dim, warm, ripple) => {
    const ca = Math.cos(turn);
    const sa = Math.sin(turn);
    const reach = Math.ceil(length + wide + 2);
    for (let y = Math.floor(cy - reach); y <= cy + reach; y += 1) {
      for (let x = Math.floor(cx - reach); x <= cx + reach; x += 1) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        /* Ось листа и поперечина к ней. Ноль оси — черешок, единица — кончик. */
        const along = (dx * sa + dy * ca) / length;
        if (along < 0 || along > 1) continue;
        const across = dx * ca - dy * sa;
        let half = wide * Math.sin(Math.PI * Math.pow(along, 0.62)) ** 0.85;
        half *= 1 + 0.13 * Math.sin(along * 19 + ripple);
        const cover = Math.min(1, half - Math.abs(across) + 0.5);
        if (cover <= 0) continue;
        /* Черешок темнее кончика, а по жилке идёт светлая полоса: без неё лист
           остаётся плоским пятном нужной формы. */
        const lit = 0.32 + along * 0.68;
        const vein = Math.max(0, 1 - Math.abs(across) / Math.max(half, 1)) ** 6;
        const rgb = [0, 1, 2].map((channel) => {
          const green = mix(
            colours.deep[channel],
            mix(colours.base[channel], colours.tip[channel], lit),
            dim,
          );
          return mix(green, colours.warm[channel], warm) * (1 + vein * 0.45);
        });
        paint(x, y, cover * edgeFade(x, y, size), rgb);
      }
    }
  };

  /* Побег снизу вверх: без него листья висят в воздухе, и на просвет карточка
     читается облаком, а не веткой. */
  const twig = (fromX, fromY, toX, toY, thick, dim) => {
    const steps = Math.max(3, Math.round(Math.hypot(toX - fromX, toY - fromY)));
    const rgb = PALETTE.bark.tip.map(
      (channel) => channel * mix(0.4, 0.95, dim),
    );
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const cx = mix(fromX, toX, t);
      const cy = mix(fromY, toY, t);
      const half = thick * (1 - t * 0.55);
      for (let y = Math.floor(cy - half); y <= cy + half; y += 1) {
        for (let x = Math.floor(cx - half); x <= cx + half; x += 1) {
          const away = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          paint(
            x,
            y,
            Math.min(1, half - away + 0.5) * edgeFade(x, y, size),
            rgb,
          );
        }
      }
    }
  };

  /*
   * Сучки: сколько их, столько у карточки узлов. Меньше трёх — карточка
   * читается одной веткой с листьями по бокам, больше семи — кустом в кусте.
   */
  const twigs = Math.min(7, Math.max(3, Math.round(leaves / 11)));
  const perTwig = Math.max(2, Math.round(leaves / twigs / 2));

  /*
   * Всё рисуется по глубине: сначала дальние листья, потом ближние.
   *
   * Список собирается целиком и сортируется, а не пишется на ходу, потому что
   * глубина у листа своя, а сучок у него общий с соседями: рисуя по сучкам, мы
   * бы клали ближний лист одного сучка под дальний лист другого.
   */
  const plan = [];
  /* Сам побег — первым и позади всего: он держит карточку и уходит вниз, к
     ветке, на которой карточка висит. */
  plan.push({
    depth: 0,
    twig: [
      centreX,
      0,
      centreX + Math.sin(2.4) * size * 0.05,
      size * stem,
      size * 0.011,
      0.75,
    ],
  });
  for (let index = 0; index < twigs; index += 1) {
    const along = lowest + ((index + 0.5) / twigs) * (0.94 - lowest);
    const rootY = along * size * stem + size * 0.02;
    const rootX = centreX + Math.sin(along * 2.4) * size * 0.05;
    /* Сучки уходят вбок то вправо, то влево и тем полого, чем выше сидят: у
       верхушки побега они почти вдоль него. */
    const side = index % 2 === 0 ? 1 : -1;
    const lean =
      side * (0.95 - along * 0.45) + (hash(index, 21, seed) - 0.5) * 0.5;
    const reach = size * (0.2 + hash(index, 22, seed) * 0.2);
    const tipX = rootX + Math.sin(lean) * reach;
    const tipY = rootY + Math.cos(lean) * reach * 0.85;
    const depth = hash(index, 23, seed);
    plan.push({ depth, twig: [rootX, rootY, tipX, tipY, size * 0.006, depth] });

    for (let leafIndex = 0; leafIndex < perTwig; leafIndex += 1) {
      /* Листья сидят парами вдоль сучка, и обе половины пары смотрят наружу от
         него: так растёт почти всё, и глаз это знает. */
      for (const hand of [1, -1]) {
        const t = 0.24 + (leafIndex / perTwig) * 0.82;
        if (t > 1.06) continue;
        const cx = mix(rootX, tipX, Math.min(1, t));
        const cy = mix(rootY, tipY, Math.min(1, t));
        const jitter = hash(index * 13 + leafIndex, 24 + hand, seed);
        const length = size * (0.085 + jitter * 0.06) * (1.1 - t * 0.3);
        const wide = length * (0.3 + jitter * 0.12);
        const turn = lean + hand * (0.85 + jitter * 0.5);
        const leafDepth = depth * 0.6 + jitter * 0.4;
        plan.push({
          depth: leafDepth,
          leaf: [
            cx,
            cy,
            length,
            wide,
            turn,
            /* Чем ближе лист к зрителю, тем он светлее: в глубине побега
               темно, и без этого карточка выходит ровным пятном. */
            0.34 + leafDepth * 0.66,
            /* Жёлтых листьев немного: пожелтевшая целиком крона — это осень, а
               не дерево. */
            Math.max(0, jitter - 0.72) * 2.2,
            jitter * 6.283,
          ],
        });
      }
    }
  }

  plan.sort((first, second) => first.depth - second.depth);
  for (const step of plan) {
    if (step.twig) twig(...step.twig);
    else leaf(...step.leaf);
  }

  const pixels = blank(size, size);
  for (let index = 0; index < size * size; index += 1) {
    const at = index * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      pixels.data[at + channel] = encode(shade[at + channel]);
    }
    pixels.data[at + 3] = Math.round(Math.min(1, shade[at + 3]) * 255);
  }
  return pixels;
}

/**
 * Подстилка: то, что лежит между землёй и травой.
 *
 * Ярусов в кадре было ровно два — земля и трава по колено, а дальше сразу куст
 * в полтора метра. Глазу под ногами не за что зацепиться, и поле теряет мелкий
 * масштаб: по нему нельзя понять, метр до него или три.
 *
 * Карточка низкая и широкая: розетка листьев, разбегающихся от корня вбок, и
 * несколько светлых соцветий. Вертикали здесь нет намеренно — вертикаль это
 * уже трава, и повторять её значит просто загустить газон.
 */
export function litterPixels({ size = 256, sprigs = 24, seed = 41 } = {}) {
  const pixels = blank(size, size);
  const { data } = pixels;
  const colours = PALETTE.litter;

  const paint = (x, y, cover, rgb) => {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const offset = (y * size + x) * 4;
    const alpha = Math.round(Math.min(1, cover) * edgeFade(x, y, size) * 255);
    if (alpha <= data[offset + 3]) return;
    for (let channel = 0; channel < 3; channel += 1) {
      data[offset + channel] = encode(rgb[channel]);
    }
    data[offset + 3] = alpha;
  };

  /* Сплюснутая клякса: лист подстилки лежит, а не стоит, и круглая клякса
     читалась бы мхом. */
  const blob = (cx, cy, radius, squash, rgb) => {
    const wide = radius / squash;
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
      for (let x = Math.floor(cx - wide); x <= Math.ceil(cx + wide); x += 1) {
        const dx = ((x + 0.5 - cx) * squash) / radius;
        const dy = (y + 0.5 - cy) / radius;
        const away = Math.sqrt(dx * dx + dy * dy);
        const cover = (1 - away) * 2.4;
        if (cover > 0) paint(x, y, cover, rgb);
      }
    }
  };

  const tips = [];
  for (let index = 0; index < sprigs; index += 1) {
    const rootX = (0.34 + hash(index, 1, seed) * 0.32) * size;
    /* Угол от вертикали большой: чем ближе к горизонтали, тем меньше веточка
       спорит с травой над ней. */
    const angle = (hash(index, 2, seed) - 0.5) * 2.3;
    const length = (0.16 + hash(index, 3, seed) * 0.34) * size;
    const shade = 0.7 + hash(index, 4, seed) * 0.6;
    const steps = Math.max(4, Math.round(length / 2));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const x = rootX + Math.sin(angle) * length * t;
      const y = 0.04 * size + Math.cos(angle) * length * t * 0.72;
      const radius = size * 0.02 * (1.25 - t * 0.75);
      const rgb = [0, 1, 2].map(
        (channel) =>
          mix(colours.base[channel], colours.tip[channel], 0.25 + t * 0.75) *
          shade,
      );
      blob(x, y, radius, 1.6, rgb);
      if (step === steps) tips.push([x, y, shade]);
    }
  }

  /* Соцветия — единственное светлое пятно в карточке, и их мало: цветущее
     поле целиком выглядит клумбой, а не поляной. */
  for (let index = 0; index < 6; index += 1) {
    const pick =
      tips[Math.floor(hash(index, 5, seed) * tips.length) % tips.length];
    if (!pick) break;
    const rgb = colours.flower.map(
      (channel) => channel * (0.8 + pick[2] * 0.3),
    );
    blob(pick[0], pick[1], size * 0.016, 1.1, rgb);
  }
  return pixels;
}

/*
 * Рельеф коры — одно поле высот на два ответа.
 *
 * Диффуз и карта нормалей коры обязаны описывать ОДНУ поверхность: иначе
 * скользящий свет тянет тень не по той борозде, которая нарисована, и ствол
 * выглядит не корой, а мятой фольгой с рисунком коры. Поэтому функция одна, а
 * `barkPixels` и `barkNormalPixels` — два способа её прочитать.
 *
 * Гряда, а не холм. Обычный шум даёт мягкие бугры; кора же колется, и у неё
 * острый гребень и широкая тёмная борозда. Даёт это перевёрнутый модуль:
 * 1 − |2n − 1| имеет излом ровно на гребне.
 */
/*
 * Ячеек шума поперёк ствола и вдоль повтора.
 *
 * Поперёк было тридцать. Обхват ствола у комля — метра полтора, то есть борозда
 * шириной в пять сантиметров; на дереве в десяти метрах от глаза видимая
 * половина обхвата занимает два десятка пикселей, и пятнадцать борозд на них
 * — это полтора пикселя на борозду. Мип-уровень стирает такое зерно
 * НАЧИСТО, и ствол выходит гладким ровно там, где на него смотрят: вблизи.
 * Шестнадцать борозд на обхват — это десять сантиметров, размер борозды
 * настоящего дуба, и она переживает и мип, и половину экрана.
 */
const BARK_ACROSS = 16;
const BARK_ALONG = 5;

function barkHeight(u, v, seed) {
  /* Борозды вытянуты вдоль ствола: ячеек шума поперёк вшестеро больше, чем
     вдоль. Изотропный шум даёт не кору, а гальку. */
  const furrow = tiledNoise(
    u * BARK_ACROSS,
    v * BARK_ALONG,
    BARK_ACROSS,
    BARK_ALONG,
    seed,
  );
  const plate = tiledNoise(u * 10, v * 4, 10, 4, seed + 5);
  const grain = tiledNoise(u * 48, v * 30, 48, 30, seed + 11);
  const ridge = 1 - Math.abs(furrow * 2 - 1);
  /* Поперечные трещины редкие и мелкие: без них кора читается вельветом, с
     частыми — плетёнкой. */
  const crack = tiledNoise(u * 6, v * 44, 6, 44, seed + 19);
  const split = Math.max(0, crack - 0.78) * 2.6;
  const height = ridge * 0.62 + plate * 0.26 + grain * 0.12 - split;
  /*
   * Гребень против борозды растягивается на весь ход.
   *
   * Без этого поле высот жмётся к середине (сумма трёх шумов — почти
   * гауссиана), и в диффузе от разницы «гребень — борозда» остаётся четверть
   * хода палитры: борозды нет, есть серая рябь. Растяжение вокруг середины
   * возвращает борозде её тень, а гребню — его свет, и делает это ОДИНАКОВО
   * для диффуза и для карты нормалей: поле-то одно.
   *
   * Коэффициент подобран по кадру: на полутора кора упирается в оба зажима
   * широкими пятнами, и вместо борозд на стволе проступают чёрные кляксы.
   */
  const shaped = 0.5 + (height - 0.5) * 1.28;
  return Math.min(1, Math.max(0, shaped));
}

/** Кора: вертикальные борозды. Непрозрачна целиком — ствол не просвечивает. */
export function barkPixels({ size = 256, seed = 17 } = {}) {
  const pixels = blank(size, size);
  const { data } = pixels;
  const colours = PALETTE.bark;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const t = barkHeight(x / size, y / size, seed);
      const offset = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        data[offset + channel] = encode(
          mix(colours.base[channel], colours.tip[channel], t),
        );
      }
      data[offset + 3] = 255;
    }
  }
  return pixels;
}

/**
 * Карта нормалей коры — по тому же полю высот, что и её диффуз.
 *
 * Ставится ТОЛЬКО поверх собственного диффуза (см. `ensureCover`): наложить
 * этот рельеф на кору из игры значило бы описать чужую поверхность своими
 * бороздами — то самое выдумывание рельефа, от которого сцена отказывается.
 *
 * Разность берётся по соседним текселям, а не аналитически: поле собрано из
 * четырёх шумов с изломом на гребне, и производной у него в этой точке просто
 * нет. Байты пишутся линейными — это не цвет, а вектор; закодированный в sRGB
 * наклон получился бы вдвое круче нарисованного.
 */
export function barkNormalPixels({
  size = 256,
  seed = 17,
  depth = 0.065,
} = {}) {
  const pixels = blank(size, size);
  const { data } = pixels;
  const step = 1 / size;
  /* `depth` — высота рельефа В ДОЛЯХ ширины картинки, поэтому наклон и есть
     производная по тем же долям. Число выросло с 0.03 ровно во столько, во
     сколько борозда стала шире: борозд поперёк стало вдвое с половиной меньше
     (`BARK_ACROSS`), и при прежней глубине стенка борозды завалилась бы
     настолько же положе — рельеф пропал бы вместе с зерном, ради которого
     борозду и расширяли. Глубина борозды в метрах при этом не изменилась. */
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const slopeU =
        ((barkHeight(u + step, v, seed) - barkHeight(u - step, v, seed)) /
          (2 * step)) *
        depth;
      const slopeV =
        ((barkHeight(u, v + step, seed) - barkHeight(u, v - step, seed)) /
          (2 * step)) *
        depth;
      const length = Math.hypot(slopeU, slopeV, 1);
      const offset = (y * size + x) * 4;
      data[offset] = Math.round(((-slopeU / length) * 0.5 + 0.5) * 255);
      data[offset + 1] = Math.round(((-slopeV / length) * 0.5 + 0.5) * 255);
      data[offset + 2] = Math.round((1 / length) * 0.5 * 255 + 127.5);
      data[offset + 3] = 255;
    }
  }
  return pixels;
}

/** Земля под травой. Тайлится, поэтому непрозрачна и без выраженных пятен. */
export function groundPixels({ kind = "lawn", size = 128, seed = 23 } = {}) {
  const pixels = blank(size, size);
  const { data } = pixels;
  const base = PALETTE.ground[kind] || PALETTE.ground.lawn;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const coarse = valueNoise(x / 17, y / 17, seed);
      const fine = valueNoise(x / 3.1, y / 3.1, seed + 3);
      const offset = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        data[offset + channel] = encode(
          base[channel] * (0.72 + coarse * 0.5 + fine * 0.22),
        );
      }
      data[offset + 3] = 255;
    }
  }
  return pixels;
}

/**
 * Что из растительности нашлось в установленной игре.
 *
 * Спрашиваем именно про наличие, а не про текстуру: неизвестное имя набор окна
 * подменяет процедурным шумом молча, и отличить «листва из игры» от «шум вместо
 * листвы» по возвращённой текстуре уже нельзя — а разница между ними и есть то,
 * что редактор пишет под кадром.
 */
export function resolveVegetationAssets(assets) {
  const items = Array.isArray(assets?.items) ? assets.items : [];
  return items
    .filter(
      (item) =>
        item &&
        item.url &&
        item.kind !== "normal" &&
        VEGETATION_ASSET_IDS.has(String(item.id)),
    )
    .map((item) =>
      Object.freeze({
        id: String(item.id),
        tileMeters: Number(item.tileMeters) || 1,
      }),
    );
}

/**
 * Имена ассетов набора `vegetation`.
 *
 * Список повторяет рецепт извлечения и нужен ровно затем, чтобы отличить свой
 * набор от чужого: `ctx.assets` отдаёт все наборы одним плоским списком, и без
 * этого фильтра в «текстуры растительности» попал бы асфальт.
 */
export const VEGETATION_ASSET_IDS = new Set([
  "ground-lawn",
  "ground-steppe",
  "ground-meadow",
  "ground-dirt",
  "grass-blades",
  "grass-tuft",
  "grass-dry",
  "grass-reeds",
  "grass-flowers",
  "bush-leaves",
  "bush-branches",
  "hedge-leaves",
  "tree-oak-leaves",
  "tree-pine-leaves",
  "tree-palm-frond",
  "bark-oak",
  "bark-palm",
]);

/** Земля, из которой человек выбирает в списке. Порядок — порядок списка. */
export const GROUND_ASSETS = Object.freeze([
  Object.freeze({ id: "ground-lawn", label: "Газон", kind: "lawn" }),
  Object.freeze({ id: "ground-steppe", label: "Сухая трава", kind: "steppe" }),
  Object.freeze({ id: "ground-meadow", label: "Луг", kind: "meadow" }),
  Object.freeze({ id: "ground-dirt", label: "Грунт", kind: "dirt" }),
]);
