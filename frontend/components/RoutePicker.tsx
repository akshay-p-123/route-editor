"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEditorStore } from "@/store/editorStore";
import type { EditorStop } from "@/store/editorStore";
import { mtd, savedRoutes, type RouteGroup, type SavedRoute, type RoutePayload } from "@/lib/api";
import { buildStopMap } from "@/lib/stopUtils";
import { loadMTDRoute, buildDirectionsByGroup } from "@/lib/routeLoader";
import { validateRoute } from "@/lib/validation";
import { createClient } from "@/lib/supabase";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronRight, Plus, Pencil } from "lucide-react";

interface RoutePickerProps {
  onNewRoute: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RoutePicker({ onNewRoute }: RoutePickerProps) {
  const { selectedRouteGroup, selectedDirection, loadRoute, isDirty, savedRouteId, isCustom } = useEditorStore();
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => setToken(session?.access_token ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setToken(session?.access_token ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const { data: rgData, isLoading, isError } = useQuery({
    queryKey: ["mtd-route-groups"],
    queryFn: () => mtd.routeGroups(),
    staleTime: 5 * 60 * 1000,
  });

  const queryClient = useQueryClient();

  const { data: stopsData } = useQuery({
    queryKey: ["mtd-stops"],
    queryFn: () => mtd.stops(),
    staleTime: 60 * 60 * 1000, // 1 h — stops change with schedule releases, not intraday
  });

  // Lazy: only fetch trips once the user expands a route group.
  // Trips is the largest payload; deferring it keeps the initial page load fast.
  const { data: tripsData, isLoading: isTripsLoading } = useQuery({
    queryKey: ["mtd-trips"],
    queryFn: () => mtd.trips(),
    staleTime: 60 * 60 * 1000,
    enabled: expandedGroupId !== null,
  });

  const { data: mySavedRoutes } = useQuery({
    queryKey: ["saved-routes", token],
    queryFn: () => savedRoutes.list(token!),
    enabled: !!token,
    staleTime: 30 * 1000,
  });

  const allSavedRoutes = useMemo(
    () => mySavedRoutes ?? [],
    [mySavedRoutes]
  );

  async function commitRename(route: SavedRoute) {
    const newName = editingName.trim();
    setEditingRouteId(null);
    if (!newName || newName === route.name || !token) return;
    const payload: RoutePayload = {
      name: newName,
      short_name: route.short_name ?? undefined,
      color: route.color ?? undefined,
      is_custom: route.is_custom,
      base_route_id: route.base_route_id ?? undefined,
      reroute_id: route.reroute_id ?? undefined,
      stops: route.route_stops.map((s) => ({
        stop_sequence: s.stop_sequence,
        stop_id: s.stop_id ?? null,
        stop_name: s.stop_name,
        stop_lat: s.stop_lat,
        stop_lon: s.stop_lon,
      })),
    };
    await savedRoutes.update(route.id, payload, token);
    queryClient.invalidateQueries({ queryKey: ["saved-routes"] });
    if (savedRouteId === route.id) {
      if (isCustom) {
        const meta = useEditorStore.getState().customMeta;
        if (meta) useEditorStore.setState({ customMeta: { ...meta, name: newName } });
      } else {
        const grp = useEditorStore.getState().selectedRouteGroup;
        if (grp) useEditorStore.setState({ selectedRouteGroup: { ...grp, routeGroupName: newName } });
      }
    }
  }

  function handleCustomRouteOpen(route: SavedRoute) {
    const stops: EditorStop[] = route.route_stops
      .sort((a, b) => a.stop_sequence - b.stop_sequence)
      .map((s) => ({
        stop_sequence: s.stop_sequence,
        stop_id: s.stop_id ?? null,
        stop_name: s.stop_name,
        stop_lat: s.stop_lat,
        stop_lon: s.stop_lon,
      }));
    const errs = validateRoute(stops);
    if (route.is_custom) {
      useEditorStore.setState({
        selectedRouteGroup: null,
        selectedDirection: null,
        originalStops: stops,
        stops,
        shapeId: null,
        isCustom: true,
        customMeta: { name: route.name, shortName: route.short_name ?? "", color: route.color ?? "#009B77" },
        savedRouteId: route.id,
        activeRerouteId: route.reroute_id ?? null,
        isDirty: false,
        routePreviewEnabled: true,
        isSuspiciousRoute: false,
        isRouteComputing: false,
        selectedStopId: null,
        validationErrors: errs,
        isValid: errs.filter((e) => e.severity === "error").length === 0,
      });
    } else {
      useEditorStore.setState({
        selectedRouteGroup: {
          id: route.base_route_id ?? "",
          routeGroupName: route.name,
          color: (route.color ?? "#009B77").replace("#", ""),
          textColor: "ffffff",
          routes: route.short_name ? [{ id: "", number: route.short_name }] : [],
        },
        selectedDirection: "",
        originalStops: stops,
        stops,
        shapeId: null,
        isCustom: false,
        customMeta: null,
        savedRouteId: route.id,
        activeRerouteId: route.reroute_id ?? null,
        isDirty: false,
        routePreviewEnabled: true,
        isSuspiciousRoute: false,
        isRouteComputing: false,
        selectedStopId: null,
        validationErrors: errs,
        isValid: errs.filter((e) => e.severity === "error").length === 0,
      });
    }
  }

  const HIDDEN_ROUTES = /cherry|transport|safe\s*rides|west connect|northeast connect/i;

  const routeGroups = useMemo(
    () =>
      (rgData?.result ?? [])
        .filter((g) => !HIDDEN_ROUTES.test(g.routeGroupName ?? ""))
        .slice()
        .sort((a, b) => (a.sortNumber ?? 0) - (b.sortNumber ?? 0)),
    [rgData]
  );

  const directionsByGroup = useMemo(
    () => buildDirectionsByGroup(tripsData?.result ?? []),
    [tripsData]
  );

  function toggleGroup(group: RouteGroup) {
    setExpandedGroupId((prev) => (prev === group.id ? null : group.id));
  }

  async function handleDirectionSelect(group: RouteGroup, dirName: string) {
    const key = `${group.id}:${dirName}`;
    setLoadingKey(key);
    setErrorKey(null);
    try {
      const stopMap = buildStopMap(stopsData?.result ?? []);
      const result = await loadMTDRoute(group, dirName, tripsData?.result ?? [], queryClient, stopMap);
      if (!result) { setErrorKey(key); return; }
      loadRoute(group, dirName, result.stops, result.shapeId);
    } catch {
      setErrorKey(key);
    } finally {
      setLoadingKey(null);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
          Routes
        </h2>
        <Button size="sm" variant="outline" onClick={onNewRoute}>
          <Plus className="w-4 h-4 mr-1" />
          New
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        {isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="p-4 text-xs text-destructive">
            Failed to load routes. Check your API key and backend connection.
          </div>
        ) : (
          <ul className="p-2 space-y-0.5">
            {allSavedRoutes.map((route) => {
              const bg = route.color ?? "#009B77";
              const isActive = savedRouteId === route.id;
              return (
                <li key={`custom-${route.id}`} className="group">
                  {editingRouteId === route.id ? (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-accent/50">
                      <Badge
                        className="min-w-[2.5rem] justify-center text-xs font-bold shrink-0"
                        style={{ backgroundColor: bg, color: "#fff", borderColor: bg }}
                      >
                        <Pencil className="w-2.5 h-2.5" />
                      </Badge>
                      <input
                        className="flex-1 text-sm bg-transparent outline-none border-b border-primary"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void commitRename(route);
                          if (e.key === "Escape") setEditingRouteId(null);
                        }}
                        onBlur={() => void commitRename(route)}
                        autoFocus
                      />
                    </div>
                  ) : (
                    <div className={`flex items-center rounded-md transition-colors ${isActive ? "bg-accent" : "hover:bg-accent/50"}`}>
                      <button
                        onClick={() => handleCustomRouteOpen(route)}
                        className="flex items-center gap-3 px-3 py-2 flex-1 text-left min-w-0"
                      >
                        <Badge
                          className="min-w-[2.5rem] justify-center text-xs font-bold shrink-0"
                          style={{ backgroundColor: bg, color: "#fff", borderColor: bg }}
                        >
                          <Pencil className="w-2.5 h-2.5" />
                        </Badge>
                        <span className={`flex-1 text-sm leading-tight line-clamp-1 ${isActive ? "font-medium" : ""}`}>
                          {route.name}
                        </span>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingRouteId(route.id);
                          setEditingName(route.name);
                        }}
                        className="opacity-0 group-hover:opacity-100 px-2 py-2 text-muted-foreground hover:text-foreground shrink-0 transition-opacity"
                        title="Rename"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
            {routeGroups.map((group) => {
              const bg = `#${group.color ?? "009B77"}`;
              const fg = `#${group.textColor ?? "ffffff"}`;
              const routeNum = group.routes?.[0]?.number ?? "–";
              const isExpanded = expandedGroupId === group.id;
              const isActiveGroup = selectedRouteGroup?.id === group.id;
              const isModified = isActiveGroup && isDirty;
              const dirs = directionsByGroup.get(group.id ?? "") ?? [];

              return (
                <li key={group.id}>
                  {/* Route group row */}
                  <button
                    onClick={() => toggleGroup(group)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors ${
                      isActiveGroup && !isExpanded
                        ? "bg-accent font-medium"
                        : "hover:bg-accent/50"
                    }`}
                  >
                    <Badge
                      className="min-w-[2.5rem] justify-center text-xs font-bold shrink-0"
                      style={{ backgroundColor: bg, color: fg, borderColor: bg }}
                    >
                      {routeNum}
                    </Badge>
                    <span className="flex-1 text-sm leading-tight line-clamp-1">
                      {group.routeGroupName}
                    </span>
                    {isModified && (
                      <span className="text-[10px] font-semibold text-orange-500 shrink-0">
                        Modified
                      </span>
                    )}
                    <ChevronRight
                      className={`w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform ${
                        isExpanded ? "rotate-90" : ""
                      }`}
                    />
                  </button>

                  {/* Direction sub-items */}
                  {isExpanded && (
                    <ul className="mt-0.5 mb-1 ml-4 space-y-0.5">
                      {isTripsLoading ? (
                        // Trips are being fetched for the first time
                        [0, 1].map((i) => (
                          <li key={i} className="px-3 py-1.5">
                            <Skeleton className="h-5 w-28" />
                          </li>
                        ))
                      ) : dirs.length === 0 ? (
                        (() => {
                          const key = `${group.id}:`;
                          const isActive = isActiveGroup && selectedDirection === "";
                          const isLoading = loadingKey === key;
                          const hasError = errorKey === key;
                          return (
                            <li key="">
                              <button
                                onClick={() => handleDirectionSelect(group, "")}
                                disabled={isLoading}
                                className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-left text-sm transition-colors ${
                                  hasError
                                    ? "text-destructive hover:bg-destructive/10"
                                    : isActive
                                    ? "bg-accent font-medium"
                                    : "hover:bg-accent/50"
                                } disabled:opacity-50`}
                                title={hasError ? "Failed to load stops — tap to retry" : undefined}
                              >
                                <span
                                  className="w-1.5 h-1.5 rounded-full shrink-0"
                                  style={{ backgroundColor: hasError ? "#ef4444" : bg }}
                                />
                                {isLoading ? "Loading…" : hasError ? "Loop — retry" : "Loop"}
                              </button>
                            </li>
                          );
                        })()
                      ) : (
                        dirs.map(({ name: dirName }) => {
                          const key = `${group.id}:${dirName}`;
                          const isActive =
                            isActiveGroup && selectedDirection === dirName;
                          const isLoading = loadingKey === key;
                          const hasError = errorKey === key;
                          return (
                            <li key={dirName}>
                              <button
                                onClick={() => handleDirectionSelect(group, dirName)}
                                disabled={isLoading}
                                className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-left text-sm transition-colors ${
                                  hasError
                                    ? "text-destructive hover:bg-destructive/10"
                                    : isActive
                                    ? "bg-accent font-medium"
                                    : "hover:bg-accent/50"
                                } disabled:opacity-50`}
                                title={hasError ? "Failed to load stops — tap to retry" : undefined}
                              >
                                <span
                                  className="w-1.5 h-1.5 rounded-full shrink-0"
                                  style={{ backgroundColor: hasError ? "#ef4444" : bg }}
                                />
                                {isLoading ? "Loading…" : hasError ? `${dirName} — retry` : dirName}
                              </button>
                            </li>
                          );
                        })
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}
