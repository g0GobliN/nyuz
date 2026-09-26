/**
 * Same floor as Minimal density: "only the things you would regret missing".
 *
 * Its own module so the alert stage, the significance rule and the shadow can
 * all read it without importing each other: `alerts.ts` calls the P4 rule in
 * `subject-significance.ts`, which needs this number, and a constant reached
 * through a cycle can be read before it is initialised.
 */
export const IMPORTANT_FLOOR = 6;
