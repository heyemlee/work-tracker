import { browser } from 'wxt/browser';
import type { FrameScan, PlannedField } from '../model';
import { toFrame } from '../messages';

/** Frames of a tab that run the content script, with what each found. */
export async function scanFrames(
  tabId: number,
  prepare: { experience: number; education: number } | null,
): Promise<FrameScan[]> {
  const frames = (await browser.webNavigation.getAllFrames({ tabId })) ?? [{ frameId: 0 }];
  const scans = await Promise.all(
    frames.map(async ({ frameId }) => {
      try {
        return await toFrame(tabId, frameId, 'frame:scan', { frameId, prepare });
      } catch {
        // No content script in this frame: an ad, a tracker, a page it doesn't run on.
        return null;
      }
    }),
  );
  return scans.filter((scan): scan is FrameScan => scan !== null);
}

/** "3:f12" → 3. */
export const frameOf = (fieldId: string) => Number(fieldId.split(':')[0]);

/** Groups planned fields by the frame that holds them. */
export function byFrame(plan: readonly PlannedField[]): Map<number, PlannedField[]> {
  const groups = new Map<number, PlannedField[]>();
  for (const entry of plan) {
    const frame = frameOf(entry.fieldId);
    groups.set(frame, [...(groups.get(frame) ?? []), entry]);
  }
  return groups;
}

/** Fills each frame's fields; frames fill one after another so dropdowns don't fight over focus. */
export async function fillFrames(
  tabId: number,
  plan: readonly PlannedField[],
): Promise<Record<string, { ok: boolean; value?: string; error?: string; at?: number }>> {
  const results: Record<string, { ok: boolean; value?: string; error?: string; at?: number }> = {};
  for (const [frameId, fields] of byFrame(plan.filter((entry) => entry.answer !== null))) {
    try {
      Object.assign(results, await toFrame(tabId, frameId, 'frame:fill', { fields }));
    } catch (error) {
      for (const field of fields)
        results[field.fieldId] = {
          ok: false,
          error: error instanceof Error ? error.message : 'frame unavailable',
        };
    }
  }
  return results;
}

/** Option lists of dropdowns that load them only when opened. */
export async function readOptions(tabId: number, fieldIds: string[]): Promise<Record<string, string[]>> {
  const options: Record<string, string[]> = {};
  const groups = new Map<number, string[]>();
  for (const id of fieldIds) groups.set(frameOf(id), [...(groups.get(frameOf(id)) ?? []), id]);
  for (const [frameId, ids] of groups) {
    try {
      Object.assign(options, await toFrame(tabId, frameId, 'frame:options', { fieldIds: ids }));
    } catch {
      // The frame went away; those fields stay without options.
    }
  }
  return options;
}
