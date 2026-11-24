/**
 * 一盘棋的局面序列。
 *
 * 复盘、时间轴回看、棋谱导出都靠这里，所以它们说的"第 n 手之后"是同一个意思：
 * 从**这盘棋真正的开局位置**重放。开局不是标准局时（导入带 [FEN] 标签的棋谱、
 * 课堂里从残局摆开），拿标准局重放会得出每一手都错、而且错得很安静的结果。
 */

import { Chess } from '../engine/chess.js';

/** FEN 的前四段：棋盘、行棋方、易位权、吃过路兵。步数与钟不进「同一局面」的判定。 */
export function fenCore(fen) {
  return String(fen ?? '').trim().split(/\s+/).slice(0, 4).join(' ');
}

function apply(replay, move) {
  return replay.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
}

/**
 * 第 `plies` 手之后的局面（`plies === 0` 就是开局位置）。
 * 走不通时返回 null —— 调用方手里的 history 与开局位置不配套。
 */
export function positionAt(originFen, history, plies) {
  const replay = new Chess(originFen);
  for (let i = 0; i < plies; i++) {
    if (!history[i] || !apply(replay, history[i])) return null;
  }
  return replay;
}

/**
 * 整盘棋每个 ply 之后的 FEN，长度 = history.length + 1。
 *
 * 开局位置若撑不起这些走法，或者走完不是 `currentFen`，返回 error 而不是硬凑一份：
 * 错误的局面喂给引擎会产出看起来很专业的错误结论。
 */
export function replayFens(originFen, history, currentFen = null) {
  let replay;
  try {
    replay = new Chess(originFen);
  } catch {
    return { fens: null, error: '记录的开局位置不是合法 FEN' };
  }
  const fens = [replay.fen()];
  for (let i = 0; i < history.length; i++) {
    if (!history[i] || !apply(replay, history[i])) {
      return { fens: null, error: `第 ${i + 1} 手在记录的开局位置里走不通` };
    }
    fens.push(replay.fen());
  }
  if (currentFen && fenCore(fens[fens.length - 1]) !== fenCore(currentFen)) {
    return { fens: null, error: '走法记录和棋盘当前局面不一致，不能复盘' };
  }
  return { fens, error: null };
}
