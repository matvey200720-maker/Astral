import { useEffect, useRef, useState } from "react";

/*
 * «Код сборки скопирован» — плашка внизу страницы «Сборки»: показывается 2,2 с, уходит 0,28 с (`builds-copy-toast`).
 * Вынесено из `BuildsPage.jsx`, когда страница упёрлась в потолок размера файла (ТЗ 23.10, п. K).
 */
const VISIBLE_MS = 2200;
const LEAVING_MS = 280;

export function useCopiedBuildToast() {
  const [copiedBuildId, setCopiedBuildId] = useState("");
  const [copyToastLeaving, setCopyToastLeaving] = useState(false);
  const timerRef = useRef(null);
  const exitTimerRef = useRef(null);

  useEffect(
    () => () => {
      window.clearTimeout(timerRef.current);
      window.clearTimeout(exitTimerRef.current);
    },
    [],
  );

  function showCopiedBuild(profileId) {
    window.clearTimeout(timerRef.current);
    window.clearTimeout(exitTimerRef.current);
    setCopyToastLeaving(false);
    setCopiedBuildId(profileId);
    timerRef.current = window.setTimeout(() => {
      setCopyToastLeaving(true);
      exitTimerRef.current = window.setTimeout(() => {
        setCopiedBuildId("");
        setCopyToastLeaving(false);
      }, LEAVING_MS);
    }, VISIBLE_MS);
  }

  return { copiedBuildId, copyToastLeaving, showCopiedBuild };
}
