"use client";

import { useState, useEffect, useRef } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEditorStore, type EditorStop } from "@/store/editorStore";
import { mtd, type StopSearchResult } from "@/lib/api"; // mtd used in StopReplaceDropdown
import type { ValidationError } from "@/lib/validation";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { GripVertical, X, MapPin, Pencil, AlertTriangle, CheckCheck, ArrowUp, ArrowDown, Minus } from "lucide-react";
import StopSearch from "@/components/StopSearch";

// ── Travel-time delta formatting ──────────────────────────────────────────────

/** Format an arrival delta in seconds as a compact duration string (e.g. "+2m 15s", "-30s", "on time"). */
function formatDelta(seconds: number): string {
  const abs = Math.abs(seconds);
  if (abs <= 30) return "on time";
  const sign = seconds > 0 ? "+" : "-";
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  if (m > 0 && s > 0) return `${sign}${m}m ${s}s`;
  if (m > 0) return `${sign}${m}m`;
  return `${sign}${s}s`;
}

// ── Inline stop replacement ───────────────────────────────────────────────────

function useDebounce(value: string, ms: number) {
  const [d, setD] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setD(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return d;
}

function StopReplaceDropdown({
  onSelect,
  onClose,
}: {
  onSelect: (stop: StopSearchResult) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StopSearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounced = useDebounce(query, 250);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (debounced.length < 2) { setResults([]); return; }
    let cancelled = false;
    mtd.searchStops(debounced)
      .then((d) => { if (!cancelled) setResults(d.result ?? []); })
      .catch(() => { if (!cancelled) setResults([]); });
    return () => { cancelled = true; };
  }, [debounced]);

  return (
    <div className="flex-1 relative">
      <Input
        ref={inputRef}
        className="h-7 text-xs pr-6"
        placeholder="Search stops…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      />
      {results.length > 0 && (
        <ul className="absolute left-0 right-0 top-full mt-0.5 z-50 bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto text-sm">
          {results.map((stop) => {
            const display = stop.subName
              ? `${stop.name} (${stop.subName})`
              : stop.name;
            return (
              <li key={stop.stopId}>
                <button
                  className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors"
                  onMouseDown={() => onSelect(stop)}
                  title={display}
                >
                  <span className="block truncate text-xs">{display}</span>
                  {stop.city && (
                    <span className="text-xs text-muted-foreground">{stop.city}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Sortable stop row ─────────────────────────────────────────────────────────

function SortableStop({
  stop,
  index,
  routeColor,
  isEditing,
  onStartEdit,
  onEndEdit,
  stopIssues,
}: {
  stop: EditorStop;
  index: number;
  routeColor: string;
  isEditing: boolean;
  onStartEdit: () => void;
  onEndEdit: () => void;
  stopIssues: ValidationError[];
}) {
  const { removeStop, replaceStop, setSelectedStopId, selectedStopId, originalStops, dismissWarning, travelTimeEstimates, travelTimeEstimatesStale } =
    useEditorStore();
  const id = stop.stop_id ?? `custom-${index}`;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isSelected = selectedStopId === id;
  const origIds = new Set(originalStops.map((s) => s.stop_id));
  const isAdded = stop.isAdded || (!!stop.stop_id && !origIds.has(stop.stop_id));
  const dotColor = isAdded ? "#22c55e" : `#${routeColor || "009B77"}`;
  const hasError   = stopIssues.some((e) => e.severity === "error");
  const hasWarning = !hasError && stopIssues.some((e) => e.severity === "warning");
  const firstIssue = stopIssues[0];

  // Travel-time estimate badge for this stop. Match by stop_id when available
  // (stable across reorders/inserts/deletes); fall back to stop_sequence for
  // editor-added stops, which have no stop_id.
  const estimate = stop.stop_id
    ? travelTimeEstimates?.find((e) => e.stop_id === stop.stop_id)
    : travelTimeEstimates?.find((e) => e.stop_id === null && e.stop_sequence === stop.stop_sequence);
  let deltaColorClass = "text-muted-foreground";
  let DeltaIcon = Minus;
  let tooltipText = "";
  if (estimate) {
    const delta = estimate.estimated_arrival_delta_seconds;
    if (delta > 30) {
      deltaColorClass = "text-orange-600";
      DeltaIcon = ArrowUp;
    } else if (delta < -30) {
      deltaColorClass = "text-emerald-600";
      DeltaIcon = ArrowDown;
    } else {
      deltaColorClass = "text-muted-foreground";
      DeltaIcon = Minus;
    }

    const osrmDeltaText = estimate.osrm_delta_seconds === null ? "none" : formatDelta(estimate.osrm_delta_seconds);
    const upstreamDelayText = estimate.upstream_delay_seconds === null ? "none" : formatDelta(estimate.upstream_delay_seconds);
    switch (estimate.basis) {
      case "osrm+delay":
        tooltipText = `Driving time change: ${osrmDeltaText}, plus current delay: ${upstreamDelayText} (live MTD data)`;
        break;
      case "osrm":
        tooltipText = `Driving time change: ${osrmDeltaText} (no live delay data for this stop)`;
        break;
      case "delay":
        tooltipText = `Current delay: ${upstreamDelayText} (live MTD data; no route-change impact at this stop)`;
        break;
      case "fallback":
        tooltipText = "Approximate — this route has many stops, so travel time is estimated";
        break;
      default:
        tooltipText = "";
    }
    if (travelTimeEstimatesStale) {
      tooltipText = `Estimate may be outdated — route was edited since this was calculated. Click Estimate Travel Time to refresh.${tooltipText ? ` ${tooltipText}` : ""}`;
    }
  }

  function handleReplace(result: StopSearchResult) {
    if (!stop.stop_id) return;
    replaceStop(stop.stop_id, {
      stopId: result.stopId,
      name: result.subName ? `${result.name} (${result.subName})` : result.name,
      lat: Number(result.location?.latitude ?? 0),
      lon: Number(result.location?.longitude ?? 0),
    });
    onEndEdit();
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 px-3 py-2 rounded-md group border-l-2 ${
        hasError
          ? "border-l-destructive"
          : hasWarning
          ? "border-l-amber-400"
          : isSelected && !isEditing
          ? "bg-accent border-l-transparent"
          : "hover:bg-accent/50 border-l-transparent"
      }`}
    >
      {/* Drag handle — hidden while editing */}
      {!isEditing && (
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab text-muted-foreground/40 hover:text-muted-foreground shrink-0"
          aria-label="Drag to reorder"
        >
          <GripVertical className="w-4 h-4" />
        </button>
      )}

      {/* Color dot */}
      <span
        className="shrink-0 rounded-full border-2 border-white shadow-sm"
        style={{ width: 10, height: 10, backgroundColor: dotColor }}
      />

      {/* Stop name or inline replacement search */}
      {isEditing ? (
        <StopReplaceDropdown onSelect={handleReplace} onClose={onEndEdit} />
      ) : (
        <button
          className="flex-1 text-sm text-left leading-tight truncate min-w-0"
          onClick={() => setSelectedStopId(isSelected ? null : id)}
          title={firstIssue ? firstIssue.message : stop.stop_name}
        >
          {hasError && (
            <AlertTriangle className="inline w-3 h-3 text-destructive mr-1 shrink-0" />
          )}
          {hasWarning && (
            <AlertTriangle className="inline w-3 h-3 text-amber-500 mr-1 shrink-0" />
          )}
          {stop.stop_name}
        </button>
      )}

      {/* Dismiss warning button — only for WRONG_SIDE warnings on stops with an ID */}
      {!isEditing && hasWarning && stop.stop_id && stopIssues.some((e) => e.code === "WRONG_SIDE") && (
        <button
          onClick={() => dismissWarning(stop.stop_id!, "WRONG_SIDE")}
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-amber-500 hover:text-amber-700"
          aria-label="Dismiss wrong-side warning"
          title="Dismiss — I know this stop is on the wrong side"
        >
          <CheckCheck className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Edit / close button */}
      {!isEditing ? (
        <button
          onClick={onStartEdit}
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
          aria-label={`Replace ${stop.stop_name}`}
        >
          <Pencil className="w-3 h-3" />
        </button>
      ) : (
        <button
          onClick={onEndEdit}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Cancel"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Remove button */}
      {!isEditing && (
        <button
          onClick={() => removeStop(id)}
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
          aria-label={`Remove ${stop.stop_name}`}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Travel-time delta badge — only rendered when an estimate exists for this stop */}
      {estimate && estimate.basis !== "none" && (
        <span
          className={`flex items-center gap-1 text-xs font-normal shrink-0 px-2 py-1 rounded ${
            travelTimeEstimatesStale ? "opacity-50 " : ""
          }${deltaColorClass}`}
          title={tooltipText}
        >
          <DeltaIcon className="w-3 h-3" />
          {formatDelta(estimate.estimated_arrival_delta_seconds)}
        </span>
      )}
      {estimate && estimate.basis === "none" && (
        <span className="text-xs text-muted-foreground/50 shrink-0" title="No estimate available for this stop">
          —
        </span>
      )}
    </li>
  );
}

// ── Stop list ─────────────────────────────────────────────────────────────────

export default function StopList() {
  const { stops, setStops, selectedRouteGroup, customMeta, validationErrors } =
    useEditorStore();
  const [editingStopId, setEditingStopId] = useState<string | null>(null);

  const routeColor =
    selectedRouteGroup?.color ?? customMeta?.color?.replace("#", "") ?? "009B77";

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = stops.map((s, i) => s.stop_id ?? `custom-${i}`);
    const oldIdx = ids.indexOf(active.id as string);
    const newIdx = ids.indexOf(over.id as string);
    if (oldIdx === -1 || newIdx === -1) return;
    const reordered = arrayMove(stops, oldIdx, newIdx).map((s, i) => ({
      ...s,
      stop_sequence: i,
    }));
    setStops(reordered);
  }

  const stopIds = stops.map((s, i) => `${s.stop_id ?? "custom"}-${i}`);
  const routeName =
    selectedRouteGroup?.routeGroupName ?? customMeta?.name ?? "New Route";

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-semibold text-sm truncate" title={routeName}>
            {routeName}
          </h2>
          <span className="ml-auto text-xs text-muted-foreground shrink-0">
            {stops.length} stops
          </span>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={stopIds} strategy={verticalListSortingStrategy}>
            <ul className="py-1">
              {stops.map((stop, index) => {
                const id = `${stop.stop_id ?? "custom"}-${index}`;
                const stopIssues = validationErrors.filter(
                  (e) => e.stopId === stop.stop_id
                );
                return (
                  <SortableStop
                    key={id}
                    stop={stop}
                    index={index}
                    routeColor={routeColor}
                    isEditing={editingStopId === id}
                    onStartEdit={() => setEditingStopId(id)}
                    onEndEdit={() => setEditingStopId(null)}
                    stopIssues={stopIssues}
                  />
                );
              })}
            </ul>
          </SortableContext>
        </DndContext>
      </ScrollArea>

      <div className="p-3 border-t">
        <StopSearch />
      </div>
    </div>
  );
}
