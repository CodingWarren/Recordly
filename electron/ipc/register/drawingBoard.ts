import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { ipcMain } from "electron";
import {
	closeDrawingBoardWindow,
	createDrawingBoardWindow,
	getDrawingBoardWindow,
} from "../../windows";
import {
	resolveLinuxWindowBounds,
	resolveMacWindowBounds,
	resolveWindowsWindowBounds,
} from "../cursor/bounds";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { getWindowsCaptureExePath } from "../paths/binaries";
import {
	attachWindowsCaptureLifecycle,
	waitForWindowsCaptureStart,
	waitForWindowsCaptureStop,
} from "../recording/windows";
import {
	selectedSource,
	setNativeScreenRecordingActive,
	setWindowsCaptureOutputBuffer,
	setWindowsCapturePaused,
	setWindowsCaptureProcess,
	setWindowsCaptureStopRequested,
	setWindowsCaptureTargetPath,
	setWindowsNativeCaptureActive,
	setWindowsPendingVideoPath,
	windowsCaptureOutputBuffer,
	windowsCaptureProcess,
	windowsCaptureTargetPath,
	windowsNativeCaptureActive,
} from "../state";
import type { SelectedSource, WindowBounds } from "../types";
import { getRecordingsDir, getScreen, moveFileWithOverwrite } from "../utils";

let drawingBoardData: string | null = null;
let isRecordingSessionActive = false;
let drawingBoardRecordingActive = false;
let drawingBoardPreRecordingVideoPath: string | null = null;

