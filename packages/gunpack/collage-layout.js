/*
 * Раскладка обложки пака — чистая геометрия, без холста (круг 7, 30.10.2026).
 *
 * Владелец: «некоторые ганпаки… делаешь превьюшки на 2 гана, хотя там явно больше… если на ганпаке мало оружия, два, то один снизу, второй
 * сверху, большие по размеру, как ты делаешь все остальные превьюшки: они подходят на карточку, у них есть гэпы, они по соотношению хорошо
 * заполняют, и нет большого пустого пространства» (эталон — «erd gp»: семь стволов рядами 1-2-2-2).
 *
 * Правило одно для любого числа стволов:
 *   • все стволы пака на обложке, ни один не пропадает и не наезжает на соседа;
 *   • один масштаб (метры → пиксели) на весь лист — длинный ствол длиннее короткого, как в игре;
 *   • масштаб — самый крупный из возможных при ЛЮБОМ разбиении по рядам (порядок показа сохраняется): один ствол — во всю ширину листа, два —
 *     один над другим, если так крупнее, чем в ряд, и так далее; ряды ищутся перебором (оптимальное разбиение по высоте), а не «заполни
 *     ряд слева направо», который оставлял половину листа пустой;
 *   • лишняя высота раздвигает ряды (зазоры ровные, но не шире `STRETCH` базового), остаток — полями сверху и снизу поровну.
 */

/** Во сколько раз зазор между рядами может вырасти, чтобы заполнить лист (дальше — поля). */
export const STRETCH = 2.4;

/**
 * Два ствола — один над другим (владелец 30.10.2026: «если на ганпаке 2 штуки, чтобы они были друг на друге, один снизу, второй сверху, большие по размеру»). Стопка берётся,
 * если масштаб в ней не меньше этой доли от лучшего масштаба при любом разбиении: у длинных стволов она и так выигрывает, у коротких (пистолеты) ряд из двух даёт крупнее, но
 * стопка ещё занимает карточку — «наискось» и «в ряд» остаются только там, где стопка выходит мельче чем на 40 %.
 */
export const STACK_PAIR = 0.6;

/**
 * Безопасная зона обложки ганпака в плитке каталога (владелец 12.11.2026, «whirlpool gp»: при 8–9 стволах раскладка 4×2 шла во всю ширину с полями 6 %, стволы упирались в
 * края плитки, а нижний ряд уходил под подпись и затемнение низа; у паков с 3–4 стволами воздух есть). Одно правило для любого числа стволов: блок лежит внутри этой зоны —
 * доли листа слева, справа, сверху и снизу; снизу поле больше, там подпись карточки (`public-mod-card-copy`) и тёмный градиент, сверху справа — кнопка «нравится».
 */
export const COVER_SAFE = Object.freeze({ left: 0.11, right: 0.11, top: 0.09, bottom: 0.2 });

/**
 * Границы по сумме непустых по строкам или столбцам: отбрасывает `trim` доли непустых с каждого конца, чтобы одиночные пятна (отблеск, пылинка
 * прозрачного шейдера) не растягивали рамку ствола на весь кадр.
 *
 * `counts` — число непустых пикселей на каждый индекс; возвращает `[first, last]` или `null`, если пусто.
 */
export function trimmedBounds(counts, trim = 0.003) {
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (!total) return null;
  const cut = total * trim;
  let first = 0;
  let seen = 0;
  while (first < counts.length - 1 && seen + counts[first] <= cut) {
    seen += counts[first];
    first += 1;
  }
  let last = counts.length - 1;
  seen = 0;
  while (last > first && seen + counts[last] <= cut) {
    seen += counts[last];
    last -= 1;
  }
  return [first, last];
}

/**
 * Самое выгодное разбиение на ряды при масштабе `scale`: по порядку показа, ряд не шире `width`; минимум суммарной высоты (динамика по
 * префиксам). `null` — какой-то ствол шире листа.
 */
function bestRows(items, scale, { width, gapX, gapY }) {
  const count = items.length;
  const best = new Array(count + 1).fill(Infinity);
  const from = new Array(count + 1).fill(-1);
  best[0] = 0;
  for (let end = 1; end <= count; end += 1) {
    let rowWidth = 0;
    let rowHeight = 0;
    for (let start = end - 1; start >= 0; start -= 1) {
      rowWidth += items[start].width * scale + (start < end - 1 ? gapX : 0);
      if (rowWidth > width + 1e-6) break;
      rowHeight = Math.max(rowHeight, items[start].height * scale);
      if (best[start] === Infinity) continue;
      const total = best[start] + rowHeight + (start > 0 ? gapY : 0);
      if (total < best[end]) {
        best[end] = total;
        from[end] = start;
      }
    }
  }
  if (best[count] === Infinity) return null;
  const rows = [];
  for (let end = count; end > 0; end = from[end]) {
    const start = from[end];
    const members = [];
    let rowWidth = 0;
    let rowHeight = 0;
    for (let index = start; index < end; index += 1) {
      members.push(index);
      rowWidth += items[index].width * scale + (index > start ? gapX : 0);
      rowHeight = Math.max(rowHeight, items[index].height * scale);
    }
    rows.unshift({ items: members, width: rowWidth, height: rowHeight });
  }
  return { rows, total: best[count] };
}

