export const ISSUANCE_QUEUE_STATUS = Object.freeze({
  QUEUED: "queued",
  PROCESSING: "processing",
  READY: "ready",
  REVIEW: "review",
  ERROR: "error",
});

export function createSequentialIssuanceQueue(worker, onChange = () => {}) {
  if (typeof worker !== "function") throw new TypeError("识别队列缺少处理函数。");
  let sequence = 0;
  let draining = false;
  const tasks = [];

  const notify = (task) => onChange({ ...task });
  const scheduleDrain = () => queueMicrotask(drain);

  async function drain() {
    if (draining) return;
    const task = tasks.find((item) => item.status === ISSUANCE_QUEUE_STATUS.QUEUED);
    if (!task) return;
    draining = true;
    task.status = ISSUANCE_QUEUE_STATUS.PROCESSING;
    task.startedAt = new Date().toISOString();
    notify(task);
    try {
      task.result = await worker(task.payload, { id: task.id });
      task.status = task.result?.canApply
        ? ISSUANCE_QUEUE_STATUS.READY
        : ISSUANCE_QUEUE_STATUS.REVIEW;
    } catch (error) {
      task.error = error?.message || "语义识别失败，请稍后重试。";
      task.status = ISSUANCE_QUEUE_STATUS.ERROR;
    } finally {
      task.completedAt = new Date().toISOString();
      draining = false;
      notify(task);
      scheduleDrain();
    }
  }

  return {
    enqueue(payload) {
      const task = {
        id: `issuance-queue-${Date.now()}-${++sequence}`,
        payload,
        status: ISSUANCE_QUEUE_STATUS.QUEUED,
        result: null,
        error: "",
        queuedAt: new Date().toISOString(),
        startedAt: "",
        completedAt: "",
      };
      tasks.push(task);
      notify(task);
      scheduleDrain();
      return { ...task };
    },
    get(id) {
      const task = tasks.find((item) => item.id === id);
      return task ? { ...task } : null;
    },
    list() {
      return tasks.map((task) => ({ ...task }));
    },
    remove(id) {
      const index = tasks.findIndex((item) => item.id === id);
      if (index < 0 || tasks[index].status === ISSUANCE_QUEUE_STATUS.PROCESSING) return false;
      tasks.splice(index, 1);
      return true;
    },
  };
}
