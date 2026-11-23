import { useEffect, useMemo, useState } from "react";
import { tr } from "../../locales/ui.js";
import { catalogIdsOf } from "../library/my-mods.js";
import { findWorkCode } from "../workshop/works/work-code.js";
import { expandWorkCode, isBuildCodeText } from "../workshop/works/work-code-share.js";
import { decodePortableBuild } from "./portable-code.js";

const NO_ENTRIES = [];

/*
 * Что во вкладке «По коду» на самом деле (владелец 01.11.2026): вставленный текст или, если это короткий код
 * `ASTRAL-…`, запись с сервера. Разбор сборки синхронный и идёт по готовой строке: всё, что ниже, — плитки, цифры,
 * отметки — видит полный код и не знает, откуда он взялся.
 *
 * `{ code, loading, problem, whenReady }`: `code` — полный код (пусто, пока запись едет или если её не достать),
 * `problem` — что сказать под полем. `whenReady(notify)` — для «Прочитать код»: отдаёт полный код или, сказав почему,
 * `null`. Запись не скачалась — повторная попытка уже здесь: кнопка не должна оставаться мёртвой, пока сервер лежал.
 */
export function useBuildCodeText(importCode) {
  const found = useMemo(() => findWorkCode(importCode), [importCode]);
  const short = found?.format === "short" ? found.code : "";
  const [read, setRead] = useState({ short: "", code: "", problem: "" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!short) return undefined;
    let active = true;
    expandWorkCode(short).then(
      (code) => {
        if (!active) return;
        setRead({
          short,
          code: isBuildCodeText(code) ? code : "",
          problem: isBuildCodeText(code) ? "" : tr("Это код работы мастерской: вставьте его в «Моих работах»."),
        });
      },
      (error) => {
        if (active) setRead({ short, code: "", problem: String(error?.message || error) });
      },
    );
    return () => {
      active = false;
    };
  }, [short, attempt]);
  if (!short) return { code: importCode, loading: false, problem: "", whenReady: async () => importCode.trim() };
  const settled = read.short === short && !read.pending;
  const loading = !settled;
  return {
    code: settled ? read.code : "",
    loading,
    problem: settled ? read.problem : "",
    whenReady: async (notify) => {
      if (settled && read.code) return read.code;
      if (loading) {
        notify(tr("Код загружается с сервера…"));
        return null;
      }
      notify(read.problem, "error");
      setRead({ ...read, pending: true });
      setAttempt((value) => value + 1);
      return null;
    },
  };
}

/*
 * Что в коде, который вставили во вкладку «По коду» (ТЗ 23.10, п. K): код читается тут же, без сервера, и моды из него —
 * записями сборки (`entriesOf`: найденные в каталоге и заготовки) — идут в плитки и цифры «В коде сборки» до «Прочитать
 * код». Не код сборки или пусто — `[]`: слова об этом скажет сама «Прочитать код».
 */
export function useBuildImportPreview({ importCode, entriesOf, modsById }) {
  const pasted = useMemo(
    () => (importCode.trim() ? decodePortableBuild(importCode) : null),
    [importCode],
  );
  return pasted ? entriesOf(catalogIdsOf(pasted.modIds, modsById)) : NO_ENTRIES;
}

/*
 * Работы мастерской из того же кода (ТЗ 24.10.2026, вечер, п. C): «По коду» показывает их плитками рядом с модами, и у тех,
 * что встанут вместо ваших, — жёлтое «!». Записи — как у открытой сборки (`{ name, workKind, slotId, section, code }`).
 */
export function useBuildImportWorks({ importCode }) {
  return useMemo(
    () => (importCode.trim() ? decodePortableBuild(importCode)?.works || NO_ENTRIES : NO_ENTRIES),
    [importCode],
  );
}
