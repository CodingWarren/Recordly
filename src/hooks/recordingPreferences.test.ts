import { describe, expect, it, vi } from "vitest";
import { loadRecordingPreferences } from "./recordingPreferences";

describe("recording preferences", () => {
	it("defaults system audio on when saved preferences cannot be loaded", async () => {
		const api = {
			getRecordingPreferences: vi.fn().mockResolvedValue({ success: false }),
		};

		await expect(loadRecordingPreferences(api)).resolves.toEqual({
			microphoneEnabled: false,
			microphoneDeviceId: undefined,
			systemAudioEnabled: true,
		});
	});

	it("uses saved microphone and system audio preferences", async () => {
		const api = {
			getRecordingPreferences: vi.fn().mockResolvedValue({
				success: true,
				microphoneEnabled: true,
				microphoneDeviceId: "mic-1",
				systemAudioEnabled: false,
			}),
		};

		await expect(loadRecordingPreferences(api)).resolves.toEqual({
			microphoneEnabled: true,
			microphoneDeviceId: "mic-1",
			systemAudioEnabled: false,
		});
	});
});
