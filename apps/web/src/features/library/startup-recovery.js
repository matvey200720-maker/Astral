import { useEffect, useRef } from "react";
import { desktopHost, takeStartupRecovery } from "../../api.js";
import { useMinimapFilmRepair } from "../workshop/install-queue/minimap-film-check.js";

// Всплывашка о том, что старт доделал сам (Т-12, 29.09.2026, d214dfd5e): прерванное удаление
// из «Библиотеки» и сеанс игры без модов (Vanilla Guard). Сбой важнее удачи, показывается одно.
// Таблицы тонов и текстов объявлены ниже, после кода: они нужны только при вызове.
// Флаг итога vanilla есть у какой-либо записи; не массив и записи не объекты флага не дают.
const flagged = (records, flag) => Array.isArray(records) && records.some((r) => r?.[flag]);

export function startupRecoveryNotices(report, language = "ru") {
  const records = report?.vanilla;
  // Итог vanilla: сбой побеждает возврат модов.
  const outcome = flagged(records, "failed")
    ? "vanillaFailed"
    : flagged(records, "resumed") && "vanillaResumed";
  const words = TEXT[language] ?? TEXT.en;
  return [report?.library, outcome]
    .filter((key) => TONE[key])
    .sort((a, b) => (TONE[b] === "error") - (TONE[a] === "error"))
    .map((key) => ({ text: words[key], tone: TONE[key] }));
}

// Ответ не отменяется при снятии компонента; любой сбой (отказ вопроса, бросающий или
// отсутствующий notify) глотается вызывающим: отчёт не должен ломать старт.
async function relay(slot) {
  const [first] = startupRecoveryNotices(await takeStartupRecovery(), slot.props.language);
  if (first) slot.props.notify(first.text, first.tone);
}

export function useStartupRecovery(props) {
  // Проверка «фильма мини-карты» (01.11.2026, 5913d51f4) — ещё одно дело, которое старт делает сам.
  useMinimapFilmRepair({ active: props.active, notify: props.notify });
  const slot = useRef({});
  // Один вопрос за жизнь компонента, когда оболочка загружена и аккаунт есть. Свежие props
  // (язык и notify) читаются в момент ответа, а не вопроса.
  useEffect(() => {
    slot.current.props = props;
    if (props.active && !slot.current.asked) {
      slot.current.asked = true;
      relay(slot.current).catch(() => {});
    }
  });
  // Страж регистрации DLC одежды (13.11.2026): вернул стёртую снаружи регистрацию — окно говорит один раз. Логика и слова грузятся лениво: стартовый кусок держит бюджет.
  useEffect(() => {
    if (!props.active) return undefined;
    let alive = true;
    let stop = () => {};
    import("./clothing-registration-notice.js")
      .then(({ watchClothingRegistration }) => {
        if (alive) stop = watchClothingRegistration(desktopHost(), () => slot.current.props);
      })
      .catch(() => {});
    return () => {
      alive = false;
      stop();
    };
  }, [props.active]);
}

// Тексты живут здесь, а не в locales/ui-text: язык приходит аргументом. Шесть языков с 29.10.2026
// (dae63f52b), французский на «vous»; неразрывный пробел записан escape, а не самим символом.
// Ключ library и итог vanilla ведут в одну таблицу; значения zip идут в порядке KEYS.
const KEYS = ["vanillaResumed", "rolled-back", "vanillaFailed", "committed", "failed", "partial"];
const zip = (values) => Object.fromEntries(KEYS.map((key, i) => [key, values[i]]));

