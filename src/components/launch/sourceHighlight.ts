type SourceHighlightApi = {
	// IPC typing differs between source picker contexts; this helper normalizes
	// the payload before forwarding it across the boundary.
	showSourceHighlight?: (source: any) => Promise<{ success: boolean }>;
};

type HighlightableSource = {
	id?: string;
	name?: string;
	appName?: string;
};

export function buildHighlightSourceLabel(source: HighlightableSource) {
	return {
		...source,
		name: source.appName ? `${source.appName} - ${source.name ?? ""}` : source.name,
		appName: source.appName,
	};
}

export async function previewSourceHighlight(api: SourceHighlightApi, source: HighlightableSource) {
	if (typeof api.showSourceHighlight !== "function") {
		return;
	}

	await api.showSourceHighlight(buildHighlightSourceLabel(source));
}
