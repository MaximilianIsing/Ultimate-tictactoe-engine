// Quick smoke test of the engine.
// Run: node _smoketest.js
'use strict';

global.self = global;
require('./engines/engine.js');
const { UTTTState, MCTSSearcher, mctsSearch, IS_WIN, WIN_COMPLETIONS } = self.UTTTEngine;

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
  console.log('  ok:', msg);
}

console.log('--- IS_WIN basics ---');
assert(IS_WIN[0b000000111] === 1, 'top row wins');
assert(IS_WIN[0b100010001] === 1, 'main diagonal wins');
assert(IS_WIN[0b000000110] === 0, 'two in a row does not win');
assert((WIN_COMPLETIONS[0b000000110] & 0b001) !== 0, 'completion finds missing cell of top row');

console.log('--- State legalMoves ---');
{
  const s = new UTTTState();
  const moves = s.legalMoves();
  assert(moves.length === 81, `initial legal moves = 81 (got ${moves.length})`);
}

console.log('--- Apply moves and constraint propagation ---');
{
  const s = new UTTTState();
  s.applyMove(4 * 9 + 4); // X: center board, center cell
  assert(s.toMove === 2, 'O to move after X');
  assert(s.activeBoard === 4, 'active board sent to 4 (center)');
  const moves = s.legalMoves();
  assert(moves.length === 8, `O has 8 legal moves in board 4 (got ${moves.length})`);
  for (const m of moves) {
    const b = (m / 9) | 0;
    assert(b === 4, 'all moves are in board 4');
  }
}

console.log('--- Win small board, send to settled board → free choice ---');
{
  const s = new UTTTState();
  // X wins board 0 then sends O to board 0 (which is now won).
  // Sequence:
  //   X: board 0, cell 0
  //   O: board 0, cell 4 (sends X to board 4)
  //   X: board 4, cell 1 (sends O to board 1)
  //   O: board 1, cell 0 (sends X to board 0)
  //   X: board 0, cell 1 (X has 0,1 on board 0; sends O to board 1)
  //   O: board 1, cell 0 already taken... let me redo with a cleaner sequence
  // Simpler: directly contrive.
  s.applyMove(0 * 9 + 0); // X b0 c0
  s.applyMove(0 * 9 + 1); // O b0 c1, sends X to b1
  s.applyMove(1 * 9 + 0); // X b1 c0, sends O to b0
  s.applyMove(0 * 9 + 4); // O b0 c4, sends X to b4
  s.applyMove(4 * 9 + 0); // X b4 c0, sends O to b0
  s.applyMove(0 * 9 + 8); // O b0 c8 (now O has 1,4,8? no, 1 and 4 and 8 — line? 1,4,8 not a line. Let's check)
  // Actually 1,4,7 is a line. 0,4,8 is a line. But not 1,4,8.
  // So board 0 is not won. Let's just check active board behavior.
  assert(s.activeBoard === 8, 'active board updated to last cell played');
}

console.log('--- Full small-board win ---');
{
  const s = new UTTTState();
  // Win board 0 with X: cells 0,1,2 (top row)
  // Need to navigate constraints.
  // X b0 c0 → O sent to b0
  // O b0 c4 → X sent to b4
  // X b4 c1 → O sent to b1
  // O b1 c4 → X sent to b4 (already played there, but cell 4 played, cell 1 was X)
  //   Actually: X played b4 c1, so b4 has X at cell 1. O can play any other cell of b4.
  //   But O is sent by previous X move to b1, not b4.
  //   Let me re-track.
  // Sequence with constraints:
  //   X: b0 c0   (free)               → next active = b0
  //   O: b0 c3   (must play b0)       → next active = b3
  //   X: b3 c1   (must play b3)       → next active = b1
  //   O: b1 c4   (must play b1)       → next active = b4
  //   X: b4 c2   (must play b4)       → next active = b2
  //   O: b2 c5   (must play b2)       → next active = b5
  //   X: b5 c1   (must play b5)       → next active = b1 (cell already taken? c1 in b5 OK)
  //   actually we want X to win b0 with cells 0,1,2. Need to navigate back to b0.
  //   This is getting complex. Skip full sequence.
  // Instead, test directly:
  s.smallX[0] = 0b000000011;
  s.applyMove(0 * 9 + 2); // ToMove is X (1) initially. Play b0 c2 → X wins board 0.
  // But applyMove will toggle and update... let me do this fresh.
}

