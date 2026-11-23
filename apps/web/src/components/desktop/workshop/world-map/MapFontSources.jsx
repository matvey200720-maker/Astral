import { useEffect, useRef, useState } from "react";
import { FontFileSources } from "../../../../features/workshop/emblem/FontSources.jsx";
import { humanFailure } from "../../../../utils/installFailure.js";
import { useMapFonts } from "./MapFontsContext.jsx";

/*
 * «Загрузить свой» и «Из установленных на ПК» под списком шрифтов подписи. Файл становится ассетом проекта (он же —
 * шрифт всех подписей карты), и `onPick("custom:<id>")` ставит его на то место, откуда человек пришёл.
 *
 * Выбор ждёт, пока проект с новым ассетом вернётся в окно (список шрифтов узнал о файле): правка подписи строится на
 * проекте окна в этот момент, и поставленная сразу она стёрла бы только что добавленный файл. Без окна, что умеет
 * добавлять файлы (тесты, просмотр), кнопок нет.
 */
export default function MapFontSources({ onPick }) {
  const { fonts, addFont } = useMapFonts();
  const [problem, setProblem] = useState("");
  const [pending, setPending] = useState("");
  const pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => {
    if (!pending || !fonts.some((font) => `custom:${font.id}` === pending)) return;
    setPending("");
    pick.current(pending);
  }, [pending, fonts]);
  if (!addFont) return null;
  return (
    <>
      <FontFileSources
        onFile={async (file) => {
          setProblem("");
          const asset = await addFont(file);
          if (asset) setPending(`custom:${asset.id}`);
        }}
        onNotice={(message) => setProblem(humanFailure(message))}
      />
      {problem && (
        <small className="wmc-hint" role="alert">
          {problem}
        </small>
      )}
    </>
  );
}
