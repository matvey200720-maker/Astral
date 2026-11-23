import { useEffect, useState } from "react";
import { bakeGameBeard } from "../../../api.js";
import { tr, useTr } from "../../../locales/ui.js";

/*
 * «Будет» для штатной бороды игры (Ц3в, условие 3 общей ведущей, 16.11.2026): когда выбрана штатная борода, слева — не объёмная модель бороды, а то, что реально ляжет в игру: ПЛОСКИЙ рисунок модели на развёртке
 * головы (`bakeGameBeard`: луч от кожи вдоль нормали в сетки бороды, лист 512×512 с прозрачным фоном). Объёмной бороды у штатной нет, и показывать её значило бы обещать то, чего в игре не будет.
 * Цвет бороды — расцветка мода (кружки), её меняют тут же: рисунок считается заново. Голова под рисунком пока не рисуется — лист показан на тёмной подложке; в игре не проверено.
 */

const stateOf = (status, extra = {}) => ({
  status,
  url: "",
  warn: false,
  coverage: 0,
  ...extra,
});

export default function GameBeardPreview({
  gameRoot,
  beardKey,
  mod,
  colours = [],
  colour = "",
  onColour,
  gender,
}) {
  useTr();
  const [baked, setBaked] = useState(() => stateOf("loading"));
  useEffect(() => {
    if (!gameRoot || !beardKey) return undefined;
    let cancelled = false;
    let url = "";
    setBaked(stateOf("loading"));
    bakeGameBeard({
      gameRoot,
      key: beardKey,
      manifest: mod.manifest,
      baseUrl: mod.packageBaseUrl,
      ...(/^[a-z]$/.test(colour) ? { colour } : {}),
      ...(gender ? { gender } : {}),
    })
      .then((answer) => {
        if (cancelled) return;
        /* `view` — тот же лист, обрезанный по рисунку и вписанный в квадрат (рисунок бороды занимает малую часть развёртки головы); целый лист — запасной. */
        url = URL.createObjectURL(
          new Blob([answer.view || answer.sheet], { type: "image/png" }),
        );
        setBaked(
          stateOf("ready", {
            url,
            warn: Boolean(answer.warn),
            coverage: Number(answer.coverage) || 0,
          }),
        );
      })
      .catch(() => {
        if (!cancelled) setBaked(stateOf("error"));
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [gameRoot, beardKey, mod.manifest, mod.packageBaseUrl, colour, gender]);
  return (
    <div className="game-beard-preview" data-status={baked.status}>
      <div className="game-beard-sheet">
        {baked.status === "ready" ? (
          <img
            src={baked.url}
            alt={tr("Будет — плоский рисунок на лице")}
            decoding="async"
            draggable={false}
          />
        ) : (
          <span role="status">
            {baked.status === "error"
              ? tr("Не получилось посчитать рисунок бороды")
              : tr("Считаю рисунок…")}
          </span>
        )}
      </div>
      <p className="game-beard-caption">
        {tr("Будет — плоский рисунок на лице")}
      </p>
      {baked.warn ? (
        <p className="game-beard-warn" role="note">
          {tr("Часть бороды ниже подбородка в рисунок не войдёт")}
        </p>
      ) : null}
      {colours.length > 1 && onColour ? (
        <div
          className="game-beard-dots"
          role="group"
          aria-label={tr("Цвета мода")}
        >
          {colours.map((entry) => (
            <button
              key={entry.letter}
              type="button"
              className={`game-beard-dot${entry.letter === colour ? " is-active" : ""}`}
              style={{
                background: entry.swatch || "#444",
                backgroundClip: "content-box",
              }}
              aria-pressed={entry.letter === colour}
              aria-label={entry.letter}
              onClick={() => onColour(entry.letter)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
