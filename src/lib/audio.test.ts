import { afterEach, describe, expect, it, vi } from "vitest";
import { toWav } from "./audio";

afterEach(() => vi.unstubAllGlobals());

describe("browser audio conversion", () => {
  it("writes a mono 16kHz PCM WAV and averages stereo channels", async () => {
    const decoded = { duration: 0.000125, length: 2, numberOfChannels: 2,
      getChannelData: (channel: number) => channel ? new Float32Array([0, -0.5]) : new Float32Array([1, 0.5]) };
    vi.stubGlobal("OfflineAudioContext", class {
      constructor(channels: number, length: number, rate: number) { expect([channels, length, rate]).toEqual([1, 1, 16000]); }
      decodeAudioData = async () => decoded;
    });
    const wav = await toWav(new Blob(["browser recording"], { type: "audio/webm" }));
    const view = new DataView(await wav.arrayBuffer());
    expect(wav.type).toBe("audio/wav");
    expect(new TextDecoder().decode((await wav.arrayBuffer()).slice(0, 4))).toBe("RIFF");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(40, true)).toBe(4);
    expect(view.getInt16(44, true)).toBe(16384);
    expect(view.getInt16(46, true)).toBe(0);
  });
  it("rejects recordings beyond the local decoder duration limit", async () => {
    vi.stubGlobal("OfflineAudioContext", class { decodeAudioData = async () => ({ duration: 61 }); });
    await expect(toWav(new Blob(["long audio"]))).rejects.toThrow("60 seconds");
  });
  it("reports unsupported browser audio decoding clearly", async () => {
    vi.stubGlobal("OfflineAudioContext", class { decodeAudioData = async () => { throw new Error("codec"); }; });
    await expect(toWav(new Blob(["bad audio"]))).rejects.toThrow("Try a WAV");
  });
});
