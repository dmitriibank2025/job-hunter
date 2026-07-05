import { spawn, ChildProcess } from "child_process";
import crypto from "crypto";
import net from "net";
import { logger } from "../Logger/logger";

/**
 * Remote interactive browser session for per-user LinkedIn login inside Docker.
 *
 * In a container there is no display the user can reach, so we run a headful
 * browser on a virtual X display (Xvfb), expose that display over VNC (x11vnc),
 * and bridge VNC to the browser via noVNC/websockify. The frontend opens the
 * returned `viewUrl` so the user sees the real LinkedIn page and logs into their
 * own account (passwords, 2FA, captcha all work).
 *
 * Scope/assumptions (small beta, single backend replica — see scheduler note):
 *   - One active session at a time on a fixed display (:99) and noVNC port.
 *   - Per-session random VNC password embedded in viewUrl gates access.
 * For multi-session concurrency, allocate dynamic displays/ports — out of scope here.
 */

const DISPLAY = process.env.REMOTE_DISPLAY ?? ":99";
const VNC_PORT = Number(process.env.REMOTE_VNC_PORT ?? 5900);
const NOVNC_PORT = Number(process.env.REMOTE_NOVNC_PORT ?? 6080);
const SCREEN = process.env.REMOTE_SCREEN ?? "1440x1100x24";
const NOVNC_WEB = process.env.NOVNC_WEB_DIR ?? "/usr/share/novnc";

export type RemoteBrowserSession = {
    display: string;
    viewUrl: string;
    stop: () => Promise<void>;
};

let activeSession: RemoteBrowserSession | null = null;

export function isRemoteViewEnabled(): boolean {
    return process.env.LINKEDIN_REMOTE_VIEW === "true";
}

export function hasActiveRemoteSession(): boolean {
    return activeSession !== null;
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

function waitForPort(port: number, timeoutMs = 8000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        const tryOnce = () => {
            const sock = net.connect(port, "127.0.0.1");
            sock.once("connect", () => { sock.destroy(); resolve(); });
            sock.once("error", () => {
                sock.destroy();
                if (Date.now() > deadline) reject(new Error(`port ${port} not ready`));
                else setTimeout(tryOnce, 200);
            });
        };
        tryOnce();
    });
}

function spawnProc(cmd: string, args: string[], extraEnv: Record<string, string> = {}): ChildProcess {
    const child = spawn(cmd, args, {
        env: { ...process.env, ...extraEnv },
        stdio: "ignore",
        detached: false,
    });
    child.on("error", (err) => logger.error({ cmd, err: err.message }, "[remote-browser] spawn error"));
    return child;
}

/**
 * Build the public noVNC URL. PUBLIC_WEB_BASE should be the externally reachable
 * origin that maps to the noVNC port (e.g. http://localhost:6080 in dev, or a
 * reverse-proxied https URL in production).
 */
function buildViewUrl(password: string): string {
    const base = (process.env.PUBLIC_NOVNC_BASE ?? `http://localhost:${NOVNC_PORT}`).replace(/\/$/, "");
    const params = new URLSearchParams({
        autoconnect: "1",
        resize: "scale",
        password,
        path: "websockify",
    });
    return `${base}/vnc.html?${params.toString()}`;
}

/**
 * Start (or reuse) the single remote browser session. Returns the display the
 * caller must launch the browser on, plus the viewUrl for the frontend.
 */
export async function startRemoteBrowserSession(): Promise<RemoteBrowserSession> {
    if (activeSession) {
        throw new Error("A LinkedIn connection is already in progress. Please finish or wait for it to time out.");
    }

    const password = crypto.randomBytes(6).toString("base64url").slice(0, 8);
    const procs: ChildProcess[] = [];

    // 1) Virtual display
    const xvfb = spawnProc("Xvfb", [DISPLAY, "-screen", "0", SCREEN, "-nolisten", "tcp"]);
    procs.push(xvfb);
    await sleep(1200);

    // 2) VNC server on that display, password-protected
    const x11vnc = spawnProc("x11vnc", [
        "-display", DISPLAY,
        "-rfbport", String(VNC_PORT),
        "-passwd", password,
        "-forever", "-shared", "-noxdamage", "-quiet",
    ]);
    procs.push(x11vnc);
    await waitForPort(VNC_PORT).catch(() => undefined);

    // 3) noVNC (websockify) bridging the browser to VNC
    const websockify = spawnProc("websockify", [
        "--web", NOVNC_WEB,
        String(NOVNC_PORT),
        `localhost:${VNC_PORT}`,
    ]);
    procs.push(websockify);
    await waitForPort(NOVNC_PORT).catch(() => undefined);

    let stopped = false;
    const stop = async () => {
        if (stopped) return;
        stopped = true;
        for (const p of procs) {
            try { p.kill("SIGTERM"); } catch { /* ignore */ }
        }
        await sleep(300);
        for (const p of procs) {
            try { if (!p.killed) p.kill("SIGKILL"); } catch { /* ignore */ }
        }
        activeSession = null;
        logger.info("[remote-browser] session stopped");
    };

    activeSession = { display: DISPLAY, viewUrl: buildViewUrl(password), stop };
    logger.info({ display: DISPLAY, novncPort: NOVNC_PORT }, "[remote-browser] session started");
    return activeSession;
}
