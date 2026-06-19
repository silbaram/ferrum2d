import { appendAuthoringViewerKeyValueRow } from "@ferrum2d/authoring-viewer";
import {
  diagnosticReport,
  type DiagnosticContext,
  type DiagnosticReport,
} from "@ferrum2d/ferrum-web/quality";

export function renderPlacementStartupError(root: HTMLElement, error: unknown): void {
  console.error("Ferrum2D placement viewer failed", error);
  const report = diagnosticReport(error);
  const container = document.createElement("main");
  const title = document.createElement("h1");
  const summary = document.createElement("p");
  const list = document.createElement("dl");
  container.className = "placement-error";
  title.textContent = "__PROJECT_TITLE__ Placement Viewer";
  summary.textContent = "Startup failed.";
  for (const [label, value] of diagnosticRows(report)) {
    appendAuthoringViewerKeyValueRow(list, label, value);
  }
  container.append(title, summary, list);
  root.replaceChildren(container);
}

function diagnosticRows(report: DiagnosticReport): Array<[string, string]> {
  const rows: Array<[string, string]> = [["code", report.code], ["message", report.message]];
  if (report.context !== undefined) appendDiagnosticContext(rows, report.context);
  return rows;
}

function appendDiagnosticContext(rows: Array<[string, string]>, context: DiagnosticContext): void {
  rows.push(["kind", context.kind]);
  if (context.name !== undefined) rows.push(["name", context.name]);
  if (context.id !== undefined) rows.push(["id", String(context.id)]);
  if (context.url !== undefined) rows.push(["url", context.url]);
  if (context.path !== undefined) rows.push(["path", context.path]);
  rows.push(["detail", context.detail]);
}
