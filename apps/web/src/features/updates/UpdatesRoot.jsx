import UpdatesHost from "./UpdatesHost.jsx";
import BranchesHost from "./BranchesHost.jsx";

// Порядок важен: слои обновлений встают в оверлей раньше слоёв веток,
// предложение поставить ветку рядом уступает дорогу замку и карточке обновления.
const UpdatesRoot = () => [<UpdatesHost key="u" />, <BranchesHost key="b" />];

export default UpdatesRoot;
