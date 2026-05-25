import { create } from "zustand";
import type { RouteGroup, StopSearchResult } from "@/lib/api";
import { validateRoute, type ValidationError } from "@/lib/validation";

export interface EditorStop {
  stop_sequence: number;
  stop_id: string | null;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
  isAdded?: boolean;
}

interface HistoryEntry {
  stops: EditorStop[];
  isDirty: boolean;
  dismissedWarnings: Set<string>;
}

interface EditorState {
  selectedRouteGroup: RouteGroup | null;
  selectedDirection: string | null;
  originalStops: EditorStop[];
  stops: EditorStop[];
  shapeId: string | null;
  isCustom: boolean;
  customMeta: { name: string; shortName: string; color: string } | null;
  savedRouteId: string | null;
  activeRerouteId: string | null;
  isDirty: boolean;
  selectedStopId: string | null;
  validationErrors: ValidationError[];
  isValid: boolean;
  routePreviewEnabled: boolean;
  isSuspiciousRoute: boolean;
  isRouteComputing: boolean;
  dismissedWarnings: Set<string>;
  history: HistoryEntry[];

  loadRoute: (group: RouteGroup, direction: string, stops: EditorStop[], shapeId: string) => void;
  startCustomRoute: (meta: { name: string; shortName: string; color: string }) => void;
  setStops: (stops: EditorStop[]) => void;
  addStop: (stop: StopSearchResult, afterIndex?: number) => void;
  removeStop: (stopId: string) => void;
  replaceStop: (oldStopId: string, replacement: { stopId: string; name: string; lat: number; lon: number }) => void;
  moveStop: (fromIndex: number, toIndex: number) => void;
  setSelectedStopId: (id: string | null) => void;
  setRoutePreviewEnabled: (v: boolean) => void;
  setSuspiciousRoute: (v: boolean) => void;
  setRouteComputing: (v: boolean) => void;
  setActiveRerouteId: (id: string | null) => void;
  dismissWarning: (stopId: string, code: string) => void;
  undo: () => void;
  markSaved: (id: string) => void;
  reset: () => void;
}

function withValidation(stops: EditorStop[], dismissed: Set<string> = new Set()): {
  validationErrors: ValidationError[];
  isValid: boolean;
} {
  const errs = validateRoute(stops, dismissed);
  const isValid = errs.filter((e) => e.severity === "error").length === 0;
  return { validationErrors: errs, isValid };
}

function snapshot(state: EditorState): HistoryEntry[] {
  const entry: HistoryEntry = {
    stops: [...state.stops],
    isDirty: state.isDirty,
    dismissedWarnings: new Set(state.dismissedWarnings),
  };
  return [...state.history.slice(-49), entry];
}

const initial = {
  selectedRouteGroup: null,
  selectedDirection: null,
  originalStops: [],
  stops: [],
  shapeId: null,
  isCustom: false,
  customMeta: null,
  savedRouteId: null,
  activeRerouteId: null,
  isDirty: false,
  selectedStopId: null,
  validationErrors: [] as ValidationError[],
  isValid: false,
  routePreviewEnabled: true,
  isSuspiciousRoute: false,
  isRouteComputing: false,
  dismissedWarnings: new Set<string>(),
  history: [] as HistoryEntry[],
};

