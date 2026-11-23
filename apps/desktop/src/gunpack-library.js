const GONE_TEXT = "The previous native gunpack library is gone: connect the gunpack through My packs.";

// Аргументы не читаются: у всех трёх функций нет параметров.
const refuse = async () => {
  throw new Error(GONE_TEXT);
};

export const listGunpacks = async () => ({ packs: [] });

export const importGunpack = async () => refuse();

export const readGunpackModel = async () => refuse();
