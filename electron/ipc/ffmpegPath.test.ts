import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveFfmpegBinaryPath } from "./ffmpegPath";

describe("resolveFfmpegBinaryPath", () => {
	it("uses ffmpeg-static when it provides a binary path", () => {
		expect(
			resolveFfmpegBinaryPath({
				ffmpegStaticPath: path.join("C:", "app.asar", "node_modules", "ffmpeg.exe"),
				isPackaged: true,
				envPath: "",
				platform: "win32",
				fileExists: () => false,
			}),
		).toBe(path.join("C:", "app.asar.unpacked", "node_modules", "ffmpeg.exe"));
	});

	it("falls back to ffmpeg.exe on PATH when ffmpeg-static is unavailable on Windows", () => {
		const ffmpegDir = path.join("C:", "Tools", "ffmpeg", "bin");
		const ffmpegPath = path.join(ffmpegDir, "ffmpeg.exe");

		expect(
			resolveFfmpegBinaryPath({
				ffmpegStaticPath: null,
				isPackaged: false,
				envPath: [path.join("C:", "Other"), ffmpegDir].join(path.delimiter),
				platform: "win32",
				fileExists: (candidate) => candidate === ffmpegPath,
			}),
		).toBe(ffmpegPath);
	});
});
