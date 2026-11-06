import { useEffect, useState } from 'react';
import type { BBWorkPackage } from '../contracts/bbWorkPackage';
import {
  SHAPES,
  TILE_COLORS,
  getShape,
} from '../nativeReference/games/block-placement/runtime/shapes';

type SupplyPiece = { shapeId: string; color: string; cellColors?: string[] };
type RunOperation = (
  operation: () => Promise<BBWorkPackage>,
  next?: string,
  applied?: () => void,
) => Promise<void>;
/** Fixed and seeded supply editor; uncommitted rounds remain separate from the work. */
export function NativeSupplyEditor({
  work,
  supply,
  seed,
  busy,
  locked,
  run,
  onDraftChange,
}: {
  work: BBWorkPackage;
  supply: SupplyPiece[][];
  seed: number;
  busy: boolean;
  locked: boolean;
  run: RunOperation;
  onDraftChange: ((editor: string, dirty: boolean) => void) | undefined;
}) {
  const normalize = (value: SupplyPiece[][]) =>
    value.map((round) =>
      round.map((piece) => ({
        shapeId: piece.shapeId,
        color: piece.color,
        ...(Array.isArray(piece.cellColors) ? { cellColors: [...piece.cellColors] } : {}),
      })),
    );
  const snapshot = JSON.stringify(normalize(supply));
  const [rounds, setRounds] = useState<SupplyPiece[][]>(() => normalize(supply));
  const [seedDraft, setSeedDraft] = useState(seed);
  useEffect(() => {
    setRounds(JSON.parse(snapshot));
  }, [snapshot]);
  useEffect(() => {
    setSeedDraft(seed);
  }, [seed]);
  const draft = JSON.stringify(rounds) !== snapshot || seedDraft !== seed;
  useEffect(() => {
    onDraftChange?.('supply-form', draft);
  }, [onDraftChange, draft]);
  useEffect(() => () => onDraftChange?.('supply-form', false), [onDraftChange]);
  function setSupplyCellColor(
    roundIndex: number,
    slotIndex: number,
    cellIndex: number,
    color: string,
  ) {
    setRounds((old) =>
      old.map((round, r) =>
        round.map((piece, c) => {
          if (r !== roundIndex || c !== slotIndex) return piece;
          const count = getShape(piece.shapeId).cells.length,
            cellColors =
              piece.cellColors?.length === count
                ? [...piece.cellColors]
                : Array<string>(count).fill(piece.color);
          cellColors[cellIndex] = color;
          return { ...piece, cellColors };
        }),
      ),
    );
  }
  return (
    <details>
      <summary>固定供给轮次</summary>
      <p>
        每轮明确三个候选；可逐格指定颜色。更换形状会重置逐格颜色，更换整块颜色会统一该候选的逐格颜色。修改后会逐步重验已有
        Take；不合法时保留原作品。
      </p>
      {rounds.map((round, ri) => (
        <div key={ri}>
          <strong>第 {ri + 1} 轮</strong>
          {round.map((piece, si) => (
            <div key={si} style={{ display: 'inline-block', verticalAlign: 'top' }}>
              <label>
                候选 {si + 1}{' '}
                <select
                  aria-label={`第 ${ri + 1} 轮候选 ${si + 1} 形状`}
                  value={piece.shapeId}
                  onChange={(e) =>
                    setRounds((old) =>
                      old.map((row, r) =>
                        row.map((item, c) =>
                          r === ri && c === si
                            ? { shapeId: e.target.value, color: item.color }
                            : item,
                        ),
                      ),
                    )
                  }
                >
                  {SHAPES.map((shape) => (
                    <option key={shape.id} value={shape.id}>
                      {shape.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                颜色{' '}
                <select
                  aria-label={`第 ${ri + 1} 轮候选 ${si + 1} 颜色`}
                  value={piece.color}
                  onChange={(e) =>
                    setRounds((old) =>
                      old.map((row, r) =>
                        row.map((item, c) =>
                          r === ri && c === si
                            ? {
                                ...item,
                                color: e.target.value,
                                ...(item.cellColors
                                  ? { cellColors: item.cellColors.map(() => e.target.value) }
                                  : {}),
                              }
                            : item,
                        ),
                      ),
                    )
                  }
                >
                  {TILE_COLORS.map((color) => (
                    <option key={color} value={color}>
                      {color}
                    </option>
                  ))}
                </select>
              </label>
              <details>
                <summary>候选 {si + 1} 逐格颜色</summary>
                {getShape(piece.shapeId).cells.map(([r, c], index) => (
                  <label key={index}>
                    格 ({r + 1},{c + 1}){' '}
                    <select
                      aria-label={`第 ${ri + 1} 轮候选 ${si + 1} 第 ${index + 1} 格颜色`}
                      value={piece.cellColors?.[index] ?? piece.color}
                      onChange={(e) => setSupplyCellColor(ri, si, index, e.target.value)}
                    >
                      {TILE_COLORS.map((color) => (
                        <option key={color} value={color}>
                          {color}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </details>
            </div>
          ))}
          <button
            disabled={rounds.length === 1}
            onClick={() => setRounds((old) => old.filter((_, i) => i !== ri))}
          >
            删除轮次
          </button>
        </div>
      ))}
      <button
        onClick={() =>
          setRounds((old) => [
            ...old,
            (old.at(-1) ?? []).map((piece) => ({
              ...piece,
              ...(piece.cellColors ? { cellColors: [...piece.cellColors] } : {}),
            })),
          ])
        }
      >
        追加轮次
      </button>{' '}
      <button
        disabled={busy || locked}
        onClick={() =>
          void run(async () => {
            const { setNativeFixedSupply } = await import('../contracts/nativeWorkAuthor');
            return setNativeFixedSupply(work, rounds);
          })
        }
      >
        核验并应用固定供给
      </button>{' '}
      <button
        disabled={busy || locked}
        onClick={() =>
          void run(async () => {
            const { setNativeSeededSupply } = await import('../contracts/nativeWorkAuthor');
            return setNativeSeededSupply(work);
          })
        }
      >
        核验并恢复种子供给
      </button>
      <p>
        当前种子：{seed}
        。恢复时从第一轮起使用七色单色的确定性发牌，并重验所有 Take；无法重放时保留原作品。
      </p>
      <label>
        作品种子{' '}
        <input
          aria-label="作品种子"
          type="number"
          min={0}
          max={2147483647}
          step={1}
          value={seedDraft}
          disabled={busy || locked}
          onChange={(e) => setSeedDraft(e.target.valueAsNumber)}
        />
      </label>{' '}
      <button
        disabled={busy || locked}
        onClick={() =>
          void run(async () => {
            const { setNativeSeed } = await import('../contracts/nativeWorkAuthor');
            return setNativeSeed(work, seedDraft);
          })
        }
      >
        核验并应用种子
      </button>
      <p>种子供给会重新生成第一轮；固定供给保留原候选。两种情况均重验全部 Take。</p>
    </details>
  );
}
