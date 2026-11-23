import { useEffect, useState } from "react";
import Button from "../../components/ui/Button.jsx";
import { readForeignConflicts, setForeignChoices } from "../../api.js";

/*
 * «Оставить своё или заменить» — вопрос о сборке человека (задача 1 ТЗ
 * 07.10.2026).
 *
 * Установка из мастерской или каталога упёрлась в файлы игры, которые у
 * человека уже правит другой мод (редукс через OpenIV, своя мини-карта).
 * Движок ничего не записал и ждёт решения; список спорных файлов он
 * оставил рядом с состоянием, окно берёт его отдельным вопросом — ошибка
 * через Electron доходит одной строкой. Решение — на каждый файл: оно
 * помнится, и та же работа второй раз не спрашивает. «Оставить своё» —
 * файл не трогается, остальное ставится; «Заменить» — ставится поверх, а
 * снятие работы вернёт файл человека.
 */

/* Отказ — этот вопрос: по началу строки движка (`foreign-entries.js`). */
export const isForeignBuildFailure = (text) =>
  String(text || "").includes("В твоей сборке уже изменены");

const COPY = {
  ru: {
    label: "Файлы твоей сборки",
    lead: "Их уже меняет другой мод. Оставить как есть или поставить поверх работу Astral? Снятие работы вернёт твои файлы.",
    more: (count) => `и ещё ${count}`,
    keep: "Оставить своё",
    replace: "Заменить",
    together: "Ответ на этот вопрос общий для всех частей сборки — дай его в первой строке выше, он подойдёт и этой части.",
  },
  uk: {
    label: "Файли твоєї збірки",
    lead: "Їх уже змінює інший мод. Залишити як є чи поставити поверх роботу Astral? Зняття роботи поверне твої файли.",
    more: (count) => `і ще ${count}`,
    keep: "Залишити своє",
    replace: "Замінити",
    together: "Відповідь на це запитання спільна для всіх частин збірки — дай її в першому рядку вище, вона підійде й цій частині.",
  },
  en: {
    label: "Files of your build",
    lead: "Another mod already changes them. Keep them as they are or put the Astral work on top? Removing the work brings your files back.",
    more: (count) => `and ${count} more`,
    keep: "Keep mine",
    replace: "Replace",
    together: "One answer covers every part of this bundle — give it in the first row above and it applies to this part too.",
  },
  de: {
    label: "Dateien deiner Spielversion",
    lead: "Ein anderer Mod ändert sie bereits. Behalten oder die Astral-Arbeit darüberlegen? Entfernst du die Arbeit, kommen deine Dateien zurück.",
    more: (count) => `und ${count} weitere`,
    keep: "Meine behalten",
    replace: "Ersetzen",
    together: "Die Antwort gilt für alle Teile dieses Pakets — gib sie in der ersten Zeile oben, dann gilt sie auch für diesen Teil.",
  },
  pl: {
    label: "Pliki twojej wersji gry",
    lead: "Zmienia je już inny mod. Zostawić je czy położyć na nich pracę Astral? Usunięcie pracy przywróci twoje pliki.",
    more: (count) => `i jeszcze ${count}`,
    keep: "Zostaw moje",
    replace: "Zamień",
    together: "Jedna odpowiedź obejmuje wszystkie części tego zestawu — udziel jej w pierwszym wierszu powyżej, a obejmie też tę część.",
  },
  fr: {
    label: "Fichiers de votre build",
    lead: "Un autre mod les modifie déjà. Les garder tels quels ou appliquer le travail d’Astral par-dessus\u00a0? Retirer ce travail restaurera vos fichiers.",
    more: (count) => `et ${count} ${count === 0 || count === 1 ? "autre" : "autres"}`,
    keep: "Garder les miens",
    replace: "Remplacer",
    together: "Une seule réponse vaut pour toutes les parties de ce build — donnez-la dans la première ligne ci-dessus, elle s’applique aussi à cette partie.",
  },
};

const SHOWN = 6;

/* Строка части сборки, которая не отвечает сама: ответ общий и даётся в первой строке сборки (`foreign-hold.js`). */
export const foreignFollowerNote = (language = "ru") => (COPY[language] || COPY.en).together;

/*
 * `conflicts` и `targetId` — свои у строки: движок хранит один список на всё приложение, и следующий отказ его перепишет. Строка сборки получает их при отказе
 * (`foreign-hold.js`), а список сборки — общий у её ждущих частей. Без них вопрос читает последний список сам, как работы мастерской и редакторы.
 */
export default function ForeignBuildChoice({ language = "ru", onDecided, conflicts: given = null, targetId: givenTarget = null }) {
  const copy = COPY[language] || COPY.en;
  const own = Array.isArray(given);
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (own) return undefined;
    let alive = true;
    readForeignConflicts()
      .then((value) => {
        if (alive) setPending(value);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [own]);
  const conflicts = own ? given : pending?.conflicts || [];
  const targetId = own ? givenTarget : pending?.targetId;
  if (!conflicts.length) return null;
  const decide = async (choice) => {
    setBusy(true);
    setError("");
    try {
      await setForeignChoices({
        targetId,
        choices: conflicts.map((item) => ({ ...item, choice })),
      });
      onDecided?.(choice);
    } catch (failure) {
      setError(String(failure?.message || failure));
      setBusy(false);
    }
  };
  return (
    <section className="foreign-build-choice" aria-label={copy.label}>
      <p>{copy.lead}</p>
      <ul>
        {conflicts.slice(0, SHOWN).map((item) => (
          <li key={`${item.archive}|${item.entry}`} title={item.entry}>
            {item.entry.split("/").pop()}
          </li>
        ))}
        {conflicts.length > SHOWN && <li>{copy.more(conflicts.length - SHOWN)}</li>}
      </ul>
      <div className="foreign-build-actions">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => decide("keep")}>
          {copy.keep}
        </Button>
        <Button size="sm" variant="primary" disabled={busy} onClick={() => decide("replace")}>
          {copy.replace}
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
