import fs from "fs/promises";
import fsSync from "fs";
import path from "path";

export function slugify(value: string): string {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export async function ensureDir(dirPath: string) {
    await fs.mkdir(dirPath, { recursive: true });
}

export function getStorageRoot(): string {
    const configuredStorageDir = process.env.STORAGE_DIR || "storage";

    if (path.isAbsolute(configuredStorageDir)) {
        return configuredStorageDir;
    }

    return path.join(getProjectRoot(), configuredStorageDir);
}

function getProjectRoot(): string {
    let current = process.cwd();

    while (true) {
        if (fsSync.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
            return current;
        }

        const parent = path.dirname(current);
        if (parent === current) {
            return process.cwd();
        }

        current = parent;
    }
}

export async function saveTextFile(
    folder: string,
    fileName: string,
    content: string,
) {
    const dir = path.join(getStorageRoot(), folder);

    await ensureDir(dir);

    const filePath = path.join(dir, fileName);

    await fs.writeFile(filePath, content, "utf-8");

    return filePath;
}
