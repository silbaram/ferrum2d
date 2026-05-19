import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  FerrumDiagnosticError,
  assetLoadError,
  diagnosticReport,
  formatDiagnosticReport,
  isFerrumDiagnosticError,
} from "../src/diagnostics.js";

test("diagnostic errors keep stable messages and expose structured reports", () => {
  const error = assetLoadError({
    kind: "json",
    name: "game",
    url: "/game.json",
    detail: "HTTP 500 Internal Server Error",
  });

  ok(error instanceof FerrumDiagnosticError);
  ok(isFerrumDiagnosticError(error));
  equal(error.code, "FERRUM_ASSET_LOAD");
  equal(
    error.message,
    "Asset load error: kind=json name='game' url='/game.json' detail='HTTP 500 Internal Server Error'.",
  );
  deepEqual(diagnosticReport(error), {
    code: "FERRUM_ASSET_LOAD",
    message: error.message,
    context: {
      kind: "json",
      name: "game",
      url: "/game.json",
      detail: "HTTP 500 Internal Server Error",
    },
  });
  equal(formatDiagnosticReport(error), `FERRUM_ASSET_LOAD: ${error.message}`);
});

test("diagnostic reports normalize unknown errors", () => {
  const report = diagnosticReport("plain failure");

  deepEqual(report, {
    code: "FERRUM_UNKNOWN",
    message: "plain failure",
  });
  equal(formatDiagnosticReport("plain failure"), "plain failure");
});
