'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type TimeZoneContextValue = { timeZone: string; setTimeZone: (value: string) => void };
const TimeZoneContext = createContext<TimeZoneContextValue>({
  timeZone: 'UTC',
  setTimeZone: () => {},
});

export function ControllerTimeZoneProvider({ timeZone, children }: { timeZone: string; children: ReactNode }) {
  const [current, setCurrent] = useState(timeZone);
  useEffect(() => setCurrent(timeZone), [timeZone]);
  return <TimeZoneContext.Provider value={{ timeZone: current, setTimeZone: setCurrent }}>{children}</TimeZoneContext.Provider>;
}

export function useControllerTimeZone() {
  return useContext(TimeZoneContext);
}
