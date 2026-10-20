export type LeaveResult = { ok: true } | { ok: false; message: string };

/**
 * Leaves the wizard. The save is the one request that counts: when it works, the user is out, even if loading the data again fails
 * (the next load shows the app). When the save fails, the screen shows the message and a way out.
 */
export async function leaveWizard(save: () => Promise<unknown>, reload: () => Promise<unknown>): Promise<LeaveResult> {
  try {
    await save();
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  try {
    await reload();
  } catch {
    /* The wizard state is saved. The data loads again with the next request. */
  }
  return { ok: true };
}
