"use client";

import { createContext, useContext } from "react";
import { RULE_DEFAULTS, type Rules } from "@/lib/rules-types";

/**
 * The saved business rules for client components (order form, size chart, staff
 * tallies, login). The root layout reads them once per request and provides them
 * here; outside the provider the code defaults apply.
 */
const RulesContext = createContext<Rules>(RULE_DEFAULTS);

export function RulesProvider({ rules, children }: { rules: Rules; children: React.ReactNode }) {
  return <RulesContext.Provider value={rules}>{children}</RulesContext.Provider>;
}

export const useRules = (): Rules => useContext(RulesContext);
