import test from "node:test";
import assert from "node:assert/strict";
import { listScenariosTool } from "../../src/mcp/tools/list-scenarios.ts";

test("list_scenarios returns 3 scenarios", async () => {
  const result = await listScenariosTool.handler({});
  assert.equal(result.success, true);
  const scenarios = result.scenarios as any[];
  assert.ok(Array.isArray(scenarios));
  assert.equal(scenarios.length, 3);
});

test("list_scenarios includes matrix, m7-chaos, m8-agent-lab", async () => {
  const result = await listScenariosTool.handler({});
  assert.equal(result.success, true);
  const scenarios = result.scenarios as any[];
  const names = scenarios.map(s => s.name);
  assert.ok(names.includes("matrix"));
  assert.ok(names.includes("m7-chaos"));
  assert.ok(names.includes("m8-agent-lab"));
});

test("each scenario has name, description, configType", async () => {
  const result = await listScenariosTool.handler({});
  assert.equal(result.success, true);
  const scenarios = result.scenarios as any[];
  for (const s of scenarios) {
    assert.equal(typeof s.name, "string");
    assert.ok(s.name.length > 0);
    assert.equal(typeof s.description, "string");
    assert.ok(s.description.length > 0);
    assert.equal(typeof s.configType, "string");
    assert.ok(s.configType.length > 0);
  }
});

