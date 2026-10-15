import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import { safeStderrWrite } from "./stderr.js";

describe("safeStderrWrite", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes the message synchronously to the stderr file descriptor", () => {
    const writeSpy = vi.spyOn(fs, "writeSync").mockImplementation(() => 0);

    safeStderrWrite("something happened\n");

    expect(writeSpy).toHaveBeenCalledWith(process.stderr.fd, "something happened\n");
  });

  it("does not throw when the stderr pipe is gone (EPIPE)", () => {
    vi.spyOn(fs, "writeSync").mockImplementation(() => {
      throw Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    });

    expect(() => safeStderrWrite("lost message\n")).not.toThrow();
  });
});
