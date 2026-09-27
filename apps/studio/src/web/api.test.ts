import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWorkspace } from "./api";

// `api()` is the web app's single path to the Studio server. These pin how it
// turns HTTP errors into messages the UI shows.
describe("web api error handling", () => {
  beforeEach(() => {
    vi.stubGlobal("document", {
      querySelector: () => ({ content: "test-token" }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("surfaces the server's JSON error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: "Reload Studio in the browser" } }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await expect(getWorkspace()).rejects.toThrow("Reload Studio in the browser");
  });

  it("falls back to the status for a non-JSON error body instead of a JSON parse error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("<html>Bad Gateway</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        }),
      ),
    );
    await expect(getWorkspace()).rejects.toThrow("Request failed with status 502");
  });
});
