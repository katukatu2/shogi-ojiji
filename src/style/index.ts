import { Style } from './types';
import { YAGURA } from './yagura';
import { SHIKENBISHA } from './shikenbisha';
import { BOUGIN } from './bougin';
import { NAKABISHA } from './nakabisha';
import { KAKUGAWARI } from './kakugawari';

// タイトル画面に並ぶ順
export const STYLES: Style[] = [YAGURA, SHIKENBISHA, KAKUGAWARI, BOUGIN, NAKABISHA];

export function findStyle(id: string): Style | undefined {
  return STYLES.find((s) => s.id === id);
}