/**
 * Ряды одного масштаба: самый крупный масштаб, при котором стволы по порядку помещаются в ряды со щелями на лист `width`×`height`.
 * Возвращает `{ scale, rows: [{ items: [индексы], width, height }] }` (ряды — в пикселях при этом масштабе).
 */
export function packRows(items, { width, height, gapX, gapY }) {
  if (!items.length) return { scale: 0, rows: [] };
  const fits = (scale) => {
    const arranged = bestRows(items, scale, { width, gapX, gapY });
    return arranged && arranged.total <= height + 1e-6 ? arranged : null;
  };
  /* Верхняя граница: самый длинный ствол не шире листа и не выше. */
  let high = Math.max(...items.map((item) => Math.min(width / item.width, height / Math.max(item.height, 1e-6))));
  let low = 0;
  for (let step = 0; step < 40; step += 1) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  const arranged = fits(low) || bestRows(items, low, { width, gapX, gapY });
  return { scale: low, rows: arranged.rows };
}

/**
 * Раскладка стволов на листе.
 *
 * `items` — `[{ width, height }]` в метрах по порядку показа. Возвращает `{ scale, rows, placed, used }`: `placed` — `{ index, x, y, w, h }` в
 * пикселях листа (`width`×`height`), `used` — рамка всего блока `{ x, y, w, h }`.
 */
export function layoutCollage(items, { width = 1200, height = 675, padX = width * 0.06, padY = height * 0.08, gapX = width * 0.04, gapY = height * 0.05, safe = null } = {}) {
  /* `safe` — доли листа `{ left, right, top, bottom }` (`COVER_SAFE`): зона неравная по краям; без неё поля одинаковые `padX`/`padY`, как у одежды. */
  const zone = safe ? { x: width * safe.left, y: height * safe.top, right: width * safe.right, bottom: height * safe.bottom } : { x: padX, y: padY, right: padX, bottom: padY };
  const area = { width: width - zone.x - zone.right, height: height - zone.y - zone.bottom };
  if (!items.length) return { scale: 0, rows: [], placed: [], used: { x: zone.x, y: zone.y, w: 0, h: 0 } };
  let { scale: low, rows } = packRows(items, { ...area, gapX, gapY });
  if (items.length === 2 && rows.length === 1) {
    const stacked = Math.min(area.width / Math.max(items[0].width, items[1].width, 1e-9), (area.height - gapY) / Math.max(items[0].height + items[1].height, 1e-9));
    if (stacked >= low * STACK_PAIR) {
      low = stacked;
      rows = items.map((item, index) => ({ items: [index], width: item.width * stacked, height: item.height * stacked }));
    }
  }
  const blockHeight = rows.reduce((sum, row) => sum + row.height, 0) + gapY * Math.max(0, rows.length - 1);
  /* Ряды раздвигаются, пока не заполнят лист; больше `STRETCH` зазоров не делаем — остаток уходит в поля. */
  const spare = Math.max(0, area.height - blockHeight);
  const spread = rows.length > 1 ? Math.min(spare / (rows.length - 1), gapY * (STRETCH - 1)) : 0;
  const rowGap = gapY + spread;
  const usedHeight = rows.reduce((sum, row) => sum + row.height, 0) + rowGap * Math.max(0, rows.length - 1);
  const placed = [];
  let y = zone.y + (area.height - usedHeight) / 2;
  let left = width;
  let right = 0;
  for (const row of rows) {
    /* В ряду из нескольких стволов лишняя ширина делится между зазорами (не шире `STRETCH` базового), остаток — полями. */
    const room = Math.max(0, area.width - row.width);
    const gap = row.items.length > 1 ? gapX + Math.min(room / (row.items.length - 1), gapX * (STRETCH - 1)) : 0;
    const rowWidth = row.items.reduce((sum, index) => sum + items[index].width * low, 0) + gap * Math.max(0, row.items.length - 1);
    let x = zone.x + (area.width - rowWidth) / 2;
    for (const index of row.items) {
      const w = items[index].width * low;
      const h = items[index].height * low;
      placed.push({ index, x, y: y + (row.height - h) / 2, w, h });
      left = Math.min(left, x);
      right = Math.max(right, x + w);
      x += w + gap;
    }
    y += row.height + rowGap;
  }
  return {
    scale: low,
    rows,
    placed,
    used: { x: left, y: zone.y + (area.height - usedHeight) / 2, w: right - left, h: usedHeight },
  };
}
