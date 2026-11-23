/*
 * Ворота догрузки: холсты после правки догружают картинки и печатают наклейки (`useGunSurfaces`), а запекание для игры должно видеть результат. `track` — новая догрузка, `settled` — кончилась последняя, даже если
 * пока ждали, началась ещё одна. `busy` — идёт ли догрузка прямо сейчас. Сбой догрузки воротам не мешает: у неё свои слова.
 */
export function createSyncGate() {
  let last = Promise.resolve();
  let pending = 0;
  return {
    track(work) {
      pending += 1;
      last = Promise.resolve(work)
        .catch(() => {})
        .finally(() => {
          pending -= 1;
        });
      return work;
    },
    busy: () => pending > 0,
    async settled() {
      let seen;
      do {
        seen = last;
        await seen;
      } while (seen !== last);
    },
  };
}