async function pathExists(filePath: string | null | undefined) {
	if (!filePath) {
		return false;
	}

	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

function escapeConcatPath(filePath: string) {
	return filePath.replace(/\\/g, "/").replace(/'/g, "'\\''");
}

async function mergeVideoSegments(videoPaths: string[]): Promise<string> {
	const validPaths: string[] = [];
	for (const videoPath of videoPaths) {
		if (await pathExists(videoPath)) {
			validPaths.push(videoPath);
		}
	}

	if (validPaths.length === 0) {
		throw new Error("No valid video segments to merge");
	}
	if (validPaths.length === 1) {
		return validPaths[0];
	}

	const outputPath = validPaths[0].replace(/(-drawing)?\.mp4$/i, "-merged.mp4");
	const concatFilePath = path.join(
		path.dirname(outputPath),
		`recordly-drawing-concat-${Date.now()}.txt`,
	);
	const concatList = validPaths.map((videoPath) => `file '${escapeConcatPath(videoPath)}'`).join("\n");

	await fs.writeFile(concatFilePath, concatList, "utf-8");
	try {
		await new Promise<void>((resolve, reject) => {
			const ffmpeg = spawn(getFfmpegBinaryPath(), [
				"-y",
				"-f",
				"concat",
				"-safe",
				"0",
				"-i",
				concatFilePath,
				"-c",
				"copy",
				outputPath,
			]);
			let output = "";
			ffmpeg.stderr.on("data", (chunk: Buffer) => {
				output += chunk.toString();
			});
			ffmpeg.once("error", reject);
			ffmpeg.once("close", (code) => {
				if (code === 0) {
					resolve();
					return;
				}
				reject(new Error(output.trim() || `FFmpeg concat failed with code ${code}`));
			});
		});
		return outputPath;
	} finally {
		await fs.rm(concatFilePath, { force: true }).catch(() => undefined);
	}
}

async function resolveSelectedWindowBounds(source: SelectedSource): Promise<WindowBounds | null> {
	if (!source.id?.startsWith("window:")) {
		const displayId = Number(source.display_id);
		if (!Number.isFinite(displayId) || displayId <= 0) {
			return null;
		}

		const resolvedDisplay = getScreen().getAllDisplays().find((display) => display.id === displayId);
		return resolvedDisplay?.bounds ?? null;
	}

	if (process.platform === "win32") {
		return resolveWindowsWindowBounds(source);
	}
	if (process.platform === "darwin") {
		return resolveMacWindowBounds(source);
	}
	if (process.platform === "linux") {
		return resolveLinuxWindowBounds(source);
	}
	return null;
}

function getWindowHandle(window: Electron.BrowserWindow) {
	const handle = window.getNativeWindowHandle();
	return process.arch === "x64" || process.arch === "arm64"
		? Number(handle.readBigInt64LE(0))
		: handle.readInt32LE(0);
}

async function moveCaptureTempToFinal(tempVideoPath: string, finalVideoPath: string) {
	if (tempVideoPath !== finalVideoPath && (await pathExists(tempVideoPath))) {
		await moveFileWithOverwrite(tempVideoPath, finalVideoPath);
	}
}

async function switchWindowsCaptureToDrawingBoard() {
	if (
		process.platform !== "win32" ||
		!windowsNativeCaptureActive ||
		!windowsCaptureProcess ||
		!selectedSource?.id?.startsWith("window:")
	) {
		return;
	}

	const proc = windowsCaptureProcess;
	const preferredVideoPath = windowsCaptureTargetPath;
	setWindowsCaptureStopRequested(true);
	proc.stdin.write("stop\n");
	const tempVideoPath = await waitForWindowsCaptureStop(proc);
	const partialVideoPath = preferredVideoPath ?? tempVideoPath;
	await moveCaptureTempToFinal(tempVideoPath, partialVideoPath);

	setWindowsCaptureProcess(null);
	setWindowsNativeCaptureActive(false);
	setNativeScreenRecordingActive(false);
	setWindowsCaptureTargetPath(null);
	setWindowsCaptureStopRequested(false);
	setWindowsCapturePaused(false);

	await new Promise((resolve) => setTimeout(resolve, 1200));
	const drawingBoardWin = getDrawingBoardWindow();
	if (!drawingBoardWin || drawingBoardWin.isDestroyed()) {
		setWindowsPendingVideoPath(partialVideoPath);
		return;
	}

	const recordingsDir = await getRecordingsDir();
	const timestamp = Date.now();
	const finalDrawingPath = path.join(recordingsDir, `recording-${timestamp}-drawing.mp4`);
	const tempDrawingPath = path.join(
		path.dirname(tempVideoPath),
		`recordly-native-${timestamp}-drawing.mp4`,
	);
	const wcProc = spawn(
		getWindowsCaptureExePath(),
		[
			JSON.stringify({
				outputPath: tempDrawingPath,
				fps: 60,
				windowHandle: getWindowHandle(drawingBoardWin),
			}),
		],
		{
			cwd: recordingsDir,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, __COMPAT_LAYER: "HighDpiAware" },
		},
	);

	setWindowsCaptureOutputBuffer("");
	setWindowsCaptureTargetPath(finalDrawingPath);
	setWindowsCaptureStopRequested(false);
	setWindowsCapturePaused(false);
	setWindowsCaptureProcess(wcProc);
	attachWindowsCaptureLifecycle(wcProc);

	wcProc.stdout.on("data", (chunk: Buffer) => {
		setWindowsCaptureOutputBuffer(windowsCaptureOutputBuffer + chunk.toString());
	});
	wcProc.stderr.on("data", (chunk: Buffer) => {
		setWindowsCaptureOutputBuffer(windowsCaptureOutputBuffer + chunk.toString());
	});

	await waitForWindowsCaptureStart(wcProc);
	setWindowsNativeCaptureActive(true);
	setNativeScreenRecordingActive(true);
	drawingBoardRecordingActive = true;
	drawingBoardPreRecordingVideoPath = partialVideoPath;
}

export async function resolveDrawingBoardMuxVideoPath(videoPath: string) {
	if (!drawingBoardRecordingActive || !drawingBoardPreRecordingVideoPath) {
		return videoPath;
	}

	try {
		return await mergeVideoSegments([drawingBoardPreRecordingVideoPath, videoPath]);
	} finally {
		drawingBoardRecordingActive = false;
		drawingBoardPreRecordingVideoPath = null;
	}
}

export function resetDrawingBoardRecordingState() {
	drawingBoardRecordingActive = false;
	drawingBoardPreRecordingVideoPath = null;
}

export function setDrawingBoardRecordingSessionActive(recording: boolean) {
	isRecordingSessionActive = recording;
}

export function registerDrawingBoardHandlers() {
	ipcMain.handle("open-drawing-board", async () => {
		if (!isRecordingSessionActive) {
			console.warn("[open-drawing-board] Rejected: no active recording session.");
			return {
				success: false,
				message: "Drawing board can only be opened during an active recording.",
			};
		}

		try {
			const sourceType = selectedSource?.id?.startsWith("window:") ? "window" : "screen";
			const windowBounds = selectedSource ? await resolveSelectedWindowBounds(selectedSource) : null;
			createDrawingBoardWindow(windowBounds, sourceType);
			await switchWindowsCaptureToDrawingBoard();
			return { success: true };
		} catch (error) {
			console.error("Failed to open drawing board:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("close-drawing-board", () => {
		try {
			closeDrawingBoardWindow();
			return { success: true };
		} catch (error) {
			console.error("Failed to close drawing board:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("get-drawing-board-data", () => ({ success: true, data: drawingBoardData }));

	ipcMain.handle("set-drawing-board-data", (_event, data: string) => {
		drawingBoardData = typeof data === "string" ? data : null;
		return { success: true };
	});

	ipcMain.handle("clear-drawing-board-data", () => {
		drawingBoardData = null;
		return { success: true };
	});

	ipcMain.handle("get-drawing-board-window-source-id", () => {
		const drawingBoardWin = getDrawingBoardWindow();
		if (!drawingBoardWin || drawingBoardWin.isDestroyed()) {
			return { success: false, message: "Drawing board window is not open" };
		}

		try {
			const hwnd = getWindowHandle(drawingBoardWin);
			return {
				success: true,
				sourceId: `window:${hwnd}:0`,
				hwnd,
				sourceName: "Drawing Board - Recordly",
			};
		} catch (error) {
			console.error("Failed to get drawing board window source ID:", error);
			return { success: false, error: String(error) };
		}
	});
}
