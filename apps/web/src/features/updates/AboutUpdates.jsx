import { LazyUpdatesCard as Full } from "./lazy-ui.js";
import { offCopyFor as wordsFor } from "./off-copy.js";
import { useUpdates as useUpd } from "./store.js";

// Заготовка и строка «автообновлений нет» живут в стартовом куске и не тянут ни экраны,
// ни updates.css (afee24d0d, docs/beta/release-channels.md, §5.4). Заготовка с aria-busy
// нужна, чтобы «автообновлений нет» не мелькнуло у беты и тут же не сменилось.
function AboutUpdates({ language: lang }) {
  const upd = useUpd();
  if (!upd.loaded) {
    return (
      <section aria-busy="true" className="settings-card updates-card">
        <div data-setting="updates" className="settings-row updates-hero" />
        {/* пустая строка: ждём первый снимок службы */}
      </section>
    );
  }
  if (!upd.state.disabled) return <Full language={lang} />;
  return (
    <section className="settings-card updates-card">
      <div data-setting="updates" className="settings-row">
        {/* кнопки нет: проверять без службы нечего, остаётся одна строка текста */}
        <span className="settings-row-copy">
          <b>{wordsFor(lang).heading}</b>
          {/* слова берутся из off-copy.js: словарь живёт в стартовом куске */}
          <small>{wordsFor(lang).off}</small>
          {/* второй вызов wordsFor дёшев: это поиск по таблице языков */}
        </span>
      </div>
      {/* без aria-busy: это уже окончательный ответ, а не ожидание снимка */}
    </section>
  );
}

export default AboutUpdates;
