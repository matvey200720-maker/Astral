import { unsupportedMinimapFeatures } from "@modovik/minimap-contract";
import { tr, useTr } from "../../../locales/ui.js";

/*
 * «Только в предпросмотре» (ТЗ H1, 14.11.2026): то, что человек сделал в мастерской мини-карты, а в игру не уйдёт, помечено
 * ДО «Применить», а не после, в ответе установки (`install-queue/tasks/minimap.js`). Что именно не уходит, знает контракт
 * (`unsupportedMinimapFeatures`) — это же перечисляет компилятор.
 */

/** Слова для ключей контракта; читаются при показе, на языке окна. */
export function previewOnlyLabel(key) {
  switch (key) {
    case "bar-style":
      return tr("свой фон и скругление полос");
    case "vitals-animation":
      return tr("градиент и пульс полосы HP");
    case "player-tag":
      return tr("подпись под картой");
    case "transparent-background":
      return tr("прозрачный фон карты");
    default:
      return key;
  }
}

/** Что из проекта (`config`) в игру не уйдёт: ключи контракта. Слова к ним — `previewOnlyLabel`, при показе. */
export function previewOnlyKeys(config) {
  return unsupportedMinimapFeatures(config);
}

/** Метка рядом с элементом, которого в игре не будет. */
export function PreviewOnlyMark({ className = "" }) {
  useTr();
  return (
    <small
      className={`gs-preview-only${className ? ` ${className}` : ""}`}
      title={tr("В игру не уйдёт: Astral ставит мини-карту без этого")}
    >
      {tr("только в предпросмотре")}
    </small>
  );
}

/** Строка с перечнем: метка и слова. Пусто, если в игру уходит всё. */
export function PreviewOnlyList({ keys }) {
  useTr();
  if (!keys?.length) return null;
  return (
    <>
      <PreviewOnlyMark /> {keys.map(previewOnlyLabel).join(" · ")}
    </>
  );
}
