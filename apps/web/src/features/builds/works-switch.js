// Общий выключатель «работы мастерской в сборках». Состояние живёт в самой копии модуля.
let worksOn = true;

// Поля записи сборки, которые страница не должна видеть при выключенном переключателе
const WORK_FIELDS = ["works", "engineIds", "droppedWorks"];

export const buildWorksEnabled = () => worksOn;

export const setBuildWorksEnabled = (value) => {
  worksOn = Boolean(value);
};

const carriesWorkFields = (profile) => WORK_FIELDS.some((field) => profile[field]);

// Поверхностная копия без полей работ; вложенные значения остаются теми же ссылками
function withoutWorkFields(profile) {
  const copy = { ...profile };
  for (const field of WORK_FIELDS) delete copy[field];
  return copy;
}

export function visibleBuild(profile) {
  if (worksOn || !profile) return profile;
  return carriesWorkFields(profile) ? withoutWorkFields(profile) : profile;
}
