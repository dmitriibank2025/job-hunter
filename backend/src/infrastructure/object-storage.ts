/**
 * Object storage abstraction.
 *
 * When USE_S3=true the service uses AWS S3 (or any S3-compatible store).
 * Otherwise it falls back to the local filesystem (STORAGE_DIR).
 *
 * Required env vars when USE_S3=true:
 *   S3_BUCKET       - bucket name
 *   S3_REGION       - AWS region (default: us-east-1)
 *   S3_ENDPOINT     - optional custom endpoint (Cloudflare R2, MinIO, etc.)
 *   AWS_ACCESS_KEY_ID
 *   AWS_SECRET_ACCESS_KEY
 */
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getStorageRoot, ensureDir } from "../services/file-storage.service";
import { logger } from "../Logger/logger";
import type { Readable } from "stream";

function buildS3Client(): S3Client {
    return new S3Client({
        region: process.env.S3_REGION ?? "us-east-1",
        endpoint: process.env.S3_ENDPOINT,
        forcePathStyle: Boolean(process.env.S3_ENDPOINT),
        credentials: process.env.AWS_ACCESS_KEY_ID
            ? {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
            }
            : undefined,
    });
}

type StorageAdapter = {
    put(relativeKey: string, content: Buffer | string): Promise<void>;
    get(relativeKey: string): Promise<Buffer>;
    stream(relativeKey: string): Promise<Readable>;
    presignedUrl(relativeKey: string, expiresInSeconds?: number): Promise<string | null>;
    exists(relativeKey: string): Promise<boolean>;
};

function localAdapter(): StorageAdapter {
    function abs(key: string) {
        return path.isAbsolute(key) ? key : path.join(getStorageRoot(), key);
    }

    return {
        async put(key, content) {
            const filePath = abs(key);
            await ensureDir(path.dirname(filePath));
            await fs.writeFile(filePath, content);
        },
        async get(key) {
            return fs.readFile(abs(key));
        },
        async stream(key) {
            const { createReadStream } = await import("fs");
            return createReadStream(abs(key)) as unknown as Readable;
        },
        async presignedUrl() {
            return null;
        },
        async exists(key) {
            return fsSync.existsSync(abs(key));
        },
    };
}

function s3Adapter(bucket: string): StorageAdapter {
    const client = buildS3Client();

    return {
        async put(key, content) {
            const body = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
            await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
            logger.debug({ key, bucket }, "S3 put");
        },
        async get(key) {
            const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
            const chunks: Buffer[] = [];
            for await (const chunk of res.Body as Readable) {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            return Buffer.concat(chunks);
        },
        async stream(key) {
            const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
            return res.Body as Readable;
        },
        async presignedUrl(key, expiresInSeconds = 3600) {
            const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
            return getSignedUrl(client, cmd, { expiresIn: expiresInSeconds });
        },
        async exists(key) {
            try {
                await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
                return true;
            } catch {
                return false;
            }
        },
    };
}

let _adapter: StorageAdapter | null = null;

export function getObjectStorage(): StorageAdapter {
    if (_adapter) return _adapter;

    const useS3 = process.env.USE_S3 === "true";
    const bucket = process.env.S3_BUCKET;

    if (useS3) {
        if (!bucket) {
            logger.error("[FATAL] USE_S3=true but S3_BUCKET is not set");
            process.exit(1);
        }
        logger.info({ bucket, endpoint: process.env.S3_ENDPOINT ?? "AWS" }, "Using S3 object storage");
        _adapter = s3Adapter(bucket);
    } else {
        logger.info({ root: getStorageRoot() }, "Using local filesystem storage");
        _adapter = localAdapter();
    }

    return _adapter;
}

export function isS3Enabled(): boolean {
    return process.env.USE_S3 === "true";
}
