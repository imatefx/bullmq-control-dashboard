import { describe, expect, it } from 'vitest';
import { COMBINED_ID, combinedBoard, destroyBoard, ensureBoard, getBoardRouter } from '../../src/bullboard.js';

describe('bull-board registry', () => {
  it('creates one board per connection and reuses it', () => {
    const a = ensureBoard('c1');
    expect(ensureBoard('c1')).toBe(a);
    expect(ensureBoard('c2')).not.toBe(a);
    expect(typeof getBoardRouter('c1')).toBe('function');
  });

  it('forgets destroyed boards', () => {
    ensureBoard('gone');
    destroyBoard('gone');
    expect(getBoardRouter('gone')).toBeUndefined();
  });

  it('exposes the combined board under a reserved id', () => {
    expect(combinedBoard()).toBe(ensureBoard(COMBINED_ID));
  });
});
