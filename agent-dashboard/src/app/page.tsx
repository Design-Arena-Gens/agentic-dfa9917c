"use client";

import { useEffect, useMemo, useState } from "react";

type DiskUsage = {
  device: string;
  totalBytes: number;
  freeBytes: number;
};

type MemoryUsage = {
  totalBytes: number;
  usedBytes: number;
};

type ProcessInfo = {
  pid: number;
  name: string;
  cpuPercent?: number;
  memoryMb?: number;
};

type EventLogEntry = {
  id?: string;
  level?: string;
  timestamp?: string;
  source?: string;
  message?: string;
};

type AgentSample = {
  collectedAt: string;
  metrics: {
    cpuPercent?: number;
    memory?: MemoryUsage;
    disks?: DiskUsage[];
  };
  processes?: ProcessInfo[];
  events?: EventLogEntry[];
};

type AgentState = {
  agentId: string;
  hostname?: string;
  ip?: string;
  lastSeen: string;
  samples: AgentSample[];
};

type MetricsResponse = {
  agents: AgentState[];
};

const POLL_INTERVAL = 5000;

function formatDate(value?: string) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatBytes(value?: number) {
  if (value === undefined) return "—";
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const exponent = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  const formatted = value / Math.pow(1024, exponent);
  return `${formatted.toFixed(1)} ${units[exponent]}`;
}

function formatPercent(value?: number) {
  if (value === undefined) return "—";
  return `${value.toFixed(1)}%`;
}

