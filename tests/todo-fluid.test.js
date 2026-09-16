import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticTodoCard } from '../todo-fluid.js';

test('only the populated card expands automatically, including after the last item is completed', () => {
  assert.equal(automaticTodoCard([0, 7]), 1);
  assert.equal(automaticTodoCard([3, 0]), 0);
  assert.equal(automaticTodoCard([3, 7]), null);
  assert.equal(automaticTodoCard([0, 0]), null);
});
