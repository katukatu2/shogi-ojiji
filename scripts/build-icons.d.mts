// scripts/build-icons.mjs の型。src/icons.test.ts から import するためのもので、実装は .mjs にある
export type IconKind = 'plain' | 'maskable' | 'square' | 'splash' | 'launcher' | 'launcher-round' | 'foreground';

export interface IconOutput {
  /** リポジトリ直下からの相対パス */
  file: string;
  /** 一辺（px） */
  size: number;
  kind: IconKind;
}

export interface IconContext {
  viewBox: string;
  /** icon.svg の <svg> の中身 */
  inner: string;
  /** icon.svg の地の色（最初の rect の fill） */
  fill: string;
  /** 角の半径 ÷ 一辺 */
  corner: number;
  /** maskable の余白の色（manifest の background_color） */
  webBackdrop: string;
  /** 丸いランチャーの地の色（values/ic_launcher_background.xml） */
  androidBackdrop: string;
}

export interface Rendered {
  width: number;
  height: number;
  /** RGBA の生データ */
  pixels: Buffer;
  png: Buffer;
}

export const DENSITIES: Record<'mdpi' | 'hdpi' | 'xhdpi' | 'xxhdpi' | 'xxxhdpi', number>;
export const LAUNCHER_DP: number;
export const ADAPTIVE_DP: number;
export const ADAPTIVE_SAFE_DP: number;
export const FOREGROUND_SCALE: number;
export const MASKABLE_SAFE_RADIUS: number;
export const SAFE_MARGIN: number;
export const OUTPUTS: IconOutput[];

export function listOutputs(): IconOutput[];
export function fitSide(radius: number, corner: number): number;
export function repoRoot(): string;
export function loadContext(root?: string): IconContext;
export function composeSvg(kind: IconKind, size: number, ctx: IconContext): string;
export function render(svg: string, size: number): Rendered;
export function buildAll(root?: string): { file: string; size: number; bytes: number }[];
