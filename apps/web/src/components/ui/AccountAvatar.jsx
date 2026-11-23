import { createElement as h, useState } from "react";

const NO_NAME_MARK = "•";

const firstLetter = (word) => String.fromCodePoint(word.codePointAt(0));

// Первые буквы (кодовые точки) первых двух слов; слов нет — запасной знак.
export const accountInitials = (name) => {
  const words = String(name ?? "").split(/\s+/).filter(Boolean);
  return words.length === 0 ? NO_NAME_MARK : words.slice(0, 2).map(firstLetter).join("").toLocaleUpperCase();
};

const lettersNode = (account) => h("span", { className: "account-mark-letters" }, accountInitials(account?.displayName || account?.name));

const pictureNode = (source, giveUp) =>
  h("img", { alt: "", referrerPolicy: "no-referrer", decoding: "async", draggable: false, src: source, onError: () => giveUp(source) });

export default function AccountAvatar({ account, size = "md", className = "" }) {
  const [lastFailed, setLastFailed] = useState("");
  const address = account?.avatarUrl;
  const source = typeof address === "string" ? address : "";
  const withPicture = source !== "" && source !== lastFailed;
  const shell = {
    className: ["account-mark", className].filter(Boolean).join(" "),
    "data-size": size,
    "data-state": withPicture ? "image" : "initials",
    "aria-hidden": "true",
  };
  return h("span", shell, withPicture ? pictureNode(source, setLastFailed) : lettersNode(account));
}
