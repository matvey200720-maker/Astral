import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Trash, X } from "../../../ui/icons.jsx";
import { describeBank } from "@modovik/sound-studio";
import Button from "../../../ui/Button.jsx";
import {
  applySoundPack,
  chooseSoundPackFolder,
  listInstalledSoundPacks,
  planSoundPack,
  removeSoundPack,
  sanitizeDesktopErrorMessage,
} from "../../../../api.js";
import { applyWorkshopWork } from "../../../../features/workshop/install-queue/index.js";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * Готовый набор звуков из папки.
 *
 * Половина звуковых модов в природе — это архив с файлами `.awc`, и
 * инструкция автора всегда одна: OpenIV, резервная копия, режим правки,
 * перетащить внутрь `RESIDENT.rpf` и `WEAPONS_PLAYER.rpf`. Студия рядом умеет
 * собирать замену по дорожкам, но чужой готовый набор ей не заменить —
 * поэтому здесь он ставится как есть: папку показали, банки узнали, каждый
 * проверили разбором, поставили одной операцией и снимают в один клик.
 *
 * Панель живёт в инспекторе студии звука, а не отдельным окном: это не другой
 * редактор, а второй способ положить звук в ту же игру. Второй и редкий —
 * поэтому она открывается из меню «⋯» студии и закрывается своей кнопкой, а
 * не стоит постоянно рядом с главным путём «ствол → ▶ → свой файл».
 */

/*
 * Причины пишутся так, чтобы по ним было что сделать. «Банк не опознан» —
 * это тупик; «положите его в папку с именем архива» — это следующий шаг, и
 * он в наборах двигателей и рации нужен всегда: имён там под семьсот, и по
 * одному имени файла архив не угадать.
 */
const SKIP_REASON = {
  "not-a-sound-bank": "не звуковой банк",
  "unknown-bank":
    "по имени не видно, в какой архив он идёт — положите его в папку с именем архива, например STREAMED_VEHICLES.rpf",
  "not-in-game-archive": "такого банка нет в звуковых архивах игры",
  "duplicate-bank": "этот банк в наборе уже есть",
  symlink: "ссылка, а не файл",
  "too-big": "файл больше допустимого",
};

const megabytes = (bytes) =>
  `${(Number(bytes || 0) / (1024 * 1024)).toFixed(1)} ${tr("МБ")}`;

const archiveName = (archive) =>
  String(archive || "")
    .split("/")
    .pop();

