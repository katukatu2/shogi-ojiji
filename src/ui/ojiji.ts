// オジジの顔。キャラクターコンセプト「雷蔵」に合わせた絵。
// 白い逆立った髪、太い黒眉、丸くて赤ら顔、茶の着物に生成りの羽織（紋つき）、手には王将の駒。
// 表情ごとに眉・目・口・手を差し替え、動きは style.css の CSS アニメーション（.ojiji.expr-*）で付ける。

export type Expression =
  | 'normal' // 仏頂面。タイトルや平常時
  | 'calm' // normal の別名（古い呼び出し互換）
  | 'thinking' // 考え顔。指を立てる
  | 'nod' // 目を閉じて頷く
  | 'stern' // 渋い顔
  | 'scold' // 渋い顔＋指差し（段階 4）
  | 'angry' // 怒鳴り顔＋指差し（ばかもーん！）
  | 'shocked'; // 驚き

export interface OjijiOptions {
  piece?: boolean; // 王将の駒を持たせる
}

const SKIN = '#f2c9a3';
const SKIN_DARK = '#d9a072';
const LINE = '#3a2a22';
const HAIR = '#f7f7f7';
const HAIR_LINE = '#c4c4c4';
const HAORI = '#efe6d2';
const HAORI_LINE = '#cbbfa6';
const KIMONO = '#a4472f';
const CREST = '#5a5a5a';

function brows(expr: Expression): string {
  // 左右の眉。内側（顔の中心側）が下がるほど怒って見える
  switch (expr) {
    case 'angry':
      return `<polygon class="g-brow-l" points="54,84 108,108 106,122 50,100" fill="${LINE}"/>
              <polygon class="g-brow-r" points="186,84 132,108 134,122 190,100" fill="${LINE}"/>`;
    case 'stern':
    case 'scold':
      return `<polygon class="g-brow-l" points="58,90 108,104 106,118 54,104" fill="${LINE}"/>
              <polygon class="g-brow-r" points="182,90 132,104 134,118 186,104" fill="${LINE}"/>`;
    case 'thinking':
      return `<polygon class="g-brow-l" points="58,82 106,98 104,110 56,94" fill="${LINE}"/>
              <polygon class="g-brow-r" points="180,94 134,104 136,116 182,108" fill="${LINE}"/>`;
    case 'shocked':
      return `<polygon class="g-brow-l" points="60,76 106,84 104,96 58,90" fill="${LINE}"/>
              <polygon class="g-brow-r" points="180,76 134,84 136,96 182,90" fill="${LINE}"/>`;
    default:
      return `<polygon class="g-brow-l" points="60,94 106,102 104,116 58,108" fill="${LINE}"/>
              <polygon class="g-brow-r" points="180,94 134,102 136,116 182,108" fill="${LINE}"/>`;
  }
}

