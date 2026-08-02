import { afterEach, describe, expect, it, vi } from "vitest";
import { checkUrl } from "../../src/commands/check-urls.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkUrl", () => {
  it("accepts configured status codes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
    await expect(checkUrl("https://example.com", 1000, 0, [403])).resolves.toMatchObject({
      status: 403,
      ok: true,
    });
  });

  it("honors zero retries", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    await expect(checkUrl("https://example.com", 1000, 0)).resolves.toMatchObject({ ok: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to GET when HEAD is not allowed", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await expect(checkUrl("https://example.com", 1000, 0)).resolves.toMatchObject({ ok: true });
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: "HEAD" });
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: "GET" });
  });
});
