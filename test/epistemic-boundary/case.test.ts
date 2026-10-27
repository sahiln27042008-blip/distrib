// enterpriseee/enterprise-simulator/test/epistemic-boundary/case.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { AlphabetCompiler } from "../../src/physics/alphabet/compiler.ts";

test("Layer 6: Epistemic Boundary Enforcement", () => {
  const compiler = new AlphabetCompiler();

  // Test 1: Mechanism decomposition of below-software physical phenomenon
  const decompResult = compiler.attemptProposedMechanism(
    "sub_causal.cosmic_ray",
    "a cosmic ray flips a bit in the L1 cache of the CPU core",
  );

  assert.equal(decompResult.status, "INSUFFICIENT_PHYSICS");
  if (decompResult.status === "INSUFFICIENT_PHYSICS") {
    assert.ok(
      decompResult.missingSemantics.some((s) => s.includes("bit flip")),
      "Must explicitly declare hardware-level bit flip as missing semantics",
    );
  }

  // Test 2: Natural language workflow parsing with physical boundary violations
  const nlText = "High-altitude server experiences cosmic ray induced bit flip causing memory corruption";
  const graph = compiler.compileFromNaturalLanguage(nlText);

  assert.ok(
    graph.epistemicStatus.includes("NOT_REPRESENTABLE"),
    "Must flag unrepresentable physics rather than fabricating a mapping",
  );
  assert.ok(
    graph.unrepresentableSemantics.includes("hardware-level bit flip"),
    "Must preserve the unrepresentable semantic term",
  );
  assert.equal(graph.vowels.length, 0, "Must NOT synthesize fake vowels for unrepresentable physics");
});

