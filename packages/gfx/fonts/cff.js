/*
 * Таблица CFF шрифта OpenType (`OTTO`): глифы — программы Type 2 с
 * кубическими кривыми. Здесь — индексы и словари CFF (в том числе
 * CID-шрифты с FDArray/FDSelect) и исполнитель программ глифов. Кривые
 * переводятся в квадратичные (каждая кубическая — две половины, у каждой
 * своя опора): так устроены и TrueType, и шрифты Scaleform, куда глифы
 * в итоге и уедут.
 */

const viewOf = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/* INDEX CFF: `{ items: [Uint8Array], end }`. */
function readIndex(bytes, at) {
  const view = viewOf(bytes);
  const count = view.getUint16(at);
  if (count === 0) return { items: [], end: at + 2 };
  const size = bytes[at + 2];
  const offset = (index) => {
    let value = 0;
    for (let k = 0; k < size; k += 1) value = value * 256 + bytes[at + 3 + index * size + k];
    return value;
  };
  const base = at + 3 + (count + 1) * size - 1;
  const items = [];
  for (let index = 0; index < count; index += 1) items.push(bytes.subarray(base + offset(index), base + offset(index + 1)));
  return { items, end: base + offset(count) };
}

/* DICT CFF: оператор → массив чисел. */
function readDict(bytes) {
  const dict = new Map();
  const operands = [];
  for (let at = 0; at < bytes.length; ) {
    const b0 = bytes[at];
    if (b0 <= 21) {
      let op = b0;
      at += 1;
      if (b0 === 12) {
        op = 1200 + bytes[at];
        at += 1;
      }
      dict.set(op, operands.splice(0));
      continue;
    }
    if (b0 === 28) {
      operands.push((bytes[at + 1] << 24) >> 16 | bytes[at + 2]);
      at += 3;
    } else if (b0 === 29) {
      operands.push((bytes[at + 1] << 24) | (bytes[at + 2] << 16) | (bytes[at + 3] << 8) | bytes[at + 4]);
      at += 5;
    } else if (b0 === 30) {
      /* Вещественное — полубайтами. */
      let text = "";
      at += 1;
      for (let done = false; !done; at += 1) {
        for (const nibble of [bytes[at] >> 4, bytes[at] & 15]) {
          if (nibble === 15) {
            done = true;
            break;
          }
          text += ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "E", "E-", "", "-"][nibble];
        }
      }
      operands.push(Number(text) || 0);
    } else if (b0 >= 32 && b0 <= 246) {
      operands.push(b0 - 139);
      at += 1;
    } else if (b0 >= 247 && b0 <= 250) {
      operands.push((b0 - 247) * 256 + bytes[at + 1] + 108);
      at += 2;
    } else if (b0 >= 251 && b0 <= 254) {
      operands.push(-(b0 - 251) * 256 - bytes[at + 1] - 108);
      at += 2;
    } else at += 1;
  }
  return dict;
}

const bias = (count) => (count < 1240 ? 107 : count < 33900 ? 1131 : 32768);

/* Кубическая → две квадратичные половины: точки TrueType (опора, конец). */
function cubicToQuads(p0, c1, c2, p3) {
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const m01 = mid(p0, c1);
  const m12 = mid(c1, c2);
  const m23 = mid(c2, p3);
  const a = mid(m01, m12);
  const b = mid(m12, m23);
  const centre = mid(a, b);
  const control = (q0, q1, q2, q3) => ({ x: (3 * (q1.x + q2.x) - q0.x - q3.x) / 4, y: (3 * (q1.y + q2.y) - q0.y - q3.y) / 4 });
  return [
    { x: control(p0, m01, a, centre).x, y: control(p0, m01, a, centre).y, on: false },
    { x: centre.x, y: centre.y, on: true },
    { x: control(centre, b, m23, p3).x, y: control(centre, b, m23, p3).y, on: false },
    { x: p3.x, y: p3.y, on: true },
  ];
}

