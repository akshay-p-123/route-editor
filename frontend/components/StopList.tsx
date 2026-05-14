"use client";

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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { GripVertical, X, MapPin } from "lucide-react";
import StopSearch from "@/components/StopSearch";

function SortableStop({
  stop,
  index,
  routeColor,
}: {
  stop: EditorStop;
  index: number;
  routeColor: string;
}) {
  const { removeStop, setSelectedStopId, selectedStopId } = useEditorStore();
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
  const dotColor = stop.isAdded ? "#22c55e" : `#${routeColor || "009B77"}`;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 px-3 py-2 rounded-md group ${
        isSelected ? "bg-accent" : "hover:bg-accent/50"
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab text-muted-foreground/40 hover:text-muted-foreground shrink-0"
        aria-label="Drag to reorder"
      >
        <GripVertical className="w-4 h-4" />
      </button>

      <span
        className="shrink-0 rounded-full border-2 border-white shadow-sm"
        style={{
          width: 10,
          height: 10,
          backgroundColor: dotColor,
        }}
      />

      <button
        className="flex-1 text-sm text-left leading-tight truncate"
        onClick={() => setSelectedStopId(isSelected ? null : id)}
        title={stop.stop_name}
      >
        {stop.stop_name}
      </button>

      <button
        onClick={() => removeStop(id)}
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
        aria-label={`Remove ${stop.stop_name}`}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </li>
  );
}

export default function StopList() {
  const { stops, setStops, selectedRouteGroup, isCustom, customMeta } =
    useEditorStore();

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

  const stopIds = stops.map((s, i) => s.stop_id ?? `custom-${i}`);

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

      <ScrollArea className="flex-1">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={stopIds} strategy={verticalListSortingStrategy}>
            <ul className="py-1">
              {stops.map((stop, index) => (
                <SortableStop
                  key={stop.stop_id ?? `custom-${index}`}
                  stop={stop}
                  index={index}
                  routeColor={routeColor}
                />
              ))}
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
