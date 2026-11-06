export type CreativeDocumentKind =
  | 'public-studio-v1'
  | 'placement-v2'
  | 'studio-v2'
  | 'game-replay-v1'
  | 'local-library-composition'
  | 'unknown';

export interface CreativeDocumentIdentity {
  kind: CreativeDocumentKind;
  loadable: boolean;
  detail: string;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function gameIdOf(source: Record<string, unknown>): string | null {
  const game = record(source.game);
  const identity = game ? record(game.game) : null;
  return identity && typeof identity.id === 'string' ? identity.id : null;
}

export function identifyCreativeDocument(value: unknown): CreativeDocumentIdentity {
  const source = record(value);
  if (!source) {
    return {
      kind: 'unknown',
      loadable: false,
      detail: '文件不是 JSON 对象。',
    };
  }

  if (source.format === 'block-creative-studio-project' && source.version === '1.0.0') {
    return {
      kind: 'public-studio-v1',
      loadable: false,
      detail: '此展示版本不支持旧格式 block-creative-studio-project；原文件没有修改。',
    };
  }

  if (source.format === 'bcs-studio-project' && source.version === '2.0.0') {
    const gameId = gameIdOf(source);
    if (gameId === 'block-placement') {
      return {
        kind: 'placement-v2',
        loadable: false,
        detail: '识别为 BB 工程；依赖核验通过后进入作品会话。',
      };
    }
    return {
      kind: 'studio-v2',
      loadable: false,
      detail: `识别为原生工程外层 V2（format=bcs-studio-project, version=2.0.0, game=${gameId ?? '未标明'}）。当前编辑器只实现 BB 拖消公开包，不会打开或转换这份文件。`,
    };
  }

  if (source.contract === 'bcs.game-replay') {
    return {
      kind: 'game-replay-v1',
      loadable: false,
      detail: '识别为动作回放合同 bcs.game-replay，不是可编辑工程。未导入。',
    };
  }

  if (source.contract === 'bcs.local-library-composition') {
    return {
      kind: 'local-library-composition',
      loadable: false,
      detail: '识别为本地素材库组合清单，不是可玩的拖消工程。未导入。',
    };
  }

  return {
    kind: 'unknown',
    loadable: false,
    detail: '无法识别作品格式。请选择 BB 作品包或受支持的 BB 工程。',
  };
}