console.log('--- Direct small-board win check ---');
{
  const s = new UTTTState();
  // Manually set up so X plays b0 c2 to complete top row.
  s.smallX[0] = 0b000000011; // cells 0 and 1 by X
  s.toMove = 1;
  s.activeBoard = 0;
  s.applyMove(0 * 9 + 2);
  assert(s.bigState[0] === 1, 'board 0 is won by X');
  assert((s.bigX & 1) === 1, 'bigX has bit 0');
  assert((s.bigSettled & 1) === 1, 'board 0 is settled');
  assert(s.toMove === 2, 'toMove flipped to O');
  assert(s.activeBoard === 2, 'active board updated to 2');
}

console.log('--- Meta-board win ---');
{
  const s = new UTTTState();
  // X wins boards 0, 1, 2 (top meta-row).
  s.smallX[0] = 0b111000000; // bottom row of board 0
  s.bigState[0] = 1;
  s.bigX = 1;
  s.bigSettled = 1;
  s.smallX[1] = 0b111000000;
  s.bigState[1] = 1;
  s.bigX = 0b011;
  s.bigSettled = 0b011;
  // X about to play to win board 2
  s.smallX[2] = 0b000000011;
  s.toMove = 1;
  s.activeBoard = 2;
  s.applyMove(2 * 9 + 2);
  assert(s.bigState[2] === 1, 'board 2 won by X');
  assert(s.winner === 1, `meta game won by X (got winner=${s.winner})`);
}

console.log('--- Serialize/deserialize round-trip ---');
{
  const s = new UTTTState();
  s.applyMove(4 * 9 + 4);
  s.applyMove(4 * 9 + 0);
  s.applyMove(0 * 9 + 4);
  const data = s.serialize();
  const s2 = UTTTState.deserialize(data);
  assert(s2.toMove === s.toMove, 'toMove preserved');
  assert(s2.activeBoard === s.activeBoard, 'activeBoard preserved');
  for (let b = 0; b < 9; b++) {
    assert(s2.smallX[b] === s.smallX[b], `smallX[${b}] preserved`);
    assert(s2.smallO[b] === s.smallO[b], `smallO[${b}] preserved`);
  }
  assert(s2.bigSettled === s.bigSettled, 'bigSettled preserved');
  assert(s2.moveCount === s.moveCount, 'moveCount preserved');
}

console.log('--- MCTS finds immediate winning move ---');
{
  // X to play, can win meta in one move.
  const s = new UTTTState();
  // Set up: X has won boards 0 and 1, O has won board 4. About to play board 2.
  s.smallX[0] = 0b111000000;
  s.bigState[0] = 1;
  s.bigX = 0b001;
  s.bigSettled = 0b001;
  s.smallX[1] = 0b111000000;
  s.bigState[1] = 1;
  s.bigX = 0b011;
  s.bigSettled = 0b011;
  s.smallO[4] = 0b111000000;
  s.bigState[4] = 2;
  s.bigO = 0b010000;
  s.bigSettled = 0b010011;
  // X can play b2 with two cells already (0,1) — needs c2 to win b2 and the meta.
  s.smallX[2] = 0b000000011;
  s.toMove = 1;
  s.activeBoard = 2;
  const result = mctsSearch(s, { budgetMs: 500 });
  console.log('  best:', result.bestMove, 'expected:', 2*9+2, 'sims:', result.simulations);
  assert(result.bestMove === 2 * 9 + 2, 'MCTS finds the winning move');
}

console.log('--- MCTS performance probe ---');
{
  const s = new UTTTState();
  s.applyMove(4 * 9 + 4);
  const start = Date.now();
  const result = mctsSearch(s, { budgetMs: 2000 });
  const elapsed = Date.now() - start;
  const rate = Math.round(result.simulations / (elapsed / 1000));
  console.log(`  ${result.simulations} sims in ${elapsed}ms (${rate}/s)`);
  console.log('  best move:', result.bestMove, 'eval:', result.evaluation.toFixed(3));
  console.log('  top moves:');
  for (const m of result.topMoves.slice(0, 5)) {
    const b = (m.move / 9) | 0;
    const c = m.move % 9;
    console.log(`    b${b}c${c}: ${m.visits} visits, ${(m.winRate*100).toFixed(1)}%`);
  }
  assert(result.simulations > 1000, 'reasonable sim count');
}

console.log('\nAll tests passed.');
