import { Download, Grid, Moon, Sun, Trash2, X } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

// Lazy-load Excalidraw to avoid issues during SSR / test environments
// The actual import is deferred until the component mounts in the browser.
let ExcalidrawModule: typeof import("@excalidraw/excalidraw") | null = null;

async function loadExcalidraw() {
	if (!ExcalidrawModule) {
		ExcalidrawModule = await import("@excalidraw/excalidraw");
	}
	return ExcalidrawModule;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcalidrawAPI = any;

export function DrawingBoardWindow() {
	const [ExcalidrawComponent, setExcalidrawComponent] = useState<React.ComponentType<any> | null>(null);
	const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawAPI | null>(null);
	const [showGrid, setShowGrid] = useState(false);
	const [isDark, setIsDark] = useState(true);
	const [isLoaded, setIsLoaded] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// ── Source type: screen vs window recording ───────────────────────────────
	// For SCREEN recording the drawing board is a transparent overlay that WGC
	// already captures as part of the display.  No background video is needed
	// and starting getDisplayMedia would create an infinite mirror effect
	// (screen → drawing board → screen → …) producing dozens of cursor ghosts.
	// For WINDOW recording we need the background video so WGC can record the
	// drawing board window and capture both the window content and the drawings.
	const urlParams = new URLSearchParams(window.location.search);
	const isWindowRecording = urlParams.get('sourceType') === 'window';

	// ── Background capture (画中画 / Picture-in-Picture) ──────────────────────
	// Only used for WINDOW recording (see above).
	const videoRef = useRef<HTMLVideoElement>(null);
	const backgroundStreamRef = useRef<MediaStream | null>(null);
	const [backgroundStream, setBackgroundStream] = useState<MediaStream | null>(null);

	// Explicit pixel dimensions so the canvas always fills the actual window,
	// not the primary display's viewport (which is what 100vw/100vh may return
	// on secondary displays with different resolutions).
	const [windowSize, setWindowSize] = useState({
		width: window.innerWidth,
		height: window.innerHeight,
	});

	// Keep windowSize in sync with the actual window dimensions
	useEffect(() => {
		const onResize = () => {
			const w = window.innerWidth;
			const h = window.innerHeight;
			console.log(`[drawing-board-renderer] resize → innerWidth=${w} innerHeight=${h} screen=${window.screen.width}x${window.screen.height} devicePixelRatio=${window.devicePixelRatio}`);
			setWindowSize({ width: w, height: h });
		};
		window.addEventListener("resize", onResize);
		// Log initial dimensions immediately
		console.log(`[drawing-board-renderer] mount → innerWidth=${window.innerWidth} innerHeight=${window.innerHeight} screen=${window.screen.width}x${window.screen.height} devicePixelRatio=${window.devicePixelRatio}`);
		// Also poll for a short period after mount in case the window is still
		// being positioned on the secondary display when the component first renders.
		const timers = [
			setTimeout(onResize, 50),
			setTimeout(onResize, 200),
			setTimeout(onResize, 500),
			setTimeout(onResize, 1000),
		];
		return () => {
			window.removeEventListener("resize", onResize);
			timers.forEach(clearTimeout);
		};
	}, []);

	// When windowSize changes and the API is ready, tell Excalidraw to refresh
	useEffect(() => {
		if (!excalidrawAPI) return;
		try { excalidrawAPI.refresh?.(); } catch { /* ignore */ }
	}, [excalidrawAPI, windowSize]);

	// ── Hide OS cursor to eliminate ghost-trail artefacts ────────────────────
	// When the drawing board is open the background video stream already shows
	// the cursor captured from the recording source.  Having the real OS cursor
	// visible on top of the (slightly delayed) video cursor creates a "double
	// cursor / ghost trail" effect.  Hiding the OS cursor while the drawing
	// board is active removes the duplicate and eliminates the artefact.
	// The cursor is restored when the component unmounts (board closed).
	useEffect(() => {
		void window.electronAPI?.hideOsCursor?.()
		return () => {
			void window.electronAPI?.showOsCursor?.()
		}
	}, [])

	// Dynamically load Excalidraw on mount
	useEffect(() => {
		loadExcalidraw()
			.then((mod) => {
				setExcalidrawComponent(() => mod.Excalidraw);
			})
			.catch((err) => {
				console.error("Failed to load Excalidraw:", err);
				setLoadError(String(err));
			});
	}, []);

	// ── Background capture: start when component mounts (window recording only)
	// getDisplayMedia() is intercepted by setDisplayMediaRequestHandler in
	// main.ts and returns the currently selected recording source automatically.
	useEffect(() => {
		if (!isWindowRecording) return;

		const startBackgroundCapture = async () => {
			try {
				console.log("[drawing-board-renderer] Starting background capture via getDisplayMedia...");
				const stream = await navigator.mediaDevices.getDisplayMedia({
					video: {
						// Request high frame-rate to match the recording
						// @ts-ignore – non-standard constraint accepted by Chromium/Electron
						frameRate: { ideal: 60, max: 60 },
					},
					audio: false,
				});
				console.log("[drawing-board-renderer] Background capture started:", stream.id);
				backgroundStreamRef.current = stream;
				setBackgroundStream(stream);

				// If the stream ends unexpectedly (e.g. source window closed), clear it
				stream.getVideoTracks()[0]?.addEventListener("ended", () => {
					console.log("[drawing-board-renderer] Background stream ended");
					backgroundStreamRef.current = null;
					setBackgroundStream(null);
				});
			} catch (error) {
				// Non-fatal: drawing board still works without background capture.
				// This can happen if no recording source is selected yet.
				console.warn("[drawing-board-renderer] Background capture failed (non-fatal):", error);
			}
		};

		void startBackgroundCapture();

		return () => {
			// Stop all background capture tracks on unmount
			if (backgroundStreamRef.current) {
				backgroundStreamRef.current.getTracks().forEach((track) => track.stop());
				backgroundStreamRef.current = null;
			}
		};
	}, []);

	// Attach the background stream to the <video> element whenever it changes
	useEffect(() => {
		if (videoRef.current && backgroundStream) {
			videoRef.current.srcObject = backgroundStream;
		}
	}, [backgroundStream]);

	// Load saved drawing data once Excalidraw API is ready, then force a
	// canvas resize so the drawable area fills the full window (important on
	// multi-monitor setups where the window may be larger than the primary display).
	useEffect(() => {
		if (!excalidrawAPI) return;

		const loadData = async () => {
			try {
				const result = await window.electronAPI.getDrawingBoardData();
				if (result?.success && result.data) {
					const parsed = JSON.parse(result.data as string) as {
						elements?: unknown[];
						appState?: Record<string, unknown>;
						files?: Record<string, unknown>;
					};
					excalidrawAPI.updateScene({
						elements: parsed.elements ?? [],
						appState: {
							...(parsed.appState ?? {}),
							collaborators: new Map(),
						},
					});
					if (parsed.files && Object.keys(parsed.files).length > 0) {
						excalidrawAPI.addFiles(Object.values(parsed.files));
					}
				}
			} catch (error) {
				console.error("Failed to load drawing data:", error);
			}
			setIsLoaded(true);
			// Trigger the resize handler so windowSize state is updated and
			// Excalidraw gets a refresh() call via the effect above.
			window.dispatchEvent(new Event("resize"));
		};

		void loadData();
	}, [excalidrawAPI]);

	// Debounced save on every scene change
	const handleChange = useCallback(() => {
		if (!excalidrawAPI || !isLoaded) return;

		if (saveTimeoutRef.current) {
			clearTimeout(saveTimeoutRef.current);
		}
		saveTimeoutRef.current = setTimeout(async () => {
			try {
				const mod = await loadExcalidraw();
				const elements = excalidrawAPI.getSceneElements();
				const appState = excalidrawAPI.getAppState();
				const files = excalidrawAPI.getFiles();
				const data = mod.serializeAsJSON(elements, appState, files, "local");
				await window.electronAPI.setDrawingBoardData(data);
			} catch (err) {
				console.error("Failed to save drawing data:", err);
			}
		}, 500);
	}, [excalidrawAPI, isLoaded]);

	const handleClose = () => {
		// Stop background capture before closing
		if (backgroundStreamRef.current) {
			backgroundStreamRef.current.getTracks().forEach((track) => track.stop());
			backgroundStreamRef.current = null;
		}
		void window.electronAPI.closeDrawingBoard();
	};

	const handleExport = async () => {
		if (!excalidrawAPI) return;
		try {
			const mod = await loadExcalidraw();
			const elements = excalidrawAPI.getSceneElements();
			const appState = excalidrawAPI.getAppState();
			const files = excalidrawAPI.getFiles();
			const blob = await mod.exportToBlob({
				elements,
				appState: { ...appState, exportBackground: false },
				files,
				mimeType: "image/png",
			});
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `drawing-${Date.now()}.png`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (error) {
			console.error("Failed to export drawing:", error);
		}
	};

	const handleClear = () => {
		if (excalidrawAPI) {
			excalidrawAPI.resetScene();
		}
	};

	if (loadError) {
		return (
			<div
				style={{
					width: "100vw",
					height: "100vh",
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					background: "#0f0f17",
					color: "#f43f5e",
					fontFamily: "system-ui, sans-serif",
					gap: 12,
					padding: 24,
				}}
			>
				<div style={{ fontSize: 32 }}>⚠️</div>
				<div style={{ fontSize: 16, fontWeight: 600 }}>Failed to load Drawing Board</div>
				<div style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", maxWidth: 400 }}>
					{loadError}
					<br />
					<br />
					Make sure <code>@excalidraw/excalidraw</code> is installed by running{" "}
					<code>npm install</code> in the Recordly project directory.
				</div>
				<button
					type="button"
					onClick={handleClose}
					style={{
						marginTop: 8,
						padding: "8px 20px",
						borderRadius: 8,
						border: "none",
						background: "#1e1e2e",
						color: "#eeeef2",
						cursor: "pointer",
						fontSize: 13,
					}}
				>
					Close
				</button>
			</div>
		);
	}

	return (
		<div
			style={{
				width: windowSize.width,
				height: windowSize.height,
				position: "relative",
				overflow: "hidden",
				// Keep transparent when no background stream so the window acts as
				// a normal transparent overlay (for screen recording where WGC
				// already captures the full display including this overlay).
				background: "transparent",
			}}
		>
			{/* ── Background video (画中画) ──────────────────────────────────────
			    Renders the recording source as a live video behind the canvas.
			    This makes the drawing board window self-contained so that WGC
			    can record it and capture both the source content and drawings.
			    Hidden (display:none) until the stream is ready to avoid a black
			    flash before the first frame arrives.                           */}
			<video
				ref={videoRef}
				autoPlay
				muted
				playsInline
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					width: "100%",
					height: "100%",
					// 'fill' stretches the video to exactly match the window size.
					// For screen sources this is pixel-perfect. For window sources
					// the content is scaled up to fill the drawing board area.
					objectFit: "fill",
					zIndex: 0,
					pointerEvents: "none",
					// Hide until stream is active to avoid a black rectangle flash
					display: backgroundStream ? "block" : "none",
				}}
			/>

			{/* ── Toolbar + Canvas overlay ──────────────────────────────────── */}
			<div
				style={{
					position: "absolute",
					inset: 0,
					display: "flex",
					flexDirection: "column",
					zIndex: 1,
				}}
			>
				{/* ── Toolbar ── */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 4,
						padding: "5px 10px",
						background: isDark ? "rgba(18,18,28,0.98)" : "rgba(248,249,250,0.98)",
						backdropFilter: "blur(12px)",
						borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`,
						flexShrink: 0,
						// @ts-expect-error Electron-specific CSS property
						WebkitAppRegion: "drag",
						userSelect: "none",
					}}
				>
					<span
						style={{
							fontSize: 13,
							fontWeight: 600,
							color: isDark ? "#eeeef2" : "#1a1a2e",
							marginRight: "auto",
							letterSpacing: "-0.01em",
						}}
					>
						🎨 Drawing Board
						{backgroundStream && (
							<span
								style={{
									marginLeft: 8,
									fontSize: 10,
									fontWeight: 500,
									color: "#22c55e",
									background: "rgba(34,197,94,0.12)",
									border: "1px solid rgba(34,197,94,0.25)",
									borderRadius: 4,
									padding: "1px 5px",
									letterSpacing: "0.02em",
									verticalAlign: "middle",
								}}
							>
								● LIVE
							</span>
						)}
					</span>

					<ToolbarButton
						onClick={() => setShowGrid((v) => !v)}
						title="Toggle Grid"
						active={showGrid}
						isDark={isDark}
					>
						<Grid size={14} />
					</ToolbarButton>

					<ToolbarButton
						onClick={() => setIsDark((v) => !v)}
						title={isDark ? "Switch to Light Theme" : "Switch to Dark Theme"}
						isDark={isDark}
					>
						{isDark ? <Sun size={14} /> : <Moon size={14} />}
					</ToolbarButton>

					<ToolbarButton
						onClick={() => void handleExport()}
						title="Export as PNG"
						isDark={isDark}
					>
						<Download size={14} />
					</ToolbarButton>

					<ToolbarButton
						onClick={handleClear}
						title="Clear Canvas"
						isDark={isDark}
					>
						<Trash2 size={14} />
					</ToolbarButton>

					<div
						style={{
							width: 1,
							height: 18,
							background: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
							margin: "0 4px",
						}}
					/>

					<ToolbarButton
						onClick={handleClose}
						title="Close Drawing Board (Esc)"
						danger
						isDark={isDark}
					>
						<X size={14} />
					</ToolbarButton>
				</div>

				{/* ── Canvas ── */}
				<div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
					{!ExcalidrawComponent ? (
						<div
							style={{
								width: "100%",
								height: "100%",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								color: "#6b6b78",
								fontSize: 14,
								fontFamily: "system-ui, sans-serif",
							}}
						>
							<div style={{ textAlign: "center" }}>
								<div
									style={{
										width: 32,
										height: 32,
										border: "3px solid rgba(99,96,245,0.3)",
										borderTopColor: "#6360f5",
										borderRadius: "50%",
										animation: "spin 0.8s linear infinite",
										margin: "0 auto 12px",
									}}
								/>
								Loading Drawing Board…
							</div>
						</div>
					) : (
						<ExcalidrawComponent
							excalidrawAPI={(api: ExcalidrawAPI) => setExcalidrawAPI(api)}
							onChange={handleChange}
							theme={isDark ? "dark" : "light"}
							gridModeEnabled={showGrid}
							initialData={{
								appState: {
									viewBackgroundColor: "transparent",
								},
							}}
							UIOptions={{
								canvasActions: {
									saveToActiveFile: false,
									loadScene: false,
									export: false,
									toggleTheme: false,
								},
							}}
						/>
					)}
				</div>
			</div>

			{/* Global transparent background + spinner keyframe */}
			<style>{`
				html, body, #root {
					background: transparent !important;
					margin: 0;
					padding: 0;
				}
				.excalidraw, .excalidraw-container {
					background: transparent !important;
				}
				@keyframes spin { to { transform: rotate(360deg); } }
			`}</style>
		</div>
	);
}

// ── Toolbar Button ────────────────────────────────────────────────────────────

function ToolbarButton({
	onClick,
	title,
	active = false,
	danger = false,
	isDark,
	children,
}: {
	onClick: () => void;
	title: string;
	active?: boolean;
	danger?: boolean;
	isDark: boolean;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				width: 28,
				height: 28,
				borderRadius: 6,
				border: "none",
				background: active
					? "rgba(99,96,245,0.25)"
					: "transparent",
				color: danger
					? "#f43f5e"
					: active
						? "#a5b4fc"
						: isDark
							? "#9ca3af"
							: "#6b7280",
				cursor: "pointer",
				// @ts-expect-error Electron-specific CSS property
				WebkitAppRegion: "no-drag",
				transition: "background 0.15s, color 0.15s",
				flexShrink: 0,
			}}
		>
			{children}
		</button>
	);
}
