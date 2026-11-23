import { useEffect, useRef, useState } from "react";
import { Check, LinkSimple } from "../../ui/icons.jsx";
import Button from "../../ui/Button.jsx";
import { getCloudModLink } from "../../../api.js";
import { cloudCatalogIDPattern } from "../../../catalog-utils.js";
import { copyText } from "../../../clipboard.js";
import { writeWindowLog } from "../../../features/app-errors/report.js";

/*
 * «Скопировать ссылку» на странице мода (Т-29; ТЗ 29.10.2026, п. 5).
 *
 * Модами делятся в Discord, а `astral://mods/<id>` он ссылкой не делает —
 * только http(s). Поэтому в буфер уходит адрес сайта облака
 * `https://<облако>/mods?mod=<id>`: сайт показывает мод и «Открыть в
 * Astral», а Astral по `astral://mods/<id>` открывается сразу на этом моде
 * (`apps/desktop/src/deep-link.js`). Ссылку собирает Astral Desktop — адрес
 * облака знает он. Кнопка есть только у мода облачного каталога: у локального
 * на сайте страницы нет. Ответ — на самой кнопке и в живой области.
 *
 * Кнопка не должна быть мёртвой (владелец, 29.10.2026: «Не удалось
 * скопировать ссылку»). Что делает путь надёжным: ссылку не получил Desktop
 * (старый мост без метода, сбой канала) — адрес сайта собирается здесь из
 * известного адреса; в буфер кладёт главный процесс (`clipboard.js`), а если и
 * это не вышло, на месте кнопки встаёт поле со ссылкой — выделенной, «скопируйте
 * вручную». Каждый сбой на пути — строка в «Логах» (`share`: этап и причина),
 * чтобы следующий отчёт был с причиной, а не со словами «не работает».
 */

const SETTLE_MS = 2400;
const MANUAL_MS = 15_000;

/* Адрес сайта облака: сборка под другое облако переназначает его переменной окружения. */
const SITE_ORIGIN = import.meta.env?.VITE_MODOVIK_SITE_URL || "https://astral-mods.online";

/** Ссылка на мод, когда Desktop её не дал: тот же вид, что у `modLink` главного процесса. */
export const fallbackModLink = (modId, origin = SITE_ORIGIN) => {
  const target = new URL("/mods", origin);
  target.searchParams.set("mod", modId);
  return target.toString();
};

const reason = (error) => String(error?.message ?? error ?? "").slice(0, 300);

export default function ModShareLink({ modId, copy, manualMs = MANUAL_MS, compact = false }) {
  const [state, setState] = useState("idle");
  const [manual, setManual] = useState("");
  const timer = useRef(0);
  const field = useRef(null);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    setState("idle");
    setManual("");
  }, [modId]);
  useEffect(() => {
    if (manual) field.current?.select();
  }, [manual]);
  if (!cloudCatalogIDPattern.test(modId || "")) return null;

  async function share() {
    let url = "";
    const problems = [];
    try {
      url = String((await getCloudModLink(modId))?.url || "");
      if (!url) problems.push("ссылка: Desktop ответил пустым адресом");
    } catch (error) {
      problems.push(`ссылка: ${reason(error)}`);
    }
    if (!url) url = fallbackModLink(modId);
    let copied = false;
    try {
      copied = await copyText(url);
    } catch (error) {
      problems.push(`буфер: ${reason(error)}`);
    }
    if (!copied && !problems.some((line) => line.startsWith("буфер"))) problems.push("буфер: ни один способ не сработал");
    if (problems.length)
      writeWindowLog({
        level: copied ? "warn" : "error",
        source: "share",
        message: `Скопировать ссылку: ${copied ? "вышло не сразу" : "не вышло"} (${problems.join("; ")})`,
        detail: `мод ${modId}\nссылка ${url}`,
      });
    setState(copied ? "copied" : "failed");
    setManual(copied ? "" : url);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(
      () => {
        setState("idle");
        setManual("");
      },
      copied ? SETTLE_MS : manualMs,
    );
  }

  if (manual)
    return (
      <span className="redux-product-share is-manual" role="group" aria-label={copy.linkManual || copy.linkFailed}>
        <input
          ref={field}
          className="redux-product-share-field"
          type="text"
          readOnly
          value={manual}
          aria-label={copy.linkField || copy.copyLink}
          title={copy.linkManual || copy.linkFailed}
          onFocus={(event) => event.currentTarget.select()}
        />
        <span className="redux-product-share-note" aria-live="polite">
          {copy.linkManual || copy.linkFailed}
        </span>
      </span>
    );

  const label =
    state === "copied"
      ? copy.linkCopied
      : state === "failed"
        ? copy.linkFailed
        : copy.copyLink;
  /* В шапке страницы-галереи ссылка — квадрат со значком, как соседние кнопки; слово — имя кнопки и подсказка, ответ («Ссылка скопирована») читается с экрана. */
  if (compact)
    return (
      <Button
        className="redux-product-share xw-icon xw-share"
        variant="secondary"
        size="sm"
        icon={state === "copied" ? <Check /> : <LinkSimple />}
        ariaLabel={label}
        title={label}
        onClick={() => void share()}
      />
    );
  return (
    <Button
      className="redux-product-share"
      variant="ghost"
      size="sm"
      icon={state === "copied" ? <Check /> : <LinkSimple />}
      onClick={() => void share()}
    >
      <span aria-live="polite">{label}</span>
    </Button>
  );
}