function eyes(expr: Expression): string {
  const eye = (cx: number, ry: number, pupilR: number, shift: number) => `
    <ellipse cx="${cx}" cy="124" rx="14" ry="${ry}" fill="#fff" stroke="${LINE}" stroke-width="2"/>
    <circle cx="${cx + shift}" cy="125" r="${pupilR}" fill="${LINE}"/>
    <path d="M${cx - 14} 120 Q${cx} ${120 - ry} ${cx + 14} 120" stroke="${LINE}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
  switch (expr) {
    case 'nod':
      return `<g class="g-eyes">
        <path d="M72 126 Q86 116 100 126" stroke="${LINE}" stroke-width="4" fill="none" stroke-linecap="round"/>
        <path d="M140 126 Q154 116 168 126" stroke="${LINE}" stroke-width="4" fill="none" stroke-linecap="round"/>
      </g>`;
    case 'angry':
      return `<g class="g-eyes">${eye(86, 10, 6, 0)}${eye(154, 10, 6, 0)}</g>`;
    case 'shocked':
      return `<g class="g-eyes">${eye(86, 12, 4, 0)}${eye(154, 12, 4, 0)}</g>`;
    case 'stern':
    case 'scold':
      return `<g class="g-eyes">${eye(86, 5, 3, 0)}${eye(154, 5, 3, 0)}</g>`;
    case 'thinking':
      return `<g class="g-eyes">${eye(86, 6, 4, 6)}${eye(154, 6, 4, 6)}</g>`;
    default:
      return `<g class="g-eyes">${eye(86, 6, 4, 0)}${eye(154, 6, 4, 0)}</g>`;
  }
}

function mouth(expr: Expression): string {
  switch (expr) {
    case 'angry':
      return `<path d="M90 160 Q120 204 150 160 Q120 172 90 160 Z" fill="#5a1414"/>
              <path d="M97 163 Q120 172 143 163 L141 170 Q120 178 99 170 Z" fill="#fff"/>
              <path d="M104 190 Q120 200 136 190 Q120 184 104 190 Z" fill="#c9503f"/>`;
    case 'shocked':
      return `<ellipse cx="120" cy="172" rx="10" ry="13" fill="#5a1414"/>`;
    case 'nod':
      return `<path d="M104 166 Q120 178 136 166" stroke="${LINE}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    case 'thinking':
      return `<path d="M110 170 Q120 176 130 170" stroke="${LINE}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    case 'stern':
    case 'scold':
      return `<path d="M100 172 Q120 164 140 172" stroke="${LINE}" stroke-width="4" fill="none" stroke-linecap="round"/>
              <path d="M96 176 L100 170 M144 176 L140 170" stroke="${LINE}" stroke-width="2" stroke-linecap="round"/>`;
    default:
      return `<path d="M100 170 Q120 163 140 170" stroke="${LINE}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
  }
}

// 指を立てた手／指差しの手（右側）
function hand(expr: Expression): string {
  if (expr === 'thinking') {
    return `<g transform="translate(206 196)"><g class="g-hand">
      <ellipse cx="0" cy="26" rx="26" ry="18" fill="${HAORI}" stroke="${HAORI_LINE}" stroke-width="2"/>
      <circle cx="0" cy="0" r="20" fill="${SKIN}" stroke="${SKIN_DARK}" stroke-width="2"/>
      <rect x="-7" y="-46" width="14" height="40" rx="7" fill="${SKIN}" stroke="${SKIN_DARK}" stroke-width="2"/>
    </g></g>`;
  }
  if (expr === 'angry' || expr === 'scold') {
    return `<g transform="translate(206 200) rotate(-25)"><g class="g-hand">
      <ellipse cx="0" cy="26" rx="26" ry="18" fill="${HAORI}" stroke="${HAORI_LINE}" stroke-width="2"/>
      <circle cx="0" cy="0" r="20" fill="${SKIN}" stroke="${SKIN_DARK}" stroke-width="2"/>
      <rect x="-7" y="-50" width="14" height="44" rx="7" fill="${SKIN}" stroke="${SKIN_DARK}" stroke-width="2"/>
    </g></g>`;
  }
  return '';
}

// 王将の駒を持つ左手
function pieceHand(): string {
  return `<g transform="translate(36 206)"><g class="g-piece">
    <ellipse cx="4" cy="26" rx="26" ry="18" fill="${HAORI}" stroke="${HAORI_LINE}" stroke-width="2"/>
    <circle cx="0" cy="4" r="19" fill="${SKIN}" stroke="${SKIN_DARK}" stroke-width="2"/>
    <polygon points="0,-30 15,-22 20,10 -20,10 -15,-22" fill="#e9c98b" stroke="#7a5a2a" stroke-width="2"/>
    <text x="0" y="-2" text-anchor="middle" font-size="12" font-weight="700" fill="#3a2a22" font-family="serif">王</text>
    <text x="0" y="8" text-anchor="middle" font-size="10" font-weight="700" fill="#3a2a22" font-family="serif">将</text>
  </g></g>`;
}

function speedLines(): string {
  return `<g class="g-lines" stroke="${LINE}" stroke-width="3" stroke-linecap="round">
    <path d="M14 58 L38 78"/><path d="M4 112 L34 114"/><path d="M14 166 L38 146"/>
    <path d="M226 58 L202 78"/><path d="M236 112 L206 114"/><path d="M226 166 L202 146"/>
  </g>`;
}

