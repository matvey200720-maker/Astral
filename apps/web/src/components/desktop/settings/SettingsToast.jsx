import Button from "../../ui/Button.jsx";
import { Check } from "../../ui/icons.jsx";
import { useEffect, useMemo, useRef, useState } from "react";

export const TOAST_MS = 5000;

// Запасной язык стоит первым: чужой язык читается как en (индекс 0).
const LANGUAGES = ["en", "ru", "uk", "de", "pl", "fr"];
const SAVED_WORDS = [
  "Saved",
  "Сохранено",
  "Збережено",
  "Gespeichert",
  "Zapisano",
  "Enregistré",
];
const UNDO_WORDS = [
  "Undo",
  "Отменить",
  "Скасувати",
  "Rückgängig",
  "Cofnij",
  "Annuler",
];

const wordsFor = (language) => {
  const slot = Math.max(LANGUAGES.indexOf(language), 0);
  return { saved: SAVED_WORDS[slot], undo: UNDO_WORDS[slot] };
};

// Сначала откат, затем сообщение владельцу, что плашку можно убрать.
function revert(toast, onHide) {
  toast.undo();
  onHide();
}

const UNDO_LOOK = { size: "sm", variant: "ghost" };

const UndoButton = ({ label, onPress }) => (
  <Button {...UNDO_LOOK} onClick={onPress}>
    {label}
  </Button>
);

// Смена ключа пересоздаёт плашку, поэтому ключ стоит на рамке, а не на её содержимом.
const ToastFrame = ({ children }) => (
  <div className="settings-toast" role="status">
    {children}
  </div>
);

const SettingsToast = (props) => {
  const { toast, language, onHide } = props;
  if (!toast) return null;

  const { id, text, undo } = toast;
  const words = wordsFor(language);

  return (
    <ToastFrame key={id}>
      <Check aria-hidden="true" />
      <span data-audit-ignore="type-scale">{text || words.saved}</span>
      {undo ? (
        <UndoButton label={words.undo} onPress={() => revert(toast, onHide)} />
      ) : null}
    </ToastFrame>
  );
};

// Действия плашки; setToast и ссылка на таймер стабильны, поэтому набор создаётся один раз.
function createToastActions(setToast, handle) {
  const dismiss = () => setToast(null);
  const stopTimer = () => {
    const pending = handle.current;
    handle.current = null;
    window.clearTimeout(pending);
  };
  const expire = () => {
    handle.current = null;
    dismiss();
  };
  const armTimer = () => {
    handle.current = window.setTimeout(expire, TOAST_MS);
  };

  return {
    hide() {
      stopTimer();
      dismiss();
    },
    saved(undo = null, text = null) {
      if (handle.current !== null) stopTimer();
      const fresh = { id: Date.now(), undo, text };
      setToast(fresh);
      armTimer();
    },
  };
}

// Таймер плашки лежит в ссылке. Уход страницы (размонтирование или скрытие: окно настроек после закрытия
// остаётся смонтированным под `Activity mode="hidden"`, которая гасит эффекты) снимает таймер, поэтому
// вместе с ним уходит и сама плашка: иначе она оставалась без таймера и висела при возврате.
function useToastActions(setToast) {
  const handle = useRef(null);

  useEffect(() => {
    const leave = () => {
      window.clearTimeout(handle.current);
      handle.current = null;
      setToast(null);
    };
    return leave;
  }, [setToast]);

  return useMemo(() => createToastActions(setToast, handle), [setToast]);
}

export const useSettingsToast = () => {
  const [toast, setToast] = useState(null);
  const { saved, hide } = useToastActions(setToast);

  return { toast, saved, hide };
};

export default SettingsToast;
