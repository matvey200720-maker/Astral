/*
 * Точки отката общими кусками, а не полными копиями (задача 5 ТЗ 10.10.2026).
 *
 * Каждое «Применить» нативного редактора (мини-карта, прицел, небо, эффекты,
 * фонари…) кладёт в точку отката полную копию update.rpf — два гигабайта. С
 * 31.10.2026 в ту же кладовую уходят и основы со сборками движка, а сам механизм
 * — общий: `@modovik/install-engine/chunk-store.js`. Здесь — точка отката: опись
 * `update.rpf.chunks.json` рядом с бывшей копией, перемотка (`rewindArchive`)
 * читает архив из кусков и сверяет тот же отпечаток «до», хост получает файл
 * собранным заново (`materializeRestoreCopy`).
 */

import { writesStore } from "@modovik/install-engine/operation-scope.js";
import {
  CHUNKS_FOLDER,
  PACKED_SUFFIX,
  chunkStoreSize,
  packFile,
  packGaveUp,
  packedManifestPath,
  packedReadStream,
  readPackedManifest,
  sweepChunks as sweepStore,
  thawFile,
  writePackedFile,
} from "@modovik/install-engine/chunk-store.js";

export { CHUNKS_FOLDER, PACKED_SUFFIX, chunkStoreSize, packGaveUp, packedManifestPath, packedReadStream, readPackedManifest, writePackedFile };

/**
 * Упаковать копию точки: куски — в кладовую, рядом — опись, копия — прочь.
 * `expectedSha256` — отпечаток «до» из `restore.json`: копию, которая с ним не
 * совпала, не трогаем; копия уходит только после того, как архив, собранный
 * обратно из кладовой, совпал с ним (`packFile`).
 */
export const packRestoreCopy = writesStore(({ backupPath, expectedSha256, chunksRoot, isBusy, pace }) =>
  packFile({ file: backupPath, expectedSha256, chunksRoot, isBusy, pace }),
);

/** Файл копии из кусков на её прежнем месте — для хоста, который читает точку сам. */
export const materializeRestoreCopy = writesStore(async ({ backupPath, chunksRoot }) => ({
  materialized: await thawFile(backupPath, { chunksRoot }),
}));

export const sweepChunks = writesStore(sweepStore);
