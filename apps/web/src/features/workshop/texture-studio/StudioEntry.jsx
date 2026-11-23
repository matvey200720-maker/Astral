/*
 * Вход в студию текстур из редактора (ТЗ 18.10.2026, Session 1, задача 6):
 * кнопка «Студия» там, где поверхность правится картинкой. Студия — большой
 * кусок (рисование, фильтры, 3D-вид), поэтому грузится только по нажатию.
 * Поверхность описывает редактор (`getSurface`: что за холст, откуда основа,
 * куда ставить), он же принимает итог (`onPlace`).
 */

import { lazy, Suspense, useState } from "react";
import { PaintBrush } from "../../../components/ui/icons.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import { tr, useTr } from "../../../locales/ui.js";

const TextureStudio = lazy(() => import("./TextureStudio.jsx"));

/**
 * `getSurface()` — описание поверхности (`TextureStudio.jsx`) или `Promise` с
 * ним; `onPlace(blob, meta)` → `{ asset }`; `onClosed({ placed })` — студию
 * закрыли.
 */
export default function StudioEntry({ getSurface, onPlace, onClosed = null, onNotice = null, label = "", caption = "", disabled = false, className = "" }) {
  useTr();
  const [surface, setSurface] = useState(null);
  const [busy, setBusy] = useState(false);
  async function open() {
    if (busy) return;
    setBusy(true);
    try {
      setSurface(await getSurface());
    } catch (error) {
      onNotice?.(String(error?.message || error), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {/*
        Строкой «значок · Студия · что там ›», как строки «Большой карты»
        (18.10.2026, владелец: «везде кнопка эта плохо смотрится»): маленькая
        кнопка висела одна под списком и читалась случайной. Имя для читалки —
        само слово, подпись — пояснение под ним.
      */}
      <NavRow
        className={`studio-entry${className ? ` ${className}` : ""}`}
        icon={<PaintBrush />}
        title={busy ? tr("Открываем студию…") : label || tr("Студия")}
        caption={caption || tr("Нарисовать своё: кисть, слои, текст")}
        aria-label={busy ? tr("Открываем студию…") : label || tr("Студия")}
        disabled={disabled || busy}
        onOpen={open}
      />
      {surface && (
        <Suspense fallback={null}>
          <TextureStudio
            open
            surface={surface}
            onPlace={onPlace}
            onNotice={(text) => onNotice?.(text)}
            onClose={(result) => {
              setSurface(null);
              onClosed?.(result);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
