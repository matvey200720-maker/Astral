import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import Button from "../../../components/ui/Button.jsx";
import Dialog from "../../../components/ui/Dialog.jsx";
import TextField from "../../../components/ui/TextField.jsx";
import { hasDesktopBridge, listSystemFonts, readSystemFont } from "../../../api.js";
import { tr, useTr } from "../../../locales/ui.js";
import { saveEmblemFont } from "./emblem-fonts.js";

/*
 * Откуда берётся свой шрифт — один орган на всю мастерскую (ТЗ 23.10.2026, п. F: «свои шрифты везде»).
 *
 * Две кнопки: «Загрузить свой (.ttf / .otf / .woff2)» — файл человека — и «Из установленных на ПК» — список шрифтов
 * системы (Astral Desktop: главный процесс отдаёт названия и читает файл по номеру из списка, `system-fonts.js`).
 * Оба пути кончаются одним: файл ложится в хранилище окна как свой шрифт (`saveEmblemFont`), и редактор получает
 * `{ fontAsset, fontName }` — то же, что раньше давал только выбор файла. Поэтому шрифт из списка и шрифт из файла
 * везде одинаково живут на этом компьютере и одинаково доходят до холста, а значит — до картинки в игре.
 *
 * `onFont({ fontAsset, fontName })` — редактор кладёт шрифт в свою правку; `onNotice(text, tone)` — если файл не
 * читается. Размещение — по месту: ряд кнопок можно поставить под любым списком шрифтов. `rows` — те же два пути строками
 * карточки (`ActionRows`), а не серыми кнопками без вида (четвёртый круг критика 31.10.2026, расписание): строка «Из
 * установленных» есть, только когда список компьютера доступен.
 */

const FONT_ACCEPT = ".ttf,.otf,.woff,.woff2";
const MIME = { ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2" };

/*
 * Окно со списком шрифтов компьютера. Свой путь к файлу — у мест, где шрифты ведёт не `saveEmblemFont` (шрифты большой
 * карты лежат в проекте): им нужен сам файл — `installedFontFile(item)`.
 */
export function InstalledFonts({ onClose, onPick }) {
  useTr();
  const [fonts, setFonts] = useState(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    let alive = true;
    listSystemFonts()
      .then((list) => alive && setFonts(list))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (fonts || []).filter((item) => !needle || String(item.name).toLowerCase().includes(needle));
  }, [fonts, query]);
  return (
    <Dialog open onClose={onClose} title={tr("Шрифты на этом компьютере")} description={tr("Выберите шрифт — он станет вашим шрифтом в Astral и останется на этом компьютере.")} size="sm">
      <TextField label={tr("Найти шрифт")} value={query} onChange={setQuery} placeholder={tr("Название")} autoFocus />
      <div className="font-installed" role="list" aria-label={tr("Установленные шрифты")}>
        {failed ? <p className="fx-hint">{tr("Список шрифтов не прочитался.")}</p> : null}
        {!failed && fonts === null ? <p className="fx-hint">{tr("Читаем список шрифтов…")}</p> : null}
        {fonts && !shown.length ? <p className="fx-hint">{fonts.length ? tr("Таких шрифтов нет.") : tr("Установленные шрифты не нашлись.")}</p> : null}
        {shown.map((item) => (
          <div key={item.id} role="listitem">
            <button type="button" className="font-installed-row" onClick={() => onPick(item)}>
              <span data-audit-ignore="caps type-min">{item.name}</span>
            </button>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

/** Файл выбранного шрифта из списка компьютера: `File` с именем и типом, как у файла, что выбрал человек. */
export async function installedFontFile(item) {
  const font = await readSystemFont(item.id);
  return new File([font.data], `${font.name}${font.extension}`, { type: MIME[font.extension] || "font/ttf" });
}

/*
 * Те же две кнопки, но результат — сам файл шрифта (`File`), а не ключ хранилища окна: для мест, где шрифты ведёт
 * не `saveEmblemFont`, а свой реестр (шрифты большой карты лежат в ассетах проекта). Файл человека или файл из списка
 * компьютера приходят одинаково — `onFile(file)`.
 */
export function FontFileSources({ onFile, onNotice = null, className = "" }) {
  useTr();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [listing, setListing] = useState(false);
  const desktop = hasDesktopBridge();
  const take = async (read) => {
    setBusy(true);
    try {
      await onFile(await read());
    } catch (error) {
      onNotice?.(String(error?.message || error), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={FONT_ACCEPT}
        hidden
        aria-label={tr("Файл своего шрифта")}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void take(async () => file);
        }}
      />
      <div className={`recolor-actions font-sources${className ? ` ${className}` : ""}`}>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? tr("Читаем шрифт…") : tr("Загрузить свой (.ttf / .otf / .woff2)")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || !desktop}
          title={desktop ? undefined : tr("Шрифты компьютера доступны в Astral Desktop")}
          onClick={() => setListing(true)}
        >
          {tr("Из установленных на ПК")}
        </Button>
      </div>
      {listing && (
        <InstalledFonts
          onClose={() => setListing(false)}
          onPick={(item) => {
            setListing(false);
            void take(() => installedFontFile(item));
          }}
        />
      )}
    </>
  );
}

export default function FontSources({ onFont, onNotice = null, className = "", rows = false }) {
  useTr();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [listing, setListing] = useState(false);
  const desktop = hasDesktopBridge();

  const take = useCallback(
    async (read) => {
      setBusy(true);
      try {
        onFont(await read());
      } catch (error) {
        onNotice?.(String(error?.message || error), "error");
      } finally {
        setBusy(false);
      }
    },
    [onFont, onNotice],
  );

  const fromFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void take(() => saveEmblemFont(file));
  };

  const fromList = (item) => {
    setListing(false);
    void take(async () => {
      const file = await installedFontFile(item);
      const saved = await saveEmblemFont(file);
      return { ...saved, fontName: item.name.slice(0, 60) };
    });
  };

  return (
    <>
      <input ref={input} type="file" accept={FONT_ACCEPT} hidden onChange={fromFile} aria-label={tr("Файл своего шрифта")} />
      {rows ? (
        <ActionRows
          className={className}
          label={tr("Свой шрифт")}
          actions={[
            { id: "font-file", label: busy ? tr("Читаем шрифт…") : tr("Загрузить свой (.ttf / .otf / .woff2)"), onClick: () => !busy && input.current?.click() },
            desktop && { id: "font-installed", label: tr("Из установленных на ПК"), onClick: () => !busy && setListing(true) },
          ]}
        />
      ) : (
        <div className={`recolor-actions font-sources${className ? ` ${className}` : ""}`}>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? tr("Читаем шрифт…") : tr("Загрузить свой (.ttf / .otf / .woff2)")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !desktop}
            title={desktop ? undefined : tr("Шрифты компьютера доступны в Astral Desktop")}
            onClick={() => setListing(true)}
          >
            {tr("Из установленных на ПК")}
          </Button>
        </div>
      )}
      {listing && <InstalledFonts onClose={() => setListing(false)} onPick={fromList} />}
    </>
  );
}
