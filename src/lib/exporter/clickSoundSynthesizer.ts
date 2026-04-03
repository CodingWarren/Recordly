import type { ClickSoundStyle } from "@/components/video-editor/types";

/**
 * Parameters that define the character of each click sound style.
 *
 * durationMs   – total length of the synthesized buffer
 * frequency    – centre frequency of the tonal component (Hz)
 * decay        – time constant for the exponential amplitude envelope (seconds)
 * noiseRatio   – mix ratio of white noise vs. pure tone (0 = pure tone, 1 = pure noise)
 * highpassHz   – high-pass filter cutoff to remove low-frequency rumble
 */
const STYLE_PARAMS: Record<
	ClickSoundStyle,
	{
		durationMs: number;
		frequency: number;
		decay: number;
		noiseRatio: number;
		highpassHz: number;
	}
> = {
	subtle: {
		durationMs: 12,
		frequency: 3200,
		decay: 0.006,
		noiseRatio: 0.65,
		highpassHz: 1800,
	},
	soft: {
		durationMs: 20,
		frequency: 1600,
		decay: 0.012,
		noiseRatio: 0.45,
		highpassHz: 800,
	},
	mechanical: {
		durationMs: 8,
		frequency: 4800,
		decay: 0.004,
		noiseRatio: 0.85,
		highpassHz: 2400,
	},
};

/**
 * Synthesise a short click sound as an AudioBuffer using the Web Audio API.
 *
 * The click is a mix of band-limited white noise and a decaying sine tone,
 * shaped by an exponential amplitude envelope.  No external audio assets are
 * required – everything is generated in-memory at the AudioContext sample rate.
 */
export function synthesizeClickSound(
	audioContext: AudioContext,
	style: ClickSoundStyle,
): AudioBuffer {
	const params = STYLE_PARAMS[style];
	const sampleRate = audioContext.sampleRate;
	const numSamples = Math.max(1, Math.ceil((sampleRate * params.durationMs) / 1000));

	// Stereo buffer so it blends naturally with stereo audio tracks.
	const buffer = audioContext.createBuffer(2, numSamples, sampleRate);

	for (let channel = 0; channel < 2; channel++) {
		const data = buffer.getChannelData(channel);

		// Simple first-order high-pass filter state
		let hpPrev = 0;
		let hpOut = 0;
		const rc = 1 / (2 * Math.PI * params.highpassHz);
		const dt = 1 / sampleRate;
		const alpha = rc / (rc + dt); // high-pass coefficient

		for (let i = 0; i < numSamples; i++) {
			const t = i / sampleRate;

			// Exponential amplitude envelope
			const envelope = Math.exp(-t / params.decay);

			// White noise component
			const noise = (Math.random() * 2 - 1) * params.noiseRatio;

			// Tonal sine component
			const tone = Math.sin(2 * Math.PI * params.frequency * t) * (1 - params.noiseRatio);

			// Raw sample
			const raw = (noise + tone) * envelope;

			// Apply high-pass filter to remove low-frequency rumble
			hpOut = alpha * (hpOut + raw - hpPrev);
			hpPrev = raw;

			data[i] = hpOut;
		}
	}

	return buffer;
}

/**
 * Pre-render click sound buffers for all three styles into a lookup map.
 * Call this once per export to avoid re-synthesising on every click event.
 */
export function preRenderClickSounds(
	audioContext: AudioContext,
): Record<ClickSoundStyle, AudioBuffer> {
	return {
		subtle: synthesizeClickSound(audioContext, "subtle"),
		soft: synthesizeClickSound(audioContext, "soft"),
		mechanical: synthesizeClickSound(audioContext, "mechanical"),
	};
}
