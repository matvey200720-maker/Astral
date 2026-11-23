import { sha256Hex } from "@modovik/mega-mall-contract";

const DDS_MAGIC = 0x20534444;
const FOUR_CC_BC1 = 0x31545844;
const FOUR_CC_BC3 = 0x35545844;

const clampByte = (value) => Math.max(0, Math.min(255, Math.round(value)));

function assertRgba(rgba, width, height, path = "rgba") {
  if (
    !(rgba instanceof Uint8Array) ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    rgba.length !== width * height * 4
  ) {
    throw new TypeError(`${path}: expected canonical RGBA8 bytes.`);
  }
}

export function createMegaMallMipChain(
  rgba,
  width,
  height,
  mipLevels = Math.floor(Math.log2(Math.max(width, height))) + 1,
) {
  assertRgba(rgba, width, height);
  const maximum = Math.floor(Math.log2(Math.max(width, height))) + 1;
  if (!Number.isInteger(mipLevels) || mipLevels < 1 || mipLevels > maximum) {
    throw new TypeError(`mipLevels: expected an integer from 1 to ${maximum}.`);
  }
  const mips = [{ width, height, rgba: new Uint8Array(rgba) }];
  while (mips.length < mipLevels) {
    const previous = mips.at(-1);
    const nextWidth = Math.max(1, previous.width >> 1);
    const nextHeight = Math.max(1, previous.height >> 1);
    const next = new Uint8Array(nextWidth * nextHeight * 4);
    for (let y = 0; y < nextHeight; y += 1) {
      for (let x = 0; x < nextWidth; x += 1) {
        for (let channel = 0; channel < 4; channel += 1) {
          let sum = 0;
          let count = 0;
          for (let offsetY = 0; offsetY < 2; offsetY += 1) {
            for (let offsetX = 0; offsetX < 2; offsetX += 1) {
              const sourceX = Math.min(previous.width - 1, x * 2 + offsetX);
              const sourceY = Math.min(previous.height - 1, y * 2 + offsetY);
              sum +=
                previous.rgba[
                  (sourceY * previous.width + sourceX) * 4 + channel
                ];
              count += 1;
            }
          }
          next[(y * nextWidth + x) * 4 + channel] = clampByte(sum / count);
        }
      }
    }
    mips.push({ width: nextWidth, height: nextHeight, rgba: next });
  }
  return Object.freeze(mips.map((mip) => Object.freeze(mip)));
}

function rgb565(red, green, blue) {
  return ((red >> 3) << 11) | ((green >> 2) << 5) | (blue >> 3);
}

function expand565(value) {
  const red = (value >> 11) & 31;
  const green = (value >> 5) & 63;
  const blue = value & 31;
  return [
    (red << 3) | (red >> 2),
    (green << 2) | (green >> 4),
    (blue << 3) | (blue >> 2),
  ];
}

function chooseColorEndpoints(block) {
  let darkest = block[0];
  let brightest = block[0];
  let darkestLuma = Infinity;
  let brightestLuma = -Infinity;
  for (const pixel of block) {
    const luma = pixel[0] * 54 + pixel[1] * 183 + pixel[2] * 19;
    if (luma < darkestLuma) {
      darkestLuma = luma;
      darkest = pixel;
    }
    if (luma > brightestLuma) {
      brightestLuma = luma;
      brightest = pixel;
    }
  }
  let color0 = rgb565(brightest[0], brightest[1], brightest[2]);
  let color1 = rgb565(darkest[0], darkest[1], darkest[2]);
  if (color0 <= color1) {
    if (color1 < 0xffff) color0 = color1 + 1;
    else color1 = color0 - 1;
  }
  return { color0, color1 };
}

function colorPalette(color0, color1) {
  const colors = [expand565(color0), expand565(color1)];
  colors.push(
    colors[0].map((value, index) =>
      Math.round((2 * value + colors[1][index]) / 3),
    ),
  );
  colors.push(
    colors[0].map((value, index) =>
      Math.round((value + 2 * colors[1][index]) / 3),
    ),
  );
  return colors;
}

function nearestColor(pixel, colors) {
  let best = 0;
  let distance = Infinity;
  colors.forEach((color, index) => {
    const candidate =
      (pixel[0] - color[0]) ** 2 +
      (pixel[1] - color[1]) ** 2 +
      (pixel[2] - color[2]) ** 2;
    if (candidate < distance) {
      distance = candidate;
      best = index;
    }
  });
  return best;
}

