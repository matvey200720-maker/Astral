import { useMemo, useRef, useState } from "react";
import { tr, useTr } from "../../../locales/ui.js";
import Button from "../../ui/Button.jsx";
import { encodePortableBuild } from "../../../features/builds/portable-code.js";
import { Check, ClipboardText, Copy, LinkSimple } from "../../ui/icons.jsx";

/*
 * «Билет» с кодом сборки (дизайн 15.11.2026, макет builds-B-open): сверху окошко с кодом, пунктир с двумя вырезами, снизу «Скопировать код»
 * и вставка чужого кода.
 *
 * В окошке — настоящий код сборки. Короткий адрес (`ASTRAL-…`) сервер выдаёт при копировании, поэтому до копирования здесь начало полного
 * кода, а после — тот адрес, что лёг в буфер (`shownCode`). Длинный код целиком в разметку не кладётся: он бывает в сотни тысяч знаков.
 * Вставка чужого кода открывает «Новая сборка → По коду» с этим кодом: состав покажется до того, как что-то создастся.
 */

const SHOWN = 22;

// Полный код сборки; не собрался — пусто, окошко скажет об этом словами.
function portableCodeOf(build) {
  try {
    return String(build.code || encodePortableBuild(build));
  } catch {
    return "";
  }
}

const shortened = (code) =>
  code.length > SHOWN + 2 ? `${code.slice(0, SHOWN)}…` : code;

async function readClipboard() {
  try {
    return String((await globalThis.navigator?.clipboard?.readText?.()) ?? "");
  } catch {
    return "";
  }
}

export default function BuildOpenTicket({
  build,
  copy,
  copied,
  shownCode = "",
  onCopy,
  onPasteCode,
}) {
  useTr();
  const [pasted, setPasted] = useState("");
  const field = useRef(null);
  const code = useMemo(
    () => shownCode || portableCodeOf(build),
    [shownCode, build],
  );

  const submit = (text) => {
    const value = text.trim();
    if (!value) return;
    setPasted("");
    onPasteCode?.(value);
  };
  // «Вставить»: есть набранное — читаем его, пусто — берём из буфера обмена; буфер не дался — ставим курсор в поле.
  const paste = async () => {
    if (pasted.trim()) return submit(pasted);
    const text = await readClipboard();
    if (text.trim()) return submit(text);
    field.current?.focus();
  };

  return (
    <aside className="builds-ticket" aria-label={copy.codeLabel}>
      <div className="builds-ticket-top">
        <h2>{copy.codeLabel}</h2>
        <div className="builds-ticket-code" data-built-code="">
          {code ? shortened(code) : "—"}
        </div>
      </div>
      <div className="builds-ticket-perf" aria-hidden="true" />
      <div className="builds-ticket-bottom">
        <Button
          variant="primary"
          size="lg"
          block
          className="builds-ticket-copy"
          icon={
            copied ? (
              <i className="builds-ticket-tick" aria-hidden="true">
                <Check weight="bold" />
              </i>
            ) : (
              <Copy aria-hidden="true" />
            )
          }
          onClick={() => onCopy(build)}
        >
          {copied ? tr("Код скопирован") : copy.copyCode}
        </Button>
        <p>
          {tr(
            "Отправьте код другу — он увидит состав и поставит такую же сборку.",
          )}
        </p>
        <div className="builds-ticket-paste">
          <label className="builds-ticket-field">
            <LinkSimple aria-hidden="true" />
            <input
              ref={field}
              type="text"
              value={pasted}
              placeholder={tr("Вставить чужой код")}
              aria-label={tr("Вставить чужой код")}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setPasted(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit(pasted);
              }}
            />
          </label>
          <Button
            variant="secondary"
            icon={<ClipboardText aria-hidden="true" />}
            onClick={paste}
          >
            {tr("Вставить")}
          </Button>
        </div>
      </div>
    </aside>
  );
}
