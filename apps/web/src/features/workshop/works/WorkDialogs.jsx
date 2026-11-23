import { useEffect, useRef, useState } from "react";
import { FloppyDisk, Plus } from "../../../components/ui/icons.jsx";
import Button from "../../../components/ui/Button.jsx";
import Dialog from "../../../components/ui/Dialog.jsx";
import TextField from "../../../components/ui/TextField.jsx";
import { readClipboardText } from "../../../clipboard.js";
import { findWorkCode } from "./work-code.js";
import { readWorkCode } from "./work-transfer.js";

/*
 * Окна «Моих работ»: сохранить работу, вставить код, показать код.
 *
 * Их зовут и экран «Мои работы», и каждый редактор мастерской — поэтому они
 * здесь, одни на всех, а не по копии в каждом «⋯».
 */

const fill = (template, values) =>
  Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    String(template || ""),
  );

/**
 * Отказ сохранения — словами окна. Слова у сохранения свои: «пусто» при
 * сохранении значит «нечего сохранять», а не «в коде нечего открыть».
 */
export function workSaveErrorText(copy, error) {
  return (
    copy.saveDialog[error?.reason] ||
    String(error?.message || copy.saveDialog.full)
  );
}

/** Отказ разбора или переноса — словами окна. */
export function workErrorText(copy, error) {
  const errors = copy.code.errors;
  const reason = error?.reason;
  if (reason === "wrong-kind")
    return fill(errors["wrong-kind"], {
      kind: copy.kinds[error.kind] || error.kind,
    });
  if (reason === "cloud") return fill(errors.cloud, { code: error.code || "" });
  if (reason === "invalid")
    return fill(errors.invalid, { reason: error.message || "" });
  if (errors[reason]) return errors[reason];
  if (copy.saveDialog[reason]) return copy.saveDialog[reason];
  return String(error?.message || errors.damaged);
}

/**
 * «Сохранить в мои работы».
 *
 * Редактор открыт из сохранённой работы — главная кнопка обновляет её, а
 * «Сохранить как новую» оставляет прежнюю как есть. Не открыт — работа
 * заводится новой под именем из поля.
 */
export function SaveToWorksDialog({
  copy,
  defaultName = "",
  linkedName = "",
  onSave,
  onClose,
}) {
  const text = copy.saveDialog;
  const [name, setName] = useState(linkedName || defaultName);
  const [busy, setBusy] = useState(false);
  const submit = async (asNew) => {
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      const done = await onSave({ name: name.trim(), asNew });
      if (done !== false) onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      className="work-save-dialog"
      size="sm"
      title={text.title}
      titleId="work-save-title"
      closeLabel={copy.cancel}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {copy.cancel}
          </Button>
          {linkedName && (
            <Button
              variant="secondary"
              disabled={busy || !name.trim()}
              onClick={() => void submit(true)}
            >
              {text.asNew}
            </Button>
          )}
          <Button
            variant="primary"
            icon={<FloppyDisk />}
            disabled={busy || !name.trim()}
            onClick={() => void submit(false)}
          >
            {text.save}
          </Button>
        </>
      }
    >
      <TextField
        label={text.name}
        value={name}
        onChange={setName}
        maxLength={120}
        autoFocus
        onFocus={(event) => event.target.select()}
        onKeyDown={(event) => {
          if (event.key === "Enter") void submit(false);
        }}
      />
      {linkedName && (
        <p className="work-dialog-note">
          {fill(text.linkedNote, { name: linkedName })}
        </p>
      )}
    </Dialog>
  );
}

/* Пауза перед разбором: пока человек набирает, окно молчит, и ошибка не
   мигает на каждой букве. Вставленный код разбирается за ту же паузу. */
const CHECK_DELAY_MS = 250;

/** Что с кодом: `ready` с разобранным кодом или `error` с причиной. */
async function checkWorkCode(value, accept) {
  if (!findWorkCode(value))
    return { state: "error", value, error: { reason: "unknown" } };
  try {
    return {
      state: "ready",
      value,
      result: await readWorkCode(value, { accept }),
    };
  } catch (error) {
    return { state: "error", value, error };
  }
}

/** Что из работы в код не вошло (свои картинки) — одной строкой отклика. */
export function workCodeLost(result) {
  return [...new Set((result?.templates || []).map((item) => item.lost))]
    .filter(Boolean)
    .join(" ");
}

/**
 * Вставить код: «Добавить шаблон» в «Моих работах» и «Вставить код» в
 * редакторе.
 *
 * Окно — одно поле и две кнопки (владелец, 24.09.2026): ни заголовка, ни
 * подсказок, ни превью. Главная кнопка горит, только когда код рабочий;
 * нерабочий называет одна строка под полем. Имя работа приносит в коде,
 * переименовать её можно на карточке. В редакторе (`mode: "open"`) окно
 * открывает только коды своего раздела; код другого называет, чей он, и
 * предлагает положить его в «Мои работы».
 */
