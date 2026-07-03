export type RecordingPreferences = {
	microphoneEnabled: boolean;
	microphoneDeviceId: string | undefined;
	systemAudioEnabled: boolean;
};

export type RecordingPreferencesApi = {
	getRecordingPreferences: () => Promise<{
		success: boolean;
		microphoneEnabled?: boolean;
		microphoneDeviceId?: string;
		systemAudioEnabled?: boolean;
	}>;
};

export const DEFAULT_RECORDING_PREFERENCES: RecordingPreferences = {
	microphoneEnabled: false,
	microphoneDeviceId: undefined,
	systemAudioEnabled: true,
};

export async function loadRecordingPreferences(
	api: RecordingPreferencesApi,
): Promise<RecordingPreferences> {
	try {
		const result = await api.getRecordingPreferences();
		if (!result.success) {
			return DEFAULT_RECORDING_PREFERENCES;
		}

		return {
			microphoneEnabled: result.microphoneEnabled === true,
			microphoneDeviceId:
				typeof result.microphoneDeviceId === "string" ? result.microphoneDeviceId : undefined,
			systemAudioEnabled: result.systemAudioEnabled !== false,
		};
	} catch {
		return DEFAULT_RECORDING_PREFERENCES;
	}
}
