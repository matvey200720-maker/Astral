import { useCallback, useEffect, useState } from "react";
import { ArrowCounterClockwise } from "../../components/ui/icons.jsx";
import {
  MOUSE_SETTINGS,
  MOUSE_VALUE_MAX,
  MOUSE_VALUE_MIN,
  mouseBelowMenu,
} from "@modovik/optimizer/mouse.js";
import {
  applyMouseSettings,
  hasGameSettingsBridge,
  readMouseSettings,
  restoreMouseSettings,
  sanitizeDesktopErrorMessage,
} from "../../api.js";
import Button from "../../components/ui/Button.jsx";
import Slider from "../../components/ui/Slider.jsx";
import { useTr } from "../../locales/ui.js";

/*
 * Мышь в «Открыть и подстроить» (ТЗ 29.10.2026, круг 6): чувствительность
 * ниже нижней строки меню GTA V. Числа лежат в профиле игры
 * (`pc_settings.bin`, 754 и 755), а не в шаблоне, поэтому раздел пишется своей
 * кнопкой и возвращается своей — «Применить в игре» вверху его не трогает.
 *
 * Игра принимает число из файла, а меню показывает только часть шкалы;
 * ползунок идёт от 1 до 100, а всё, что меньше нижней строки меню
 * (`MOUSE_MENU_MIN`), помечено «ниже меню игры» — так же, как у параметров
 * графики, которых меню не даёт.
 */

const ROWS = Object.freeze([
  { key: "look", label: "На ногах: обзор и прицел" },
  { key: "driving", label: "В транспорте" },
]);

const fallbackOf = (key) => MOUSE_SETTINGS.find((item) => item.key === key)?.fallback ?? 50;

/** Профиль мыши из игры: `undefined` — читаем, `null` — браузер без профиля. */
function useMouseSettings() {
  const [mouse, setMouse] = useState(undefined);
  const refresh = useCallback(async () => {
    try {
      setMouse((await readMouseSettings()) || null);
    } catch {
      setMouse(null);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return [mouse, refresh];
}

export default function MouseSection({ onNotice }) {
  const tr = useTr();
  const [mouse, refresh] = useMouseSettings();
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState("");

  /* Черновик встаёт на то, что в профиле, при каждом чтении (в первый раз и после записи). */
  useEffect(() => {
    if (mouse?.values) setDraft({ ...mouse.values });
  }, [mouse]);

  if (!hasGameSettingsBridge() || !mouse) return null;

  const valueOf = (key) => draft[key] ?? mouse.values?.[key] ?? fallbackOf(key);
  const changedKeys = mouse.found
    ? ROWS.filter(({ key }) => mouse.values?.[key] !== undefined && mouse.values?.[key] !== null && valueOf(key) !== mouse.values[key]).map(({ key }) => key)
    : [];
  const notify = (message, tone) => onNotice?.(message, tone);
  const failure = (error) => notify(tr(sanitizeDesktopErrorMessage(error)), "error");

  async function apply() {
    setBusy("apply");
    try {
      const values = {};
      for (const key of changedKeys) values[key] = valueOf(key);
      await applyMouseSettings(values);
      notify(tr("Чувствительность мыши записана в профиль игры — запустите игру."));
      await refresh();
    } catch (error) {
      failure(error);
    } finally {
      setBusy("");
    }
  }

  async function restore() {
    setBusy("restore");
    try {
      await restoreMouseSettings();
      notify(tr("Мышь — как до Astral."));
      await refresh();
    } catch (error) {
      failure(error);
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="ui-panel graphics-param-group graphics-mouse" aria-label={tr("Мышь")}>
      <h2>{tr("Мышь")}</h2>
      <p className="graphics-mouse-note">
        {tr(
          "Чувствительность мыши лежит в профиле игры, а не в шаблоне, и пишется своей кнопкой. Шкала шире меню GTA V: числа ниже его нижней строки — для тех, кому и она слишком быстрая.",
        )}
      </p>
      {!mouse.found ? (
        <p className="graphics-mouse-empty" role="status">
          {tr("Профиль игры не найден — запустите GTA V хотя бы один раз, игра создаст его сама.")}
        </p>
      ) : !mouse.supported ? (
        <p className="graphics-mouse-empty" role="status">
          {tr("В профиле игры нет настроек мыши — откройте в игре «Настройки → Управление», выйдите и вернитесь сюда.")}
        </p>
      ) : (
        <>
          {ROWS.map(({ key, label }) => {
            const value = valueOf(key);
            const differs = value !== mouse.values[key];
            return (
              <div className={`graphics-param is-share${differs ? " is-changed" : ""}`} key={key}>
                <Slider
                  label={tr(label)}
                  value={value}
                  min={MOUSE_VALUE_MIN}
                  max={MOUSE_VALUE_MAX}
                  step={1}
                  unit=""
                  onChange={(next) => setDraft((current) => ({ ...current, [key]: next }))}
                />
                <span className="graphics-param-copy is-under">
                  {mouseBelowMenu(value) ? (
                    <small className="graphics-param-below">
                      {tr("ниже меню игры — игра берёт значение только из файла профиля")}
                    </small>
                  ) : null}
                  {differs ? (
                    <small className="graphics-param-game">{tr("В игре: {0}").replace("{0}", String(mouse.values[key]))}</small>
                  ) : null}
                </span>
              </div>
            );
          })}
          <div className="graphics-mouse-actions">
            <Button
              size="sm"
              variant="primary"
              disabled={!changedKeys.length || Boolean(busy)}
              onClick={apply}
            >
              {busy === "apply" ? tr("Записываем мышь…") : tr("Записать мышь")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<ArrowCounterClockwise />}
              disabled={!mouse.canRestore || Boolean(busy)}
              onClick={restore}
            >
              {busy === "restore" ? tr("Возвращаем мышь…") : tr("Мышь как было")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
