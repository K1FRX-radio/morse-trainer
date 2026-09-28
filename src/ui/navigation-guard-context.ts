import { createContext, useContext } from "react";

export type NavigationGuardContextValue = {
  blocked: boolean;
  setBlocked: (blocked: boolean) => void;
};

export const NavigationGuardContext =
  createContext<NavigationGuardContextValue>({
    blocked: false,
    setBlocked: () => undefined,
  });

export function useNavigationGuard(): NavigationGuardContextValue {
  return useContext(NavigationGuardContext);
}
