import { inflateRawNode, keysFromDirectory, openRpf } from "@modovik/rpf7/node";

export const createRpfReader = async ({ keysDirectory = null } = {}) => {
  const keys = keysDirectory ? await keysFromDirectory(keysDirectory) : null;
  const withKeys = keys ? { keys } : {};
  return function openArchive(source, { name } = {}) {
    return openRpf(source, { name, ...withKeys, inflateRaw: inflateRawNode });
  };
};
