import { NextRequest, NextResponse } from "next/server";
import { upsertAgent } from "@/lib/datastore";

const DEFAULT_SECRET = "dev-secret";

type IncomingDisk = {
    device?: unknown;
    total_bytes?: unknown;
    free_bytes?: unknown;
};

type IncomingProcess = {
    pid?: unknown;
    name?: unknown;
    cpu_percent?: unknown;
    memory_mb?: unknown;
};

type IncomingEvent = {
    id?: unknown;
    level?: unknown;
    timestamp?: unknown;
    source?: unknown;
    message?: unknown;
};

function asNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

function asString(value: unknown): string | undefined {
    if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
    }
    return undefined;
}

function normalizeDisks(disks: unknown) {
    if (!Array.isArray(disks)) return [];
    return disks
        .map((disk) => {
            if (typeof disk !== "object" || disk === null) return undefined;
            const d = disk as IncomingDisk;
            const device = asString(d.device);
            const total = asNumber(d.total_bytes);
            const free = asNumber(d.free_bytes);
            if (!device || total === undefined || free === undefined) return undefined;
            return {
                device,
                totalBytes: total,
                freeBytes: free,
            };
        })
        .filter(Boolean) as { device: string; totalBytes: number; freeBytes: number }[];
}

function normalizeProcesses(processes: unknown) {
    if (!Array.isArray(processes)) return [];
    return processes
        .map((process) => {
            if (typeof process !== "object" || process === null) return undefined;
            const p = process as IncomingProcess;
            const pid = asNumber(p.pid);
            const name = asString(p.name);
            if (pid === undefined || !name) return undefined;
            return {
                pid,
                name,
                cpuPercent: asNumber(p.cpu_percent),
                memoryMb: asNumber(p.memory_mb),
            };
        })
        .filter(Boolean) as {
        pid: number;
        name: string;
        cpuPercent?: number;
        memoryMb?: number;
    }[];
}

function normalizeEvents(events: unknown) {
    if (!Array.isArray(events)) return [];
    return events
        .map((event) => {
            if (typeof event !== "object" || event === null) return undefined;
            const e = event as IncomingEvent;
            const timestamp = asString(e.timestamp);
            const message =
                typeof e.message === "string"
                    ? e.message.slice(0, 4000)
                    : undefined;
            return {
                id: asString(e.id),
                level: asString(e.level),
                timestamp,
                source: asString(e.source),
                message,
            };
        })
        .filter(Boolean) as {
        id?: string;
        level?: string;
        timestamp?: string;
        source?: string;
        message?: string;
    }[];
}

export async function POST(request: NextRequest) {
    const secret = process.env.INGEST_SECRET ?? DEFAULT_SECRET;
    const provided =
        request.headers.get("x-ingest-secret") ??
        request.nextUrl.searchParams.get("secret");

    if (secret && provided !== secret) {
        return NextResponse.json(
            { error: "Unauthorized" },
            {
                status: 401,
            },
        );
    }

    let body: Record<string, unknown> | undefined;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json(
            { error: "Invalid JSON payload" },
            { status: 400 },
        );
    }

    if (!body) {
        return NextResponse.json(
            { error: "Missing payload" },
            { status: 400 },
        );
    }

    const agentId =
        asString(body.agent_id) ?? asString(body.agentId) ?? asString(body.hostname);
    if (!agentId) {
        return NextResponse.json(
            { error: "agent_id is required" },
            { status: 422 },
        );
    }

    const collectedAt =
        asString(body.collected_at) ?? new Date().toISOString();

    const metrics = body.metrics as Record<string, unknown> | undefined;
    const memory = metrics?.memory as Record<string, unknown> | undefined;

    upsertAgent({
        agentId,
        hostname: asString(body.hostname),
        ip: asString(body.ip),
        collectedAt,
        metrics: {
            cpuPercent: asNumber(metrics?.cpu_percent),
            memory: memory
                ? {
                    totalBytes: asNumber(memory.total_bytes) ?? 0,
                    usedBytes: asNumber(memory.used_bytes) ?? 0,
                }
                : undefined,
            disks: normalizeDisks(metrics?.disks),
        },
        processes: normalizeProcesses(body.processes),
        events: normalizeEvents(body.events),
    });

    return NextResponse.json({ ok: true });
}
