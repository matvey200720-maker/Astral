import PreviewWindow from "./PreviewWindow.jsx";
import { previewKindOfMod } from "./preview-entry.js";

/*
 * Полный предпросмотр мода целиком (Каталог 2.0, предпросмотр, круг 2): `<ModPreviewWindow mod={mod} language onClose />`. Заголовок — имя мода, вид — по файлам его пакета
 * (`previewKindOfMod`); у мода без предпросмотра не рисует ничего. Окно то же, что у части (`PreviewWindow`): файлы читаются по открытию, в игру ничего не пишется.
 */
export default function ModPreviewWindow({
  mod,
  language,
  poster = "",
  onClose,
}) {
  const kind = previewKindOfMod(mod);
  if (!kind) return null;
  return (
    <PreviewWindow
      title={mod.name}
      kind={kind}
      part={mod}
      language={language}
      poster={poster}
      onClose={onClose}
    />
  );
}
