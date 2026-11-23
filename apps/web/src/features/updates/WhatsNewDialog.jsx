import { useReducer } from "react";
import { default as Dialog } from "../../components/ui/Dialog.jsx";
import * as copyApi from "./copy.js";
import * as notesApi from "./notes.js";
import * as modelApi from "./model.js";
import * as formatApi from "./format.js";
import Button from "../../components/ui/Button.jsx";

// Неменяющиеся свойства окна и картинки лежат отдельно от разметки.
const FRAME = {
  size: "lg",
  titleId: "updates-whatsnew-title",
  className: "updates-dialog updates-whatsnew",
  backdropClassName: "updates-backdrop",
};
const COVER_IMG = { alt: "", decoding: "async" };

// Версия · канал · сборка · дата; пустые части пропускаются.
const releaseMeta = (release, language) => {
  const copy = copyApi.updatesCopyFor(language);
  const channelName = modelApi.channelLabel(release.channel);
  return [
    release.version,
    channelName ? copy.channel(channelName) : "",
    release.build ? copy.build(release.build) : "",
    release.publishedAt ? formatApi.formatDay(release.publishedAt, language) : "",
  ]
    .filter(Boolean)
    .map(String)
    .join(" · ");
};

// Заметки приходят простым текстом и рисуются только текстовыми узлами:
// подписанный манифест не значит «безопасно вставлять как HTML» (docs/beta/release-channels.md, §5.4).
const TEXT_TAGS = { h: "h3", p: "p" };

function renderBlock(block, key) {
  const Tag = TEXT_TAGS[block.type];
  if (Tag) return <Tag key={key}>{block.text}</Tag>;
  return <ul key={key}>{Array.from(block.items, (item, n) => <li key={n}>{item}</li>)}</ul>;
}

// Один тег на оба случая: пустые заметки — абзац со своим классом, иначе блок со списком блоков.
const ReleaseNotes = ({ text, empty: whenEmpty }) => {
  const blocks = notesApi.parseNotes(text);
  const none = blocks.length === 0;
  const Tag = none ? "p" : "div";
  return (
    <Tag className={none ? "updates-notes-empty" : "updates-notes"}>{none ? whenEmpty : blocks.map(renderBlock)}</Tag>
  );
};

function WhatsNewDialog({ justUpdated = false, language, onClose, primary = null, release }) {
  const [coverBroken, markCoverBroken] = useReducer(() => true, false);
  const { actions, whatsNew } = copyApi.updatesCopyFor(language);
  const kicker = justUpdated ? whatsNew.justUpdated : whatsNew.kicker(release.version);
  const coverSrc = modelApi.coverUrl(release.cover);
  const buttons = [
    <Button key={0} onClick={onClose} variant={primary ? "ghost" : "secondary"}>
      {actions.close}
    </Button>,
  ];
  if (primary) {
    buttons.push(
      <Button key={1} onClick={primary.onClick} variant="primary">
        {primary.label}
      </Button>,
    );
  }
  return (
    <Dialog {...FRAME} actions={buttons} closeLabel={whatsNew.close} kicker={kicker} onClose={onClose} title={whatsNew.title}>
      {coverSrc && !coverBroken ? (
        <figure className="updates-cover">
          <img {...COVER_IMG} onError={markCoverBroken} src={coverSrc} />
        </figure>
      ) : null}
      <p className="updates-meta">{releaseMeta(release, language)}</p>
      <ReleaseNotes empty={whatsNew.empty} text={modelApi.pickNotes(release.notes, language)} />
    </Dialog>
  );
}

export { ReleaseNotes, releaseMeta };
export default WhatsNewDialog;
