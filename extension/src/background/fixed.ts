import { snapshotsItem } from '../storage';

/**
 * "This page didn't fill right" reports this build fixes, by snapshot id. The snapshots are the owner's list of
 * open problems, so a report leaves the list once the build that fixes it is loaded. Add a report's id here with
 * its fix; ids from builds the owner has loaded since can go.
 */
export const FIXED_SNAPSHOTS: ReadonlySet<string> = new Set([
  // Fixed 2026-09-30 (a422960, 0c00f54).
  '6acc00c7-216c-4792-a68a-90b9b32017b0',
  '6ce8cb60-98bf-493e-bc96-279f1f245e1d',
  '394072c0-c262-4306-b582-ec78b9e06853',
  '77f7c4a7-4dcd-4d39-b5c4-2199de4aef22',
  'd6b40676-8a5c-45e0-8535-4fed2725db8a',
  '9a3a3a03-744f-4922-abd7-246641321c19',
  '7fa5df9a-69de-4f63-afb3-39d8294d1e34',
  'd4119518-4f3f-43b5-b582-1a4ace7f4748',
  'ce14fb74-267a-43c1-88a9-4b5007faa4e0',
  '3e8285a0-e47a-433b-bce2-1cd4cbb51fe1',
  // Fixed 2026-10-01 (62a9c1d).
  'c5f0154f-3eab-42a5-a5c0-7ad205da2be8',
  // Fixed 2026-10-06 (66dcdb1).
  '5687b391-71f8-413f-9f24-2f09ebb1898a',
  // Fixed 2026-10-06: Affirm's city and school searches, typed into but never opened.
  '498b278b-f6be-4121-bb86-38564a6efb9c',
  // Saved by a slip of the hand on 2026-10-06: nothing was wrong on the page.
  '2e3a98fd-1784-435f-8413-aaaf16a7c1bb',
  // Fixed 2026-10-07: Robinhood's three required questions stayed "to fill" in the list after the owner had
  // answered them by hand. The list follows the page now.
  '808dd626-d3e8-4442-8da5-4f27fbe79366',
  // Fixed 2026-10-08: on Crusoe's Ashby form no resume went in once an account had been chosen on the card, and the
  // page, which the browser translated while it was filled, lost its race and veteran status.
  'e3f6bca8-632a-40e6-967e-9df73e256551',
  // Fixed 2026-10-09: on Palo Alto Networks' Workday form the race boxes, the disability form's boxes and the date
  // it's signed on were read without their questions, and stayed empty.
  '0a21376d-d791-4755-a478-d11cc9ec908e',
  '9a183bff-c572-4e3d-bcec-6e007715f06f',
]);

/** Takes the reports this build fixes off the list. */
export async function dropFixedSnapshots(fixed: ReadonlySet<string> = FIXED_SNAPSHOTS): Promise<void> {
  const snapshots = await snapshotsItem.getValue();
  const open = snapshots.filter((shot) => !fixed.has(shot.id));
  if (open.length < snapshots.length) await snapshotsItem.setValue(open);
}
