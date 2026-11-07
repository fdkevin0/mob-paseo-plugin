import { describe, expect, it } from "vitest";
import { checkFeedback, findings, parseVerdict, reviewPrompt } from "../server/review";

describe("parseVerdict", () => {
  it("reads the last verdict line", () => {
    expect(parseVerdict("Looks good.\nVERDICT: APPROVE")).toBe("approve");
    expect(parseVerdict("- fix a.ts\n\n**VERDICT: CHANGES**")).toBe("changes");
    expect(parseVerdict("verdict: approve")).toBe("approve");
    expect(parseVerdict("VERDICT: APPROVE\nWait, one more.\nVERDICT: CHANGES")).toBe("changes");
  });
  it("is unknown without a verdict", () => {
    expect(parseVerdict(null)).toBe("unknown");
    expect(parseVerdict("I would APPROVE this")).toBe("unknown");
    expect(parseVerdict("The VERDICT: APPROVE line is required")).toBe("unknown");
  });
});

it("strips the verdict from findings", () => {
  expect(findings("- fix a.ts\nVERDICT: CHANGES")).toBe("- fix a.ts");
});

it("tells the reviewer not to edit and how to end", () => {
  const prompt = reviewPrompt(2, [{ name: "tests", ok: true, exitCode: 0 }]);
  expect(prompt).toContain("round 2");
  expect(prompt).toContain("Do not edit");
  expect(prompt).toContain("tests");
  expect(prompt).toContain("VERDICT: APPROVE");
});

it("sends the failing check's tail back", () => {
  const text = checkFeedback({ name: "tests", ok: false, exitCode: 1, tail: "1 failed" }, 1, 2);
  expect(text).toContain("`tests` exited with 1 (attempt 1 of 2)");
  expect(text).toContain("1 failed");
});
