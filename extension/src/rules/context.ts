import type { Posting } from '../model';
import type { Profile } from '../profile/schema';

/** Everything the rules read besides the field itself. */
export interface RuleContext {
  profile: Profile;
  /** The email of the account applying this time. */
  email: string;
  /** The resume PDF chosen on the card. */
  resumeId: string | null;
  posting: Posting | null;
  /** YYYY-MM-DD, local. */
  today: string;
  /** Outbox has an earlier application at this company. */
  appliedBefore: boolean;
}
