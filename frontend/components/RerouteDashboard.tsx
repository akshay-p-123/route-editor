"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { reroutes, savedRoutes as savedRoutesApi, mtd, exportPng, exportGtfs, type Reroute, type RouteGroup, type ExportPayload } from "@/lib/api";
import { createClient } from "@/lib/supabase";
import { useEditorStore } from "@/store/editorStore";
import type { EditorStop } from "@/store/editorStore";
import { validateRoute } from "@/lib/validation";
import { buildStopMap } from "@/lib/stopUtils";
import { loadMTDRoute, buildDirectionsByGroup } from "@/lib/routeLoader";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, ChevronDown, ChevronRight, Trash2, Plus, Download, FileArchive, Loader2, LogIn, Pencil } from "lucide-react";
import NewRerouteModal from "@/components/NewRerouteModal";

interface RerouteDashboardProps {
  onClose: () => void;
}

export default function RerouteDashboard({ onClose }: RerouteDashboardProps) {
  const [showNewReroute, setShowNewReroute] = useState(false);
  const [expandedRerouteId, setExpandedRerouteId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const [token, setToken] = useState<string | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);

  const [exportingRerouteId, setExportingRerouteId] = useState<string | null>(null);
  const [exportingGtfsRerouteId, setExportingGtfsRerouteId] = useState<string | null>(null);
  const [editingRerouteId, setEditingRerouteId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  // Route picker state (for "Edit a route in this reroute")
  const [pickGroup, setPickGroup] = useState<RouteGroup | null>(null);
  const [pickDir, setPickDir] = useState<string | null>(null);
  const [pickLoading, setPickLoading] = useState(false);

  // Reset picker when a different reroute is expanded
  useEffect(() => {
    setPickGroup(null);
    setPickDir(null);
  }, [expandedRerouteId]);

  // Get token
  useQuery({
    queryKey: ["auth-token"],
    queryFn: async () => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const t = session?.access_token ?? null;
      setToken(t);
      setAuthLoaded(true);
      return t;
    },
  });

  const isGuest = authLoaded && !token;

  const { data: rerouteList = [], isLoading } = useQuery({
    queryKey: ["reroutes"],
    queryFn: async () => {
      if (!token) return [];
      return reroutes.list(token);
    },
    enabled: !!token,
  });

  const { data: allSavedRoutes = [] } = useQuery({
    queryKey: ["saved-routes"],
    queryFn: async () => {
      if (!token) return [];
      return savedRoutesApi.list(token);
    },
    enabled: !!token,
  });

  // MTD data — reuses same cache keys as RoutePicker (no extra network calls)
  const { data: rgData } = useQuery({
    queryKey: ["mtd-route-groups"],
    queryFn: () => mtd.routeGroups(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: tripsData } = useQuery({
    queryKey: ["mtd-trips"],
    queryFn: () => mtd.trips(),
    staleTime: 60 * 60 * 1000,
    enabled: !!expandedRerouteId || !!pickGroup || rerouteList.length > 0,
  });

  const { data: stopsData } = useQuery({
    queryKey: ["mtd-stops"],
    queryFn: () => mtd.stops(),
    staleTime: 60 * 60 * 1000,
    enabled: !!expandedRerouteId || !!pickGroup || rerouteList.length > 0,
  });

  const routeGroups = useMemo(
    () => (rgData?.result ?? []).slice().sort((a, b) => (a.sortNumber ?? 0) - (b.sortNumber ?? 0)),
    [rgData]
  );

  const directionsByGroup = useMemo(
    () => buildDirectionsByGroup(tripsData?.result ?? []),
    [tripsData]
  );

  async function handleOpenReroute(reroute: Reroute, routeId: string) {
    if (!token) return;
    const fullRoute = await savedRoutesApi.get(routeId, token);
    const stops: EditorStop[] = fullRoute.route_stops
      .sort((a, b) => a.stop_sequence - b.stop_sequence)
      .map((s) => ({
        stop_sequence: s.stop_sequence,
        stop_id: s.stop_id ?? null,
        stop_name: s.stop_name,
        stop_lat: s.stop_lat,
        stop_lon: s.stop_lon,
      }));
    const errs = validateRoute(stops);

    if (fullRoute.is_custom) {
      useEditorStore.setState({
        selectedRouteGroup: null,
        selectedDirection: null,
        originalStops: stops,
        stops,
        shapeId: null,
        isCustom: true,
        customMeta: {
          name: fullRoute.name,
          shortName: fullRoute.short_name ?? "",
          color: fullRoute.color ?? "#009B77",
        },
        savedRouteId: fullRoute.id,
        activeRerouteId: reroute.id,
        isDirty: false,
        selectedStopId: null,
        routePreviewEnabled: true,
        isSuspiciousRoute: false,
        isRouteComputing: false,
        dismissedWarnings: new Set(),
        history: [],
        validationErrors: errs,
        isValid: errs.filter((e) => e.severity === "error").length === 0,
      });
    } else {
      useEditorStore.setState({
        selectedRouteGroup: {
          id: fullRoute.base_route_id ?? "",
          routeGroupName: fullRoute.name,
          color: (fullRoute.color ?? "#009B77").replace("#", ""),
          textColor: "ffffff",
          routes: fullRoute.short_name ? [{ id: "", number: fullRoute.short_name }] : [],
        },
        selectedDirection: "",
        originalStops: stops,
        stops,
        shapeId: null,
        isCustom: false,
        customMeta: null,
        savedRouteId: fullRoute.id,
        activeRerouteId: reroute.id,
        isDirty: false,
        selectedStopId: null,
        routePreviewEnabled: true,
        isSuspiciousRoute: false,
        isRouteComputing: false,
        dismissedWarnings: new Set(),
        history: [],
        validationErrors: errs,
        isValid: errs.filter((e) => e.severity === "error").length === 0,
      });
    }
    onClose();
  }

  async function handleDeleteReroute(id: string) {
    if (!token || !confirm("Delete this reroute?")) return;
    await reroutes.delete(id, token);
    queryClient.invalidateQueries({ queryKey: ["reroutes"] });
  }

  async function getOriginalStops(baseRouteId: string): Promise<EditorStop[]> {
    const group = routeGroups.find((g) => g.id === baseRouteId);
    if (!group) return [];
    const dirs = directionsByGroup.get(baseRouteId) ?? [];
    if (dirs.length === 0) return [];
    const stopMap = buildStopMap(stopsData?.result ?? []);
    let bestStops: EditorStop[] = [];
    let bestScore = -1;
    for (const dir of dirs) {
      const result = await loadMTDRoute(group, dir.name, tripsData?.result ?? [], queryClient, stopMap);
      if (!result) continue;
      if (result.stops.length > bestScore) {
        bestScore = result.stops.length;
        bestStops = result.stops;
      }
    }
    return bestStops;
  }

  async function handleExportAll(reroute: Reroute) {
    if (!token || !reroute.saved_routes?.length) return;
    setExportingRerouteId(reroute.id);
    try {
      for (let i = 0; i < reroute.saved_routes.length; i++) {
        const routeRef = reroute.saved_routes[i];
        const fullRoute = await savedRoutesApi.get(routeRef.id, token);
        const color = fullRoute.color ?? "#009B77";

        const origStops = fullRoute.is_custom || !fullRoute.base_route_id
          ? []
          : await getOriginalStops(fullRoute.base_route_id);
        const origIdSet = new Set(origStops.map((s) => s.stop_id).filter((id): id is string => !!id));
        const savedIdSet = new Set(fullRoute.route_stops.map((s) => s.stop_id).filter((id): id is string => !!id));

        const payload: ExportPayload = {
          original_stops: origStops.map((s) => ({
            lat: s.stop_lat, lon: s.stop_lon, stop_name: s.stop_name,
            is_removed: !!s.stop_id && !savedIdSet.has(s.stop_id),
          })),
          modified_stops: fullRoute.route_stops
            .sort((a, b) => a.stop_sequence - b.stop_sequence)
            .map((s) => ({
              lat: s.stop_lat, lon: s.stop_lon, stop_name: s.stop_name,
              is_added: !!s.stop_id && !origIdSet.has(s.stop_id),
            })),
          route_color: color,
        };
        const blob = await exportPng(payload);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${reroute.name}-${routeRef.name}.png`.replace(/[^\w\s\-().]/g, "_");
        a.click();
        URL.revokeObjectURL(url);
        if (i < reroute.saved_routes.length - 1) {
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    } finally {
      setExportingRerouteId(null);
    }
  }

  async function handleExportGtfs(reroute: Reroute) {
    if (!token || !reroute.saved_routes?.length) return;
    setExportingGtfsRerouteId(reroute.id);
    try {
      const blob = await exportGtfs(reroute.id, token);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${reroute.name.replace(/[^\w\s\-().]/g, "_")}-gtfs.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("GTFS export failed:", err);
    } finally {
      setExportingGtfsRerouteId(null);
    }
  }

  async function handleOpenInEditor(rerouteId: string | null) {
    if (!pickGroup || !pickDir) return;
    setPickLoading(true);
    try {
      const stopMap = buildStopMap(stopsData?.result ?? []);
      const result = await loadMTDRoute(pickGroup, pickDir, tripsData?.result ?? [], queryClient, stopMap);
      if (!result) return;
      const errs = validateRoute(result.stops);
      useEditorStore.setState({
        selectedRouteGroup: pickGroup,
        selectedDirection: pickDir,
        originalStops: result.stops,
        stops: result.stops,
        shapeId: result.shapeId,
        isCustom: false,
        customMeta: null,
        savedRouteId: null,
        activeRerouteId: rerouteId,
        isDirty: false,
        routePreviewEnabled: true,
        isSuspiciousRoute: false,
        isRouteComputing: false,
        selectedStopId: null,
        dismissedWarnings: new Set(),
        history: [],
        validationErrors: errs,
        isValid: errs.filter((e) => e.severity === "error").length === 0,
      });
      onClose();
    } finally {
      setPickLoading(false);
    }
  }

  async function commitRename(reroute: Reroute) {
    const newName = editingName.trim();
    setEditingRerouteId(null);
    if (!newName || newName === reroute.name || !token) return;
    await reroutes.update(reroute.id, { name: newName }, token);
    queryClient.invalidateQueries({ queryKey: ["reroutes"] });
  }

  const routesInReroutes = new Set(
    rerouteList.flatMap((r) => r.saved_routes?.map((sr) => sr.id) || [])
  );
  const availableRoutes = allSavedRoutes.filter((r) => !routesInReroutes.has(r.id) && !r.reroute_id);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
      <div className="bg-background rounded-lg shadow-lg w-full max-w-2xl mx-4 h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">Reroutes</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {isGuest && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-blue-50 border-b border-blue-200">
            <LogIn className="w-4 h-4 text-blue-500 shrink-0" />
            <span className="text-sm text-blue-700 flex-1">
              Sign in to save changes and manage reroutes.
            </span>
          </div>
        )}

        <ScrollArea className="flex-1">
          <div className="p-6 space-y-4">
            {isGuest ? (
              <div>
                <h4 className="text-sm font-medium mb-3">Edit a route</h4>
                <div className="flex flex-col gap-2">
                  <select
                    className="text-sm border rounded px-2 py-1.5 bg-background"
                    value={pickGroup?.id ?? ""}
                    onChange={(e) => {
                      const g = routeGroups.find((r) => r.id === e.target.value) ?? null;
                      setPickGroup(g);
                      setPickDir(null);
                    }}
                  >
                    <option value="">Select route…</option>
                    {routeGroups.map((g) => (
                      <option key={g.id} value={g.id ?? ""}>{g.routeGroupName}</option>
                    ))}
                  </select>
                  {pickGroup && (
                    <select
                      className="text-sm border rounded px-2 py-1.5 bg-background"
                      value={pickDir ?? ""}
                      onChange={(e) => setPickDir(e.target.value || null)}
                    >
                      <option value="">Select direction…</option>
                      {(directionsByGroup.get(pickGroup.id ?? "") ?? []).map((d) => (
                        <option key={d.name} value={d.name}>{d.name}</option>
                      ))}
                    </select>
                  )}
                  <Button
                    size="sm"
                    disabled={!pickGroup || !pickDir || pickLoading}
                    onClick={() => handleOpenInEditor(null)}
                  >
                    {pickLoading ? "Loading…" : "Open in editor"}
                  </Button>
                </div>
              </div>
            ) : !authLoaded || isLoading ? (
              <p className="text-sm text-muted-foreground">Loading reroutes…</p>
            ) : rerouteList.length === 0 ? (
              <p className="text-sm text-muted-foreground">No reroutes yet</p>
            ) : (
              rerouteList.map((reroute) => (
                <div
                  key={reroute.id}
                  className="border rounded-lg p-4 bg-card group/card"
                >
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() =>
                        setExpandedRerouteId(
                          expandedRerouteId === reroute.id ? null : reroute.id
                        )
                      }
                      className="text-muted-foreground hover:text-foreground shrink-0"
                    >
                      {expandedRerouteId === reroute.id ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </button>

                    <div className="flex-1 min-w-0">
                      {editingRerouteId === reroute.id ? (
                        <input
                          className="w-full font-semibold bg-transparent outline-none border-b border-primary text-sm"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void commitRename(reroute);
                            if (e.key === "Escape") setEditingRerouteId(null);
                          }}
                          onBlur={() => void commitRename(reroute)}
                          autoFocus
                        />
                      ) : (
                        <h3 className="font-semibold truncate">{reroute.name}</h3>
                      )}
                      {reroute.description && (
                        <p className="text-xs text-muted-foreground">
                          {reroute.description}
                        </p>
                      )}
                      {(reroute.start_date || reroute.end_date) && (
                        <p className="text-xs text-muted-foreground">
                          {reroute.start_date && `From ${reroute.start_date}`}
                          {reroute.start_date && reroute.end_date && " to "}
                          {reroute.end_date && reroute.end_date}
                        </p>
                      )}
                    </div>

                    <button
                      onClick={() => {
                        setEditingRerouteId(reroute.id);
                        setEditingName(reroute.name);
                      }}
                      className="opacity-0 group-hover/card:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0"
                      title="Rename"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => void handleExportGtfs(reroute)}
                      disabled={exportingGtfsRerouteId === reroute.id || !reroute.saved_routes?.length}
                      title={!reroute.saved_routes?.length ? "No routes to export" : "Export GTFS zip"}
                      aria-label={exportingGtfsRerouteId === reroute.id ? "Exporting GTFS…" : "Export GTFS zip"}
                      className="text-muted-foreground hover:text-foreground shrink-0 disabled:opacity-40"
                    >
                      {exportingGtfsRerouteId === reroute.id
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <FileArchive className="w-4 h-4" />}
                    </button>

                    <button
                      onClick={() => void handleExportAll(reroute)}
                      disabled={exportingRerouteId === reroute.id || !reroute.saved_routes?.length}
                      title={!reroute.saved_routes?.length ? "No routes to export" : "Export all routes as PNGs"}
                      className="text-muted-foreground hover:text-foreground shrink-0 disabled:opacity-40"
                    >
                      {exportingRerouteId === reroute.id
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Download className="w-4 h-4" />}
                    </button>

                    <button
                      onClick={() => handleDeleteReroute(reroute.id)}
                      className="text-destructive hover:text-destructive/80 shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {expandedRerouteId === reroute.id && (
                    <div className="mt-4 pt-4 border-t space-y-4">
                      {/* Saved route edits in this reroute */}
                      <div>
                        <h4 className="text-sm font-medium mb-2">Route edits in this reroute</h4>
                        {reroute.saved_routes && reroute.saved_routes.length > 0 ? (
                          <div className="space-y-2">
                            {reroute.saved_routes.map((route) => (
                              <div
                                key={route.id}
                                className="flex items-center gap-2 bg-muted px-3 py-2 rounded text-sm"
                              >
                                <span className="flex-1">{route.name}</span>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleOpenReroute(reroute, route.id)}
                                >
                                  Open
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={async () => {
                                    if (!token) return;
                                    await reroutes.removeRoute(reroute.id, route.id, token);
                                    queryClient.invalidateQueries({ queryKey: ["reroutes"] });
                                  }}
                                >
                                  Remove
                                </Button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">No route edits yet</p>
                        )}
                      </div>

                      {/* Edit a route directly from this reroute context */}
                      <div className="border-t pt-4">
                        <h4 className="text-sm font-medium mb-2">Edit a route in this reroute</h4>
                        <div className="flex flex-col gap-2">
                          <select
                            className="text-sm border rounded px-2 py-1.5 bg-background"
                            value={pickGroup?.id ?? ""}
                            onChange={(e) => {
                              const g = routeGroups.find((r) => r.id === e.target.value) ?? null;
                              setPickGroup(g);
                              setPickDir(null);
                            }}
                          >
                            <option value="">Select route…</option>
                            {routeGroups.map((g) => (
                              <option key={g.id} value={g.id ?? ""}>{g.routeGroupName}</option>
                            ))}
                          </select>

                          {pickGroup && (
                            <select
                              className="text-sm border rounded px-2 py-1.5 bg-background"
                              value={pickDir ?? ""}
                              onChange={(e) => setPickDir(e.target.value || null)}
                            >
                              <option value="">Select direction…</option>
                              {(directionsByGroup.get(pickGroup.id ?? "") ?? []).map((d) => (
                                <option key={d.name} value={d.name}>{d.name}</option>
                              ))}
                            </select>
                          )}

                          <Button
                            size="sm"
                            disabled={!pickGroup || !pickDir || pickLoading}
                            onClick={() => handleOpenInEditor(reroute.id)}
                          >
                            {pickLoading ? "Loading…" : "Open in editor"}
                          </Button>
                        </div>
                      </div>

                      {/* Link an existing permanent edit to this reroute */}
                      {availableRoutes.length > 0 && (
                        <div className="border-t pt-4">
                          <h4 className="text-sm font-medium mb-2">Link a saved edit</h4>
                          <div className="space-y-1 max-h-32 overflow-y-auto">
                            {availableRoutes.map((route) => (
                              <button
                                key={route.id}
                                onClick={async () => {
                                  if (!token) return;
                                  await reroutes.addRoute(reroute.id, route.id, token);
                                  queryClient.invalidateQueries({ queryKey: ["reroutes"] });
                                  queryClient.invalidateQueries({ queryKey: ["saved-routes"] });
                                }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-muted rounded transition-colors"
                              >
                                {route.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        {!isGuest && (
          <div className="px-6 py-4 border-t">
            <Button onClick={() => setShowNewReroute(true)} className="w-full">
              <Plus className="w-4 h-4 mr-2" />
              New Reroute
            </Button>
          </div>
        )}
      </div>

      {showNewReroute && (
        <NewRerouteModal
          onClose={() => setShowNewReroute(false)}
          onCreated={() => {
            setShowNewReroute(false);
            queryClient.invalidateQueries({ queryKey: ["reroutes"] });
          }}
        />
      )}
    </div>
  );
}
