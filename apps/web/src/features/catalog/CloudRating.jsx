import { useEffect, useState } from "react";
import { Star } from "../../components/ui/icons.jsx";
import { getCloudRating, setCloudRating } from "../../api.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const copy = {
  ru: {
    title: "Ваша оценка",
    saved: "Оценка сохранена",
    failed: "Не удалось сохранить",
    login: "Войдите, чтобы оценить",
  },
  uk: {
    title: "Ваша оцінка",
    saved: "Оцінку збережено",
    failed: "Не вдалося зберегти",
    login: "Увійдіть, щоб оцінити",
  },
  en: {
    title: "Your rating",
    saved: "Rating saved",
    failed: "Could not save",
    login: "Sign in to rate",
  },
  de: {
    title: "Deine Bewertung",
    saved: "Bewertung gespeichert",
    failed: "Speichern fehlgeschlagen",
    login: "Zum Bewerten anmelden",
  },
  pl: {
    title: "Twoja ocena",
    saved: "Ocena zapisana",
    failed: "Nie udało się zapisać",
    login: "Zaloguj się, aby ocenić",
  },
  fr: {
    title: "Votre note",
    saved: "Note enregistrée",
    failed: "Enregistrement impossible",
    login: "Connectez-vous pour noter",
  },
};

export default function CloudRating({
  modId,
  active,
  initialAverage = 0,
  language = "ru",
}) {
  const text = copy[language] || copy.ru;
  const valid = UUID.test(modId || "");
  const [rating, setRating] = useState({
    value: 0,
    average: Number(initialAverage) || 0,
    count: 0,
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setNotice("");
    setRating({ value: 0, average: Number(initialAverage) || 0, count: 0 });
    if (!active || !valid) return undefined;
    let cancelled = false;
    getCloudRating(modId)
      .then((value) => {
        if (!cancelled) setRating(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [active, initialAverage, modId, valid]);

  if (!valid) return null;

  async function submit(value) {
    if (!active || busy) return;
    setBusy(true);
    setNotice("");
    try {
      setRating(await setCloudRating(modId, value));
      setNotice(text.saved);
    } catch {
      setNotice(text.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cloud-rating" aria-label={text.title}>
      <span>{text.title}</span>
      <div>
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            type="button"
            disabled={!active || busy}
            className={value <= rating.value ? "is-active" : ""}
            aria-label={`${text.title}: ${value}/5`}
            aria-pressed={rating.value === value}
            onClick={() => submit(value)}
            key={value}
          >
            <Star weight={value <= rating.value ? "fill" : "regular"} />
          </button>
        ))}
      </div>
      <b>
        {rating.average.toFixed(1)} · {rating.count}
      </b>
      <small>{notice || (!active ? text.login : "")}</small>
    </div>
  );
}
