import {answerViewModels} from "./answer-view-data.js?v=5.5.2";
import {createAnswerViews} from "./answer-views.js?v=5.5.2";

// Saved answers use the schema of the release that created them. Keep their
// original ledger reader available when a newer chart cannot represent them.
export function presentAnswer(answer, actions, renderEvidence) {
  let views;
  try {
    const models = answerViewModels(answer);
    if (!models.length) return null;
    views = createAnswerViews(models);
    if (!views?.childElementCount) return null;
  } catch (error) {
    console.warn("问数图表未能显示，已使用台账视图。", error?.name);
    return null;
  }
  const panel = document.createElement("div");
  panel.className = "answer-presentation";
  panel.append(views);
  const toolbar = document.createElement("div");
  toolbar.className = "view-actions";
  toolbar.append(...actions());
  if (toolbar.childElementCount) panel.append(toolbar);
  const evidence = document.createElement("details");
  evidence.className = "answer-evidence";
  const summary = document.createElement("summary");
  summary.textContent = "台账明细与计算依据";
  evidence.append(summary);
  evidence.addEventListener("toggle", () => {
    if (evidence.open && evidence.childElementCount === 1) evidence.append(renderEvidence());
  });
  panel.append(evidence);
  return panel;
}