export function WorkCodeDialog({
  copy,
  mode = "add",
  accept = null,
  confirmLabel = "",
  /* Код, с которым окно открыли (вставка Ctrl+V на экране «Моих работ»). */
  initialCode = "",
  onConfirm,
  onAddToWorks = null,
  onClose,
}) {
  const text = copy.code;
  const [code, setCode] = useState(initialCode);
  const [status, setStatus] = useState({ state: "idle" });
  const [busy, setBusy] = useState(false);
  const acceptKey = accept ? accept.join(",") : "";

  /* Код друга обычно уже в буфере: окно открыли, чтобы его вставить. Чужой
     текст из буфера поле не занимает. */
  useEffect(() => {
    let active = true;
    void readClipboardText().then((clip) => {
      if (!active || !clip || !findWorkCode(clip)) return;
      setCode((current) => current || clip.trim());
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const value = code.trim();
    if (!value) {
      setStatus({ state: "idle" });
      return undefined;
    }
    setStatus({ state: "checking", value });
    let active = true;
    const timer = setTimeout(() => {
      void checkWorkCode(value, acceptKey ? acceptKey.split(",") : null).then(
        (next) => {
          if (active) setStatus(next);
        },
      );
    }, CHECK_DELAY_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [code, acceptKey]);

  const value = code.trim();
  /* Ответ разбора — про то, что сейчас в поле, а не про прежнюю строку. */
  const current = status.value === value ? status : { state: "idle" };
  const error = current.state === "error" ? current.error : null;
  const wrongKind = error?.reason === "wrong-kind";

  const run = async (action) => {
    if (busy) return;
    setBusy(true);
    try {
      const done = await action();
      if (done !== false) onClose();
    } catch (failure) {
      setStatus({ state: "error", value, error: failure });
    } finally {
      setBusy(false);
    }
  };

  /* Enter сразу после вставки паузы разбора не ждёт: код проверяется тут же. */
  const confirm = async () => {
    if (busy || !value) return;
    const checked =
      current.state === "ready"
        ? current
        : await checkWorkCode(value, acceptKey ? acceptKey.split(",") : null);
    if (checked.state !== "ready") {
      setStatus(checked);
      return;
    }
    await run(() => onConfirm({ result: checked.result }));
  };

  return (
    <Dialog
      className="work-code-dialog"
      size="sm"
      ariaLabel={mode === "add" ? text.addTitle : text.openTitle}
      showClose={false}
      closeLabel={copy.cancel}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {copy.cancel}
          </Button>
          {mode === "open" && wrongKind && onAddToWorks && (
            <Button
              variant="secondary"
              icon={<Plus />}
              disabled={busy}
              onClick={() => void run(() => onAddToWorks({ code: value }))}
            >
              {text.addToWorks}
            </Button>
          )}
          <Button
            variant="primary"
            icon={mode === "add" ? <Plus /> : null}
            disabled={busy || current.state !== "ready"}
            onClick={() => void confirm()}
          >
            {confirmLabel || (mode === "add" ? text.add : text.open)}
          </Button>
        </>
      }
    >
      <TextField
        aria-label={text.field}
        value={code}
        onChange={setCode}
        placeholder={text.placeholder}
        spellCheck={false}
        autoComplete="off"
        autoFocus
        /* Код в сотни знаков в поле не помещается и не должен: его не читают,
           а вставляют, и поле прокручивается к курсору. */
        data-audit-ignore="clipped-text"
        /* Однострочное поле само выбрасывает переносы строк, и код, который
           мессенджер разбил на строки, склеивался бы с соседним текстом
           сообщения. Переносы становятся пробелами — их разбор кода знает. */
        onPaste={(event) => {
          const pasted = event.clipboardData?.getData("text") || "";
          if (!/[\r\n]/.test(pasted)) return;
          event.preventDefault();
          const input = event.currentTarget;
          const start = input.selectionStart ?? input.value.length;
          const end = input.selectionEnd ?? input.value.length;
          setCode(
            input.value.slice(0, start) +
              pasted.replace(/\s*[\r\n]+\s*/g, " ").trim() +
              input.value.slice(end),
          );
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          void confirm();
        }}
        error={error ? workErrorText(copy, error) : null}
      />
    </Dialog>
  );
}

/**
 * Код, который буфер не принял: он виден целиком и выделен — человек
 * копирует его сам. Кнопка копирования без запасного пути была бы мёртвой.
 */
export function ManualCodeDialog({ copy, code, onClose }) {
  const fieldRef = useRef(null);
  useEffect(() => {
    fieldRef.current?.select();
  }, []);
  return (
    <Dialog
      className="work-code-dialog"
      size="md"
      title={copy.code.manualTitle}
      titleId="work-manual-code-title"
      description={copy.code.copyFailed}
      closeLabel={copy.cancel}
      onClose={onClose}
      actions={
        <Button variant="primary" onClick={onClose}>
          {copy.code.done}
        </Button>
      }
    >
      <TextField
        label={copy.code.field}
        value={code}
        multiline
        rows={5}
        mono
        readOnly
        spellCheck={false}
        /* См. поле кода в окне вставки: код прокручивается, а не прячется. */
        data-audit-ignore="clipped-text"
        inputRef={fieldRef}
        onFocus={(event) => event.target.select()}
      />
    </Dialog>
  );
}
