import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from typing import Any, Dict, List, Optional

INGEST_URL = os.environ.get("INGEST_URL", "http://localhost:3000/api/ingest")
INGEST_SECRET = os.environ.get("INGEST_SECRET", "dev-secret")
AGENT_ID = os.environ.get("AGENT_ID") or socket.gethostname()
POLL_INTERVAL = float(os.environ.get("INGEST_INTERVAL", "30"))
MAX_PROCESSES = int(os.environ.get("MAX_PROCESSES", "15"))
MAX_EVENTS = int(os.environ.get("MAX_EVENTS", "20"))

_PREVIOUS_CPU_TIMES: Dict[int, float] = {}
_PREVIOUS_COLLECTED_AT: Optional[float] = None


def _run_command(command: List[str]) -> str:
    process = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False,
    )
    if process.returncode != 0:
        raise RuntimeError(
            f"Command {' '.join(command)} failed: {process.stderr.strip()}"
        )
    return process.stdout.strip()


def _run_powershell(script: str) -> str:
    return _run_command(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            script,
        ]
    )


def _collect_cpu_percent() -> Optional[float]:
    try:
        output = _run_command(["wmic", "cpu", "get", "LoadPercentage", "/value"])
    except RuntimeError:
        return None

    for line in output.splitlines():
        if line.startswith("LoadPercentage="):
            value = line.split("=", 1)[1].strip()
            try:
                return float(value)
            except ValueError:
                return None
    return None


def _collect_memory() -> Dict[str, Optional[float]]:
    try:
        output = _run_command(
            [
                "wmic",
                "OS",
                "get",
                "FreePhysicalMemory,TotalVisibleMemorySize",
                "/value",
            ]
        )
    except RuntimeError:
        return {"total_bytes": None, "used_bytes": None}

    total_kb = None
    free_kb = None

    for line in output.splitlines():
        if line.startswith("TotalVisibleMemorySize="):
            try:
                total_kb = float(line.split("=", 1)[1].strip())
            except ValueError:
                total_kb = None
        elif line.startswith("FreePhysicalMemory="):
            try:
                free_kb = float(line.split("=", 1)[1].strip())
            except ValueError:
                free_kb = None

    if total_kb is None or free_kb is None:
        return {"total_bytes": None, "used_bytes": None}

    total_bytes = total_kb * 1024
    free_bytes = free_kb * 1024
    used_bytes = max(total_bytes - free_bytes, 0)

    return {"total_bytes": total_bytes, "used_bytes": used_bytes}


def _collect_disks() -> List[Dict[str, Any]]:
    try:
        output = _run_powershell(
            "Get-CimInstance Win32_LogicalDisk | "
            "Where-Object {$_.DriveType -eq 3} | "
            "Select-Object DeviceID,Size,FreeSpace | "
            "ConvertTo-Json -Depth 3"
        )
    except RuntimeError:
        return []

    if not output:
        return []

    try:
        data = json.loads(output)
    except json.JSONDecodeError:
        return []

    if isinstance(data, dict):
        disks = [data]
    elif isinstance(data, list):
        disks = data
    else:
        return []

    result = []
    for disk in disks:
        device = disk.get("DeviceID")
        total = disk.get("Size")
        free = disk.get("FreeSpace")
        if device is None or total is None or free is None:
            continue
        try:
            result.append(
                {
                    "device": str(device),
                    "total_bytes": float(total),
                    "free_bytes": float(free),
                }
            )
        except (TypeError, ValueError):
            continue
    return result


