"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { KitchenMenuCategory, KitchenMenuItem } from "./api/kitchen-types";
import { reorderKitchenMenu } from "./api/kitchen";
import { stationLabel, type MenuStationId } from "./stations";

type CatDrag = { type: "category"; categoryId: string; station: MenuStationId };
type ItemDrag = {
  type: "item";
  itemId: string;
  categoryId: string;
  station: MenuStationId;
};

function catKey(id: string) {
  return `cat:${id}`;
}
function itemKey(id: string) {
  return `item:${id}`;
}

export function MenuStationSorter({
  station,
  categories,
  busy,
  onError,
  onOptimistic,
  onServerMenu,
  onRemoveItem,
}: {
  station: MenuStationId;
  categories: KitchenMenuCategory[];
  busy: boolean;
  onError: (msg: string | null) => void;
  onOptimistic: (stationCategories: KitchenMenuCategory[]) => void;
  onServerMenu: (categories: KitchenMenuCategory[]) => void;
  onRemoveItem: (id: string, name: string) => void;
}) {
  const [activeLabel, setActiveLabel] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    })
  );

  const categoryIds = useMemo(
    () => categories.map((c) => catKey(c.id)),
    [categories]
  );

  const itemIndex = useMemo(() => {
    const map = new Map<string, { item: KitchenMenuItem; categoryId: string }>();
    for (const cat of categories) {
      for (const item of cat.items) {
        map.set(item.id, { item, categoryId: cat.id });
      }
    }
    return map;
  }, [categories]);

  async function persist(
    nextCats: KitchenMenuCategory[],
    previous: KitchenMenuCategory[]
  ) {
    onOptimistic(nextCats);
    const payload = {
      categories: nextCats.map((c, i) => ({
        id: c.id,
        sortOrder: (i + 1) * 10,
        station,
      })),
      items: nextCats.flatMap((c) =>
        c.items.map((item, i) => ({
          id: item.id,
          sortOrder: (i + 1) * 10,
          categoryId: c.id,
        }))
      ),
    };
    const result = await reorderKitchenMenu(payload);
    if (!result.ok) {
      onError(result.error);
      onOptimistic(previous);
      return;
    }
    onServerMenu(result.data.categories);
  }

  function onDragStart(event: DragStartEvent) {
    const data = event.active.data.current as CatDrag | ItemDrag | undefined;
    if (!data) return;
    if (data.type === "category") {
      const cat = categories.find((c) => c.id === data.categoryId);
      setActiveLabel(cat?.name ?? "Category");
    } else {
      const found = itemIndex.get(data.itemId);
      setActiveLabel(found?.item.name ?? "Item");
    }
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveLabel(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeData = active.data.current as CatDrag | ItemDrag | undefined;
    const overData = over.data.current as
      | CatDrag
      | ItemDrag
      | { type: "category-drop"; categoryId: string }
      | undefined;
    if (!activeData || !overData) return;

    const previous = categories;

    if (activeData.type === "category" && overData.type === "category") {
      const oldIndex = categories.findIndex((c) => c.id === activeData.categoryId);
      const newIndex = categories.findIndex((c) => c.id === overData.categoryId);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
      const next = arrayMove(categories, oldIndex, newIndex);
      void persist(next, previous);
      return;
    }

    if (activeData.type !== "item") return;

    let next = categories.map((c) => ({ ...c, items: [...c.items] }));
    const fromCatIndex = next.findIndex((c) => c.id === activeData.categoryId);
    if (fromCatIndex < 0) return;
    const fromItems = next[fromCatIndex].items;
    const fromItemIndex = fromItems.findIndex((i) => i.id === activeData.itemId);
    if (fromItemIndex < 0) return;
    const [moved] = fromItems.splice(fromItemIndex, 1);

    let toCategoryId =
      overData.type === "item"
        ? overData.categoryId
        : overData.type === "category" || overData.type === "category-drop"
          ? overData.categoryId
          : activeData.categoryId;

    const toCatIndex = next.findIndex((c) => c.id === toCategoryId);
    if (toCatIndex < 0) {
      // restore
      fromItems.splice(fromItemIndex, 0, moved);
      return;
    }

    const toItems = next[toCatIndex].items;
    if (overData.type === "item") {
      const overIndex = toItems.findIndex((i) => i.id === overData.itemId);
      const insertAt = overIndex < 0 ? toItems.length : overIndex;
      toItems.splice(insertAt, 0, { ...moved, categoryId: toCategoryId });
    } else {
      toItems.push({ ...moved, categoryId: toCategoryId });
    }

    void persist(next, previous);
  }

  if (categories.length === 0) {
    return (
      <p className="kt-editor-help">
        No categories here yet — add one for {stationLabel(station).toLowerCase()}.
      </p>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveLabel(null)}
    >
      <SortableContext items={categoryIds} strategy={verticalListSortingStrategy}>
        <ul className="kt-editor-list kt-sortable-list">
          {categories.map((cat) => (
            <SortableCategory
              key={cat.id}
              category={cat}
              station={station}
              busy={busy}
              onRemoveItem={onRemoveItem}
            />
          ))}
        </ul>
      </SortableContext>
      <DragOverlay>
        {activeLabel ? (
          <div className="kt-drag-ghost">{activeLabel}</div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function SortableCategory({
  category,
  station,
  busy,
  onRemoveItem,
}: {
  category: KitchenMenuCategory;
  station: MenuStationId;
  busy: boolean;
  onRemoveItem: (id: string, name: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: catKey(category.id),
    data: {
      type: "category",
      categoryId: category.id,
      station,
    } satisfies CatDrag,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
  };

  const itemIds = category.items.map((i) => itemKey(i.id));

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`kt-editor-cat kt-sortable-cat${isDragging ? " is-dragging" : ""}`}
    >
      <div className="kt-sortable-cat-head">
        <button
          type="button"
          className="kt-drag-handle"
          aria-label={`Drag category ${category.name}`}
          {...attributes}
          {...listeners}
        >
          ⋮⋮
        </button>
        <strong>{category.name}</strong>
      </div>
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        <ul>
          {category.items.length === 0 ? (
            <EmptyCategoryDrop categoryId={category.id} />
          ) : (
            category.items.map((item) => (
              <SortableItem
                key={item.id}
                item={item}
                categoryId={category.id}
                station={station}
                busy={busy}
                onRemoveItem={onRemoveItem}
              />
            ))
          )}
        </ul>
      </SortableContext>
    </li>
  );
}

function EmptyCategoryDrop({ categoryId }: { categoryId: string }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `drop:${categoryId}`,
    data: { type: "category-drop", categoryId },
  });
  return (
    <li
      ref={setNodeRef}
      className={`kt-editor-item kt-editor-item-empty${isOver ? " is-drop-target" : ""}`}
    >
      <span>Drop items here · empty category</span>
    </li>
  );
}

function SortableItem({
  item,
  categoryId,
  station,
  busy,
  onRemoveItem,
}: {
  item: KitchenMenuItem;
  categoryId: string;
  station: MenuStationId;
  busy: boolean;
  onRemoveItem: (id: string, name: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: itemKey(item.id),
    data: {
      type: "item",
      itemId: item.id,
      categoryId,
      station,
    } satisfies ItemDrag,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`kt-editor-item kt-sortable-item${isDragging ? " is-dragging" : ""}`}
    >
      <button
        type="button"
        className="kt-drag-handle"
        aria-label={`Drag ${item.name}`}
        {...attributes}
        {...listeners}
      >
        ⋮⋮
      </button>
      <span className="kt-sortable-item-name">{item.name}</span>
      <button
        type="button"
        className="kt-btn kt-btn-ghost"
        disabled={busy}
        onClick={() => onRemoveItem(item.id, item.name)}
      >
        Remove
      </button>
    </li>
  );
}
