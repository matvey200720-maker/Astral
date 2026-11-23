import Button from "../../components/ui/Button.jsx";
import UpdateBar from "./UpdateBar.jsx";
import UpdateOrbit from "./UpdateOrbit.jsx";
import VersionText from "./VersionText.jsx";
import { updatesCopyFor } from "./copy.js";
import { formatBytes, transferLines } from "./format.js";

// Кнопка строится из строки [показывать?, вид, обработчик, подпись];
// ключ — место в строке, чтобы «Что нового» не пересоздавала соседние кнопки.
const Buttons = ({ rows }) => (
  <div className="update-prompt-actions">
    {rows.map(([shown, variant, onClick, text], at) =>
      shown ? (
        <Button key={at} onClick={onClick} size="sm" variant={variant}>
          {text}
        </Button>
      ) : null,
    )}
  </div>
);

export default function UpdatePrompt(props) {
  const { kind, candidate, language, notice } = props;
  const facts = props.facts ?? null;
  const copy = updatesCopyFor(language);
  const { prompt: words, actions } = copy;
  const version = candidate.version;
  const phrase = (text) => (
    <span>
      <VersionText text={text} versions={[version]} />
    </span>
  );
  const found = phrase(words.availableText(version, formatBytes(candidate.bytes, language)));
  // Результат нажатия: незнакомый вид читается как общее «не получилось».
  const outcome = notice ? <em role="status">{copy.notice[notice.kind] || copy.notice.failed}</em> : null;
  const notes = [props.canShowNotes, "ghost", props.onWhatsNew, actions.whatsNew];
  const later = [true, "ghost", props.onLater, actions.later];

  // Три лица карточки: ход скачивания, «готово» и «найдено» (оно же для любого другого вида).
  const faces = {
    downloading() {
      const verifying = facts?.stage === "verify";
      const title = verifying ? words.verifyingTitle : words.downloadingTitle;
      const { line, note } = transferLines(facts, language, copy);
      return {
        root: { className: "update-prompt update-prompt-transfer", "data-stage": verifying ? "verify" : "download" },
        orbit: <UpdateOrbit kind="progress" size="sm" value={facts?.share ?? 0} />,
        title,
        body: (
          <>
            {found}
            <span className="update-prompt-line">{line}</span>
            <UpdateBar label={title} percent={(verifying ? facts.verifyPercent : facts?.percent) ?? 0} />
            {note ? <em role="status">{note}</em> : <small>{words.hideNote}</small>}
          </>
        ),
        rows: [[true, "ghost", props.onLater, words.hide]],
      };
    },
    ready: () => ({
      root: { className: "update-prompt" },
      orbit: <UpdateOrbit kind="done" size="sm" />,
      title: words.readyTitle,
      body: (
        <>
          {phrase(words.readyText(version))}
          {outcome || <small>{words.laterNote}</small>}
        </>
      ),
      rows: [notes, later, [true, "primary", props.onPrimary, actions.restart]],
    }),
    found: () => ({
      root: { className: "update-prompt" },
      orbit: <UpdateOrbit kind="idle" size="sm" />,
      title: words.availableTitle,
      body: (
        <>
          {found}
          {outcome}
        </>
      ),
      rows: [notes, later, [true, "primary", props.onPrimary, actions.download]],
    }),
  };
  const face = faces[kind === "downloading" || kind === "ready" ? kind : "found"]();

  return (
    <section {...face.root} aria-label={words.label} aria-modal="false" data-kind={kind} role="dialog">
      {face.orbit}
      <div className="update-prompt-copy">
        <b>{face.title}</b>
        {face.body}
      </div>
      <Buttons rows={face.rows} />
    </section>
  );
}