function encodeBc1Block(block) {
  const { color0, color1 } = chooseColorEndpoints(block);
  const colors = colorPalette(color0, color1);
  let colorBits = 0;
  block.forEach((pixel, index) => {
    colorBits |= nearestColor(pixel, colors) << (index * 2);
  });
  const output = new Uint8Array(8);
  const view = new DataView(output.buffer);
  view.setUint16(0, color0, true);
  view.setUint16(2, color1, true);
  view.setUint32(4, colorBits >>> 0, true);
  return output;
}

function encodeBc3Block(block) {
  let alphaMin = 255;
  let alphaMax = 0;
  for (const pixel of block) {
    alphaMin = Math.min(alphaMin, pixel[3]);
    alphaMax = Math.max(alphaMax, pixel[3]);
  }
  const alphas = [alphaMax, alphaMin];
  for (let index = 1; index <= 6; index += 1) {
    alphas.push(Math.round(((7 - index) * alphaMax + index * alphaMin) / 7));
  }
  const colorsBlock = encodeBc1Block(block);
  const output = new Uint8Array(16);
  output[0] = alphaMax;
  output[1] = alphaMin;
  let alphaBits = 0n;
  block.forEach((pixel, index) => {
    let best = 0;
    let distance = Infinity;
    alphas.forEach((alpha, candidate) => {
      const current = Math.abs(pixel[3] - alpha);
      if (current < distance) {
        distance = current;
        best = candidate;
      }
    });
    alphaBits |= BigInt(best) << BigInt(index * 3);
  });
  for (let index = 0; index < 6; index += 1) {
    output[2 + index] = Number((alphaBits >> BigInt(index * 8)) & 0xffn);
  }
  output.set(colorsBlock, 8);
  return output;
}

function readBlock(mip, blockX, blockY) {
  const block = [];
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const sourceX = Math.min(mip.width - 1, blockX * 4 + x);
      const sourceY = Math.min(mip.height - 1, blockY * 4 + y);
      const offset = (sourceY * mip.width + sourceX) * 4;
      block.push(mip.rgba.subarray(offset, offset + 4));
    }
  }
  return block;
}

function encodeMip(mip, format) {
  const blockBytes = format === "BC1" ? 8 : 16;
  const blockWidth = Math.ceil(mip.width / 4);
  const blockHeight = Math.ceil(mip.height / 4);
  const output = new Uint8Array(blockWidth * blockHeight * blockBytes);
  let offset = 0;
  for (let blockY = 0; blockY < blockHeight; blockY += 1) {
    for (let blockX = 0; blockX < blockWidth; blockX += 1) {
      const block = readBlock(mip, blockX, blockY);
      output.set(
        format === "BC1" ? encodeBc1Block(block) : encodeBc3Block(block),
        offset,
      );
      offset += blockBytes;
    }
  }
  return output;
}

function createDdsHeader(width, height, mipLevels, format) {
  const header = new Uint8Array(128);
  const view = new DataView(header.buffer);
  const blockBytes = format === "BC1" ? 8 : 16;
  view.setUint32(0, DDS_MAGIC, true);
  view.setUint32(4, 124, true);
  view.setUint32(8, mipLevels > 1 ? 0x000a1007 : 0x00081007, true);
  view.setUint32(12, height, true);
  view.setUint32(16, width, true);
  view.setUint32(
    20,
    Math.ceil(width / 4) * Math.ceil(height / 4) * blockBytes,
    true,
  );
  view.setUint32(28, mipLevels, true);
  view.setUint32(76, 32, true);
  view.setUint32(80, 4, true);
  view.setUint32(84, format === "BC1" ? FOUR_CC_BC1 : FOUR_CC_BC3, true);
  view.setUint32(108, mipLevels > 1 ? 0x00401008 : 0x00001000, true);
  return header;
}

export function encodeMegaMallDds({ rgba, width, height, format, mipLevels }) {
  if (!["BC1", "BC3"].includes(format)) {
    throw new TypeError("DDS format must be BC1 or BC3.");
  }
  assertRgba(rgba, width, height);
  if (format === "BC1") {
    for (let offset = 3; offset < rgba.length; offset += 4) {
      if (rgba[offset] !== 255) {
        throw new TypeError("BC1 target requires a fully opaque surface.");
      }
    }
  }
  const mips = createMegaMallMipChain(rgba, width, height, mipLevels);
  const encoded = mips.map((mip) => encodeMip(mip, format));
  const output = new Uint8Array(
    128 + encoded.reduce((total, bytes) => total + bytes.length, 0),
  );
  output.set(createDdsHeader(width, height, mipLevels, format));
  let offset = 128;
  for (const bytes of encoded) {
    output.set(bytes, offset);
    offset += bytes.length;
  }
  return output;
}

