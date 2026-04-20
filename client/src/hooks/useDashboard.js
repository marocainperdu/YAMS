import { useState, useEffect, useRef } from 'react';

const DEFAULT_DATA = {
  uptime: 0,
  servers: { total: 0, running: 0, stopped: 0, crashed: 0, list: [] },
  clients: { active: 0, pending: 0 },
  backpressure: { droppedMessages: 0 },
  recentLogs: [],
};

const POLL_INTERVAL = 3000;

export default function useDashboard() {
  const [data, setData] = useState(DEFAULT_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);
  // Keep a stable ref to the last serialised response so we can skip
  // setState when the backend returns identical data — avoids re-renders
  // on every poll tick even when nothing changed.
  const lastJsonRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchMetrics() {
      try {
        const res = await fetch('/api/metrics');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        if (cancelled) return;

        // Shallow change detection via serialisation — cheap for this payload size.
        const serialised = JSON.stringify(json);
        if (serialised !== lastJsonRef.current) {
          lastJsonRef.current = serialised;
          setData(json);
        }

        setError(null);
        setLoading(false);
        setLastFetched(Date.now());
      } catch (err) {
        if (cancelled) return;
        // Keep stale data visible; only surface the error.
        setError(err.message);
        setLoading(false);
      }
    }

    // Fetch immediately, then on every interval tick.
    fetchMetrics();
    const interval = setInterval(fetchMetrics, POLL_INTERVAL);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []); // empty deps — single interval, never recreated

  return { data, loading, error, lastFetched };
}
