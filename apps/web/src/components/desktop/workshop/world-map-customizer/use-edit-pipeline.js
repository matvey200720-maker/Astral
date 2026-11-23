// Единственный выход правок: накопитель цвета подложки и правка раздела.
import { useMemo } from "react";
import { useSettledColourPatch } from "../world-map/use-settled-colour.js";

// Родитель получает копию проекта целиком; свойство по умолчанию пустое
class PatchRelay {
  constructor(onPatch) {
    this.onPatch = onPatch;
    this.relay = this.relay.bind(this);
  }

  relay(next, label, property = "") {
    return this.onPatch({ ...next }, label, property);
  }
}

export function useEditPipeline({ config, onPatch }) {
  const { apply, settling } = useSettledColourPatch(
    useMemo(() => new PatchRelay(onPatch).relay, [onPatch]),
    config,
  );
  // правка раздела: заменённый раздел поверх прежнего проекта
  const onSection = useMemo(
    () => (patch, ...rest) => apply(Object.assign({}, config, patch), ...rest),
    [apply, config],
  );

  return { apply, settling, onSection };
}
