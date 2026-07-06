import { initialState, type AppState } from "./state.ts";

export const S: AppState = initialState();

// Draft-aware field value: while the user is typing, the raw draft wins over
// the formatted value from state (cleared again on blur).
export function fv(key: string, formatted: string): string {
  return S.drafts[key] !== undefined ? S.drafts[key] : formatted;
}
