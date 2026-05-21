import { create } from "zustand";
import type { RouteGroup, StopSearchResult } from "@/lib/api";

export interface EditorStop {
  stop_sequence: number;
  stop_id: string | null;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
  isAdded?: boolean;
}

export type EditMode = "map" | "list";

interface EditorState {
  selectedRouteGroup: RouteGroup | null;
  selectedDirection: string | null;
  originalStops: EditorStop[];
  stops: EditorStop[];
  shapeId: string | null;
  editMode: EditMode;
  isCustom: boolean;
  customMeta: { name: string; shortName: string; color: string } | null;
  savedRouteId: string | null;
  isDirty: boolean;
  selectedStopId: string | null;

  loadRoute: (
    group: RouteGroup,
    direction: string,
    stops: EditorStop[],
    shapeId: string
  ) => void;
  startCustomRoute: (meta: { name: string; shortName: string; color: string }) => void;
  setStops: (stops: EditorStop[]) => void;
  addStop: (stop: StopSearchResult, afterIndex?: number) => void;
  removeStop: (stopId: string) => void;
  replaceStop: (
    oldStopId: string,
    replacement: { stopId: string; name: string; lat: number; lon: number }
  ) => void;
  moveStop: (fromIndex: number, toIndex: number) => void;
  setEditMode: (mode: EditMode) => void;
  setSelectedStopId: (id: string | null) => void;
  markSaved: (id: string) => void;
  reset: () => void;
}

const initial = {
  selectedRouteGroup: null,
  selectedDirection: null,
  originalStops: [],
  stops: [],
  shapeId: null,
  editMode: "list" as EditMode,
  isCustom: false,
  customMeta: null,
  savedRouteId: null,
  isDirty: false,
  selectedStopId: null,
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
    });
  },

  setStops(stops) {
    set({ stops, isDirty: true });
  },

  addStop(stop, afterIndex) {
    const current = get().stops;
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
      next = [
        ...current.slice(0, afterIndex + 1),
        newStop,
        ...current.slice(afterIndex + 1),
      ];
    } else {
      next = [...current, newStop];
    }
    next = next.map((s, i) => ({ ...s, stop_sequence: i }));
    set({ stops: next, isDirty: true });
  },

  removeStop(stopId) {
    const next = get()
      .stops.filter((s) => s.stop_id !== stopId)
      .map((s, i) => ({ ...s, stop_sequence: i }));
    set({ stops: next, isDirty: true });
  },

  replaceStop(oldStopId, replacement) {
    const stops = get().stops;
    const idx = stops.findIndex((s) => s.stop_id === oldStopId);
    if (idx === -1) return;
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
    set({ stops: updated, isDirty: true });
  },

  moveStop(fromIndex, toIndex) {
    const arr = [...get().stops];
    const [item] = arr.splice(fromIndex, 1);
    arr.splice(toIndex, 0, item);
    const next = arr.map((s, i) => ({ ...s, stop_sequence: i }));
    set({ stops: next, isDirty: true });
  },

  setEditMode(mode) {
    set({ editMode: mode });
  },

  setSelectedStopId(id) {
    set({ selectedStopId: id });
  },

  markSaved(id) {
    set({ savedRouteId: id, isDirty: false });
  },

  reset() {
    set(initial);
  },
}));
