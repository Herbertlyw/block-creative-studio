import { expect, it } from 'vitest';
import { paintBoardCells } from '../src/games/block-placement/rendering/boardLayer';

it('preserves interleaved and separate board pass order without painting empty tiles', () => {
  const cells = [
    { row: 0, col: 0, x: 0, y: 0, size: 10, color: 'blue' },
    { row: 0, col: 1, x: 10, y: 0, size: 10, color: null },
    { row: 1, col: 0, x: 0, y: 10, size: 10, color: 'red' },
  ];
  const output: string[] = [],
    painters = {
      slot: (cell: (typeof cells)[number]) => output.push(`s${cell.row}${cell.col}`),
      occupied: (cell: (typeof cells)[number]) => output.push(`t${cell.row}${cell.col}`),
    };
  paintBoardCells(cells, 'interleaved', painters);
  expect(output).toEqual(['s00', 't00', 's01', 's10', 't10']);
  output.length = 0;
  paintBoardCells(cells, 'slots', painters);
  paintBoardCells(cells, 'occupied', painters);
  expect(output).toEqual(['s00', 's01', 's10', 't00', 't10']);
});
