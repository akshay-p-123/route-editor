"use client";

import dynamic from "next/dynamic";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase";
import { useEditorStore } from "@/store/editorStore";
import { mtd } from "@/lib/api";
import RoutePicker from "@/components/RoutePicker";
import StopList from "@/components/StopList";
import EditorToolbar from "@/components/EditorToolbar";
import AuthModal from "@/components/AuthModal";
import NewRouteModal from "@/components/NewRouteModal";
import SavedRoutesDashboard from "@/components/SavedRoutesDashboard";
import RerouteDashboard from "@/components/RerouteDashboard";
import { Button } from "@/components/ui/button";
import { LogIn, LogOut, FolderOpen, MapPin } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import type { ShapePoint } from "@/lib/api";

// Dynamically import the map to prevent SSR issues with mapbox-gl
const RouteMap = dynamic(() => import("@/components/RouteMap"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 bg-muted animate-pulse flex items-center justify-center text-sm text-muted-foreground">
      Loading map…
    </div>
  ),
});

export default function EditorPage() {
  const [user, setUser] = useState<User | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [showNewRoute, setShowNewRoute] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showReroutes, setShowReroutes] = useState(false);
  const [shapePoints, setShapePoints] = useState<ShapePoint[]>([]);

  const { selectedRouteGroup, shapeId, isCustom, customMeta } = useEditorStore();

  // Auth state
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Ctrl+Z / Cmd+Z — undo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "z") {
        e.preventDefault();
        useEditorStore.getState().undo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Load shape whenever shapeId changes
  useEffect(() => {
    if (!shapeId) {
      setShapePoints([]);
      return;
    }
    mtd.shape(shapeId).then((data) => {
      // v3: result.shapePoints is already sorted by sequence
      setShapePoints(data.result?.shapePoints ?? []);
    });
  }, [shapeId]);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
  }

  const routeColor =
    selectedRouteGroup?.color ??
    customMeta?.color?.replace("#", "") ??
    "009B77";
  const hasRoute = !!selectedRouteGroup || isCustom;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Top nav bar */}
      <header className="h-12 border-b flex items-center px-4 gap-3 shrink-0 bg-background z-10">
        <span className="font-bold text-sm tracking-tight">MTD Route Editor</span>
        <div className="ml-auto flex items-center gap-2">
          {user && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowReroutes(true)}
              >
                <MapPin className="w-4 h-4 mr-1.5" />
                Reroutes
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowDashboard(true)}
              >
                <FolderOpen className="w-4 h-4 mr-1.5" />
                My Routes
              </Button>
            </>
          )}
          {user ? (
            <Button size="sm" variant="ghost" onClick={handleLogout}>
              <LogOut className="w-4 h-4 mr-1.5" />
              Sign out
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setShowAuth(true)}>
              <LogIn className="w-4 h-4 mr-1.5" />
              Sign in
            </Button>
          )}
        </div>
      </header>

      {/* Editor toolbar */}
      <EditorToolbar onAuthRequired={() => setShowAuth(true)} />

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar: route picker */}
        <aside className="w-64 border-r flex flex-col shrink-0 overflow-hidden">
          <RoutePicker onNewRoute={() => setShowNewRoute(true)} />
        </aside>

        {/* Center: map */}
        <main className="flex-1 relative overflow-hidden">
          <RouteMap shapePoints={shapePoints} routeColor={routeColor} />

          {!hasRoute && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-background/90 backdrop-blur-sm rounded-xl px-6 py-4 shadow text-center">
                <p className="font-medium text-sm">Select a route to begin editing</p>
                <p className="text-xs text-muted-foreground mt-1">
                  or click <strong>New</strong> to create a custom route
                </p>
              </div>
            </div>
          )}
        </main>

        {/* Right sidebar: stop list */}
        {hasRoute && (
          <aside className="w-72 border-l flex flex-col shrink-0 overflow-hidden">
            <StopList />
          </aside>
        )}
      </div>

      {/* Modals */}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      {showNewRoute && <NewRouteModal onClose={() => setShowNewRoute(false)} />}
      {showDashboard && (
        <SavedRoutesDashboard onClose={() => setShowDashboard(false)} />
      )}
      {showReroutes && (
        <RerouteDashboard onClose={() => setShowReroutes(false)} />
      )}
    </div>
  );
}
