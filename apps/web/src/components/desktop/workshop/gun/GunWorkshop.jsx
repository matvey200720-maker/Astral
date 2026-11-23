/*
 * Вход в мастерскую оружия и одежды. Одежда — та же студия, оружие — студия вместе с экраном «Ганпак» (`pack/WeaponWorkshop.jsx`).
 */

import GunStudio from "./GunStudio.jsx";
import WeaponWorkshop from "./pack/WeaponWorkshop.jsx";

export default function GunWorkshop(props) {
  const { catalogOf: _catalogOf, ...studio } = props;
  if (props.profile && props.profile !== "weapon") return <GunStudio {...studio} />;
  return <WeaponWorkshop {...props} />;
}
