import type {SemanticGameEvent} from '../game-runtime/presentationPacket';
import { PRAISE_WORDS, praiseWordLabel } from '../domain/praiseWords';
export const soundEventLabels: Record<string, string> = { 'mahjong.pick': '取牌', 'mahjong.land': '落槽', 'mahjong.match': '双消碰撞', 'mahjong.rejected-tap': '错误点击', 'mahjong.warning': '槽位提醒', 'mahjong.win': '通关', 'mahjong.loss': '失败', 'tap.accepted': '正确点击', 'tap.rejected': '错误点击', 'tile.fly-to-tray': '飞向槽位', 'tray.reordered': '落槽', 'match.resolved': '三消碰撞', 'tray.warning': '槽位提醒', 'game.won': '通关', 'game.lost': '失败', 'block-placement.placement-committed': '正确放置', 'block-placement.line-cleared': '行列消除', 'block-placement.cross-cleared':'十字消除', 'block-placement.game-over': '结束', 'block-placement.input-rejected': '错误放置', 'block-crush-drop.piece-committed': '正确释放', 'block-crush-drop.blocks-eliminated': '消除', 'block-crush-drop.outcome': '结束', 'block-crush-drop.input-rejected': '错误释放' };
for (const word of PRAISE_WORDS) soundEventLabels[`block-placement.praise-${word}`] = `鼓励语 ${praiseWordLabel(word)}`;
soundEventLabels['block-crush-drop.piece-landed'] = '落地接触';
soundEventLabels['block-crush-drop.single-line-cleared'] = '单行消除';
soundEventLabels['block-crush-drop.multi-line-cleared'] = '多行消除';
const eventTypesByGame:Record<string,string[]>={
  'vita-mahjong-solitaire':['mahjong.pick','mahjong.land','mahjong.match','mahjong.rejected-tap','mahjong.warning','mahjong.win','mahjong.loss'],
  'taptile-tray-match3':['tap.accepted','tap.rejected','tile.fly-to-tray','tray.reordered','match.resolved','tray.warning','game.won','game.lost'],
  'block-placement':Object.keys(soundEventLabels).filter(type=>type.startsWith('block-placement.')),
  'block-crush-drop':Object.keys(soundEventLabels).filter(type=>type.startsWith('block-crush-drop.')),
};
const nativeDefaultAudioGames=new Set(['taptile-tray-match3']);
export function soundEventsForGame(gameId: string) { return [...(eventTypesByGame[gameId]??[])]; }
export function usesNativeDefaultAudio(gameId:string){return nativeDefaultAudioGames.has(gameId);}

/** A per-action settlement is not necessarily a terminal result. */
export function soundEventAudible(event:SemanticGameEvent){return event.type!=='block-crush-drop.outcome'||event.tags.some(tag=>['won','lost','game-over'].includes(tag));}
