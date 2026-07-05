type AutomationProgressEntry = {
    at: Date;
    stage: string;
    message: string;
    percent: number;
};

export type ProviderProgressStatus = {
    source: string;
    phase: string;
    searchUrl?: string | null;
    pageStart?: number | null;
    visibleCards?: number;
    newCards?: number;
    totalCards?: number;
    prefilteredCards?: number;
    detailIndex?: number;
    detailTotal?: number;
    detailTitle?: string | null;
};

export type AutomationProgressState = {
    running: boolean;
    stage: string;
    message: string;
    percent: number;
    currentStep: number;
    totalSteps: number;
    currentTarget: string | null;
    completedTargets: number;
    totalTargets: number;
    companiesScanned: number;
    careerPagesFound: number;
    matchedJobs: number;
    providerStatus: ProviderProgressStatus | null;
    startedAt: Date | null;
    updatedAt: Date | null;
    finishedAt: Date | null;
    error: string | null;
    history: AutomationProgressEntry[];
};

const DEFAULT_TOTAL_STEPS = 5;
const MAX_HISTORY_SIZE = 100;

// Per-user state map — key is userId
const userStates = new Map<string, AutomationProgressState>();
const userTimers = new Map<string, NodeJS.Timeout>();
const userPendingUpdates = new Map<string, { stage: string; message: string; percent: number }>();
const userCaches = new Map<string, { state: AutomationProgressState; at: number }>();
const CACHE_TTL_MS = 500;

function defaultState(): AutomationProgressState {
    return {
        running: false,
        stage: "Idle",
        message: "Ready.",
        percent: 0,
        currentStep: 0,
        totalSteps: DEFAULT_TOTAL_STEPS,
        currentTarget: null,
        completedTargets: 0,
        totalTargets: 0,
        companiesScanned: 0,
        careerPagesFound: 0,
        matchedJobs: 0,
        providerStatus: null,
        startedAt: null,
        updatedAt: null,
        finishedAt: null,
        error: null,
        history: [],
    };
}

function getState(userId: string): AutomationProgressState {
    if (!userStates.has(userId)) {
        userStates.set(userId, defaultState());
    }
    return userStates.get(userId)!;
}

function pushHistory(userId: string, stage: string, message: string, percent: number) {
    const state = getState(userId);
    state.history.push({ at: new Date(), stage, message, percent });
    if (state.history.length > MAX_HISTORY_SIZE) {
        state.history = state.history.slice(-MAX_HISTORY_SIZE);
    }
}

export function startAutomationProgress(userId: string, totalSteps = DEFAULT_TOTAL_STEPS) {
    const state = getState(userId);
    state.running = true;
    state.stage = "Initializing";
    state.message = "Starting automation...";
    state.percent = 0;
    state.currentStep = 0;
    state.totalSteps = totalSteps;
    state.currentTarget = null;
    state.completedTargets = 0;
    state.totalTargets = 0;
    state.companiesScanned = 0;
    state.careerPagesFound = 0;
    state.matchedJobs = 0;
    state.providerStatus = null;
    state.startedAt = new Date();
    state.updatedAt = new Date();
    state.finishedAt = null;
    state.error = null;
    state.history = [];
    userCaches.delete(userId);
    pushHistory(userId, state.stage, state.message, state.percent);
}

export function updateAutomationProgress(userId: string, input: {
    stage: string;
    message: string;
    percent?: number;
    currentStep?: number;
    currentTarget?: string | null;
    completedTargets?: number;
    totalTargets?: number;
    companiesScanned?: number;
    careerPagesFound?: number;
    matchedJobs?: number;
    providerStatus?: ProviderProgressStatus | null;
}) {
    const state = getState(userId);

    state.stage = input.stage;
    state.message = input.message;
    if (input.percent !== undefined) state.percent = Math.max(0, Math.min(100, input.percent));
    if (input.currentStep !== undefined) state.currentStep = input.currentStep;
    if (input.currentTarget !== undefined) state.currentTarget = input.currentTarget;
    if (input.completedTargets !== undefined) state.completedTargets = input.completedTargets;
    if (input.totalTargets !== undefined) state.totalTargets = input.totalTargets;
    if (input.companiesScanned !== undefined) state.companiesScanned = input.companiesScanned;
    if (input.careerPagesFound !== undefined) state.careerPagesFound = input.careerPagesFound;
    if (input.matchedJobs !== undefined) state.matchedJobs = input.matchedJobs;
    if ("providerStatus" in input) state.providerStatus = input.providerStatus ?? null;
    state.updatedAt = new Date();
    userCaches.delete(userId);

    // Debounced history write
    const existing = userTimers.get(userId);
    if (existing) clearTimeout(existing);

    userPendingUpdates.set(userId, {
        stage: state.stage,
        message: state.message,
        percent: state.percent,
    });

    const timer = setTimeout(() => {
        const pending = userPendingUpdates.get(userId);
        if (pending) {
            pushHistory(userId, pending.stage, pending.message, pending.percent);
            userPendingUpdates.delete(userId);
        }
        userTimers.delete(userId);
    }, 100);
    timer.unref?.();
    userTimers.set(userId, timer);
}

export function finishAutomationProgress(userId: string, message: string) {
    const timer = userTimers.get(userId);
    if (timer) { clearTimeout(timer); userTimers.delete(userId); }
    userPendingUpdates.delete(userId);

    const state = getState(userId);
    state.running = false;
    state.stage = "Complete";
    state.message = message;
    state.percent = 100;
    state.currentStep = state.totalSteps;
    state.updatedAt = new Date();
    state.finishedAt = new Date();
    userCaches.delete(userId);
    pushHistory(userId, state.stage, state.message, state.percent);
}

export function failAutomationProgress(userId: string, error: string) {
    const timer = userTimers.get(userId);
    if (timer) { clearTimeout(timer); userTimers.delete(userId); }
    userPendingUpdates.delete(userId);

    const state = getState(userId);
    state.running = false;
    state.stage = "Failed";
    state.message = error;
    state.error = error;
    state.updatedAt = new Date();
    state.finishedAt = new Date();
    userCaches.delete(userId);
    pushHistory(userId, state.stage, state.message, state.percent);
}

export function getAutomationProgress(userId: string): AutomationProgressState {
    const now = Date.now();
    const cached = userCaches.get(userId);
    if (cached && now - cached.at < CACHE_TTL_MS) return cached.state;

    const state = getState(userId);
    const snapshot: AutomationProgressState = {
        ...state,
        startedAt: state.startedAt ? new Date(state.startedAt) : null,
        updatedAt: state.updatedAt ? new Date(state.updatedAt) : null,
        finishedAt: state.finishedAt ? new Date(state.finishedAt) : null,
        history: state.history.map((e) => ({ ...e, at: new Date(e.at) })),
    };
    userCaches.set(userId, { state: snapshot, at: now });
    return snapshot;
}

export function isAutomationRunning(userId: string): boolean {
    return userStates.get(userId)?.running ?? false;
}

export function resetAutomationProgressCache(userId: string) {
    userCaches.delete(userId);
}
