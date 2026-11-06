/** Coordinated stage/board palettes for the authored material studies.
 * Tile images remain embedded project assets; a theme never changes game state.
 */
export const MATERIAL_THEME_IDS = ['watermelon', 'orange', 'kiwi', 'dragonfruit', 'cheese', 'chocolate', 'ice', 'gold', 'celadon', 'amethyst', 'pearl', 'midnight'] as const;
export type MaterialThemeId = typeof MATERIAL_THEME_IDS[number];
export interface MaterialTheme {
  id: MaterialThemeId;
  title: string;
  stage: { top: string; middle: string; bottom: string; glow: string; accent: string };
  board: { frame: string; frameHighlight: string; slot: string; slotTop: string; slotEdge: string; shadow: string };
  hud: { score: string; best: string };
}
function theme(id: MaterialThemeId, title: string, stage: string[], board: string[], hud = ['#fffaf1', '#ffdc7f']): MaterialTheme {
  return { id, title, stage: { top: stage[0]!, middle: stage[1]!, bottom: stage[2]!, glow: stage[3]!, accent: stage[4]! },
    board: { frame: board[0]!, frameHighlight: board[1]!, slot: board[2]!, slotTop: board[3]!, slotEdge: board[0]!, shadow: 'rgba(12,18,16,0.25)' },
    hud: { score: hud[0]!, best: hud[1]! } };
}
export const MATERIAL_THEMES: Record<MaterialThemeId, MaterialTheme> = {
  watermelon: theme('watermelon', '薄荷瓜园', ['#80b699','#619d7e','#386955','#d3f2c9','#c6e6ae'], ['#153d2e','#91c4a0','#21503b','#285b43']),
  orange: theme('orange', '暖陶橘光', ['#d89971','#b8754b','#805038','#ffe0ac','#f4c991'], ['#57321f','#e4ae70','#70402a','#794a2e']),
  kiwi: theme('kiwi', '鼠尾草果园', ['#a6b186','#839360','#536747','#edf3b7','#d1dda7'], ['#34422b','#aaba7a','#435337','#4a5c3c']),
  dragonfruit: theme('dragonfruit', '莓粉暮光', ['#cf9ab2','#ab708f','#754963','#ffe3eb','#efc1d6'], ['#4e293f','#d49bb5','#60354d','#6d3c56']),
  cheese: theme('cheese', '蜂蜜奶油', ['#dab071','#be904b','#8f6835','#ffe8ac','#f1d198'], ['#604326','#dabb7a','#76512e','#825c35']),
  chocolate: theme('chocolate', '香草可可', ['#e3c9a5','#cfb38c','#ab8967','#fff3d4','#f4e4c2'], ['#9c7d5b','#f2dec1','#b99c77','#c6ab86'], ['#583a2a','#73502d']),
  ice: theme('ice', '极地蓝湾', ['#7dacc5','#4d849f','#294e68','#c4f3ff','#c3edff'], ['#173e53','#95d5e5','#24576d','#2b6379']),
  gold: theme('gold', '香槟夜宴', ['#653d4c','#462b39','#241b29','#c29b79','#d6b57b'], ['#261c25','#c7a46a','#3c2934','#472e39']),
  celadon: theme('celadon', '青瓷水纹', ['#a6cfc3','#6eaaa0','#356760','#e8f8dd','#d7f0df'], ['#28544e','#c0e1ce','#467e73','#4d887c'], ['#f8fff0','#fff0bb']),
  amethyst: theme('amethyst', '紫晶星图', ['#62568f','#40355e','#231c3e','#d5bdfa','#b6a1dc'], ['#29203d','#b09ad1','#36294f','#42335d']),
  pearl: theme('pearl', '珍珠月湾', ['#a8b5c8','#788ca9','#485878','#ffefec','#ede4ee'], ['#526581','#dce6ee','#657d96','#718aa2'], ['#fff9f0','#fce5ac']),
  midnight: theme('midnight', '七彩星轨', ['#36476d','#253254','#151d38','#a1c8ed','#94afda'], ['#17223e','#7a9ac4','#202e4c','#293a5d']),

};
export function materialTheme(id: unknown): MaterialTheme | undefined {
  return typeof id === 'string' && Object.hasOwn(MATERIAL_THEMES, id) ? MATERIAL_THEMES[id as MaterialThemeId] : undefined;
}
/** Only painting bounds change. The grid centers, hit targets, and replay coordinates stay fixed. */
export function materialCellMetrics(gap: number | undefined, pickup = 1) {
  const t = Math.max(0, Math.min(1, pickup));
  if (gap === undefined) return { boardSize: 110, rackSize: 48, dragSize: 50 + 60 * t, dragPitch: 54 + 60 * t, slotInset: 1.5 };
  const spacing = Math.max(0, Math.min(8, gap));
  const pitch = 50 + 62 * t;
  return { boardSize: 112 - spacing, rackSize: 50 - spacing * 50 / 112,
    dragSize: pitch - spacing * pitch / 112, dragPitch: pitch, slotInset: (spacing - 2) / 2 };
}
export function paintMaterialStage(ctx: CanvasRenderingContext2D, theme: MaterialTheme, width: number, height: number): void {
  const s = theme.stage;
  const bg = ctx.createLinearGradient(0, 0, width * .28, height);
  bg.addColorStop(0, s.top); bg.addColorStop(.51, s.middle); bg.addColorStop(1, s.bottom);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(width * .25, height * .07, 0, width * .25, height * .07, width * .9);
  glow.addColorStop(0, s.glow + '42'); glow.addColorStop(1, s.glow + '00');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);
  const bottom = ctx.createRadialGradient(width * .5, height * .86, 0, width * .5, height * .86, width * .63);
  bottom.addColorStop(0, s.glow + '1c'); bottom.addColorStop(1, s.glow + '00');
  ctx.fillStyle = bottom; ctx.fillRect(0, 0, width, height);
  // Quiet material-associated line work lives in the outer margins and below the tray.
  ctx.save(); ctx.strokeStyle = s.accent; ctx.lineWidth = 2;
  if (['celadon', 'pearl', 'amethyst', 'midnight'].includes(theme.id)) {
    ctx.globalAlpha = theme.id === 'amethyst' ? .15 : .12;
    ctx.lineWidth = 1.6;
    if (theme.id === 'celadon' || theme.id === 'pearl') {
      // Repeated engraved wave fans; board paint occludes the center.
      for (let y = -40; y < height + 100; y += 160) for (let x = -90; x < width + 100; x += 180) {
        for (let r = 34; r <= 82; r += 16) {
          ctx.beginPath(); ctx.arc(x + (Math.round(y / 160) % 2) * 90, y, r, Math.PI, Math.PI * 2); ctx.stroke();
        }
      }
    } else {
      for (let y = 40; y < height; y += 170) for (let x = 35; x < width; x += 175) {
        const xx = x + (Math.round(y / 170) % 2) * 75;
        ctx.beginPath(); ctx.moveTo(xx, y - 32); ctx.lineTo(xx + 23, y); ctx.lineTo(xx, y + 32); ctx.lineTo(xx - 23, y); ctx.closePath(); ctx.stroke();
        ctx.beginPath(); ctx.arc(xx + 57, y + 66, 2, 0, Math.PI * 2); ctx.stroke();
      }
    }
  } else if (theme.id === 'gold') {
    ctx.globalAlpha = .13;
    for (let i = 0; i < 3; i++) {
      const m = 24 + i * 13;
      ctx.strokeRect(m, 23 + i * 12, width - 2 * m, height - 46 - i * 24);
    }
    ctx.beginPath(); ctx.moveTo(width*.34,height*.925); ctx.lineTo(width*.5,height*.945); ctx.lineTo(width*.66,height*.925);ctx.stroke();
  } else if (theme.id === 'ice') {
    ctx.globalAlpha = .10;
    for (let i=0;i<5;i++) {ctx.beginPath();ctx.moveTo(width*(-.6+i*.42),0);ctx.lineTo(width*(.4+i*.42),height);ctx.stroke();}
  } else {
    ctx.globalAlpha = .09;
    for (const [cx,cy,rot] of [[width*.04,height*.89,-.55],[width*.97,height*.1,.65]]) {
      ctx.save();ctx.translate(cx!,cy!);ctx.rotate(rot!);
      for(let i=0;i<3;i++) {
        ctx.beginPath();ctx.ellipse(i*36,-i*24,33,100,Math.PI*.24,0,Math.PI*2);ctx.stroke();
      }
      ctx.restore();
    }
  }
  ctx.restore();
  const vignette = ctx.createRadialGradient(width*.5,height*.46,width*.33,width*.5,height*.46,height*.7);
  vignette.addColorStop(0,'rgba(0,0,0,0)');vignette.addColorStop(1,'rgba(12,10,18,0.14)');
  ctx.fillStyle=vignette;ctx.fillRect(0,0,width,height);
}
