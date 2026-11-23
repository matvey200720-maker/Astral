import * as React from "react";

// Действия сборки отдаёт оболочка окна. Без неё провайдера нет, и страницы
// получают null: так «оболочки нет» отличается от «действий нет».
export const BundleContext = React.createContext(null);

export const useBundleActions = () => React.useContext(BundleContext);
