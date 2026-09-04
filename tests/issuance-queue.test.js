import assert from "node:assert/strict";
import test from "node:test";
import { createSequentialIssuanceQueue, ISSUANCE_QUEUE_STATUS } from "../issuance-queue.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("processes rapid issuance submissions strictly one at a time", async () => {
  const gates = [deferred(), deferred(), deferred()];
  const starts = [];
  const completions = deferred();
  const finished = [];
  const queue = createSequentialIssuanceQueue(async (payload) => {
    starts.push(payload.name);
    await gates[payload.index].promise;
    return { canApply: true, name: payload.name };
  }, (task) => {
    if (task.status === ISSUANCE_QUEUE_STATUS.READY) {
      finished.push(task.payload.name);
      if (finished.length === 3) completions.resolve();
    }
  });

  const tasks = ["甲", "乙", "丙"].map((name, index) => queue.enqueue({ name, index }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(starts, ["甲"]);

  gates[0].resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(starts, ["甲", "乙"]);
  gates[1].resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(starts, ["甲", "乙", "丙"]);
  gates[2].resolve();
  await completions.promise;

  assert.deepEqual(finished, ["甲", "乙", "丙"]);
  assert.equal(queue.get(tasks[2].id).status, ISSUANCE_QUEUE_STATUS.READY);
});

test("continues with the next result after an isolated recognition failure", async () => {
  const final = deferred();
  const statuses = [];
  const queue = createSequentialIssuanceQueue(async ({ name }) => {
    if (name === "失败") throw new Error("模型暂不可用");
    return { canApply: false };
  }, (task) => {
    if ([ISSUANCE_QUEUE_STATUS.ERROR, ISSUANCE_QUEUE_STATUS.REVIEW].includes(task.status)) {
      statuses.push([task.payload.name, task.status]);
      if (statuses.length === 2) final.resolve();
    }
  });

  queue.enqueue({ name: "失败" });
  queue.enqueue({ name: "待核对" });
  await final.promise;

  assert.deepEqual(statuses, [
    ["失败", ISSUANCE_QUEUE_STATUS.ERROR],
    ["待核对", ISSUANCE_QUEUE_STATUS.REVIEW],
  ]);
});
