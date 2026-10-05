import {
    centerIsraelBrowserTimeoutMs,
    centerIsraelProviderTimeoutMs,
} from "../providers/center-israel.provider";

describe("Center Israel timeout configuration", () => {
    const originalProviderTimeout = process.env.CENTER_ISRAEL_PROVIDER_TIMEOUT_MS;
    const originalBrowserTimeout = process.env.CENTER_ISRAEL_BROWSER_TIMEOUT_MS;

    afterEach(() => {
        if (originalProviderTimeout === undefined) delete process.env.CENTER_ISRAEL_PROVIDER_TIMEOUT_MS;
        else process.env.CENTER_ISRAEL_PROVIDER_TIMEOUT_MS = originalProviderTimeout;

        if (originalBrowserTimeout === undefined) delete process.env.CENTER_ISRAEL_BROWSER_TIMEOUT_MS;
        else process.env.CENTER_ISRAEL_BROWSER_TIMEOUT_MS = originalBrowserTimeout;
    });

    it("keeps the shared browser alive longer than the default provider deadline", () => {
        delete process.env.CENTER_ISRAEL_PROVIDER_TIMEOUT_MS;
        delete process.env.CENTER_ISRAEL_BROWSER_TIMEOUT_MS;

        expect(centerIsraelBrowserTimeoutMs()).toBeGreaterThan(centerIsraelProviderTimeoutMs());
    });

    it("derives the browser lifetime from a configured provider deadline", () => {
        process.env.CENTER_ISRAEL_PROVIDER_TIMEOUT_MS = "120000";
        delete process.env.CENTER_ISRAEL_BROWSER_TIMEOUT_MS;

        expect(centerIsraelProviderTimeoutMs()).toBe(120000);
        expect(centerIsraelBrowserTimeoutMs()).toBe(180000);
    });
});
