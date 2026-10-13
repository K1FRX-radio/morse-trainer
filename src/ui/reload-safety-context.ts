import { createContext, useContext } from "react";

export type ReloadSafetyContextValue = {
  blocked: boolean;
  setBlocked: (blocked: boolean) => void;
};

export const ReloadSafetyContext = createContext<ReloadSafetyContextValue>({
  blocked: false,
  setBlocked: () => undefined,
});

export function useReloadSafety(): ReloadSafetyContextValue {
  return useContext(ReloadSafetyContext);
}
