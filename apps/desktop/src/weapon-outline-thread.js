import * as zlib from "node:zlib";
import * as gameWeapon from "@modovik/gunpack/game-weapon";
import * as weaponShape from "@modovik/gunpack/weapon-outline";

export const OUTLINE_SIZE = 768;

const TEXTURE_LIMIT = 256;

// Сырой deflate; обрыв потока не ошибка: берём то, что успело распаковаться.
const inflateRaw = ({ buffer, byteOffset, byteLength }) => {
  const plain = zlib.inflateRawSync(Buffer.from(buffer, byteOffset, byteLength), {
    finishFlush: zlib.constants.Z_SYNC_FLUSH,
  });
  return new Uint8Array(plain);
};

export function gameWeaponOutline(files, parts = []) {
  const readerOptions = { inflateRaw, maxTexture: TEXTURE_LIMIT };
  readerOptions.parts = parts;
  const model = gameWeapon.gameWeaponModel(files, readerOptions);
  const shapeOptions = {};
  shapeOptions.size = OUTLINE_SIZE;
  return weaponShape.weaponOutline(model.drawable, shapeOptions);
}
