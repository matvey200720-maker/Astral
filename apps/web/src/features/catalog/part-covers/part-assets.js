import { inflateSync } from "fflate";
import { encodePng } from "@modovik/gfx";
import { reticleWorkshopCoverPng } from "@modovik/reticle-pack/workshop-cover";
import { mapPackCover } from "@modovik/vector-map";
import { decodeNamedTexture, readTextureDictionary } from "@modovik/rage-drawable";

// Настройки чтения для соседей. Они зовут распаковщик и с объявленным
// размером; fflate принял бы его за свои настройки, поэтому передаётся один аргумент.
const unpacking = () => ({ inflateRaw: (packed) => inflateSync(packed) });

const pngOfRaster = ({ rgba, width, height }) => encodePng(rgba, width, height, 4);

const whenPresent = (value, build) => (value ? build(value) : null);

// Текстура рамки урона со своими пикселями или ничего.
const overlayTexture = (dictionary) => {
  const texture = decodeNamedTexture("dmg_overlay_fade", [dictionary]);
  return texture?.rgba?.length ? texture : null;
};

export const reticleCoverPng = (bytes) => reticleWorkshopCoverPng(bytes);

export const damageOverlayPng = (bytes) =>
  whenPresent(overlayTexture(readTextureDictionary(bytes, unpacking())), pngOfRaster);

export const mapMosaicPng = (files) =>
  whenPresent(mapPackCover(files === undefined ? [] : files, unpacking()), (cover) => ({
    png: pngOfRaster(cover),
    width: cover.width,
    height: cover.height,
  }));
