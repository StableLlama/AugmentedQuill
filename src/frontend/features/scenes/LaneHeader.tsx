// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Reusable lane-header component shared between NarrativeView and
 * ConvergenceMapView. Renders the sticky row of sourcebook-entry lane buttons
 * with drag-reorder, remove, and the add-entry picker portal.
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import type { UseSceneLanesResult } from './useSceneLanes';
import type { SourcebookEntry } from '../../types';
import { useTheme } from '../layout/ThemeContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LaneHeaderProps {
  lanes: UseSceneLanesResult;
  laneTrackRef: React.RefObject<HTMLDivElement | null>;
  /**
   * Optional explicit width (px) for each lane button keyed by entry id.
   * When absent the default fixed width (`defaultButtonWidth`) is used.
   */
  laneWidths?: Map<string, number>;
  /** Width (px) of each button when laneWidths is not provided. Default: 144. */
  defaultButtonWidth?: number;
  /** Optional content rendered as the first item inside the lane track. */
  prefixContent?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const LaneHeader: React.FC<LaneHeaderProps> = ({
  lanes,
  laneTrackRef,
  laneWidths,
  defaultButtonWidth = 144,
  prefixContent,
}: LaneHeaderProps) => {
  const { t } = useTranslation();
  const { isLight } = useTheme();

  const {
    visibleLaneEntryIds,
    selectedLaneEntryIds,
    dragLaneEntryId,
    laneDropHint,
    pickerOpen,
    pickerQuery,
    pickerPosition,
    laneScrollLeft,
    sourcebookEntriesById,
    projectImageByFilename,
    availableSourcebookEntries,
    laneButtonRefs,
    addLaneButtonRef,
    handleLaneSelect,
    handleLaneRemove,
    handleLaneAdd,
    handleLaneDragStart,
    handleLaneDragEnd,
    handleLaneDragOver,
    handleLaneDrop,
    setPickerOpen,
    setPickerQuery,
    updatePickerAlignment,
  } = lanes;

  return (
    <div
      ref={laneTrackRef}
      className="relative flex items-start gap-2 w-max min-w-full"
      style={{ transform: `translateX(${-laneScrollLeft}px)` }}
    >
      {prefixContent}
      {visibleLaneEntryIds.map((entryId: string, index: number) => {
        const entry = sourcebookEntriesById.get(entryId);
        if (!entry) return null;

        const isSelected = selectedLaneEntryIds.has(entryId);
        const dropLeft =
          laneDropHint?.id === entryId &&
          laneDropHint.placeBefore &&
          Boolean(dragLaneEntryId);
        const dropRight =
          laneDropHint?.id === entryId &&
          !laneDropHint.placeBefore &&
          Boolean(dragLaneEntryId);

        const buttonWidth = laneWidths?.get(entryId) ?? defaultButtonWidth;

        return (
          <div
            key={entryId}
            data-sourcebook-lane-item={entryId}
            role="presentation"
            tabIndex={-1}
            draggable
            onDragStart={(e: React.DragEvent<HTMLDivElement>) =>
              handleLaneDragStart(e, entryId)
            }
            onDragEnd={handleLaneDragEnd}
            onDragOver={(e: React.DragEvent<HTMLDivElement>) =>
              handleLaneDragOver(e, entryId)
            }
            onDrop={(e: React.DragEvent<HTMLDivElement>) => handleLaneDrop(e, entryId)}
            onKeyDown={() => {}}
            className={[
              'relative w-auto',
              dropLeft
                ? 'before:absolute before:-left-1 before:top-2 before:bottom-2 before:w-0.5 before:bg-brand-500 before:rounded'
                : '',
              dropRight
                ? 'after:absolute after:-right-1 after:top-2 after:bottom-2 after:w-0.5 after:bg-brand-500 after:rounded'
                : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <button
              draggable
              ref={(el: HTMLButtonElement | null) => {
                if (el) {
                  laneButtonRefs.current.set(entryId, el);
                } else {
                  laneButtonRefs.current.delete(entryId);
                }
              }}
              type="button"
              aria-pressed={isSelected}
              aria-label={entry.name}
              onDragStart={(e: React.DragEvent<HTMLButtonElement>) =>
                handleLaneDragStart(e, entryId)
              }
              onDragEnd={handleLaneDragEnd}
              onDragOver={(e: React.DragEvent<HTMLButtonElement>) =>
                handleLaneDragOver(e, entryId)
              }
              onDrop={(e: React.DragEvent<HTMLButtonElement>) =>
                handleLaneDrop(e, entryId)
              }
              onClick={(e: React.MouseEvent<HTMLButtonElement>) =>
                handleLaneSelect(e, entryId, index)
              }
              style={{ width: buttonWidth, minWidth: buttonWidth }}
              className={[
                'inline-flex flex-col items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium shadow-sm transition-colors',
                isSelected
                  ? isLight
                    ? 'border-brand-500 bg-brand-100 text-brand-gray-900'
                    : 'border-brand-300 bg-brand-gray-800 text-brand-gray-50'
                  : isLight
                    ? 'border-brand-gray-200 bg-white text-brand-gray-800 hover:border-brand-300'
                    : 'border-brand-gray-700 bg-brand-gray-900 text-brand-gray-100 hover:border-brand-gray-500',
              ].join(' ')}
            >
              <span
                data-sourcebook-lane-label
                className="block w-full truncate text-center"
              >
                {entry.name}
              </span>
              {(() => {
                const firstImageFilename = entry.images?.[0];
                const portrait = firstImageFilename
                  ? projectImageByFilename.get(firstImageFilename)
                  : undefined;
                const portraitUrl = portrait?.url ?? null;
                if (portraitUrl) {
                  return (
                    <img
                      src={portraitUrl}
                      alt=""
                      className="h-12 w-12 rounded-md object-cover border border-brand-gray-300/60 flex-shrink-0"
                    />
                  );
                }
                return (
                  <span className="h-12 w-12 rounded-md border border-brand-gray-300/60 bg-brand-gray-100/60 flex-shrink-0" />
                );
              })()}
            </button>
            <button
              type="button"
              aria-label={t('Remove {{name}}', { name: entry.name })}
              onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.stopPropagation();
                handleLaneRemove(entryId);
              }}
              className={[
                'absolute -top-1.5 -right-1.5 rounded-full border p-0.5 shadow-sm',
                isLight
                  ? 'border-brand-gray-200 bg-white text-brand-gray-500 hover:text-brand-gray-800'
                  : 'border-brand-gray-700 bg-brand-gray-900 text-brand-gray-300 hover:text-brand-gray-50',
              ].join(' ')}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </div>
        );
      })}

      {/* Add-lane button */}
      <div className="relative w-auto">
        <button
          ref={addLaneButtonRef}
          type="button"
          aria-label={t('Add sourcebook lane')}
          style={{ width: defaultButtonWidth }}
          onClick={(): void => {
            setPickerOpen((open: boolean) => {
              const nextOpen = !open;
              if (nextOpen) updatePickerAlignment();
              return nextOpen;
            });
          }}
          className={[
            'inline-flex items-center justify-center gap-1 rounded-md border border-dashed px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors',
            isLight
              ? 'border-brand-gray-300 bg-white text-brand-gray-600 hover:border-brand-500 hover:text-brand-gray-900'
              : 'border-brand-gray-600 bg-brand-gray-900 text-brand-gray-300 hover:border-brand-300 hover:text-brand-gray-50',
          ].join(' ')}
        >
          <Plus size={14} aria-hidden="true" />
          <span>{t('Add')}</span>
        </button>

        {pickerOpen &&
          pickerPosition &&
          createPortal(
            <div
              className={[
                'fixed z-[120] w-72 rounded-lg border shadow-xl',
                isLight
                  ? 'border-brand-gray-200 bg-white'
                  : 'border-brand-gray-700 bg-brand-gray-900',
              ].join(' ')}
              style={{
                top: pickerPosition.top,
                left: pickerPosition.left,
                maxWidth: 'calc(100vw - 1rem)',
              }}
            >
              <div className="p-3 border-b border-inherit">
                <input
                  type="text"
                  value={pickerQuery}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setPickerQuery(e.target.value)
                  }
                  placeholder={t('Search sourcebook entries...')}
                  className={[
                    'w-full rounded-md border px-3 py-2 text-sm outline-none',
                    isLight
                      ? 'border-brand-gray-200 bg-white text-brand-gray-900'
                      : 'border-brand-gray-700 bg-brand-gray-950 text-brand-gray-100',
                  ].join(' ')}
                />
              </div>
              <div className="max-h-64 overflow-y-auto p-2">
                {availableSourcebookEntries.length > 0 ? (
                  availableSourcebookEntries.map((entry: SourcebookEntry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => handleLaneAdd(entry.id)}
                      className={[
                        'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors',
                        isLight
                          ? 'hover:bg-brand-gray-100 text-brand-gray-900'
                          : 'hover:bg-brand-gray-800 text-brand-gray-100',
                      ].join(' ')}
                    >
                      <span>{entry.name}</span>
                      <span
                        className={`text-xs ${isLight ? 'text-brand-gray-500' : 'text-brand-gray-400'}`}
                      >
                        {t(entry.category || 'Sourcebook')}
                      </span>
                    </button>
                  ))
                ) : (
                  <p
                    className={`px-3 py-2 text-sm ${isLight ? 'text-brand-gray-500' : 'text-brand-gray-400'}`}
                  >
                    {t('No matching sourcebook entries')}
                  </p>
                )}
              </div>
            </div>,
            document.body
          )}
      </div>
    </div>
  );
};
