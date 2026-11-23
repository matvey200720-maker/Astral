import { isBranch } from "./format.js";

// Ветки, открытые аккаунту (CHANNELS.md §2, п. 3). Порядок хоста не меняем,
// записи отдаём те же объекты; повтор ветки — остаётся первая запись.
const branchList = (confirmed) => {
  const raw = confirmed?.channels;
  if (!Array.isArray(raw)) return [];
  return raw.reduce(
    (kept, entry) => (isBranch(entry?.channel) && !kept.some((have) => have.channel === entry.channel) ? [...kept, entry] : kept),
    [],
  );
};

// Что показать про выбранную ветку. Размеры и версия сервера годятся только
// его собственной ветке; у другой версия берётся из списка (CHANNELS.md §2, п. 4).
function chosenRelease(confirmed, selected) {
  const available = branchList(confirmed);
  const picked = available.find((entry) => entry.channel === selected);
  if (picked === undefined) {
    return {
      channel: confirmed?.channel ?? null,
      sameAsServer: true,
      version: confirmed?.version ?? null,
      branches: available.length,
    };
  }
  const sameAsServer = picked.channel === confirmed.channel;
  const listed = picked.version;
  const version = (sameAsServer ? (confirmed.version ?? listed) : listed) ?? null;
  return { channel: picked.channel, sameAsServer, version, branches: available.length };
}

export { branchList, chosenRelease };