export function ojijiSvg(exprIn: Expression, opts: OjijiOptions = {}): string {
  const expr: Expression = exprIn === 'calm' ? 'normal' : exprIn;
  const showPiece = opts.piece ?? (expr === 'normal' || expr === 'nod');
  const cheeks = expr === 'angry' ? 0.75 : expr === 'shocked' ? 0.2 : 0.45;
  return `
<svg class="ojiji expr-${expr}" viewBox="0 0 240 260" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="オジジ">
  ${expr === 'angry' ? speedLines() : ''}
  <!-- 羽織と着物 -->
  <path d="M14 260 L32 196 Q120 172 208 196 L226 260 Z" fill="${HAORI}" stroke="${HAORI_LINE}" stroke-width="2"/>
  <path d="M80 260 L92 194 L120 216 L148 194 L160 260 Z" fill="${KIMONO}"/>
  <path d="M92 194 L120 216 L148 194 L141 191 L120 207 L99 191 Z" fill="#fff"/>
  <circle cx="50" cy="226" r="9" fill="${CREST}"/><circle cx="50" cy="226" r="4" fill="${HAORI}"/>
  <circle cx="190" cy="226" r="9" fill="${CREST}"/><circle cx="190" cy="226" r="4" fill="${HAORI}"/>
  <!-- 首 -->
  <rect x="103" y="172" width="34" height="30" fill="${SKIN_DARK}"/>
  <g class="g-head">
    <!-- 横の白髪（後ろ） -->
    <polygon points="14,112 34,58 66,94 34,146" fill="${HAIR}" stroke="${HAIR_LINE}" stroke-width="2"/>
    <polygon points="226,112 206,58 174,94 206,146" fill="${HAIR}" stroke="${HAIR_LINE}" stroke-width="2"/>
    <!-- 耳 -->
    <ellipse cx="38" cy="126" rx="10" ry="15" fill="${SKIN_DARK}"/>
    <ellipse cx="202" cy="126" rx="10" ry="15" fill="${SKIN_DARK}"/>
    <!-- 顔 -->
    <ellipse cx="120" cy="120" rx="84" ry="80" fill="${SKIN}" stroke="${SKIN_DARK}" stroke-width="2"/>
    <!-- てっぺんの白髪 -->
    <polygon points="86,44 102,58 110,20 124,54 140,22 150,58 166,42 156,70 88,70" fill="${HAIR}" stroke="${HAIR_LINE}" stroke-width="2"/>
    <!-- おでこのしわ・ほお -->
    <path d="M88 78 Q120 70 152 78" stroke="${SKIN_DARK}" stroke-width="2" fill="none"/>
    <path d="M94 90 Q120 82 146 90" stroke="${SKIN_DARK}" stroke-width="2" fill="none"/>
    <ellipse cx="70" cy="148" rx="15" ry="8" fill="#e8806a" opacity="${cheeks}"/>
    <ellipse cx="170" cy="148" rx="15" ry="8" fill="#e8806a" opacity="${cheeks}"/>
    ${brows(expr)}
    ${eyes(expr)}
    <!-- 目の下のたるみ -->
    <path d="M74 134 Q86 140 98 134" stroke="${SKIN_DARK}" stroke-width="2" fill="none"/>
    <path d="M142 134 Q154 140 166 134" stroke="${SKIN_DARK}" stroke-width="2" fill="none"/>
    <!-- 鼻 -->
    <ellipse cx="120" cy="142" rx="13" ry="10" fill="${SKIN_DARK}" opacity="0.9"/>
    <!-- ほうれい線 -->
    <path d="M96 156 Q88 170 94 184" stroke="${SKIN_DARK}" stroke-width="2" fill="none"/>
    <path d="M144 156 Q152 170 146 184" stroke="${SKIN_DARK}" stroke-width="2" fill="none"/>
    ${mouth(expr)}
  </g>
  ${showPiece ? pieceHand() : ''}
  ${hand(expr)}
</svg>`;
}
