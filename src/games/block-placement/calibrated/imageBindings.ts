import type { ImageFit } from '../../../shared/media/drawImageFitted';

export type ImageBinding = {
  fit: ImageFit;
  opacity: number;
  blendMode: GlobalCompositeOperation;
  inset: number;
};
export type ImageBindings = {
  background: ImageBinding | null;
  face: ImageBinding | null;
  atlas: ImageBinding | null;
};
