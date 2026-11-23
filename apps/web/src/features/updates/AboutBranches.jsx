import { LazyBranchesCard as Card } from "./lazy-ui.js";
import { useChannels as useList } from "./channels-store.js";

// Карточка только у беты (docs/beta/channels-launcher.md, §5): пока снимка нет или ветки
// выключены, не рисуем ничего и не тянем ни код карточки, ни её стили (afee24d0d).
const AboutBranches = (props) => {
  const list = useList();
  return list.loaded && list.state.enabled && <Card language={props.language} />;
};

export default AboutBranches;
