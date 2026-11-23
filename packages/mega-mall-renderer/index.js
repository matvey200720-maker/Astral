import sharp from "sharp";
import {
  canonicalSha256,
  getMegaMallProfile,
  hashMegaMallDesign,
  normalizeMegaMallDesign,
  sha256Hex,
} from "@modovik/mega-mall-contract";
import {
  createMegaMallMipChain,
  decodeMegaMallDds,
  encodeMegaMallDds,
} from "./dds.js";

const BLENDS = Object.freeze({
  normal: "over",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
});

const FONT_FAMILIES = Object.freeze({
  sans: "Arial, sans-serif",
  condensed: "Arial Narrow, sans-serif",
  display: "Impact, Arial Black, sans-serif",
  mono: "Consolas, monospace",
});

function rgbaColor(hex, opacity = 1) {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
    alpha: (Number.parseInt(hex.slice(7, 9), 16) / 255) * opacity,
  };
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function outputLayout(profile, surface, previewMaxEdge) {
  if (surface.target) {
    return {
      width: surface.target.width,
      height: surface.target.height,
      format: surface.target.format,
      mipLevels: surface.target.mipLevels,
      physical: true,
    };
  }
  const maximum = Math.max(256, Math.min(2048, previewMaxEdge));
  if (surface.aspectRatio >= 1) {
    return {
      width: maximum,
      height: Math.max(64, Math.round(maximum / surface.aspectRatio)),
      format: null,
      mipLevels: null,
      physical: false,
    };
  }
  return {
    width: Math.max(64, Math.round(maximum * surface.aspectRatio)),
    height: maximum,
    format: null,
    mipLevels: null,
    physical: false,
  };
}

function findOwnedAsset(design, layer, assetsById) {
  const descriptor = design.assets.find((asset) => asset.id === layer.assetId);
  const owned = assetsById.get(layer.assetId);
  if (!descriptor || !owned || owned.descriptor?.id !== descriptor.id) {
    throw new TypeError(`Canonical asset ${layer.assetId} is missing.`);
  }
  const rgba =
    owned.rgba instanceof Uint8Array
      ? owned.rgba
      : new Uint8Array(owned.rgba || 0);
  if (
    rgba.length !== descriptor.width * descriptor.height * 4 ||
    `sha256:${sha256Hex(rgba)}` !== descriptor.sha256
  ) {
    throw new TypeError(`Canonical asset ${layer.assetId} failed readback.`);
  }
  return { descriptor, rgba };
}

function cropPixels(descriptor, crop) {
  const left = Math.min(
    descriptor.width - 1,
    Math.floor(crop.x * descriptor.width),
  );
  const top = Math.min(
    descriptor.height - 1,
    Math.floor(crop.y * descriptor.height),
  );
  return {
    left,
    top,
    width: Math.max(
      1,
      Math.min(
        descriptor.width - left,
        Math.round(crop.width * descriptor.width),
      ),
    ),
    height: Math.max(
      1,
      Math.min(
        descriptor.height - top,
        Math.round(crop.height * descriptor.height),
      ),
    ),
  };
}

