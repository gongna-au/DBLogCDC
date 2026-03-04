
export type Key = string;

export interface LogEntry {
  id: string;
  key: Key;
  type: 'INSERT' | 'UPDATE' | 'DELETE' | 'WATERMARK';
  value?: string;
  watermarkType?: 'L' | 'H';
  source: 'USER' | 'DBLOG';
}

export interface ChunkItem {
  key: Key;
  value: string;
}

export type AnimationStep = 
  | 'IDLE'
  | 'PAUSE'
  | 'WRITE_L'
  | 'SELECT_CHUNK'
  | 'WRITE_H'
  | 'RESUME'
  | 'CONSUMING'
  | 'FLUSH_CHUNK'
  | 'DISPATCH'
  | 'COMPLETE';

export interface AppState {
  step: AnimationStep;
  mysqlData: Record<Key, string>;
  binlogQueue: LogEntry[];
  chunkMemory: ChunkItem[];
  outputBuffer: LogEntry[];
  kafkaStream: LogEntry[];
  isPaused: boolean;
  windowActive: boolean;
}
