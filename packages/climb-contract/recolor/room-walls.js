// Таблица «комната + материал → лист, который править» и поиск по ней.

function sheet(kind, file, texture) {
  return Object.freeze({ kind, file, texture });
}

export const ROOM_WALL_SHEETS = Object.freeze({
  'GtaMloRoom001|xj_v_wall05': sheet('embed', 'v_62_lobby_wall.ydr', 'xj_v_wall05'),
  'GtaMloRoom001|xj_v_barrierpost01': sheet('dictionary', 'v_62_v_stadium_txd.ytd', 'xj_v_barrierpost01'),
  'GtaMloRoom001|xj_v_white_wall': sheet('dictionary', 'v_62_v_stadium_txd.ytd', 'xj_v_white_wall'),
  'GtaMloRoom002|xj_v_wood07': sheet('dictionary', 'v_62_v_stadium_txd.ytd', 'xj_v_wood07'),
});

export function roomWallSheet(room, material) {
  const key = `${room}|${material}`;
  return Object.hasOwn(ROOM_WALL_SHEETS, key) ? ROOM_WALL_SHEETS[key] : null;
}
