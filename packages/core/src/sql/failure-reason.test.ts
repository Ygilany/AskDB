import { describe, expect, it } from "vitest";
import { failureMessage } from "./failure-reason.js";

/** An error that stops at a colon over one inner error with these fields, like the AI SDK's. */
const over = (fields: Record<string, unknown>, inner: Error = new Error("connect failed")): Error =>
  new Error("Cannot connect to API: ", { cause: new AggregateError([Object.assign(inner, fields)], "") });

describe("failureMessage", () => {
  it.each([
    ["an IPv4 address and port", { code: "ECONNREFUSED", address: "127.0.0.1", port: 11434 }, "ECONNREFUSED 127.0.0.1:11434"],
    ["an IPv6 address, in brackets", { code: "ECONNREFUSED", address: "::1", port: 11434 }, "ECONNREFUSED [::1]:11434"],
    ["a DNS failure's hostname", { code: "ENOTFOUND", hostname: "api.example.com" }, "ENOTFOUND api.example.com"],
    ["an address that isn't a host: the code alone", { code: "ECONNREFUSED", address: "admin:S3cret@db", port: 5432 }, "ECONNREFUSED"],
    ["a port of 0", { code: "ECONNREFUSED", address: "10.0.0.1", port: 0 }, "ECONNREFUSED 10.0.0.1"],
    ["a port above 65535", { code: "ECONNREFUSED", address: "10.0.0.1", port: 70000 }, "ECONNREFUSED 10.0.0.1"],
    ["a port that isn't a number", { code: "ECONNREFUSED", address: "10.0.0.1", port: "5432/S3cret" }, "ECONNREFUSED 10.0.0.1"],
    ["a code that isn't an uppercase identifier: the name", { code: "econnrefused S3cret" }, "Error"],
  ])("reads %s from the parts, never the message text", (_name, fields, reason) => {
    const message = failureMessage(over(fields, new Error("https://admin:S3cret@llm.internal refused")));
    expect(message).toBe(`Cannot connect to API: ${reason}`);
    expect(message).not.toMatch(/S3cret|admin|llm\.internal/);
  });

  it("uses an error's name when it has no code, and Error when the name isn't an identifier", () => {
    expect(failureMessage(over({}, new TypeError("https://admin:S3cret@llm.internal")))).toBe("Cannot connect to API: TypeError");
    expect(failureMessage(over({ name: "not a name: S3cret" }))).toBe("Cannot connect to API: Error");
    expect(failureMessage(over({ name: Symbol("S3cret") }))).toBe("Cannot connect to API: Error");
  });

  it("returns a message that already gives its reason, and a thrown non-error, unchanged", () => {
    expect(failureMessage(new Error("Rate limit reached: retry in 20s", { cause: new Error("x") }))).toBe("Rate limit reached: retry in 20s");
    expect(failureMessage("boom")).toBe("boom");
  });

  it("never throws on a host-built error with odd fields", () => {
    const nullMessage = Object.assign(new Error(), { message: null });
    expect(failureMessage(nullMessage)).toBe("null");

    const numericChild = over({ message: 42, code: "EPIPE" });
    expect(failureMessage(numericChild)).toBe("Cannot connect to API: EPIPE");

    const noErrors = new AggregateError([], "");
    Object.defineProperty(noErrors, "errors", { value: undefined });
    expect(failureMessage(noErrors)).toBe("AggregateError");
  });

  it("stops on a cause cycle and on a chain deeper than it walks", () => {
    const cyclic = new Error("Upstream said:");
    (cyclic as { cause?: unknown }).cause = cyclic;
    expect(failureMessage(cyclic)).toBe("Upstream said:");

    let deep: Error = Object.assign(new Error(""), { code: "ECONNREFUSED" });
    for (let i = 0; i < 20; i += 1) deep = new Error("", { cause: deep });
    expect(failureMessage(deep)).toBe("Error");
  });
});
