import { post } from '../api';

/** Saves one country choice. */
export const saveCountry = (cc: string, on: boolean) => post('/api/countries', { cc, on });

/**
 * What a switch on a country does: change it, and on a failure give the error text to show.
 * The caller shows the text and loads the real choice again, so the switch goes back.
 */
export async function changeCountry(
  c: { cc: string; name: string },
  on: boolean,
  toggle: (cc: string, on: boolean) => void | Promise<unknown>,
): Promise<string | null> {
  try {
    await toggle(c.cc, on);
    return null;
  } catch (e) {
    return `Waypoint could not change ${c.name}. ${(e as Error).message.replace(/\.?$/, '.')} The switch is back to its old state.`;
  }
}
