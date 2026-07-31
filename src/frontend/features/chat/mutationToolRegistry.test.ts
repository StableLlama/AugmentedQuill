// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Validate mutation tool registry mappings for chat tool events.
 */

import { describe, expect, it } from 'vitest';

import { buildMetadataFields, MUTATION_TOOL_REGISTRY } from './mutationToolRegistry';
import type { SessionMutation } from './components/MutationTags';

describe('mutationToolRegistry', () => {
  it('detects manage_scenes mutations when tool args are raw JSON', () => {
    const factory = MUTATION_TOOL_REGISTRY.manage_scenes;
    expect(factory).toBeDefined();

    const mutation = factory({
      args: {
        raw: JSON.stringify({
          action: 'update',
          scene_id: 'scene-1',
          update_data: { summary_patch: { operation: 'append', value: 'x' } },
        }),
      },
      result: { id: 'scene-1' },
    });

    expect(mutation).toMatchObject({
      type: 'scene',
      label: 'Scene',
      targetId: 'scene-1',
    });
  });

  it('detects manage_scenes mutations for direct args and numeric ids', () => {
    const mutation = MUTATION_TOOL_REGISTRY.manage_scenes({
      args: {
        action: 'update',
        scene_id: 42,
        update_data: {
          scene_time: { temporal_zoned_datetime: '2026-06-01T14:00:00Z' },
        },
      },
      result: {},
    });

    expect(mutation).toMatchObject({
      type: 'scene',
      label: 'Scene',
      targetId: '42',
      sceneChangeHint: { changedFields: ['scene_time'] },
    });
  });

  it('does not emit manage_scenes mutation for non-mutating actions', () => {
    const mutation = MUTATION_TOOL_REGISTRY.manage_scenes({
      args: { action: 'get' },
      result: { id: 'scene-1' },
    });

    expect(mutation).toBeNull();
  });

  it('does not emit manage_scenes mutation when update reports no effective changes', () => {
    const mutation = MUTATION_TOOL_REGISTRY.manage_scenes({
      args: { action: 'update', scene_id: 1 },
      result: {
        ok: true,
        changed: false,
        message: 'No effective scene content changes',
      },
    });

    expect(mutation).toBeNull();
  });

  it('does not emit manage_scenes mutation when raw args are invalid JSON', () => {
    const mutation = MUTATION_TOOL_REGISTRY.manage_scenes({
      args: { raw: '{not-json' },
      result: { id: 'scene-1' },
    });

    expect(mutation).toBeNull();
  });

  it('emits one scene mutation per updated scene in aggregated manage_scenes results', () => {
    const mutations = MUTATION_TOOL_REGISTRY.manage_scenes({
      args: { action: 'update' },
      result: [
        { scene_id: 7, causes: [8] },
        { scene_id: 9, causes_patch: { add: [10] } },
      ],
    }) as SessionMutation[];

    expect(Array.isArray(mutations)).toBe(true);
    expect(mutations).toHaveLength(2);
    expect(mutations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetId: '7' }),
        expect.objectContaining({ targetId: '9' }),
      ])
    );
  });

  it('emits one scene mutation per scene when result contains scene_list array only', () => {
    const mutations = MUTATION_TOOL_REGISTRY.manage_scenes({
      args: { action: 'update' },
      result: [{ scene_id: 5 }, { scene_id: '6' }],
    }) as SessionMutation[];

    expect(Array.isArray(mutations)).toBe(true);
    expect(mutations).toHaveLength(2);
    expect(mutations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetId: '5' }),
        expect.objectContaining({ targetId: '6' }),
      ])
    );
  });

  it('normalizes raw args for manage_story_core metadata actions', () => {
    const mutations = MUTATION_TOOL_REGISTRY.manage_story_core({
      args: {
        raw: JSON.stringify({
          action: 'update_metadata',
          update_data: { notes_patch: { operation: 'replace', value: 'x' } },
        }),
      },
      result: {},
    }) as SessionMutation[];

    expect(Array.isArray(mutations)).toBe(true);
    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({ type: 'metadata', subType: 'notes' });
  });

  it('normalizes raw args for manage_sourcebook actions', () => {
    const mutation = MUTATION_TOOL_REGISTRY.manage_sourcebook({
      args: {
        raw: JSON.stringify({ action: 'create', name: 'People', name_or_id: 'people' }),
      },
      result: {},
    });

    expect(mutation).toMatchObject({
      type: 'sourcebook',
      targetId: 'people',
    });
  });

  it('normalizes raw args for manage_images actions', () => {
    const mutation = MUTATION_TOOL_REGISTRY.manage_images({
      args: { raw: JSON.stringify({ action: 'set_metadata', image_path: 'x.png' }) },
      result: {},
    });

    expect(mutation).toMatchObject({ type: 'story', label: 'Images' });
  });

  it('normalizes raw args for search_and_replace delegation', () => {
    const mutation = MUTATION_TOOL_REGISTRY.search_and_replace({
      args: { raw: JSON.stringify({ action: 'replace' }) },
      result: { changed_sections: ['Scene 7 notes'] },
    }) as SessionMutation[];

    expect(Array.isArray(mutation)).toBe(true);
    expect(mutation).toHaveLength(1);
    expect(mutation[0]).toMatchObject({
      type: 'scene',
      targetId: '7',
      label: 'Scene 7 notes',
    });
  });

  it('produces sensible mutations for replace_in_project change_locations', () => {
    const factory = MUTATION_TOOL_REGISTRY.replace_in_project;
    expect(factory).toBeDefined();

    const mutations = factory({
      args: {},
      result: {
        change_locations: [
          {
            type: 'metadata',
            target_id: '1',
            field: 'summary',
            label: 'Chapter 1: The Dusty Discovery summary',
          },
          {
            type: 'sourcebook',
            target_id: 'Fred',
            field: 'description',
            label: "Sourcebook 'Fred' Description",
          },
          {
            type: 'metadata',
            target_id: 'story',
            field: 'story_summary',
            label: 'Story summary',
          },
          {
            type: 'scene',
            target_id: 'scene-7',
            field: 'summary',
            label: 'Scene scene-7 summary',
          },
        ],
      },
    }) as SessionMutation[];

    expect(Array.isArray(mutations)).toBe(true);
    expect(mutations).toHaveLength(4);
    expect(mutations[0]).toMatchObject({
      type: 'metadata',
      targetId: '1',
      subType: 'summary',
      label: 'Chapter 1: The Dusty Discovery summary',
    });
    expect(mutations[1]).toMatchObject({
      type: 'sourcebook',
      targetId: 'Fred',
      label: "Sourcebook 'Fred' Description",
    });
    expect(mutations[2]).toMatchObject({
      type: 'metadata',
      label: 'Story summary',
      subType: 'summary',
    });
    expect(mutations[3]).toMatchObject({
      type: 'scene',
      targetId: 'scene-7',
      label: 'Scene scene-7 summary',
    });
  });

  it('falls back to changed_sections when change_locations are unavailable', () => {
    const factory = MUTATION_TOOL_REGISTRY.replace_in_project;
    const mutations = factory({
      args: {},
      result: {
        changed_sections: [
          'Chapter 1: The Dusty Discovery summary',
          "Sourcebook 'Fred' Description",
          'Story summary',
          'Scene 9 summary',
        ],
      },
    }) as SessionMutation[];

    expect(Array.isArray(mutations)).toBe(true);
    expect(mutations).toHaveLength(4);
    expect(mutations[0]).toMatchObject({
      type: 'chapter',
      targetId: '1',
      label: 'Chapter 1: The Dusty Discovery summary',
    });
    expect(mutations[1]).toMatchObject({
      type: 'sourcebook',
      targetId: 'Fred',
      label: "Sourcebook 'Fred' Description",
    });
    expect(mutations[2]).toMatchObject({
      type: 'metadata',
      label: 'Story summary',
      subType: 'summary',
    });
    expect(mutations[3]).toMatchObject({
      type: 'scene',
      targetId: '9',
      label: 'Scene 9 summary',
    });
  });

  it('falls back to generic project replace story mutation when no change details are available', () => {
    const factory = MUTATION_TOOL_REGISTRY.replace_in_project;
    const mutations = factory({
      args: {},
      result: {},
    }) as SessionMutation[];

    expect(Array.isArray(mutations)).toBe(true);
    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({
      type: 'story',
      label: 'Project replace',
    });
  });
});

