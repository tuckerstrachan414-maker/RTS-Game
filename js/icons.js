'use strict';
// Extra HUD icons, drawn from pixel grids at load time.
//
// assets/icons16x16.png holds the original 28 icons and there is no free cell
// in it. The systems added since (knowledge, Ages, leaders, the chronicle,
// victory) need icons in the same chunky 16px style, so rather than hand-edit
// the sheet they are written here as character grids and turned into data URLs
// on boot. Each becomes a `.icon-<name>` class that works exactly like the
// sheet's own (`icon('book')` in js/ui.js).
//
// One character per pixel; '.' is transparent; everything else looks up the
// icon's palette.

const PIXEL_ICONS = {
  book: {
    pal: { k: '#3a2616', c: '#efe4c4', s: '#c9b98f', r: '#b04b3a', d: '#7a2f24' },
    rows: [
      '................',
      '................',
      '..kkkkk..kkkkk..',
      '.kccccck.kccccck',
      '.kcsscck.kcsscck',
      '.kccccck.kccccck',
      '.kcsscckkkcsscck',
      '.kccccckckccccck',
      '.kcsscckckcsscck',
      '.kccccckckccccck',
      '.kkkkkcckcckkkkk',
      '.rrrrrkkkkkrrrrr',
      '..dddddddddddd..',
      '................',
      '................',
      '................',
    ],
  },
  scroll: {
    pal: { k: '#3a2616', c: '#efe4c4', s: '#b8a47a', r: '#b04b3a' },
    rows: [
      '................',
      '...kkkkkkkkkk...',
      '..kcccccccccck..',
      '..ksccccccccsk..',
      '...kcsssssscck..',
      '...kcccccccck...',
      '...kcsssssscck..',
      '...kcccccccck...',
      '...kcssssscck...',
      '...kcccccccck...',
      '...kcsssssscck..',
      '..kcccccccccck..',
      '..ksccccccccskr.',
      '...kkkkkkkkkk.rr',
      '...............r',
      '................',
    ],
  },
  star: {
    pal: { k: '#5c4312', y: '#ffd24a', w: '#fff3b0' },
    rows: [
      '................',
      '.......kk.......',
      '......kyyk......',
      '......kyyk......',
      '.....kywyyk.....',
      'kkkkkkywyyykkkkk',
      'kyyyyyywyyyyyyyk',
      '.kyyyyyyyyyyyyk.',
      '..kyyyyyyyyyyk..',
      '...kyyyyyyyyk...',
      '...kyyyykyyyk...',
      '..kyyyykkyyyyk..',
      '..kyyykk.kkyyk..',
      '.kyykk....kkyyk.',
      '.kkk........kkk.',
      '................',
    ],
  },
  flag: {
    pal: { k: '#2e2014', p: '#8f6436', r: '#c95a4a', w: '#e8836f' },
    rows: [
      '................',
      '..kk............',
      '..kpkkkkkkkk....',
      '..kprrrrrrrrk...',
      '..kprwwrrrrrrk..',
      '..kprrrrrrrrrk..',
      '..kprrrrrwrrk...',
      '..kprrrrrrrk....',
      '..kprrrrrrrrk...',
      '..kpkkkkkkkkk...',
      '..kpk...........',
      '..kpk...........',
      '..kpk...........',
      '.kkpkk..........',
      '.kpppk..........',
      '.kkkkk..........',
    ],
  },
  trophy: {
    pal: { k: '#5c4312', y: '#ffd24a', w: '#fff3b0', o: '#c9962e' },
    rows: [
      '................',
      '..kkkkkkkkkkkk..',
      'kkkywwyyyyyyykkk',
      'ky.kywyyyyyyk.yk',
      'ky.kywyyyyyyk.yk',
      '.ky.kyyyyyyk.yk.',
      '..kk.kyyyyk.kk..',
      '......kyyk......',
      '.......oo.......',
      '.......oo.......',
      '......kyyk......',
      '.....kyyyyk.....',
      '....kooooook....',
      '....kkkkkkkk....',
      '................',
      '................',
    ],
  },
  quill: {
    pal: { k: '#2e2014', w: '#efe9dc', g: '#b8b2a4', i: '#1e2a44' },
    rows: [
      '................',
      '............kk..',
      '...........kwwk.',
      '..........kwgwk.',
      '.........kwgwk..',
      '........kwgwk...',
      '.......kwgwk....',
      '......kwgwk.....',
      '.....kwgwk......',
      '....kwgwk.......',
      '....kwwk........',
      '...kkkk.........',
      '...kk...........',
      '..k.............',
      '.iiiiiii........',
      '................',
    ],
  },
  pillar: {
    pal: { k: '#3d3a38', s: '#cfc6b8', m: '#a0938e', d: '#7d7071' },
    rows: [
      '................',
      '.kkkkkkkkkkkkkk.',
      '.ksssssssssssmk.',
      '..kkkkkkkkkkkk..',
      '...ksmskmsmsk...',
      '...ksmskmsmsk...',
      '...ksmskmsmsk...',
      '...ksmskmsmsk...',
      '...ksmskmsmsk...',
      '...ksmskmsmsk...',
      '...ksmskmsmsk...',
      '...ksmskmsmsk...',
      '..kkkkkkkkkkkk..',
      '.ksssssssssssmk.',
      '.kddddddddddddk.',
      '.kkkkkkkkkkkkkk.',
    ],
  },
  tower: {
    pal: { k: '#2e2a28', s: '#cfc6b8', m: '#a0938e', d: '#6a605c', b: '#2b1f16' },
    rows: [
      '................',
      '..kkk.kkk.kkk...',
      '..ksk.ksk.ksk...',
      '..kskkkskkkskk..',
      '..kssssssssssk..',
      '..kmmmmmmmmmmk..',
      '...kssssssssk...',
      '...ksmmsmmssk...',
      '...kssssbsssk...',
      '...ksmmbbbmsk...',
      '...kssssbsssk...',
      '...ksmmmmmmsk...',
      '...kssssssssk...',
      '..kddddddddddk..',
      '..kkkkkkkkkkkk..',
      '................',
    ],
  },
  catapult: {
    pal: { k: '#2e2014', l: '#c08a4e', m: '#8f6436', g: '#9a9a98' },
    rows: [
      '................',
      '..........l.....',
      '.........m......',
      '........m.......',
      '.......m...kkk..',
      '......mm...kgk..',
      '.gg..m.m...kkk..',
      '.ggkm..m........',
      '.kkm...m........',
      'kmmmmmmmmmmmmmk.',
      'kllllllllllllk..',
      '..kkk.....kkk...',
      '.kmmmk...kmmmk..',
      '..kkk.....kkk...',
      '................',
      '................',
    ],
  },
  eye: {
    pal: { k: '#2e2014', w: '#efe9dc', b: '#4a90d9', i: '#1e2a44' },
    rows: [
      '................',
      '................',
      '................',
      '.....kkkkkk.....',
      '...kkwwwwwwkk...',
      '..kwwwwbbwwwwk..',
      '.kwwwwbbbbwwwwk.',
      'kwwwwbbiibbwwwwk',
      'kwwwwbbiibbwwwwk',
      '.kwwwwbbbbwwwwk.',
      '..kwwwwbbwwwwk..',
      '...kkwwwwwwkk...',
      '.....kkkkkk.....',
      '................',
      '................',
      '................',
    ],
  },
  upgrade: {
    pal: { k: '#3a2616', y: '#ffd24a', o: '#c98f1c', s: '#a9a39a', d: '#6f6a62' },
    rows: [
      '.......kk.......',
      '......kyyk......',
      '.....kyyyyk.....',
      '....kyyyyyyk....',
      '...kyyyyyyyyk...',
      '...kkkyyyykkk...',
      '.....kyooyk.....',
      '.....kyooyk.....',
      '.....kyooyk.....',
      '.....kkkkkk.....',
      '.kkkkkkkkkkkkkk.',
      '.kssssssdsssssk.',
      '.kssssssdsssssk.',
      '.kddddddddddddk.',
      '.ksssdssssssdsk.',
      '.kkkkkkkkkkkkkk.',
    ],
  },
  chevron: {
    pal: { k: '#5c4312', y: '#ffd24a' },
    rows: [
      '................',
      '................',
      '.k............k.',
      'kyk..........kyk',
      '.kyk........kyk.',
      '..kyk......kyk..',
      '...kyk....kyk...',
      '....kyk..kyk....',
      '.k...kykkyk...k.',
      'kyk...kyyk...kyk',
      '.kyk...kk...kyk.',
      '..kyk......kyk..',
      '...kyk....kyk...',
      '....kyk..kyk....',
      '.....kykkyk.....',
      '......kkkk......',
    ],
  },
};

(function installPixelIcons() {
  const rules = [];
  for (const [name, def] of Object.entries(PIXEL_ICONS)) {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    const g = c.getContext('2d');
    def.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const col = def.pal[row[x]];
        if (!col) continue;
        g.fillStyle = col;
        g.fillRect(x, y, 1, 1);
      }
    });
    rules.push(`.icon.icon-${name} { background-image: url(${c.toDataURL()}); background-size: 100% 100%; background-position: 0 0; }`);
  }
  const style = document.createElement('style');
  style.textContent = rules.join('\n');
  document.head.appendChild(style);
})();
