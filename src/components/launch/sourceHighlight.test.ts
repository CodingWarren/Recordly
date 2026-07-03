import { describe, expect, it, vi } from "vitest";

import { buildHighlightSourceLabel, previewSourceHighlight } from "./sourceHighlight";

describe("source highlight preview", () => {
	it("passes screen sources to the highlight API", async () => {
		const showSourceHighlight = vi.fn().mockResolvedValue({ success: true });
		const source = {
			id: "screen:1:0",
			name: "Screen 2",
			display_id: "202",
			sourceType: "screen",
		};

		await previewSourceHighlight({ showSourceHighlight }, source);

		expect(showSourceHighlight).toHaveBeenCalledWith(source);
	});

	it("keeps app name context for window sources", () => {
		expect(buildHighlightSourceLabel({ id: "window:1", name: "Inbox", appName: "Mail" })).toEqual({
			id: "window:1",
			name: "Mail - Inbox",
			appName: "Mail",
		});
	});
});
