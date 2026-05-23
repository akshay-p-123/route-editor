"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { reroutes, savedRoutes as savedRoutesApi, type Reroute, type SavedRoute } from "@/lib/api";
import { createClient } from "@/lib/supabase";
import { useEditorStore } from "@/store/editorStore";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, ChevronDown, ChevronRight, Trash2, Edit2, Plus } from "lucide-react";
import NewRerouteModal from "@/components/NewRerouteModal";

interface RerouteDashboardProps {
  onClose: () => void;
}

export default function RerouteDashboard({ onClose }: RerouteDashboardProps) {
  const [showNewReroute, setShowNewReroute] = useState(false);
  const [expandedRerouteId, setExpandedRerouteId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { setActiveRerouteId } = useEditorStore();

  const [token, setToken] = useState<string | null>(null);

  // Get token
  const tokenQuery = useQuery({
    queryKey: ["auth-token"],
    queryFn: async () => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const t = session?.access_token ?? null;
      setToken(t);
      return t;
    },
  });

  const { data: rerouteList = [], isLoading } = useQuery({
    queryKey: ["reroutes"],
    queryFn: async () => {
      if (!token) return [];
      const data = await reroutes.list(token);
      return data;
    },
    enabled: !!token,
  });

  const { data: allSavedRoutes = [] } = useQuery({
    queryKey: ["saved-routes"],
    queryFn: async () => {
      if (!token) return [];
      const data = await savedRoutesApi.list(token);
      return data;
    },
    enabled: !!token,
  });

  async function handleOpenReroute(reroute: Reroute) {
    if (!reroute.saved_routes || reroute.saved_routes.length === 0) return;
    const route = reroute.saved_routes[0];
    if (!token) return;

    const fullRoute = await savedRoutesApi.get(route.id, token);
    setActiveRerouteId(reroute.id);
    useEditorStore.setState({
      selectedRouteGroup: null,
      selectedDirection: null,
      originalStops: [],
      stops: fullRoute.route_stops,
      shapeId: null,
      isCustom: true,
      customMeta: {
        name: fullRoute.name,
        shortName: fullRoute.short_name || "",
        color: fullRoute.color || "009B77",
      },
      savedRouteId: fullRoute.id,
      activeRerouteId: reroute.id,
      isDirty: false,
      selectedStopId: null,
      routePreviewEnabled: true,
      isSuspiciousRoute: false,
      dismissedWarnings: new Set(),
      history: [],
    });
    onClose();
  }

  async function handleDeleteReroute(id: string) {
    if (!token || !confirm("Delete this reroute?")) return;
    await reroutes.delete(id, token);
    queryClient.invalidateQueries({ queryKey: ["reroutes"] });
  }

  const routesInReroutes = new Set(
    rerouteList.flatMap((r) => r.saved_routes?.map((sr) => sr.id) || [])
  );
  const availableRoutes = allSavedRoutes.filter((r) => !routesInReroutes.has(r.id));

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

        <ScrollArea className="flex-1">
          <div className="p-6 space-y-4">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading reroutes…</p>
            ) : rerouteList.length === 0 ? (
              <p className="text-sm text-muted-foreground">No reroutes yet</p>
            ) : (
              rerouteList.map((reroute) => (
                <div
                  key={reroute.id}
                  className="border rounded-lg p-4 bg-card"
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

                    <div className="flex-1">
                      <h3 className="font-semibold">{reroute.name}</h3>
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
                      onClick={() => handleDeleteReroute(reroute.id)}
                      className="text-destructive hover:text-destructive/80 shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {expandedRerouteId === reroute.id && (
                    <div className="mt-4 pt-4 border-t space-y-3">
                      <div>
                        <h4 className="text-sm font-medium mb-2">Routes in this reroute</h4>
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
                                  onClick={() =>
                                    handleOpenReroute({
                                      ...reroute,
                                      saved_routes: [route],
                                    })
                                  }
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
                          <p className="text-xs text-muted-foreground">No routes added yet</p>
                        )}
                      </div>

                      {availableRoutes.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium mb-2">Add routes</h4>
                          <div className="space-y-1 max-h-32 overflow-y-auto">
                            {availableRoutes.map((route) => (
                              <button
                                key={route.id}
                                onClick={async () => {
                                  if (!token) return;
                                  await reroutes.addRoute(reroute.id, route.id, token);
                                  queryClient.invalidateQueries({
                                    queryKey: ["reroutes"],
                                  });
                                }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-muted rounded transition-colors"
                              >
                                <span>{route.name}</span>
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

        <div className="px-6 py-4 border-t">
          <Button onClick={() => setShowNewReroute(true)} className="w-full">
            <Plus className="w-4 h-4 mr-2" />
            New Reroute
          </Button>
        </div>
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
