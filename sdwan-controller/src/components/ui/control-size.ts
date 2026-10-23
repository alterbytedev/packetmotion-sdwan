/** Visual control height; native input/select `size` keeps its HTML meaning. */
export type ControlSize = 'sm' | 'md' | 'default';

export const controlSizes: Record<ControlSize, string> = {
  sm: 'h-8 py-1 text-sm',
  md: 'h-9 py-1.5 text-sm',
  default: 'h-11 py-2 text-sm',
};