async function applyOpacity(buffer, opacity) {
  if (opacity >= 1) return buffer;
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let offset = 3; offset < data.length; offset += 4) {
    data[offset] = Math.round(data[offset] * opacity);
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

async function rasterAssetLayer(layer, owned, width, height) {
  const boxWidth = Math.max(
    1,
    Math.min(width * 4, Math.round(width * layer.transform.scaleX)),
  );
  const boxHeight = Math.max(
    1,
    Math.min(height * 4, Math.round(height * layer.transform.scaleY)),
  );
  let pipeline = sharp(owned.rgba, {
    raw: {
      width: owned.descriptor.width,
      height: owned.descriptor.height,
      channels: 4,
    },
  }).extract(cropPixels(owned.descriptor, layer.crop));
  pipeline = pipeline.resize(boxWidth, boxHeight, {
    fit: layer.crop.mode === "contain" ? "contain" : "cover",
    position: "centre",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
  if (layer.type === "emblem" && layer.tint !== "#ffffffff") {
    const tint = rgbaColor(layer.tint);
    pipeline = pipeline.tint({ r: tint.r, g: tint.g, b: tint.b });
  }
  let buffer = await pipeline
    .rotate(layer.transform.rotation, {
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  buffer = await applyOpacity(buffer, layer.opacity);
  return buffer;
}

function textSvg(layer, width, height) {
  const color = rgbaColor(layer.color, layer.opacity);
  const family = escapeXml(FONT_FAMILIES[layer.font]);
  const fontSize = Math.max(12, Math.round(height * 0.46));
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" font-family="${family}" font-size="${fontSize}" font-weight="700" fill="rgb(${color.r},${color.g},${color.b})" fill-opacity="${color.alpha}">${escapeXml(layer.text)}</text></svg>`,
  );
}

function patternSvg(layer, width, height) {
  const primary = rgbaColor(layer.primary, layer.opacity);
  const secondary = rgbaColor(layer.secondary, layer.opacity);
  const size = Math.max(4, Math.round(Math.min(width, height) / layer.density));
  const common = `fill="rgb(${primary.r},${primary.g},${primary.b})" fill-opacity="${primary.alpha}"`;
  const mark = {
    grid: `<path d="M0 0H${size}V${size}" fill="none" stroke="rgb(${primary.r},${primary.g},${primary.b})" stroke-opacity="${primary.alpha}" stroke-width="${Math.max(1, size / 8)}"/>`,
    diagonal: `<path d="M-${size / 2} ${size}L${size} -${size / 2}M0 ${size * 1.5}L${size * 1.5} 0" stroke="rgb(${primary.r},${primary.g},${primary.b})" stroke-opacity="${primary.alpha}" stroke-width="${Math.max(1, size / 3)}"/>`,
    dots: `<circle cx="${size / 2}" cy="${size / 2}" r="${Math.max(1, size / 4)}" ${common}/>`,
    chevrons: `<path d="M0 ${size * 0.75}L${size / 2} ${size * 0.25}L${size} ${size * 0.75}" fill="none" stroke="rgb(${primary.r},${primary.g},${primary.b})" stroke-opacity="${primary.alpha}" stroke-width="${Math.max(1, size / 5)}"/>`,
    waves: `<path d="M0 ${size / 2}Q${size / 4} 0 ${size / 2} ${size / 2}T${size} ${size / 2}" fill="none" stroke="rgb(${primary.r},${primary.g},${primary.b})" stroke-opacity="${primary.alpha}" stroke-width="${Math.max(1, size / 6)}"/>`,
  }[layer.pattern];
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><pattern id="p" width="${size}" height="${size}" patternUnits="userSpaceOnUse"><rect width="${size}" height="${size}" fill="rgb(${secondary.r},${secondary.g},${secondary.b})" fill-opacity="${secondary.alpha}"/>${mark}</pattern></defs><rect width="100%" height="100%" fill="url(#p)"/></svg>`,
  );
}

function symbolSvg(layer, width, height) {
  const color = rgbaColor(layer.color, layer.opacity);
  const fill = `fill="rgb(${color.r},${color.g},${color.b})" fill-opacity="${color.alpha}"`;
  const stroke = `stroke="rgb(${color.r},${color.g},${color.b})" stroke-opacity="${color.alpha}"`;
  const mark = {
    star: `<path d="M50 4 61.2 36.1 95.2 36.8 68.1 57.4 78 90 50 70.7 22 90 31.9 57.4 4.8 36.8 38.8 36.1Z" ${fill}/>`,
    crown: `<path d="M10 76 4 25l24 20 22-35 22 35 24-20-6 51ZM12 84h76v10H12Z" ${fill}/>`,
    bolt: `<path d="M57 3 16 57h29l-5 40 44-58H55Z" ${fill}/>`,
    shield: `<path d="M50 4 91 18v29c0 25-17 40-41 49C26 87 9 72 9 47V18Zm0 13L22 27v20c0 17 10 28 28 36 18-8 28-19 28-36V27Z" ${fill}/>`,
    diamond: `<path d="M18 15h64l15 24-47 58L3 39Zm13 13-10 13 29 36 29-36-10-13Z" fill-rule="evenodd" ${fill}/>`,
    laurel: `<path d="M28 88C11 73 6 50 15 27m57 61c17-15 22-38 13-61M18 31 6 22m10 24L2 42m19 19L7 62m23 14-11 8m63-53 12-9m-10 24 14-4M79 61l14 1M70 76l11 8" fill="none" ${stroke} stroke-width="8" stroke-linecap="round"/><circle cx="50" cy="50" r="10" ${fill}/>`,
  }[layer.symbol];
  if (!mark)
    throw new TypeError(`Unsupported Mega Mall symbol ${layer.symbol}.`);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${width}" height="${height}">${mark}</svg>`,
  );
}

async function generatedLayer(layer, width, height) {
  const boxWidth = Math.max(
    1,
    Math.min(width * 4, Math.round(width * layer.transform.scaleX)),
  );
  const heightFactor = layer.type === "text" ? 0.3 : 1;
  const boxHeight = Math.max(
    1,
    Math.min(
      height * 4,
      Math.round(height * layer.transform.scaleY * heightFactor),
    ),
  );
  const source =
    layer.type === "text"
      ? textSvg(layer, boxWidth, boxHeight)
      : layer.type === "symbol"
        ? symbolSvg(layer, boxWidth, boxHeight)
        : patternSvg(layer, boxWidth, boxHeight);
  return sharp(source)
    .rotate(layer.transform.rotation, {
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

async function compositeDescriptor(layer, design, assetsById, width, height) {
  const input = ["image", "emblem"].includes(layer.type)
    ? await rasterAssetLayer(
        layer,
        findOwnedAsset(design, layer, assetsById),
        width,
        height,
      )
    : await generatedLayer(layer, width, height);
  const metadata = await sharp(input).metadata();
  const left = Math.round(
    (width - metadata.width) / 2 + layer.transform.x * width * 0.5,
  );
  const top = Math.round(
    (height - metadata.height) / 2 + layer.transform.y * height * 0.5,
  );
  return {
    input,
    left,
    top,
    blend: BLENDS[layer.blendMode],
  };
}

export async function renderMegaMallSurface({
  design: designInput,
  profile: suppliedProfile,
  surfaceId,
  assets = [],
  previewMaxEdge = 1024,
}) {
  const profile = suppliedProfile || getMegaMallProfile(designInput?.profileId);
  if (!profile) throw new TypeError("Mega Mall profile is not available.");
  const design = normalizeMegaMallDesign(designInput, { profile });
  const surfaceProfile = profile.surfaces.find(
    (surface) => surface.id === surfaceId,
  );
  const surface = design.surfaces.find(
    (candidate) => candidate.surfaceId === surfaceId,
  );
  if (!surfaceProfile || !surface)
    throw new TypeError(`Unknown surface ${surfaceId}.`);
  const layout = outputLayout(profile, surfaceProfile, previewMaxEdge);
  const assetsById = new Map();
  for (const owned of assets) {
    if (!owned?.descriptor?.id || assetsById.has(owned.descriptor.id)) {
      throw new TypeError(
        "Canonical assets contain a missing or duplicate id.",
      );
    }
    assetsById.set(owned.descriptor.id, owned);
  }
  const layers = surface.layers.filter(
    (layer) => layer.visible && layer.opacity > 0,
  );
  const composites = [];
  for (const layer of layers) {
    composites.push(
      await compositeDescriptor(
        layer,
        design,
        assetsById,
        layout.width,
        layout.height,
      ),
    );
  }
  const base = sharp({
    create: {
      width: layout.width,
      height: layout.height,
      channels: 4,
      background: rgbaColor(surface.background),
    },
  });
  const { data, info } = await base
    .composite(composites)
    .toColorspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgba = new Uint8Array(data);
  const png = new Uint8Array(
    await sharp(data, { raw: info })
      .png({ compressionLevel: 9, adaptiveFiltering: false })
      .toBuffer(),
  );
  const recipe = {
    profileId: profile.id,
    designSha256: hashMegaMallDesign(design, { profile }),
    surfaceId,
    width: layout.width,
    height: layout.height,
    layers: layers.map((layer) => layer.id),
    renderer: "sharp-rgba-v1",
  };
  return Object.freeze({
    surfaceId,
    width: layout.width,
    height: layout.height,
    physical: layout.physical,
    rgba,
    png,
    rgbaSha256: `sha256:${sha256Hex(rgba)}`,
    pngSha256: `sha256:${sha256Hex(png)}`,
    recipeSha256: canonicalSha256(recipe),
    diagnostics: Object.freeze({
      layerCount: layers.length,
      assetCount: assetsById.size,
    }),
  });
}

export async function compileMegaMallSurface(input) {
  const profile = input.profile || getMegaMallProfile(input.design?.profileId);
  const surfaceProfile = profile?.surfaces.find(
    (surface) => surface.id === input.surfaceId,
  );
  if (!profile?.installable || !surfaceProfile?.target) {
    throw new TypeError("Mega Mall surface has no verified physical target.");
  }
  const rendered = await renderMegaMallSurface({ ...input, profile });
  const dds = encodeMegaMallDds({
    rgba: rendered.rgba,
    width: rendered.width,
    height: rendered.height,
    format: surfaceProfile.target.format,
    mipLevels: surfaceProfile.target.mipLevels,
  });
  const readback = decodeMegaMallDds(dds);
  if (
    readback.width !== surfaceProfile.target.width ||
    readback.height !== surfaceProfile.target.height ||
    readback.format !== surfaceProfile.target.format ||
    readback.mipLevels !== surfaceProfile.target.mipLevels
  ) {
    throw new TypeError("Mega Mall DDS failed independent layout readback.");
  }
  return Object.freeze({
    ...rendered,
    dds,
    ddsSha256: readback.sha256,
    readback,
    target: surfaceProfile.target,
  });
}

export { createMegaMallMipChain, decodeMegaMallDds, encodeMegaMallDds };
