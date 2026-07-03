import { existsSync } from "node:fs";
import path from "node:path";

type ResolveFfmpegBinaryPathOptions = {
	ffmpegStaticPath: string | null;
	isPackaged: boolean;
	envPath?: string;
	platform?: NodeJS.Platform;
	fileExists?: (candidate: string) => boolean;
};

function findFfmpegOnPath(
	envPath: string,
	platform: NodeJS.Platform,
	fileExists: (candidate: string) => boolean,
) {
	const executableNames =
		platform === "win32" ? ["ffmpeg.exe", "ffmpeg.cmd", "ffmpeg.bat", "ffmpeg"] : ["ffmpeg"];

	for (const directory of envPath.split(path.delimiter)) {
		if (!directory) continue;
		for (const executableName of executableNames) {
			const candidate = path.join(directory, executableName);
			if (fileExists(candidate)) {
				return candidate;
			}
		}
	}

	return null;
}

export function resolveFfmpegBinaryPath({
	ffmpegStaticPath,
	isPackaged,
	envPath = process.env.PATH ?? "",
	platform = process.platform,
	fileExists = existsSync,
}: ResolveFfmpegBinaryPathOptions) {
	if (ffmpegStaticPath && typeof ffmpegStaticPath === "string") {
		return isPackaged
			? ffmpegStaticPath.replace(/\.asar([/\\])/, ".asar.unpacked$1")
			: ffmpegStaticPath;
	}

	return findFfmpegOnPath(envPath, platform, fileExists);
}
