/*
 * Раздел «Инструменты».
 *
 * Правка архивов GTA V невозможна без ArchiveFix и набора ключей. Astral качает
 * их сам — с закреплённого адреса, с побайтовой сверкой, — но делал это молча и
 * внутри первой установки: человек нажимал «Применить в игру» и получал
 * полсотни мегабайт скачивания вместо правки. Здесь та же поставка названа
 * вслух и вынесена вперёд: видно, что уже готово, чего нет, сколько это весит и
 * куда легло.
 *
 * Кнопка одна и на весь набор. «Докачать только этот файл» здесь не бывает:
 * поставка сверяет набор целиком и сама решает, что тянуть, — второй способ
 * добыть те же файлы разошёлся бы с первым в первый же день.
 */

import { useCallback, useEffect, useState } from "react";
import {
  ArrowClockwise,
  DownloadSimple,
  FolderOpen,
  Info,
  SealCheck,
} from "../../ui/icons.jsx";
import Button from "../../ui/Button.jsx";
import {
  provisionWorkshopTools,
  readWorkshopTools,
  revealWorkshopTools,
  sanitizeDesktopErrorMessage,
  workshopToolsSupported,
} from "../../../api.js";
import { toolsCopyFor } from "./tools-copy.js";

/* Ступенька появления. Набор приходит ответом настольного моста: тот читает
   семь файлов и считает у них SHA-256, панель к этому времени давно собрана, а
   ответ приходит разом — куском в полтысячи пикселей. Чтобы список выезжал, а
   не возникал, каждая строка несёт свой номер в очереди; шаг между строками и
   всё остальное движение выбирает settings-motion.css — там лежит вся
   хореография настроек.

   Глубже десятой ступеньки лестница не растёт: набор задан в коде и вдвое
   вырасти не может, но если однажды вырастет — низ списка не должен ждать
   верх лишние полсекунды. */
const QUEUE_LIMIT = 9;
const place = (index) => Math.min(index, QUEUE_LIMIT);

export default function ToolsPanel({ language = "ru" }) {
  const copy = toolsCopyFor(language);
  const supported = workshopToolsSupported();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!supported) return;
    try {
      setStatus(await readWorkshopTools());
      setError("");
    } catch (nextError) {
      setError(sanitizeDesktopErrorMessage(nextError));
    }
  }, [supported]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const provision = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setStatus(await provisionWorkshopTools());
    } catch (nextError) {
      /* Сперва перечитать состояние, потом сказать про беду: поставка могла
         упасть на середине набора, и список обязан остаться правдой. Порядок
         важен — успешное чтение гасит прежнюю ошибку, и сообщение о провале,
         поставленное раньше, стёрлось бы вместе с ней. */
      await refresh();
      setError(sanitizeDesktopErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  };

  if (!supported)
    return (
      <section
        className="settings-tools"
        aria-labelledby="settings-tools-title"
      >
        <header className="settings-tools-head">
          <h2 id="settings-tools-title">{copy.title}</h2>
        </header>
        <p className="settings-tools-notice" role="note">
          <Info weight="bold" />
          <span>{copy.browserOnly}</span>
        </p>
      </section>
    );

  const tools = status?.tools || [];
  const ready = Boolean(status?.ready);

  return (
    <section
      className="settings-tools"
      aria-labelledby="settings-tools-title"
      data-setting="toolkit"
    >
      <header className="settings-tools-head">
        <div>
          <h2 id="settings-tools-title">{copy.title}</h2>
          <p>{copy.lede}</p>
        </div>
        <Button
          icon={ready ? <ArrowClockwise /> : <DownloadSimple />}
          disabled={busy}
          onClick={provision}
        >
          {/* Размер называется только когда он известен: до ответа моста
              пустота округлялась до «1 КБ», и кнопка успевала пообещать
              килобайт вместо полусотни мегабайт. */}
          {busy
            ? copy.busy
            : ready
              ? copy.recheck
              : status?.missingBytes
                ? `${copy.prepare} · ${copy.size(status.missingBytes)}`
                : copy.prepare}
        </Button>
      </header>

      {status && (
        <p
          className={`settings-tools-state${ready ? " is-ready" : ""}`}
          role="status"
        >
          {ready ? <SealCheck weight="fill" /> : <Info weight="bold" />}
          <span>
            {ready
              ? copy.ready(
                  copy.fileCount(tools.length),
                  copy.size(status.totalBytes),
                )
              : copy.missing(
                  copy.size(status.missingBytes),
                  copy.size(status.totalBytes),
                )}
          </span>
        </p>
      )}

      {/* Пустого списка не бывает: пока ответа нет, рамка вокруг ничего —
          обещание, которое неизвестно, чем закончится. */}
      {tools.length > 0 && (
        <ul className="settings-tools-list">
          {tools.map((tool, index) => {
            const { title, detail } = copy.describe(tool);
            return (
              <li
                key={tool.name}
                className={tool.ready ? "is-ready" : ""}
                data-state={tool.state}
                style={{ "--tools-row": place(index) }}
              >
                <div>
                  <b>{title}</b>
                  <small>{detail}</small>
                </div>
                <span className="settings-tools-size">
                  {copy.size(tool.size)}
                </span>
                <em>{copy.state[tool.state] || tool.state}</em>
              </li>
            );
          })}
        </ul>
      )}

      {status?.directory && (
        <div className="settings-tools-path">
          <code>{status.directory}</code>
          <Button
            variant="ghost"
            size="sm"
            icon={<FolderOpen />}
            onClick={() =>
              void revealWorkshopTools().catch((nextError) =>
                setError(sanitizeDesktopErrorMessage(nextError)),
              )
            }
          >
            {copy.openFolder}
          </Button>
        </div>
      )}

      {error && (
        <p className="settings-tools-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
