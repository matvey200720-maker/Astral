import { useMemo } from "react";
import {
  buildBlockReason,
  catalogStateOf,
  openedBuildMods,
  useModFaces,
  useModNames,
} from "../../../features/builds/build-mods.js";
import { indexById, mergeLibrary, toSet } from "./build-lists.js";

// Библиотека модов для расчётов: записи по id, недоступность и состояние каталога.
export function useLibrary(input) {
  const { catalogMods, libraryMods, installed, profiles, catalogConnection } = input;
  const availableMods = useMemo(function merged() {
    return mergeLibrary(catalogMods, libraryMods);
  }, [catalogMods, libraryMods]);
  const modsById = useMemo(function byId() {
    return indexById(availableMods);
  }, [availableMods]);
  const installedIds = useMemo(function installedSet() {
    return toSet(installed);
  }, [installed]);
  const catalogState = catalogStateOf(catalogConnection);
  const namesInput = [profiles, modsById];
  const facesInput = [profiles, installed, modsById];
  const names = useModNames(...namesInput);
  const faces = useModFaces(...facesInput);

  // Причина, по которой мод не встанет: у стоящего в игре её нет.
  const blockOf = useMemo(
    () =>
      function blockReasonOf(id) {
        if (installedIds.has(id)) return "";
        return buildBlockReason(modsById.get(id), catalogState);
      },
    [installedIds, modsById, catalogState],
  );
  const entriesOf = useMemo(
    () =>
      function entriesFor(ids) {
        return openedBuildMods(ids, { modsById, names, faces, catalogState });
      },
    [modsById, names, faces, catalogState],
  );

  return { availableMods, modsById, installedIds, catalogState, blockOf, entriesOf };
}