def _collect_processes(interval_seconds: float) -> List[Dict[str, Any]]:
    try:
        output = _run_powershell(
            "Get-Process | "
            "Select-Object Id,ProcessName,CPU,WorkingSet64 | "
            "Sort-Object CPU -Descending | "
            f"Select-Object -First {MAX_PROCESSES} | "
            "ConvertTo-Json -Depth 3"
        )
    except RuntimeError:
        return []

    if not output:
        return []

    try:
        data = json.loads(output)
    except json.JSONDecodeError:
        return []

    if isinstance(data, dict):
        processes = [data]
    elif isinstance(data, list):
        processes = data
    else:
        return []

    cpu_count = os.cpu_count() or 1
    results: List[Dict[str, Any]] = []

    for process in processes:
        pid = process.get("Id")
        name = process.get("ProcessName")
        working_set = process.get("WorkingSet64")
        cpu_time = process.get("CPU", 0)

        if pid is None or name is None:
            continue

        try:
            pid_int = int(pid)
        except (TypeError, ValueError):
            continue

        try:
            cpu_seconds = float(cpu_time or 0.0)
        except (TypeError, ValueError):
            cpu_seconds = 0.0

        previous_cpu = _PREVIOUS_CPU_TIMES.get(pid_int)
        cpu_percent = None
        if previous_cpu is not None and interval_seconds > 0:
            delta = max(cpu_seconds - previous_cpu, 0.0)
            cpu_percent = (delta / interval_seconds) * 100 / cpu_count

        _PREVIOUS_CPU_TIMES[pid_int] = cpu_seconds

        memory_mb = None
        try:
            if working_set is not None:
                memory_mb = float(working_set) / (1024 * 1024)
        except (TypeError, ValueError):
            memory_mb = None

        results.append(
            {
                "pid": pid_int,
                "name": str(name),
                "cpu_percent": cpu_percent,
                "memory_mb": memory_mb,
            }
        )

    return results


def _collect_events() -> List[Dict[str, Any]]:
    try:
        output = _run_powershell(
            "Get-WinEvent -LogName System -MaxEvents {0} | "
            "Select-Object TimeCreated,Id,LevelDisplayName,ProviderName,Message | "
            "ConvertTo-Json -Depth 4".format(MAX_EVENTS)
        )
    except RuntimeError:
        return []

    if not output:
        return []

    try:
        data = json.loads(output)
    except json.JSONDecodeError:
        return []

    if isinstance(data, dict):
        events = [data]
    elif isinstance(data, list):
        events = data
    else:
        return []

    result = []
    for event in events:
        result.append(
            {
                "timestamp": event.get("TimeCreated"),
                "id": str(event.get("Id")) if event.get("Id") is not None else None,
                "level": event.get("LevelDisplayName"),
                "source": event.get("ProviderName"),
                "message": event.get("Message"),
            }
        )
    return result


def _collect_snapshot() -> Dict[str, Any]:
    global _PREVIOUS_COLLECTED_AT

    now = time.time()
    interval = (
        now - _PREVIOUS_COLLECTED_AT
        if _PREVIOUS_COLLECTED_AT is not None
        else POLL_INTERVAL
    )
    _PREVIOUS_COLLECTED_AT = now

    cpu_percent = _collect_cpu_percent()
    memory = _collect_memory()
    disks = _collect_disks()
    processes = _collect_processes(interval)
    events = _collect_events()

    ip_address = None
    try:
        ip_address = socket.gethostbyname(socket.gethostname())
    except OSError:
        pass

    return {
        "agent_id": AGENT_ID,
        "hostname": socket.gethostname(),
        "ip": ip_address,
        "collected_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
        "metrics": {
            "cpu_percent": cpu_percent,
            "memory": memory,
            "disks": disks,
        },
        "processes": processes,
        "events": events,
    }


def _post_snapshot(payload: Dict[str, Any]) -> None:
    request = urllib.request.Request(
        INGEST_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "User-Agent": "windows-agent/1.0",
            "X-Ingest-Secret": INGEST_SECRET,
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        if response.status >= 400:
            raise RuntimeError(f"Ingest failed with status {response.status}")


def main() -> None:
    if sys.platform != "win32":
        print("Warning: This agent is intended to run on Windows.", file=sys.stderr)

    while True:
        started = time.time()
        try:
            snapshot = _collect_snapshot()
            _post_snapshot(snapshot)
            print(
                f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] "
                f"Sent metrics for {snapshot['agent_id']}",
                flush=True,
            )
        except Exception as exc:
            print(f"Error collecting or sending metrics: {exc}", file=sys.stderr)

        elapsed = time.time() - started
        sleep_time = max(POLL_INTERVAL - elapsed, 5)
        time.sleep(sleep_time)


if __name__ == "__main__":
    main()
