import PageHeading from "../ui/PageHeading.jsx";
import * as Design from "@astral/design";

const LOGO_PROPS = { className: "desktop-logo", markClassName: "modovik-mark", wordmarkAs: "b" };

// В шапку уходят только название и действие; остальное от вызывающего отбрасывается.
const headingProps = (source) => {
  const { title, action } = source;
  return { title, actions: action };
};

export const AppLogo = () => <Design.Brand {...LOGO_PROPS} />;

export const SectionTitle = (props) => <PageHeading {...headingProps(props)} />;
