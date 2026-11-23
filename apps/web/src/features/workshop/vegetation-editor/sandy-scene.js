const ZOOM_LIMITS = [0.12, 2.2];
const LOOK_DOWN = { yaw: -0.95, pitch: 0.58, zoom: 0.5 };
const FREE_GROUND = { ground: true, free: true };

export const SANDY_SCENE_URL = "/assets/workshop/vegetation/sandy-terrain.bin";

// Начальный ракурс сверху вдоль карты с запада на восток; объекты каждый раз новые.
export function sandyFlightFrame(scene) {
  const frame = { bounds: scene.bounds };
  frame.view = { ...LOOK_DOWN };
  frame.zoomRange = [...ZOOM_LIMITS];
  return Object.assign(frame, FREE_GROUND);
}