/**
 * Шрифт CFF: `outline(номер глифа)` → контуры точками `{ x, y, on }`
 * (ось Y вверх, единицы шрифта).
 */
export function readCff(bytes) {
  const header = bytes[2];
  const names = readIndex(bytes, header);
  const top = readIndex(bytes, names.end);
  const strings = readIndex(bytes, top.end);
  const global = readIndex(bytes, strings.end);
  const topDict = readDict(top.items[0] || new Uint8Array());
  const charStrings = readIndex(bytes, (topDict.get(17) || [0])[0]).items;
  const privateOf = (dict) => {
    const [size, offset] = dict.get(18) || [0, 0];
    if (!size) return { subrs: [], defaultWidth: 0, nominalWidth: 0 };
    const priv = readDict(bytes.subarray(offset, offset + size));
    const subrsAt = priv.get(19)?.[0];
    return {
      subrs: subrsAt ? readIndex(bytes, offset + subrsAt).items : [],
      defaultWidth: priv.get(20)?.[0] || 0,
      nominalWidth: priv.get(21)?.[0] || 0,
    };
  };
  /* CID-шрифт: свой Private у каждого FD, глиф → FD по FDSelect. */
  let privates = [privateOf(topDict)];
  let fdOf = () => 0;
  if (topDict.has(1230) && topDict.has(1236) && topDict.has(1237)) {
    privates = readIndex(bytes, topDict.get(1236)[0]).items.map((item) => privateOf(readDict(item)));
    const at = topDict.get(1237)[0];
    const format = bytes[at];
    const view = viewOf(bytes);
    if (format === 0) fdOf = (glyph) => bytes[at + 1 + glyph] || 0;
    else if (format === 3) {
      const ranges = view.getUint16(at + 1);
      fdOf = (glyph) => {
        for (let range = 0; range < ranges; range += 1) {
          const first = view.getUint16(at + 3 + range * 3);
          const next = view.getUint16(at + 3 + (range + 1) * 3);
          if (glyph >= first && glyph < next) return bytes[at + 5 + range * 3];
        }
        return 0;
      };
    }
  }

  const cache = new Map();
  function outline(glyph) {
    if (cache.has(glyph)) return cache.get(glyph);
    const code = charStrings[glyph];
    const contours = [];
    if (!code) {
      cache.set(glyph, contours);
      return contours;
    }
    const local = privates[fdOf(glyph)] || privates[0];
    const stack = [];
    let x = 0;
    let y = 0;
    let stems = 0;
    let haveWidth = false;
    let contour = null;
    const moveTo = (nx, ny) => {
      if (contour && contour.length > 1) contours.push(contour);
      x = nx;
      y = ny;
      contour = [{ x, y, on: true }];
    };
    const lineTo = (nx, ny) => {
      if (!contour) contour = [{ x, y, on: true }];
      x = nx;
      y = ny;
      contour.push({ x, y, on: true });
    };
    const curveTo = (x1, y1, x2, y2, x3, y3) => {
      if (!contour) contour = [{ x, y, on: true }];
      contour.push(...cubicToQuads({ x, y }, { x: x1, y: y1 }, { x: x2, y: y2 }, { x: x3, y: y3 }));
      x = x3;
      y = y3;
    };
    /* Ширина глифа — лишнее первое число (ширина — из hmtx, здесь не нужна). */
    const width = (parity) => {
      if (!haveWidth && stack.length % 2 === parity) stack.shift();
      haveWidth = true;
    };
    const run = (program, depth) => {
      if (depth > 10) return;
      for (let at = 0; at < program.length; ) {
        const b0 = program[at];
        if (b0 >= 32 || b0 === 28) {
          if (b0 === 28) {
            stack.push((program[at + 1] << 24) >> 16 | program[at + 2]);
            at += 3;
          } else if (b0 <= 246) {
            stack.push(b0 - 139);
            at += 1;
          } else if (b0 <= 250) {
            stack.push((b0 - 247) * 256 + program[at + 1] + 108);
            at += 2;
          } else if (b0 <= 254) {
            stack.push(-(b0 - 251) * 256 - program[at + 1] - 108);
            at += 2;
          } else {
            stack.push(((program[at + 1] << 24) | (program[at + 2] << 16) | (program[at + 3] << 8) | program[at + 4]) / 65536);
            at += 5;
          }
          continue;
        }
        at += 1;
        switch (b0) {
          case 1:
          case 3:
          case 18:
          case 23:
            width(1);
            stems += stack.length >> 1;
            stack.length = 0;
            break;
          case 19:
          case 20:
            width(1);
            stems += stack.length >> 1;
            stack.length = 0;
            at += (stems + 7) >> 3;
            break;
          case 21:
            width(1);
            moveTo(x + stack[0], y + stack[1]);
            stack.length = 0;
            break;
          case 22:
            width(0);
            moveTo(x + stack[0], y);
            stack.length = 0;
            break;
          case 4:
            width(0);
            moveTo(x, y + stack[0]);
            stack.length = 0;
            break;
          case 5:
            for (let k = 0; k + 1 < stack.length; k += 2) lineTo(x + stack[k], y + stack[k + 1]);
            stack.length = 0;
            break;
          case 6:
          case 7: {
            let horizontal = b0 === 6;
            for (const value of stack) {
              if (horizontal) lineTo(x + value, y);
              else lineTo(x, y + value);
              horizontal = !horizontal;
            }
            stack.length = 0;
            break;
          }
          case 8:
            for (let k = 0; k + 5 < stack.length; k += 6)
              curveTo(x + stack[k], y + stack[k + 1], x + stack[k] + stack[k + 2], y + stack[k + 1] + stack[k + 3], x + stack[k] + stack[k + 2] + stack[k + 4], y + stack[k + 1] + stack[k + 3] + stack[k + 5]);
            stack.length = 0;
            break;
          case 24: {
            let k = 0;
            for (; k + 7 < stack.length; k += 6)
              curveTo(x + stack[k], y + stack[k + 1], x + stack[k] + stack[k + 2], y + stack[k + 1] + stack[k + 3], x + stack[k] + stack[k + 2] + stack[k + 4], y + stack[k + 1] + stack[k + 3] + stack[k + 5]);
            lineTo(x + stack[k], y + stack[k + 1]);
            stack.length = 0;
            break;
          }
          case 25: {
            let k = 0;
            for (; k + 7 < stack.length; k += 2) lineTo(x + stack[k], y + stack[k + 1]);
            curveTo(x + stack[k], y + stack[k + 1], x + stack[k] + stack[k + 2], y + stack[k + 1] + stack[k + 3], x + stack[k] + stack[k + 2] + stack[k + 4], y + stack[k + 1] + stack[k + 3] + stack[k + 5]);
            stack.length = 0;
            break;
          }
          case 26: {
            let k = 0;
            let dx = 0;
            if (stack.length % 4 === 1) dx = stack[k++];
            for (; k + 3 < stack.length; k += 4) {
              curveTo(x + dx, y + stack[k], x + dx + stack[k + 1], y + stack[k] + stack[k + 2], x + dx + stack[k + 1], y + stack[k] + stack[k + 2] + stack[k + 3]);
              dx = 0;
            }
            stack.length = 0;
            break;
          }
          case 27: {
            let k = 0;
            let dy = 0;
            if (stack.length % 4 === 1) dy = stack[k++];
            for (; k + 3 < stack.length; k += 4) {
              curveTo(x + stack[k], y + dy, x + stack[k] + stack[k + 1], y + dy + stack[k + 2], x + stack[k] + stack[k + 1] + stack[k + 3], y + dy + stack[k + 2]);
              dy = 0;
            }
            stack.length = 0;
            break;
          }
          case 30:
          case 31: {
            /* vhcurveto / hvcurveto: кривые попеременно с вертикали и горизонтали. */
            let vertical = b0 === 30;
            for (let k = 0; k + 3 < stack.length; k += 4) {
              const last = k + 4 >= stack.length - 1 && stack.length - k === 5 ? stack[k + 4] : 0;
              if (vertical) curveTo(x, y + stack[k], x + stack[k + 1], y + stack[k] + stack[k + 2], x + stack[k + 1] + stack[k + 3], y + stack[k] + stack[k + 2] + last);
              else curveTo(x + stack[k], y, x + stack[k] + stack[k + 1], y + stack[k + 2], x + stack[k] + stack[k + 1] + last, y + stack[k + 2] + stack[k + 3]);
              vertical = !vertical;
            }
            stack.length = 0;
            break;
          }
          case 10: {
            const index = stack.pop() + bias(local.subrs.length);
            if (local.subrs[index]) run(local.subrs[index], depth + 1);
            break;
          }
          case 29: {
            const index = stack.pop() + bias(global.items.length);
            if (global.items[index]) run(global.items[index], depth + 1);
            break;
          }
          case 11:
            return;
          case 14:
            width(1);
            if (contour && contour.length > 1) contours.push(contour);
            contour = null;
            stack.length = 0;
            at = program.length;
            break;
          case 12: {
            const op = program[at];
            at += 1;
            /* flex: две кривые подряд; остальное (dotsection и т. п.) — без рисования. */
            if (op === 35) {
              curveTo(x + stack[0], y + stack[1], x + stack[0] + stack[2], y + stack[1] + stack[3], x + stack[0] + stack[2] + stack[4], y + stack[1] + stack[3] + stack[5]);
              curveTo(x + stack[6], y + stack[7], x + stack[6] + stack[8], y + stack[7] + stack[9], x + stack[6] + stack[8] + stack[10], y + stack[7] + stack[9] + stack[11]);
            } else if (op === 34) {
              const startY = y;
              curveTo(x + stack[0], y, x + stack[0] + stack[1], y + stack[2], x + stack[0] + stack[1] + stack[3], y + stack[2]);
              curveTo(x + stack[4], y, x + stack[4] + stack[5], startY, x + stack[4] + stack[5] + stack[6], startY);
            } else if (op === 36) {
              const startY = y;
              curveTo(x + stack[0], y + stack[1], x + stack[0] + stack[2], y + stack[1] + stack[3], x + stack[0] + stack[2] + stack[4], y + stack[1] + stack[3]);
              curveTo(x + stack[5], y, x + stack[5] + stack[6], y + stack[7], x + stack[5] + stack[6] + stack[8], startY);
            } else if (op === 37) {
              const sx = x;
              const sy = y;
              const dx = stack[0] + stack[2] + stack[4] + stack[6] + stack[8];
              const dy = stack[1] + stack[3] + stack[5] + stack[7] + stack[9];
              curveTo(x + stack[0], y + stack[1], x + stack[0] + stack[2], y + stack[1] + stack[3], x + stack[0] + stack[2] + stack[4], y + stack[1] + stack[3] + stack[5]);
              const last = Math.abs(dx) > Math.abs(dy) ? [sx + dx + stack[10], sy] : [sx, sy + dy + stack[10]];
              curveTo(x + stack[6], y + stack[7], x + stack[6] + stack[8], y + stack[7] + stack[9], last[0], last[1]);
            }
            stack.length = 0;
            break;
          }
          default:
            stack.length = 0;
        }
      }
    };
    run(code, 0);
    if (contour && contour.length > 1) contours.push(contour);
    /* Замкнутый контур повторяет первую точку в конце — она лишняя. */
    for (const item of contours) {
      const first = item[0];
      const last = item[item.length - 1];
      if (item.length > 1 && last.on && Math.abs(last.x - first.x) < 1e-6 && Math.abs(last.y - first.y) < 1e-6) item.pop();
    }
    cache.set(glyph, contours);
    return contours;
  }
  return { outline, glyphs: charStrings.length };
}
