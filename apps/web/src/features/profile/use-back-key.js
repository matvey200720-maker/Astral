import { useEffect } from "react";

/*
 * Backspace — «назад» на странице профиля, открытой из Настроек (владелец, 16.11.2026: «должна быть стрелочка хотя бы слева в углу, чтобы вернуться в настройки»): к стрелке и Escape
 * (`DetailTopbar.jsx`) добавлена клавиша, как у браузера. Не срабатывает в поле ввода, с Ctrl, Alt и Meta, под окном поверх страницы и когда клавишу уже взял другой.
 */

// Окно поверх страницы: диалог или подложка внутри оверлейного хоста (тот же признак, что у Escape в `DetailTopbar.jsx`).
const WINDOW_OPEN =
  "[role='dialog'], .desktop-overlay-host [role='presentation']";
const TEXT_FIELD = /^(INPUT|TEXTAREA|SELECT)$/;

export const isTextTarget = (target) =>
  Boolean(target) &&
  (target.isContentEditable || TEXT_FIELD.test(target.tagName || ""));

export default function useBackKey(onBack) {
  useEffect(() => {
    if (!onBack) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== "Backspace" || event.defaultPrevented) return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (isTextTarget(event.target) || document.querySelector(WINDOW_OPEN))
        return;
      event.preventDefault();
      onBack();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onBack]);
}
