// オジジ（雷蔵）の顔素材の場所。raizo-rig.js はこの一覧を読み、名前ごとに画像を読み込む。
// 顔は public/raizo/faces/ の非可逆 WebP（幅 288px、8 点で約 135KB）。scripts/build-faces.py が assets-src/raizo/heads から作る。
(function () {
  var names = ['neutral', 'blink', 'think', 'sip', 'sour', 'shout', 'surprise', 'brow'];
  var base = new URL('raizo/faces/', document.baseURI).href;
  var map = {};
  for (var i = 0; i < names.length; i++) map[names[i]] = base + names[i] + '.webp';
  window.RAIZO_RIG_SPRITES = map;
})();
