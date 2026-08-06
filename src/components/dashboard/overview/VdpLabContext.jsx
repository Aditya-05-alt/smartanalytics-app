'use client';

import { createContext, useContext } from 'react';

const VdpLabContext = createContext(false);

/** True only on /dashboard/vdp-lab — use to gate experimental channel/location behavior. */
export function useIsVdpLab() {
  return useContext(VdpLabContext);
}

export function VdpLabProvider({ children }) {
  return (
    <VdpLabContext.Provider value={true}>{children}</VdpLabContext.Provider>
  );
}
