import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDatePickerMonth,
  formatDatePickerValue,
  parseDatePickerValue,
} from "../date-picker.js";

test("builds a stable Monday-first six-week calendar", () => {
  const days = buildDatePickerMonth(2026, 6);

  assert.equal(days.length, 42);
  assert.equal(days[0].value, "2026-06-29");
  assert.equal(days[2].value, "2026-07-01");
  assert.equal(days.at(-1).value, "2026-08-09");
  assert.equal(days.filter((item) => item.inMonth).length, 31);
});

test("keeps date and datetime-local values in their existing ISO formats", () => {
  const date = new Date(2026, 6, 13);

  assert.equal(formatDatePickerValue(date), "2026-07-13");
  assert.equal(formatDatePickerValue(date, "datetime-local", 18, 5), "2026-07-13T18:05");
  assert.deepEqual(
    parseDatePickerValue("2026-07-13T18:05", "datetime-local"),
    { date, hour: 18, minute: 5 },
  );
});

test("rejects impossible dates and includes leap day", () => {
  assert.equal(parseDatePickerValue("2026-02-30"), null);
  assert.equal(parseDatePickerValue("2026-07-13T25:00", "datetime-local"), null);
  assert.equal(buildDatePickerMonth(2028, 1).some((item) => item.value === "2028-02-29"), true);
});
