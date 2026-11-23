export const DEFAULT_WORKSHOP_EAGER_MEDIA_COUNT = 6;

export function workshopMediaPriority({
  index = 0,
  selected = false,
  hero = false,
  eagerCount = DEFAULT_WORKSHOP_EAGER_MEDIA_COUNT,
} = {}) {
  const isHighPriority = hero || selected || index < eagerCount;

  return {
    loading: isHighPriority ? "eager" : "lazy",
    decoding: "async",
    fetchPriority: hero || selected || index < 2 ? "high" : "auto",
  };
}