export default function SoundPackPanel({
  gameRoot,
  /* Профиль движка, а не номер установки: слои студии рядом пишут в
     "default", и набор обязан писать туда же — иначе набор и слой не видели
     бы друг друга на одних и тех же банках. Установку главный процесс ищет
     по папке. */
  targetId = "default",
  onNotice,
  /* Банки игры изменились: студия обязана перечитать их, иначе она правит
     оригиналы, которых в игре уже нет. */
  onChanged,
  /* Панель открыта из меню студии — и закрывается здесь же. */
  onClose = null,
}) {
  useTr();
  const [found, setFound] = useState(null);
  const [plan, setPlan] = useState(null);
  const [installed, setInstalled] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const list = await listInstalledSoundPacks({ targetId });
      setInstalled(Array.isArray(list) ? list : []);
    } catch {
      /* Список установленных — подсказка, а не условие работы панели. */
    }
  }, [targetId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /* Ошибка главного процесса приезжает с приставкой Electron («Error invoking
     remote method …»); сама причина написана для человека, и показывается
     только она. */
  const fail = (problem) => {
    const message =
      sanitizeDesktopErrorMessage(problem) ||
      tr("Не удалось выполнить действие с набором звуков.");
    setError(message);
    onNotice?.(message);
  };

  const choose = async () => {
    setBusy("choose");
    setError("");
    try {
      const chosen = await chooseSoundPackFolder();
      if (!chosen?.cancelled) {
        setFound(chosen);
        setPlan(null);
      }
    } catch (problem) {
      fail(problem);
    } finally {
      setBusy("");
    }
  };

  const prepare = async () => {
    if (!found?.sourceRoot) return;
    setBusy("plan");
    setError("");
    try {
      const next = await planSoundPack({
        sourceRoot: found.sourceRoot,
        name: found.sourceRoot.split(/[\\/]/).pop() || tr("звуки"),
        gameRoot,
        targetId,
      });
      setPlan(next);
    } catch (problem) {
      fail(problem);
    } finally {
      setBusy("");
    }
  };

  /*
   * Запись идёт той же очередью, что и своя работа.
   *
   * Проверка чужой папки осталась шагом человека: что там за банки и что
   * набор заменит, надо увидеть до того, как он ляжет в игру. А сама запись —
   * такая же запись в архив, и вести её мимо очереди значило бы столкнуться с
   * работой студии и получить «Мастерская уже применяет изменения» вместо
   * установки.
   */
  const apply = () => {
    if (!plan?.planId || !found?.sourceRoot) return;
    const name = found.sourceRoot.split(/[\\/]/).pop() || tr("звуки");
    const payload = {
      sourceRoot: found.sourceRoot,
      name,
      planId: plan.planId,
      gameRoot,
      targetId,
    };
    setPlan(null);
    setFound(null);
    void applyWorkshopWork({
      key: `local-legacy-sound-pack:${payload.sourceRoot}`,
      title: name,
      editor: tr("Набор звуков"),
      coverSlotId: "sounds",
      notify: (text) => onNotice?.(text),
      savedText: tr("Набор звуков встал в очередь — ставим в игру"),
      run: async () => {
        const result = await applySoundPack(payload);
        await refresh();
        onChanged?.();
        return result;
      },
      doneText: (result) =>
        tr("Набор звуков установлен: банков {count}. Перезапустите GTA V.").replace("{count}", result?.banks?.length ?? 0),
    });
  };

  const remove = async (modId) => {
    setBusy("remove");
    setError("");
    try {
      await removeSoundPack({ modId, gameRoot, targetId });
      onNotice?.(tr("Набор звуков снят, банки игры вернулись на место."));
      await refresh();
      onChanged?.();
    } catch (problem) {
      fail(problem);
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="ui-panel snd-section snd-pack">
      <header>
        <h3>{tr("Готовый набор звуков")}</h3>
        {onClose && (
          <Button
            variant="ghost"
            size="sm"
            icon={<X />}
            aria-label={tr("Скрыть готовые наборы")}
            title={tr("Скрыть")}
            onClick={onClose}
          />
        )}
      </header>
      {/* Одна строка вместо абзаца: что показать и что будет. Как Astral
          раскладывает банки по архивам — не вопрос человека. */}
      <small className="snd-hint">
        {tr("Архив")} <code>.zip</code> {tr("или")} <code>.oiv</code> {tr("— или папка с файлами")}{" "}
        <code>.awc</code>
        {tr(": Astral сам разложит их по местам, без OpenIV.")}
      </small>

      <Button
        size="sm"
        variant="secondary"
        icon={<FolderOpen />}
        disabled={busy !== ""}
        progress={busy === "choose" ? 50 : null}
        onClick={() => void choose()}
      >
        {tr("Показать архив или папку")}
      </Button>

      {error && <small className="snd-hint snd-conflict">{error}</small>}

      {found && (
        <div className="snd-pack-found">
          <b>
            {tr("Нашлось банков: {count} · {size}")
              .replace("{count}", found.entries.length)
              .replace("{size}", megabytes(found.bytes))}
          </b>
          {found.fromArchive && (
            <small className="snd-hint">
              {tr("Архив распакован — доставать файлы руками не нужно.")}
            </small>
          )}
          <ul className="snd-pack-list">
            {found.entries.map((item) => (
              <li key={item.entry}>
                {/* Имя, а не код банка: «ptl_pistol» в списке находок — это
                    «Пистолет». Код остаётся в подсказке. */}
                <span title={item.bank}>
                  {describeBank(item.bank, item.archive).title}
                </span>
                <small>{archiveName(item.archive)}</small>
              </li>
            ))}
          </ul>
          {found.skipped.length > 0 && (
            <details className="snd-pack-skipped">
              <summary>{tr("Отложено: {count}").replace("{count}", found.skipped.length)}</summary>
              <ul>
                {found.skipped.slice(0, 24).map((item) => (
                  <li key={item.name}>
                    {item.name} — {SKIP_REASON[item.reason] ? tr(SKIP_REASON[item.reason]) : item.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {/* Не «Подготовить установку»: так называется кнопка студии над
              дорожками, и две одинаковые надписи на одном экране делали бы
              разное. Здесь проверяют чужой набор, а не свою работу. */}
          {!plan && (
            <Button
              size="sm"
              disabled={busy !== ""}
              progress={busy === "plan" ? 50 : null}
              onClick={() => void prepare()}
            >
              {tr("Проверить набор")}
            </Button>
          )}
        </div>
      )}

      {plan && (
        <div className="snd-pack-plan">
          <b>{tr("Проверено — можно ставить")}</b>
          <small className="snd-hint">
            {tr("Банков: {banks} · архивов: {archives}")
              .replace("{banks}", plan.banks?.length ?? 0)
              .replace("{archives}", (plan.archives || []).map(archiveName).join(", "))}
            {plan.replaceModIds?.length
              ? tr(" · заменит: {mods}").replace("{mods}", plan.replaceModIds.join(", "))
              : ""}
          </small>
          <small className="snd-hint">
            {tr("Звуки игры сохраняются — набор снимается в один клик.")}
          </small>
          <div className="snd-pack-actions">
            <Button
              size="sm"
              disabled={busy !== ""}
              onClick={() => void apply()}
            >
              {tr("Поставить набор")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPlan(null)}>
              {tr("Отменить")}
            </Button>
          </div>
        </div>
      )}

      {installed.length > 0 && (
        <ul className="snd-works">
          {installed.map((item) => (
            <li key={item.modId}>
              <span>{item.name || item.modId}</span>
              <button
                type="button"
                aria-label={tr("Снять набор {id}").replace("{id}", item.modId)}
                title={tr("Снять набор")}
                disabled={busy !== ""}
                onClick={() => void remove(item.modId)}
              >
                <Trash />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
