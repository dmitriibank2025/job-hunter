import { configureStore, createSlice, PayloadAction } from "@reduxjs/toolkit";
import { useDispatch, useSelector, type TypedUseSelectorHook } from "react-redux";

type AppState = {
  status: string;
  user: any | null;
  authTokens: any | null;
  catalog: any[];
  languageOptions: string[];
  jobs: any[];
  documents: any[];
  companies: any[];
  adminUsers: any[];
  settings: Record<string, any>;
};

const appSlice = createSlice({
  name: "app",
  initialState: {
    status: "Ready.",
    user: null,
    authTokens: null,
    catalog: [],
    languageOptions: [],
    jobs: [],
    documents: [],
    companies: [],
    adminUsers: [],
    settings: {},
  } as AppState,
  reducers: {
    setStatus(state, action: PayloadAction<string>) {
      state.status = action.payload;
    },
    setUser(state, action: PayloadAction<any | null>) {
      state.user = action.payload;
    },
    setAuthTokens(state, action: PayloadAction<any | null>) {
      state.authTokens = action.payload;
    },
    setCatalog(state, action: PayloadAction<any[]>) {
      state.catalog = action.payload;
    },
    setLanguageOptions(state, action: PayloadAction<string[]>) {
      state.languageOptions = action.payload;
    },
    setJobs(state, action: PayloadAction<any[]>) {
      state.jobs = action.payload;
    },
    setDocuments(state, action: PayloadAction<any[]>) {
      state.documents = action.payload;
    },
    setCompanies(state, action: PayloadAction<any[]>) {
      state.companies = action.payload;
    },
    setAdminUsers(state, action: PayloadAction<any[]>) {
      state.adminUsers = action.payload;
    },
    setSettings(state, action: PayloadAction<Record<string, any>>) {
      state.settings = action.payload;
    },
  },
});

export const appActions = appSlice.actions;

export const store = configureStore({
  reducer: {
    app: appSlice.reducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