function useMetrics() {
  const [data, setData] = useState<MetricsResponse | undefined>();

  useEffect(() => {
    let isMounted = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const fetchData = async () => {
      try {
        const response = await fetch("/api/metrics");
        if (!response.ok) {
          throw new Error(`Failed to load metrics: ${response.status}`);
        }
        const payload = (await response.json()) as MetricsResponse;
        if (isMounted) {
          setData(payload);
        }
      } catch (error) {
        console.error(error);
      } finally {
        if (isMounted) {
          timeout = setTimeout(fetchData, POLL_INTERVAL);
        }
      }
    };

    fetchData();

    return () => {
      isMounted = false;
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, []);

  return data;
}

function ProgressBar({ value }: { value?: number }) {
  const percentage = value !== undefined ? Math.min(Math.max(value, 0), 100) : 0;
  return (
    <div className="h-2 w-full rounded-full bg-zinc-200">
      <div
        className="h-2 rounded-full bg-emerald-500 transition-all"
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

function AgentSummary({ agent }: { agent: AgentState }) {
  const latestSample = agent.samples[0];
  const cpuPercent = latestSample?.metrics.cpuPercent ?? 0;
  const memory = latestSample?.metrics.memory;
  const disks = latestSample?.metrics.disks ?? [];

  const memoryUsagePercent = useMemo(() => {
    if (!memory || memory.totalBytes === 0) return undefined;
    return (memory.usedBytes / memory.totalBytes) * 100;
  }, [memory]);

  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <header className="border-b border-zinc-200 px-6 py-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-zinc-900">
              {agent.hostname ?? agent.agentId}
            </h2>
            <p className="text-sm text-zinc-500">
              Agent ID: {agent.agentId}
              {agent.ip ? ` • ${agent.ip}` : ""}
            </p>
          </div>
          <p className="text-sm text-zinc-500">
            Last seen: {formatDate(agent.lastSeen)}
          </p>
        </div>
      </header>

      <div className="grid gap-6 px-6 py-6 lg:grid-cols-3">
        <div className="col-span-1">
          <h3 className="mb-2 text-sm font-medium text-zinc-500">CPU Load</h3>
          <p className="text-3xl font-semibold text-zinc-900">
            {formatPercent(cpuPercent)}
          </p>
          <ProgressBar value={cpuPercent} />
        </div>

        <div className="col-span-1">
          <h3 className="mb-2 text-sm font-medium text-zinc-500">Memory</h3>
          <p className="text-3xl font-semibold text-zinc-900">
            {memory ? formatPercent(memoryUsagePercent) : "—"}
          </p>
          <p className="text-sm text-zinc-500">
            {memory
              ? `${formatBytes(memory.usedBytes)} / ${formatBytes(memory.totalBytes)}`
              : "Unavailable"}
          </p>
          <ProgressBar value={memoryUsagePercent} />
        </div>

        <div className="col-span-1">
          <h3 className="mb-2 text-sm font-medium text-zinc-500">Disks</h3>
          <div className="space-y-3">
            {disks.length === 0 ? (
              <p className="text-sm text-zinc-500">No disk data</p>
            ) : (
              disks.map((disk) => {
                const freePercent =
                  disk.totalBytes > 0
                    ? (disk.freeBytes / disk.totalBytes) * 100
                    : undefined;
                return (
                  <div key={disk.device}>
                    <p className="text-sm font-medium text-zinc-700">
                      {disk.device}
                    </p>
                    <p className="text-xs text-zinc-500">
                      Free {formatBytes(disk.freeBytes)} of{" "}
                      {formatBytes(disk.totalBytes)}
                    </p>
                    <ProgressBar value={freePercent} />
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-zinc-200 px-6 py-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-3 text-sm font-semibold text-zinc-600">
              Top Processes
            </h3>
            <div className="overflow-hidden rounded-lg border border-zinc-200">
              <table className="min-w-full divide-y divide-zinc-200 text-sm">
                <thead className="bg-zinc-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-zinc-500">
                      PID
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-zinc-500">
                      Name
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-zinc-500">
                      CPU
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-zinc-500">
                      Memory
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 bg-white">
                  {latestSample?.processes && latestSample.processes.length > 0 ? (
                    latestSample.processes.map((process) => (
                      <tr key={`${process.pid}-${process.name}`}>
                        <td className="px-4 py-2 text-zinc-700">{process.pid}</td>
                        <td className="px-4 py-2 text-zinc-700">{process.name}</td>
                        <td className="px-4 py-2 text-zinc-700">
                          {process.cpuPercent !== undefined
                            ? `${process.cpuPercent.toFixed(1)}%`
                            : "—"}
                        </td>
                        <td className="px-4 py-2 text-zinc-700">
                          {process.memoryMb !== undefined
                            ? `${process.memoryMb.toFixed(1)} MB`
                            : "—"}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-6 text-center text-zinc-500"
                      >
                        No process data available
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-zinc-600">
              Recent Event Logs
            </h3>
            <div className="h-64 overflow-y-auto rounded-lg border border-zinc-200 bg-white">
              {latestSample?.events && latestSample.events.length > 0 ? (
                <ul className="divide-y divide-zinc-200">
                  {latestSample.events.map((event, index) => (
                    <li key={`${event.id}-${index}`} className="p-4">
                      <p className="text-sm font-semibold text-zinc-700">
                        {event.source ?? "Unknown Source"}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {formatDate(event.timestamp)}{" "}
                        {event.level ? `• ${event.level}` : ""}
                      </p>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-600">
                        {event.message ?? "No details available"}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex h-full items-center justify-center px-4 text-sm text-zinc-500">
                  No events reported
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const data = useMetrics();
  const agents = data?.agents ?? [];

  return (
    <div className="min-h-screen bg-zinc-50 py-12">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6">
        <header>
          <h1 className="text-3xl font-bold text-zinc-900">
            Windows Telemetry Dashboard
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            Live telemetry from lightweight Python agents running on Windows
            machines.
          </p>
        </header>

        {agents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-12 text-center">
            <p className="text-lg font-medium text-zinc-700">
              Waiting for agents to report in…
            </p>
            <p className="mt-2 text-sm text-zinc-500">
              Configure the Python agent to send metrics to this deployment and
              they will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {agents.map((agent) => (
              <AgentSummary key={agent.agentId} agent={agent} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
