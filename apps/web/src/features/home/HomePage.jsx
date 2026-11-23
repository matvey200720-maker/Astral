import { useCallback, useMemo } from "react";
import AstralEditorialHome from "../../AstralEditorialHome.jsx";
import { modSizeLabel } from "../catalog/size-estimate.js";
import { coverFor } from "../../utils/catalogMedia.js";

/*
 * Моды главной: каталог и то, что окно добавило само, без повторов — первый
 * по id побеждает. Повтор ищется словарём: поиск по всему списку для каждой
 * карточки на каталоге в тысячи модов (выгрузка Discord) — это миллионы
 * сравнений, полсекунды на каждое обновление каталога.
 */
function dedupeHomeMods(catalogMods, runtimeMods) {
  const sourceMods = [...catalogMods, ...runtimeMods];
  const firstById = new Map();
  sourceMods.forEach((mod) => {
    if (!firstById.has(mod.id)) firstById.set(mod.id, mod);
  });
  return { sourceMods, mods: [...firstById.values()] };
}

/* Размер — на языке окна: без него главная писала «217 КБ» и немцу. Точного нет — примерный по типу мода (`size-estimate.js`). */
function decorateHomeMod(mod, sourceMods, language) {
  const size = modSizeLabel(mod, sourceMods, language);
  return {
    ...mod,
    resolvedCover: coverFor(mod),
    formattedSize: size.text,
    sizeApproximate: size.approximate,
  };
}

function prepareHomeMods(catalogMods, runtimeMods, language = "ru") {
  const { sourceMods, mods } = dedupeHomeMods(catalogMods, runtimeMods);
  return mods.map((mod) => decorateHomeMod(mod, sourceMods, language));
}

/*
 * Главная показывает двадцать модов подборки и баннер, а каталог — тысячи. Подпись размера, адрес обложки и копия объекта нужны только показанным, поэтому
 * здесь все моды лишь сводятся без повторов, а «одевает» их сама витрина (`decorateMod`) уже после выбора подборки. Раньше на старте это были три тысячи
 * копий и три тысячи подписей размера — 77 мс из худшего кадра старта при ×4 (30.10.2026).
 */
export default function HomePage({
  catalogMods = [],
  mods = [],
  language = "ru",
  ...props
}) {
  const home = useMemo(
    () => dedupeHomeMods(catalogMods, mods),
    [catalogMods, mods],
  );
  const decorateMod = useCallback(
    (mod) => decorateHomeMod(mod, home.sourceMods, language),
    [home, language],
  );

  return (
    <AstralEditorialHome
      {...props}
      language={language}
      mods={home.mods}
      decorateMod={decorateMod}
    />
  );
}

export { prepareHomeMods };
