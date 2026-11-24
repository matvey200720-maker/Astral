import { useEffect, useRef, useState } from "react";
import SegmentedControl from "../../ui/SegmentedControl.jsx";
import { getRpPlace, setRpPlace } from "../../../api.js";
import { useTr } from "../../../locales/ui.js";
import { rpPlaceWords } from "./rp-place-words.js";

/*
 * Строка «Где играю» (23.11.2026, слово владельца «да, так»; настройки → GTA V): GTA 5 RP / Majestic / только сюжет. Главный процесс по выбору включает или выключает режим RP (`rp-place.js`, `rp-mode-channel.js`):
 * при двух клиентах, пока человек не выбрал, режим включён сам. Плашек и пояснений нет — только строка и три сегмента (решение владельца через лида 1). Не вышло записать выбор — сегменты остаются прежними.
 * Вне приложения (нет моста) и в сборке без режима (dev) строки нет.
 */

export default function RpPlaceRow() {
  useTr();
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);

  const saving = useRef(false);

  /* Выбор читается при открытии и при возврате фокуса в окно: второе окно приложения могло сменить его, а вид этого окна остался бы прежним. Пока идёт своя запись, чужой ответ не берётся (он мог выйти раньше). */
  useEffect(() => {
    let alive = true;
    const load = () =>
      getRpPlace().then(
        (answer) => alive && !saving.current && setView(answer && typeof answer === "object" ? answer : null),
        () => {},
      );
    load();
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      window.removeEventListener("focus", load);
    };
  }, []);

  if (!view?.available) return null;

  const choose = async (place) => {
    if (busy) return;
    setBusy(true);
    saving.current = true;
    try {
      if (view.place === place) {
        /* Тот же выбор, что показан: прежде чем счесть клик повтором, спросить главный процесс — другое окно могло записать иное, и клик по прежнему значению тогда нужен. */
        const current = await getRpPlace().catch(() => null);
        if (!current || current.place === place) {
          if (current) setView(current);
          return;
        }
      }
      setView(await setRpPlace(place));
    } catch {
      /* не записалось — выбор остаётся прежним */
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const words = rpPlaceWords({ view });
  return (
    <div className="settings-row" data-setting="rp-place" data-state={view.place || "auto"}>
      <span className="settings-row-copy">
        <b>{words.title}</b>
        {words.notes.map((note) => (
          <small key={note} role="status">
            {note}
          </small>
        ))}
      </span>
      <span className="settings-row-control">
        <SegmentedControl size="sm" label={words.title} options={words.options} value={words.shown} disabled={busy} onChange={choose} />
      </span>
    </div>
  );
}
