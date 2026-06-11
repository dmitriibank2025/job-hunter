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

const state: AutomationProgressState = {
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

function pushHistory(stage: string, message: string, percent: number) {
    state.history.push({
        at: new Date(),
        stage,
        message,
        percent,
    });

    if (state.history.length > MAX_HISTORY_SIZE) {
        state.history = state.history.slice(-MAX_HISTORY_SIZE);
    }
}

export function startAutomationProgress(totalSteps = DEFAULT_TOTAL_STEPS) {
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
    pushHistory(state.stage, state.message, state.percent);
}

let updateTimeout: NodeJS.Timeout | null = null;
let pendingUpdate: { stage: string; message: string; percent: number } | null = null;

export function updateAutomationProgress(input: {
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
    // Мгновенно обновляем критичные поля
    state.stage = input.stage;
    state.message = input.message;

    if (input.percent !== undefined) {
        state.percent = Math.max(0, Math.min(100, input.percent));
    }
    if (input.currentStep !== undefined) {
        state.currentStep = input.currentStep;
    }
    if (input.currentTarget !== undefined) {
        state.currentTarget = input.currentTarget;
    }
    if (input.completedTargets !== undefined) {
        state.completedTargets = input.completedTargets;
    }
    if (input.totalTargets !== undefined) {
        state.totalTargets = input.totalTargets;
    }
    if (input.companiesScanned !== undefined) {
        state.companiesScanned = input.companiesScanned;
    }
    if (input.careerPagesFound !== undefined) {
        state.careerPagesFound = input.careerPagesFound;
    }
    if (input.matchedJobs !== undefined) {
        state.matchedJobs = input.matchedJobs;
    }
    if ("providerStatus" in input) {
        state.providerStatus = input.providerStatus ?? null;
    }

    state.updatedAt = new Date();

    // Дебаунсинг для истории
    if (updateTimeout) {
        clearTimeout(updateTimeout);
    }

    // Сохраняем текущие значения с гарантией, что они не undefined
    pendingUpdate = {
        stage: state.stage,
        message: state.message,
        percent: state.percent
    };

    updateTimeout = setTimeout(() => {
        if (pendingUpdate) {
            // Теперь все поля гарантированно имеют тип string и number
            pushHistory(pendingUpdate.stage, pendingUpdate.message, pendingUpdate.percent);
            pendingUpdate = null;
        }
        updateTimeout = null;
    }, 100);
}

export function finishAutomationProgress(message: string) {
    if (updateTimeout) {
        clearTimeout(updateTimeout);
        updateTimeout = null;
    }

    state.running = false;
    state.stage = "Complete";
    state.message = message;
    state.percent = 100;
    state.currentStep = state.totalSteps;
    state.updatedAt = new Date();
    state.finishedAt = new Date();
    pushHistory(state.stage, state.message, state.percent);

    pendingUpdate = null;
}

export function failAutomationProgress(error: string) {
    if (updateTimeout) {
        clearTimeout(updateTimeout);
        updateTimeout = null;
    }

    state.running = false;
    state.stage = "Failed";
    state.message = error;
    state.error = error;
    state.updatedAt = new Date();
    state.finishedAt = new Date();
    pushHistory(state.stage, state.message, state.percent);

    pendingUpdate = null;
}

let cachedProgress: AutomationProgressState | null = null;
let lastCacheInvalidation = 0;
const CACHE_TTL_MS = 500;

export function getAutomationProgress(): AutomationProgressState {
    const now = Date.now();

    if (cachedProgress && (now - lastCacheInvalidation) < CACHE_TTL_MS) {
        return cachedProgress;
    }

    cachedProgress = {
        ...state,
        startedAt: state.startedAt ? new Date(state.startedAt) : null,
        updatedAt: state.updatedAt ? new Date(state.updatedAt) : null,
        finishedAt: state.finishedAt ? new Date(state.finishedAt) : null,
        history: state.history.map((entry) => ({
            ...entry,
            at: new Date(entry.at),
        })),
    };

    lastCacheInvalidation = now;

    return cachedProgress;
}

// Функция для сброса кеша (полезно при тестировании)
export function resetAutomationProgressCache() {
    cachedProgress = null;
    lastCacheInvalidation = 0;
}