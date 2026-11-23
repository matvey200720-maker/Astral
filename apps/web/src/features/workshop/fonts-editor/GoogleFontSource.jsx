import { GOOGLE_FONTS_URL, fontFromGoogle } from "./google-fonts.js";
import Button from "../../../components/ui/Button.jsx";
import { ArrowSquareOut } from "../../../components/ui/icons.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import TextField from "../../../components/ui/TextField.jsx";
import { createElement as h, useState } from "react";

const NEW_TAB = [GOOGLE_FONTS_URL, "_blank", "noopener,noreferrer"];

// Покой: ничего не качается, в поле — текст последней ошибки (или пусто).
const calm = (error = "") => ({ loading: false, error });

// В приложении каталог открывает мост, в браузере — новая вкладка.
const showCatalog = () => {
  if (window.modovik?.openExternal) window.modovik.openExternal(GOOGLE_FONTS_URL);
  else window.open(...NEW_TAB);
};

const useFontDownload = (busy, onFile) => {
  const [link, setLink] = useState("");
  const [{ loading, error }, setState] = useState(() => calm());
  const working = busy || loading;

  const add = () => {
    if (!link.trim() || working) return undefined;
    setState({ loading: true, error: "" });
    const download = async () => {
      const file = await fontFromGoogle(link);
      setLink("");
      setState(calm());
      await onFile(file);
    };
    return download().catch((failure) => setState(calm(failure?.message || String(failure))));
  };

  return { link, setLink, loading, error, working, add };
};

const GoogleFontSource = ({ busy, onFile }) => {
  useTr();
  const { link, setLink, loading, error, working, add } = useFontDownload(busy, onFile);
  const addLabel = tr("Добавить");

  const field = {
    label: tr("Шрифт с Google Fonts"),
    placeholder: tr("Ссылка или название — например, Russo One"),
    value: link,
    onChange: setLink,
    spellCheck: false,
    onKeyDown: ({ key }) => {
      if (key === "Enter") add();
    },
    error: error || null,
    hint: error ? null : tr("Откройте каталог, выберите шрифт и вставьте ссылку со страницы шрифта — Astral скачает его сам"),
  };

  const buttons = [
    { variant: "secondary", disabled: !link.trim() || working, onClick: add, text: loading ? tr("Скачиваю…") : addLabel },
    { variant: "ghost", icon: h(ArrowSquareOut), onClick: showCatalog, text: tr("Открыть Google Fonts") },
  ];

  return h(
    "div",
    { className: "fonts-google" },
    h(TextField, field),
    h(
      "div",
      { className: "fonts-google-actions" },
      buttons.map(({ text, ...props }, slot) => h(Button, { key: slot, size: "sm", ...props }, text)),
    ),
  );
};

export default GoogleFontSource;
