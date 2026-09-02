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
import type {
  KitchenMenuCategory,
  KitchenMenuChoiceGroup,
  KitchenMenuItem,
} from "./api/kitchen-types";
import { reorderKitchenMenu } from "./api/kitchen";
import { MENU_STATIONS, stationLabel, type MenuStationId } from "./stations";

type CatDrag = { type: "category"; categoryId: string; station: MenuStationId };
type ItemDrag = {
  type: "item";
  itemId: string;
  categoryId: string;
  station: MenuStationId;
};

const DEFAULT_COURSES = [
  { value: "", label: "None" },
  { value: "starter", label: "Starter" },
  { value: "main", label: "Main" },
  { value: "dessert", label: "Dessert" },
] as const;

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
  onUpdateCategory,
  onToggleAvailability,
  onSaveChoices,
}: {
  station: MenuStationId;
  categories: KitchenMenuCategory[];
  busy: boolean;
  onError: (msg: string | null) => void;
  onOptimistic: (stationCategories: KitchenMenuCategory[]) => void;
  onServerMenu: (categories: KitchenMenuCategory[]) => void;
  onRemoveItem: (id: string, name: string) => void;
  onUpdateCategory?: (
    id: string,
    patch: { station?: string; defaultCourse?: string | null }
  ) => void;
  onToggleAvailability?: (id: string, available: boolean) => void;
  onSaveChoices?: (id: string, choices: KitchenMenuChoiceGroup[] | null) => void;
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

    const next = categories.map((c) => ({ ...c, items: [...c.items] }));
    const fromCatIndex = next.findIndex((c) => c.id === activeData.categoryId);
    if (fromCatIndex < 0) return;
    const fromItems = next[fromCatIndex].items;
    const fromItemIndex = fromItems.findIndex((i) => i.id === activeData.itemId);
    if (fromItemIndex < 0) return;
    const [moved] = fromItems.splice(fromItemIndex, 1);

    const toCategoryId =
      overData.type === "item"
        ? overData.categoryId
        : overData.type === "category" || overData.type === "category-drop"
          ? overData.categoryId
          : activeData.categoryId;

    const toCatIndex = next.findIndex((c) => c.id === toCategoryId);
    if (toCatIndex < 0) {
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
              onUpdateCategory={onUpdateCategory}
              onToggleAvailability={onToggleAvailability}
              onSaveChoices={onSaveChoices}
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
  onUpdateCategory,
  onToggleAvailability,
  onSaveChoices,
}: {
  category: KitchenMenuCategory;
  station: MenuStationId;
  busy: boolean;
  onRemoveItem: (id: string, name: string) => void;
  onUpdateCategory?: (
    id: string,
    patch: { station?: string; defaultCourse?: string | null }
  ) => void;
  onToggleAvailability?: (id: string, available: boolean) => void;
  onSaveChoices?: (id: string, choices: KitchenMenuChoiceGroup[] | null) => void;
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
        {onUpdateCategory && (
          <div className="kt-cat-meta-edits">
            <label className="kt-inline-field">
              <span>Station</span>
              <select
                className="kt-input kt-input-compact"
                value={category.station}
                disabled={busy}
                onChange={(e) =>
                  onUpdateCategory(category.id, { station: e.target.value })
                }
              >
                {MENU_STATIONS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
                {!MENU_STATIONS.some((s) => s.id === category.station) && (
                  <option value={category.station}>{category.station}</option>
                )}
              </select>
            </label>
            <label className="kt-inline-field">
              <span>Course</span>
              <select
                className="kt-input kt-input-compact"
                value={category.defaultCourse ?? ""}
                disabled={busy}
                onChange={(e) =>
                  onUpdateCategory(category.id, {
                    defaultCourse: e.target.value || null,
                  })
                }
              >
                {DEFAULT_COURSES.map((c) => (
                  <option key={c.value || "none"} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
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
                onToggleAvailability={onToggleAvailability}
                onSaveChoices={onSaveChoices}
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
  onToggleAvailability,
  onSaveChoices,
}: {
  item: KitchenMenuItem;
  categoryId: string;
  station: MenuStationId;
  busy: boolean;
  onRemoveItem: (id: string, name: string) => void;
  onToggleAvailability?: (id: string, available: boolean) => void;
  onSaveChoices?: (id: string, choices: KitchenMenuChoiceGroup[] | null) => void;
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

  const [editingChoices, setEditingChoices] = useState(false);
  const [draft, setDraft] = useState<KitchenMenuChoiceGroup[]>(
    () => item.choices ?? []
  );

  function openChoices() {
    setDraft(
      (item.choices ?? []).map((g) => ({
        label: g.label,
        required: g.required,
        options: [...g.options],
      }))
    );
    setEditingChoices(true);
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`kt-editor-item kt-sortable-item${isDragging ? " is-dragging" : ""}`}
    >
      <div className="kt-sortable-item-row">
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
        {onToggleAvailability && (
          <button
            type="button"
            className={`kt-avail-toggle${item.available ? "" : " is-86"}`}
            disabled={busy}
            onClick={() => onToggleAvailability(item.id, !item.available)}
          >
            {item.available ? "Available" : "86’d"}
          </button>
        )}
        {onSaveChoices && (
          <button
            type="button"
            className="kt-btn kt-btn-ghost"
            disabled={busy}
            onClick={() => (editingChoices ? setEditingChoices(false) : openChoices())}
          >
            Choices
          </button>
        )}
        <button
          type="button"
          className="kt-btn kt-btn-ghost"
          disabled={busy}
          onClick={() => onRemoveItem(item.id, item.name)}
        >
          Remove
        </button>
      </div>
      {editingChoices && onSaveChoices && (
        <div className="kt-choices-editor">
          {draft.map((group, gi) => (
            <div key={gi} className="kt-choice-group-edit">
              <input
                className="kt-input"
                placeholder="Group label"
                value={group.label}
                onChange={(e) => {
                  const next = [...draft];
                  next[gi] = { ...group, label: e.target.value };
                  setDraft(next);
                }}
              />
              <label className="kt-radio">
                <input
                  type="checkbox"
                  checked={group.required}
                  onChange={(e) => {
                    const next = [...draft];
                    next[gi] = { ...group, required: e.target.checked };
                    setDraft(next);
                  }}
                />
                Required
              </label>
              <input
                className="kt-input"
                placeholder="Options (comma-separated)"
                value={group.options.join(", ")}
                onChange={(e) => {
                  const options = e.target.value
                    .split(",")
                    .map((o) => o.trim())
                    .filter(Boolean);
                  const next = [...draft];
                  next[gi] = { ...group, options };
                  setDraft(next);
                }}
              />
              <button
                type="button"
                className="kt-btn kt-btn-ghost"
                onClick={() => setDraft(draft.filter((_, i) => i !== gi))}
              >
                Remove group
              </button>
            </div>
          ))}
          <div className="kt-editor-row">
            <button
              type="button"
              className="kt-btn"
              onClick={() =>
                setDraft([
                  ...draft,
                  { label: "", required: false, options: [] },
                ])
              }
            >
              Add group
            </button>
            <button
              type="button"
              className="kt-btn kt-btn-fire"
              disabled={busy}
              onClick={() => {
                const cleaned = draft
                  .map((g) => ({
                    label: g.label.trim(),
                    required: g.required,
                    options: g.options.map((o) => o.trim()).filter(Boolean),
                  }))
                  .filter((g) => g.label && g.options.length > 0);
                onSaveChoices(item.id, cleaned.length ? cleaned : null);
                setEditingChoices(false);
              }}
            >
              Save choices
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
