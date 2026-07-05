import winston from "winston";

const isProduction = process.env.NODE_ENV === "production";

const winstonLogger = winston.createLogger({
    level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
    format: isProduction
        ? winston.format.combine(
            winston.format.timestamp(),
            winston.format.errors({ stack: true }),
            winston.format.json(),
        )
        : winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp({ format: "HH:mm:ss" }),
            winston.format.printf(({ timestamp, level, message, ...meta }) => {
                const metaStr = Object.keys(meta).length
                    ? ` ${JSON.stringify(meta)}`
                    : "";
                return `${timestamp} ${level}: ${message}${metaStr}`;
            }),
        ),
    transports: [new winston.transports.Console()],
});

type Meta = Record<string, unknown> | unknown;

// Supports both calling conventions:
//   logger.info("message")
//   logger.info("message", metaObject)
//   logger.info(metaObject, "message")   ← pino-style used throughout codebase
function buildLog(level: "debug" | "info" | "warn" | "error", ...args: unknown[]) {
    let message: string;
    let meta: Meta = {};

    if (typeof args[0] === "string") {
        message = args[0];
        meta = (args[1] as Meta) ?? {};
    } else if (typeof args[1] === "string") {
        message = args[1];
        meta = args[0] as Meta;
    } else {
        message = String(args[0]);
        meta = {};
    }

    if (level === "error" && meta instanceof Error) {
        winstonLogger.error(message, { err: { message: meta.message, stack: meta.stack } });
        return;
    }
    if (level === "error" && args[0] instanceof Error) {
        winstonLogger.error(args[0].message, { stack: args[0].stack });
        return;
    }

    winstonLogger[level](message, meta);
}

export const logger = {
    debug: (...args: unknown[]) => buildLog("debug", ...args),
    info: (...args: unknown[]) => buildLog("info", ...args),
    warn: (...args: unknown[]) => buildLog("warn", ...args),
    error: (...args: unknown[]) => buildLog("error", ...args),
};
