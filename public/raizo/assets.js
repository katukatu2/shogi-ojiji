// 雷蔵の素材の場所。base64 内包版（6MB）ではなく sprites/ の透過画像（ロスレス WebP。元の PNG と同じ内容）を URL で渡す。
// raizo-rig.js はこの一覧を読み、名前ごとに画像を読み込む。
(function () {
  var names = ['neutral', 'blink', 'think', 'sip', 'sour', 'shout', 'surprise', 'brow',
    'body', 'sleeve', 'finger', 'point', 'relaxed', 'cup', 'cupSip', 'pointNear', 'teaWrap'];
  var base = new URL('raizo/sprites/', document.baseURI).href;
  var map = {};
  for (var i = 0; i < names.length; i++) map[names[i]] = base + names[i] + '.webp';
  window.RAIZO_RIG_SPRITES = map;
})();
