import "./component-pick.css";
import Button from "../../ui/Button.jsx";
import { CaretLeft } from "../../ui/icons.jsx";
import { placeOfSlot } from "../../../features/catalog/bundles/component-places.js";
import { packContentsCopy } from "../../../features/catalog/pack-contents-copy.js";
import { pencilCopy } from "../../../features/catalog/pencil-copy.js";
import { useTr } from "../../../locales/ui.js";

/*
 * Верх каталога «через карандаш» (чистовой набор 2, 15.11.2026, `card-final2-catalog-from-part`): человек нажал карандаш у части редукса и попал на раздел этой части. Тут нет меню
 * разделов, поиска, сортировки и «Избранного»: только «← Назад к «<редукс>»», заголовок раздела и «меняем часть «<вид>»». Категорию отсюда не сменить. Щелчок по карточке подставляет её
 * вместо части (`PublicCatalog` → `component-pick.js`), «Назад» возвращает на страницу мода без изменений. Вид называется словом окна «Компоненты» (`packContentsCopy().kinds`),
 * название редукса и раздела — как есть. Едет по нужде, пока запрос выбора есть.
 */

/**
 * @param {{ request: { slot: string, bundleName: string }, language: string, title: string, onCancel: () => void }} props
 */
export default function ComponentPickBar({
  request,
  language,
  title,
  onCancel,
}) {
  useTr();
  /* Слово вида — как у записи в окне «Компоненты»; у слота без своего слова (`reticle`, `blood-effects`) — слово его полки. */
  const { kinds } = packContentsCopy(language);
  const kind =
    kinds[request.slot] ||
    kinds[placeOfSlot(request.slot)?.editor] ||
    request.slot;
  const words = pencilCopy(language);
  return (
    <section className="pencil-head" aria-label={words.replacing(kind)}>
      <Button
        variant="secondary"
        size="md"
        className="pencil-back"
        icon={<CaretLeft weight="bold" />}
        onClick={onCancel}
      >
        <span data-no-translate="">{words.back(request.bundleName)}</span>
      </Button>
      <h1>{title}</h1>
      <p>
        <span data-no-translate="">{words.replacing(kind)}</span>
      </p>
    </section>
  );
}
