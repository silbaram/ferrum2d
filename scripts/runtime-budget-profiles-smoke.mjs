#!/usr/bin/env node
import {
  runtimeBudgetProfileIds,
  validateRuntimeBudgetProfiles,
} from "./runtime-budget-profiles.mjs";

const errors = validateRuntimeBudgetProfiles();
if (errors.length > 0) {
  console.error("runtime budget profile validation failed");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log("runtime budget profiles ok");
  console.log(JSON.stringify({ profiles: runtimeBudgetProfileIds() }, null, 2));
}