// Обычные объекты без проверки собственных ключей: имена из прототипа (toString, constructor)
// считаются известными и дают странное уведомление. Так было, главный процесс их не шлёт.
const TONE = zip(["info", "info", "error", "info", "error", "info"]);
const TEXT = Object.fromEntries([
  [
    "en",
    zip([
      "The session without mods was interrupted — Astral put the mods back",
      "Removal from the Library was interrupted when Astral closed — the game was put back as it was",
      "After playing without mods, Astral could not bring the mods back. Do not start GTA V and restart Astral — it will try again",
      "Removal from the Library, interrupted when Astral closed, has been finished",
      "Could not finish the removal interrupted when Astral closed. Do not start GTA V and restart Astral — it will try again",
      "Removal stopped halfway when Astral closed: some mods are already gone. What is still in the game is shown in the Library",
    ]),
  ],
  [
    "fr",
    zip([
      "La session de jeu sans mods a été interrompue — Astral a remis les mods en place",
      "La suppression depuis la Bibliothèque a été interrompue à la fermeture d’Astral — le jeu a été remis comme avant",
      "Après une partie sans mods, Astral n’a pas pu remettre les mods en place. Ne lancez pas GTA V et redémarrez Astral — il réessaiera",
      "La suppression depuis la Bibliothèque, interrompue par la fermeture d’Astral, est terminée",
      "Impossible de terminer la suppression interrompue par la fermeture d’Astral. Ne lancez pas GTA V et redémarrez Astral — il réessaiera",
      "La suppression s’est arrêtée en cours de route à la fermeture d’Astral\u00a0: certains mods ont déjà été retirés. Ce qui reste dans le jeu se trouve dans la Bibliothèque",
    ]),
  ],
  [
    "de",
    zip([
      "Die Sitzung ohne Mods wurde unterbrochen — Astral hat die Mods zurückgebracht",
      "Das Entfernen aus der Bibliothek wurde unterbrochen, als Astral geschlossen wurde — das Spiel ist wieder wie vorher",
      "Nach dem Spielen ohne Mods konnte Astral die Mods nicht zurückholen. Starte GTA V nicht und starte Astral neu — es versucht es noch einmal",
      "Das Entfernen aus der Bibliothek, das durch das Schließen von Astral unterbrochen wurde, ist abgeschlossen",
      "Das unterbrochene Entfernen ließ sich nicht abschließen. Starte GTA V nicht und starte Astral neu — es versucht es noch einmal",
      "Das Entfernen brach mittendrin ab, als Astral geschlossen wurde: Ein Teil der Mods ist schon weg. Was noch im Spiel ist, steht in der Bibliothek",
    ]),
  ],
  [
    "pl",
    zip([
      "Sesja gry bez modów została przerwana — Astral przywrócił mody na miejsce",
      "Usuwanie z Biblioteki przerwało się, gdy Astral został zamknięty — gra wróciła do poprzedniego stanu",
      "Po grze bez modów Astral nie zdołał przywrócić modów. Nie uruchamiaj GTA V i uruchom ponownie Astral — spróbuje jeszcze raz",
      "Usuwanie z Biblioteki, przerwane zamknięciem Astral, zostało dokończone",
      "Nie udało się dokończyć usuwania przerwanego zamknięciem Astral. Nie uruchamiaj GTA V i uruchom ponownie Astral — spróbuje jeszcze raz",
      "Usuwanie przerwało się w połowie, gdy Astral został zamknięty: część modów już zdjęto. Co zostało w grze — w Bibliotece",
    ]),
  ],
  [
    "ru",
    zip([
      "Сеанс игры без модов прервался — Astral вернул моды на место",
      "Удаление из «Библиотеки» прервалось, когда Astral закрылся, — игра возвращена как было",
      "После игры без модов Astral не смог вернуть моды. Не запускайте GTA V и перезапустите Astral — он попробует снова",
      "Удаление из «Библиотеки», прерванное закрытием Astral, доделано",
      "Не удалось доделать удаление, прерванное закрытием Astral. Не запускайте GTA V и перезапустите Astral — он попробует снова",
      "Удаление прервалось на середине, когда Astral закрылся: часть модов уже снята. Что осталось в игре — в «Библиотеке»",
    ]),
  ],
  [
    "uk",
    zip([
      "Сеанс гри без модів перервався — Astral повернув моди на місце",
      "Видалення з «Бібліотеки» перервалося, коли Astral закрився, — гру повернуто як було",
      "Після гри без модів Astral не зміг повернути моди. Не запускайте GTA V і перезапустіть Astral — він спробує знову",
      "Видалення з «Бібліотеки», перерване закриттям Astral, завершено",
      "Не вдалося завершити видалення, перерване закриттям Astral. Не запускайте GTA V і перезапустіть Astral — він спробує знову",
      "Видалення перервалося посередині, коли Astral закрився: частину модів уже знято. Що залишилося в грі — у «Бібліотеці»",
    ]),
  ],
]);