export const useEditorStore = create<EditorState>((set, get) => ({
  ...initial,

  loadRoute(group, direction, stops, shapeId) {
    set({
      selectedRouteGroup: group,
      selectedDirection: direction,
      originalStops: stops,
      stops: stops.map((s) => ({ ...s })),
      shapeId,
      isCustom: false,
      customMeta: null,
      savedRouteId: null,
      isDirty: false,
      routePreviewEnabled: true,
      isSuspiciousRoute: false,
      dismissedWarnings: new Set(),
      history: [],
      ...withValidation(stops),
    });
  },

  startCustomRoute(meta) {
    set({
      selectedRouteGroup: null,
      selectedDirection: null,
      originalStops: [],
      stops: [],
      shapeId: null,
      isCustom: true,
      customMeta: meta,
      savedRouteId: null,
      isDirty: false,
      routePreviewEnabled: true,
      isSuspiciousRoute: false,
      dismissedWarnings: new Set(),
      history: [],
      ...withValidation([]),
    });
  },

  setStops(stops) {
    const history = snapshot(get());
    set({ stops, isDirty: true, routePreviewEnabled: false, history, ...withValidation(stops, get().dismissedWarnings) });
  },

  addStop(stop, afterIndex) {
    const current = get().stops;
    if (current.some((s) => s.stop_id === stop.stopId)) return;

    const newStop: EditorStop = {
      stop_sequence: 0,
      stop_id: stop.stopId,
      stop_name: stop.subName ? `${stop.name} (${stop.subName})` : stop.name,
      stop_lat: Number(stop.location?.latitude ?? 0),
      stop_lon: Number(stop.location?.longitude ?? 0),
      isAdded: true,
    };
    let next: EditorStop[];
    if (afterIndex !== undefined) {
      next = [...current.slice(0, afterIndex + 1), newStop, ...current.slice(afterIndex + 1)];
    } else {
      next = [...current, newStop];
    }
    next = next.map((s, i) => ({ ...s, stop_sequence: i }));

    const history = snapshot(get());
    set({ stops: next, isDirty: true, routePreviewEnabled: false, selectedStopId: stop.stopId, history, ...withValidation(next, get().dismissedWarnings) });
  },

  removeStop(stopId) {
    const next = get()
      .stops.filter((s) => s.stop_id !== stopId)
      .map((s, i) => ({ ...s, stop_sequence: i }));

    const history = snapshot(get());
    set({ stops: next, isDirty: true, routePreviewEnabled: false, history, ...withValidation(next, get().dismissedWarnings) });
  },

  replaceStop(oldStopId, replacement) {
    const stops = get().stops;
    const idx = stops.findIndex((s) => s.stop_id === oldStopId);
    if (idx === -1) return;
    if (replacement.stopId === oldStopId) return;

    const dismissed = new Set(get().dismissedWarnings);
    for (const key of dismissed) {
      if (key.startsWith(`${oldStopId}:`)) dismissed.delete(key);
    }

    const origIds = new Set(get().originalStops.map((s) => s.stop_id));
    const updated = [...stops];
    updated[idx] = {
      ...updated[idx],
      stop_id: replacement.stopId,
      stop_name: replacement.name,
      stop_lat: replacement.lat,
      stop_lon: replacement.lon,
      isAdded: !origIds.has(replacement.stopId),
    };

    const history = snapshot(get());
    set({ stops: updated, isDirty: true, routePreviewEnabled: false, dismissedWarnings: dismissed, history, ...withValidation(updated, dismissed) });
  },

  moveStop(fromIndex, toIndex) {
    const arr = [...get().stops];
    if (
      fromIndex < 0 || fromIndex >= arr.length ||
      toIndex   < 0 || toIndex   >= arr.length
    ) return;
    const [item] = arr.splice(fromIndex, 1);
    arr.splice(toIndex, 0, item);
    const next = arr.map((s, i) => ({ ...s, stop_sequence: i }));

    const history = snapshot(get());
    set({ stops: next, isDirty: true, routePreviewEnabled: false, history, ...withValidation(next, get().dismissedWarnings) });
  },

  setSelectedStopId(id) {
    set({ selectedStopId: id });
  },

  setRoutePreviewEnabled(v) {
    set({ routePreviewEnabled: v, isSuspiciousRoute: v ? get().isSuspiciousRoute : false });
  },

  setSuspiciousRoute(v) {
    set({ isSuspiciousRoute: v });
  },

  setRouteComputing(v) {
    set({ isRouteComputing: v });
  },

  setActiveRerouteId(id) {
    set({ activeRerouteId: id });
  },

  dismissWarning(stopId, code) {
    const dismissed = new Set(get().dismissedWarnings);
    dismissed.add(`${stopId}:${code}`);
    const history = snapshot(get());
    set({ dismissedWarnings: dismissed, history, ...withValidation(get().stops, dismissed) });
  },

  undo() {
    const { history } = get();
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    set({
      history: history.slice(0, -1),
      stops: prev.stops,
      isDirty: prev.isDirty,
      dismissedWarnings: prev.dismissedWarnings,
      routePreviewEnabled: false,
      ...withValidation(prev.stops, prev.dismissedWarnings),
    });
  },

  markSaved(id) {
    const { isCustom, stops } = get();
    set({
      savedRouteId: id,
      isDirty: false,
      shapeId: null,
      ...(isCustom ? { originalStops: stops.map((s) => ({ ...s })) } : {}),
    });
  },

  reset() {
    set(initial);
  },
}));