function decodeColorBlock(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const color0 = view.getUint16(0, true);
  const color1 = view.getUint16(2, true);
  const colors = colorPalette(color0, color1);
  const bits = view.getUint32(4, true);
  return Array.from(
    { length: 16 },
    (_, index) => colors[(bits >>> (index * 2)) & 3],
  );
}

function decodeBlock(bytes, format) {
  const colorOffset = format === "BC1" ? 0 : 8;
  const colors = decodeColorBlock(bytes.subarray(colorOffset, colorOffset + 8));
  if (format === "BC1") return colors.map((color) => [...color, 255]);
  const alpha0 = bytes[0];
  const alpha1 = bytes[1];
  const alphas = [alpha0, alpha1];
  if (alpha0 > alpha1) {
    for (let index = 1; index <= 6; index += 1) {
      alphas.push(Math.round(((7 - index) * alpha0 + index * alpha1) / 7));
    }
  } else {
    for (let index = 1; index <= 4; index += 1) {
      alphas.push(Math.round(((5 - index) * alpha0 + index * alpha1) / 5));
    }
    alphas.push(0, 255);
  }
  let alphaBits = 0n;
  for (let index = 0; index < 6; index += 1) {
    alphaBits |= BigInt(bytes[2 + index]) << BigInt(index * 8);
  }
  return colors.map((color, index) => [
    ...color,
    alphas[Number((alphaBits >> BigInt(index * 3)) & 7n)],
  ]);
}

export function decodeMegaMallDds(input) {
  const bytes =
    input instanceof Uint8Array ? input : new Uint8Array(input || 0);
  if (bytes.length < 136) throw new TypeError("DDS is truncated.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0, true) !== DDS_MAGIC ||
    view.getUint32(4, true) !== 124 ||
    view.getUint32(76, true) !== 32 ||
    view.getUint32(80, true) !== 4
  ) {
    throw new TypeError("DDS header is invalid.");
  }
  const width = view.getUint32(16, true);
  const height = view.getUint32(12, true);
  const mipLevels = Math.max(1, view.getUint32(28, true));
  const fourCC = view.getUint32(84, true);
  const format =
    fourCC === FOUR_CC_BC1 ? "BC1" : fourCC === FOUR_CC_BC3 ? "BC3" : null;
  if (!format || width < 1 || height < 1 || width > 4096 || height > 4096) {
    throw new TypeError("DDS layout is unsupported.");
  }
  const blockBytes = format === "BC1" ? 8 : 16;
  const mips = [];
  let mipWidth = width;
  let mipHeight = height;
  let offset = 128;
  for (let level = 0; level < mipLevels; level += 1) {
    const blockWidth = Math.ceil(mipWidth / 4);
    const blockHeight = Math.ceil(mipHeight / 4);
    const byteLength = blockWidth * blockHeight * blockBytes;
    if (offset + byteLength > bytes.length)
      throw new TypeError(`DDS mip ${level} is truncated.`);
    const rgba = new Uint8Array(mipWidth * mipHeight * 4);
    let blockOffset = offset;
    for (let blockY = 0; blockY < blockHeight; blockY += 1) {
      for (let blockX = 0; blockX < blockWidth; blockX += 1) {
        const pixels = decodeBlock(
          bytes.subarray(blockOffset, blockOffset + blockBytes),
          format,
        );
        blockOffset += blockBytes;
        pixels.forEach((pixel, index) => {
          const x = blockX * 4 + (index % 4);
          const y = blockY * 4 + Math.floor(index / 4);
          if (x < mipWidth && y < mipHeight)
            rgba.set(pixel, (y * mipWidth + x) * 4);
        });
      }
    }
    mips.push(Object.freeze({ width: mipWidth, height: mipHeight, rgba }));
    offset += byteLength;
    mipWidth = Math.max(1, mipWidth >> 1);
    mipHeight = Math.max(1, mipHeight >> 1);
  }
  if (offset !== bytes.length)
    throw new TypeError("DDS contains trailing bytes.");
  return Object.freeze({
    width,
    height,
    format,
    mipLevels,
    mips: Object.freeze(mips),
    sha256: `sha256:${sha256Hex(bytes)}`,
  });
}