describe('buildMetadataFields', () => {
  it('detects patch variants as changed fields', () => {
    const mutations = buildMetadataFields(
      {
        conflicts_patch: { operations: [{ op: 'update', index: 0, updates: {} }] },
      },
      false
    );
    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({ type: 'metadata', subType: 'conflicts' });
  });

  it('detects summary_patch and notes_patch', () => {
    const mutations = buildMetadataFields(
      {
        summary_patch: { operation: 'append', value: ' extra' },
        notes_patch: { operation: 'replace', value: 'new' },
      },
      false
    );
    expect(mutations).toHaveLength(2);
    expect(mutations[0]).toMatchObject({ subType: 'summary' });
    expect(mutations[1]).toMatchObject({ subType: 'notes' });
  });

  it('does not duplicate fields when both direct and patch args are present', () => {
    const mutations = buildMetadataFields(
      { conflicts: [], conflicts_patch: {} },
      false
    );
    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({ subType: 'conflicts' });
  });

  it('attaches chapter target id for update_chapter_metadata mutations', () => {
    const factory = MUTATION_TOOL_REGISTRY.update_chapter_metadata;
    const mutations = factory({
      args: {
        chap_id: 2,
        conflicts_patch: { operations: [{ op: 'update', index: 0, updates: {} }] },
      },
      result: {},
    }) as SessionMutation[];

    expect(Array.isArray(mutations)).toBe(true);
    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({
      type: 'metadata',
      subType: 'conflicts',
      targetId: '2',
      label: 'Chapter 2 Conflicts',
    });
  });

  it('uses changed_fields from tool result and suppresses no-op tags', () => {
    const factory = MUTATION_TOOL_REGISTRY.update_chapter_metadata;

    const changed = factory({
      args: {
        chap_id: 2,
        summary_patch: { operation: 'append', value: 'x' },
        notes_patch: { operation: 'append', value: 'y' },
      },
      result: {
        changed_fields: ['notes'],
      },
    }) as SessionMutation[];

    expect(Array.isArray(changed)).toBe(true);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({
      type: 'metadata',
      subType: 'notes',
      targetId: '2',
      label: 'Chapter 2 Notes',
    });

    const noOp = factory({
      args: {
        chap_id: 2,
        summary_patch: { operation: 'append', value: '' },
      },
      result: {
        changed_fields: [],
      },
    }) as SessionMutation[];

    expect(Array.isArray(noOp)).toBe(true);
    expect(noOp).toHaveLength(0);
  });
});
