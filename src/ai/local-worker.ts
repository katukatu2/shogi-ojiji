import { Position } from '../engine/position';
import { chooseMove, SearchOptions } from './search';

// structured clone で届く盤面にメソッドを戻す。探索中の apply/undo はこの複製だけに作用する。
self.onmessage = (event: MessageEvent<{ position: Position; options: SearchOptions }>) => {
  const position = Object.assign(new Position(), event.data.position);
  self.postMessage(chooseMove(position, event.data.options));
};
