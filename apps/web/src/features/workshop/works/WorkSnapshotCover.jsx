import { useEffect, useState } from "react";
import { onWorkCoverChange, readWorkCover } from "./work-covers.js";

/*
 * Обложка работы человека: снимок её редактора, снятый при «Сохранить» и «Применить», или обложка из каталога (`work-covers.js`), а пока их нет
 * (работа сохранена до 25.10.2026, чужая работа из кода, окно без главного процесса) — то, что подставит хозяин: лёгкая обложка редактора или
 * штатная плитка (`fallback`). Ничего не рисуется и не снимается в фоне.
 *
 * `coverKeys` — ключи снимка по порядку (`work-cover-keys.js`); пусто — снимка быть не может. Картинка читается из IndexedDB один раз на ключи и
 * обновляется, когда снимок сняли заново (`onWorkCoverChange`). Пока ответа нет, запасной вид не рисуется: лёгкая обложка карты — это куски кода и
 * холст, и незачем тратить их на картинку, которая сейчас же сменится.
 */
const NO_KEYS = Object.freeze([]);

async function firstCover(keys) {
  for (const key of keys) {
    const url = await readWorkCover(key);
    if (url) return url;
  }
  return null;
}

export default function WorkSnapshotCover({ coverKey = "", coverKeys = NO_KEYS, fallback = null }) {
  const keys = coverKey ? [coverKey, ...coverKeys] : coverKeys;
  const signature = keys.join("|");
  const [shot, setShot] = useState({ signature: "", url: null });
  const [broken, setBroken] = useState("");

  useEffect(() => {
    if (!signature) return undefined;
    const wanted = signature.split("|");
    let alive = true;
    const read = () =>
      firstCover(wanted).then((url) => {
        if (alive) setShot({ signature, url });
      });
    void read();
    const stop = onWorkCoverChange((changed) => {
      if (wanted.includes(changed)) void read();
    });
    return () => {
      alive = false;
      stop();
    };
  }, [signature]);

  if (signature && shot.signature !== signature) return <span className="workshop-cover" aria-hidden="true" />;
  const url = signature ? shot.url : null;
  if (!url || url === broken) return fallback;
  return (
    <span className="workshop-cover" data-cover="work-snapshot" aria-hidden="true">
      <img
        className="workshop-cover-image workshop-cover-snapshot"
        data-photo=""
        src={url}
        alt=""
        draggable="false"
        decoding="async"
        /* Обложка из каталога не доехала (нет сети): запасной вид, а не значок битой картинки. */
        onError={() => setBroken(url)}
      />
    </span>
  );
}
