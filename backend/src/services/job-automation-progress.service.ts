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

    if (state.history.length > 40) {
        state.history = state.history.slice(-40);
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
    state.stage = input.stage;
    state.message = input.message;
    state.percent = Math.max(0, Math.min(100, input.percent ?? state.percent));
    state.currentStep = input.currentStep ?? state.currentStep;
    state.currentTarget = input.currentTarget ?? state.currentTarget;
    state.completedTargets = input.completedTargets ?? state.completedTargets;
    state.totalTargets = input.totalTargets ?? state.totalTargets;
    state.companiesScanned = input.companiesScanned ?? state.companiesScanned;
    state.careerPagesFound = input.careerPagesFound ?? state.careerPagesFound;
    state.matchedJobs = input.matchedJobs ?? state.matchedJobs;
    if ("providerStatus" in input) {
        state.providerStatus = input.providerStatus ?? null;
    }
    state.updatedAt = new Date();
    pushHistory(state.stage, state.message, state.percent);
}

export function finishAutomationProgress(message: string) {
    state.running = false;
    state.stage = "Complete";
    state.message = message;
    state.percent = 100;
    state.currentStep = state.totalSteps;
    state.updatedAt = new Date();
    state.finishedAt = new Date();
    pushHistory(state.stage, state.message, state.percent);
}

export function failAutomationProgress(error: string) {
    state.running = false;
    state.stage = "Failed";
    state.message = error;
    state.error = error;
    state.updatedAt = new Date();
    state.finishedAt = new Date();
    pushHistory(state.stage, state.message, state.percent);
}

export function getAutomationProgress(): AutomationProgressState {
    return {
        ...state,
        startedAt: state.startedAt ? new Date(state.startedAt) : null,
        updatedAt: state.updatedAt ? new Date(state.updatedAt) : null,
        finishedAt: state.finishedAt ? new Date(state.finishedAt) : null,
        history: state.history.map((entry) => ({
            ...entry,
            at: new Date(entry.at),
        })),
    };
}
