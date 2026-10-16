import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  applyHonestyRules,
  diagnosisModelSchema,
  earlyCaveat,
  MAX_CAVEATS,
  parseDiagnosisOutput,
  parseStoredDiagnosis,
  toStoredDiagnosis,
} from "@/lib/schemas/diagnosis";
import { validDiagnosis } from "./diagnosis-fixture";

const confidences = (d: { factors: { confidence: string }[] }) => d.factors.map((f) => f.confidence);

describe("diagnosisModelSchema", () => {
  it("has every key required, as OpenAI strict mode needs", () => {
    const json = JSON.stringify(z.toJSONSchema(diagnosisModelSchema));
    // Strict mode: no property may be left out of its object's `required` list.
    const walk = (node: Record<string, unknown>): void => {
      const props = node.properties as Record<string, Record<string, unknown>> | undefined;
      if (props) {
        expect(new Set(node.required as string[])).toEqual(new Set(Object.keys(props)));
        Object.values(props).forEach(walk);
      }
      if (node.items) walk(node.items as Record<string, unknown>);
      for (const option of (node.anyOf as Record<string, unknown>[] | undefined) ?? []) walk(option);
    };
    walk(JSON.parse(json));
  });

  it("accepts the fixture", () => {
    expect(diagnosisModelSchema.safeParse(validDiagnosis).success).toBe(true);
  });
});

describe("diagnosisOutput", () => {
  it("accepts a valid diagnosis and trims text", () => {
    const parsed = parseDiagnosisOutput({ ...validDiagnosis, headline: "  Trimmed  " });
    expect(parsed.ok && parsed.data.headline).toBe("Trimmed");
  });

  it("enforces 1-4 factors, at most 3 caveats and the text bounds", () => {
    const factor = validDiagnosis.factors[0];
    expect(parseDiagnosisOutput({ ...validDiagnosis, factors: [] }).ok).toBe(false);
    expect(parseDiagnosisOutput({ ...validDiagnosis, factors: Array(5).fill(factor) }).ok).toBe(false);
    expect(parseDiagnosisOutput({ ...validDiagnosis, caveats: ["a", "b", "c", "d"] }).ok).toBe(false);
    expect(parseDiagnosisOutput({ ...validDiagnosis, headline: "x".repeat(161) }).ok).toBe(false);
    expect(parseDiagnosisOutput({ ...validDiagnosis, what_happened: " " }).ok).toBe(false);
  });

  it("turns an empty experiment format into null", () => {
    const input = {
      ...validDiagnosis,
      next_experiment: { ...validDiagnosis.next_experiment, idea: { ...validDiagnosis.next_experiment.idea, format: "" } },
    };
    const parsed = parseDiagnosisOutput(input);
    expect(parsed.ok && parsed.data.next_experiment.idea.format).toBeNull();
  });
});

describe("applyHonestyRules", () => {
  it("caps every factor at low for early results, and adds the early caveat once", () => {
    const { diagnosis, capped } = applyHonestyRules(validDiagnosis, { settled: false, ageDays: 2, peers: 10 });
    expect(confidences(diagnosis)).toEqual(["low", "low"]);
    expect(capped).toBe(true);
    expect(diagnosis.caveats).toEqual([earlyCaveat(2)]);

    const again = applyHonestyRules(diagnosis, { settled: false, ageDays: 2, peers: 10 });
    expect(again.diagnosis.caveats).toEqual([earlyCaveat(2)]);
  });

  it("caps at low without a baseline and at medium below 8 peers", () => {
    expect(confidences(applyHonestyRules(validDiagnosis, { settled: true, ageDays: 9, peers: 2 }).diagnosis)).toEqual([
      "low",
      "low",
    ]);
    const medium = applyHonestyRules(validDiagnosis, { settled: true, ageDays: 9, peers: 7 });
    expect(confidences(medium.diagnosis)).toEqual(["medium", "medium"]);
    expect(medium.capped).toBe(true);
  });

  it("leaves a well-supported diagnosis alone", () => {
    const result = applyHonestyRules(validDiagnosis, { settled: true, ageDays: 9, peers: 8 });
    expect(result).toEqual({ diagnosis: validDiagnosis, capped: false });
  });

  it(`keeps at most ${MAX_CAVEATS} caveats, the early one first`, () => {
    const result = applyHonestyRules({ ...validDiagnosis, caveats: ["a", "b", "c"] }, { settled: false, ageDays: 1, peers: 9 });
    expect(result.diagnosis.caveats).toEqual([earlyCaveat(1), "a", "b"]);
  });
});

describe("stored diagnosis", () => {
  it("round-trips and rejects unknown versions or broken content", () => {
    const stored = toStoredDiagnosis(validDiagnosis, true);
    expect(parseStoredDiagnosis(JSON.parse(JSON.stringify(stored)))).toEqual({ ok: true, diagnosis: stored });
    expect(parseStoredDiagnosis({ ...stored, schema_version: 2 })).toEqual({ ok: false });
    expect(parseStoredDiagnosis({ schema_version: 1 })).toEqual({ ok: false });
  });
});
