# ═══════════════════════════════════════════════════════════════════
# MINEGUARD AI — control_room_service.py
# Part 1/5 · Flask setup, config, constants, state, static routes
# SIH26039 · Team LABELX · Jharia Seam XI · RL −480 m · BCCL
# ═══════════════════════════════════════════════════════════════════

import os
import time
import math
import json
import random
import threading
from datetime import datetime, timezone, timedelta

from flask import Flask, jsonify, request, send_from_directory, abort
from flask_cors import CORS


# ─────────────── CONFIG ───────────────
HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", 5000))
IST = timezone(timedelta(hours=5, minutes=30))

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

TICK_INTERVAL = 1.0            # simulation tick (seconds)
STALE_THRESHOLD_MS = 10000     # >10 s no update → UNKNOWN
MAX_ALERTS = 60
MAX_TIMELINE = 200

# Risk bands — green/orange/red only
RISK_BANDS = [
    (0,  39,  "LOW",      "green"),
    (40, 69,  "MEDIUM",   "orange"),
    (70, 89,  "HIGH",     "red"),
    (90, 100, "CRITICAL", "red"),
]


# ─────────────── SENSOR DEFINITIONS ───────────────
SENSOR_KEYS = ["ch4", "co", "o2", "temp", "hum", "vib",
               "water", "flame", "pm10", "aqi", "airflow", "pir"]

BASELINES = {
    "ch4":     {"value": 0.22,  "min": 0.0,   "max": 5.0,   "unit": "%",      "warn": 0.80,  "crit": 1.25},
    "co":      {"value": 4.2,   "min": 0.0,   "max": 200.0, "unit": "ppm",    "warn": 25.0,  "crit": 50.0},
    "o2":      {"value": 20.8,  "min": 15.0,  "max": 20.9,  "unit": "%",      "warn": 19.5,  "crit": 19.0, "invert": True},
    "temp":    {"value": 27.6,  "min": 15.0,  "max": 60.0,  "unit": "°C",     "warn": 28.0,  "crit": 30.5},
    "hum":     {"value": 72.4,  "min": 0.0,   "max": 100.0, "unit": "%",      "warn": 85.0,  "crit": 92.0},
    "vib":     {"value": 0.04,  "min": 0.0,   "max": 2.0,   "unit": "g",      "warn": 0.30,  "crit": 0.78},
    "water":   {"value": 22.0,  "min": 0.0,   "max": 100.0, "unit": "%",      "warn": 50.0,  "crit": 75.0},
    "flame":   {"value": 0.00,  "min": 0.0,   "max": 1.0,   "unit": "ratio",  "warn": 0.30,  "crit": 0.50},
    "pm10":    {"value": 0.84,  "min": 0.0,   "max": 5.0,   "unit": "mg/m³",  "warn": 1.50,  "crit": 2.00},
    "aqi":     {"value": 42.0,  "min": 0.0,   "max": 500.0, "unit": "AQI",    "warn": 90.0,  "crit": 150.0},
    "airflow": {"value": 1.85,  "min": 0.0,   "max": 3.0,   "unit": "m/s",    "warn": 1.70,  "crit": 1.50, "invert": True},
    "pir":     {"value": "MESH","min": None,  "max": None,  "unit": "",       "warn": None,  "crit": None},
}

SENSOR_LABELS = {
    "ch4":     "CH₄ · Methane",
    "co":      "CO · Carbon Monoxide",
    "o2":      "O₂ · Oxygen Purity",
    "temp":    "Strata Temperature",
    "hum":     "Relative Humidity",
    "vib":     "Strata Vibration",
    "water":   "Sump Water Level",
    "flame":   "Optical Flame (IR/UV)",
    "pm10":    "Respirable Dust PM₁₀",
    "aqi":     "Air Quality Index",
    "airflow": "Shaft B Return Flow",
    "pir":     "PIR Motion Mesh",
}

SENSOR_LOCATIONS = {
    "ch4":     "Anchor A3 · Node N3-2 · Zone 3",
    "co":      "Anchor A4 · Node N4-3 · Zone 4",
    "o2":      "Anchor A1 · Node N1-3 · Zone 1",
    "temp":    "Anchor A3 · Node N3-3 · Zone 3",
    "hum":     "Anchor A3 · Node N3-3 · Zone 3",
    "vib":     "Anchor A2 · Node N2-2 · Zone 2",
    "water":   "Anchor A2 · Node N2-3 · Zone 2",
    "flame":   "Anchor A3 · Node N3-2 · Zone 3",
    "pm10":    "Anchor A4 · Node N4-3 · Zone 4",
    "aqi":     "Anchor A4 · Node N4-3 · Zone 4",
    "airflow": "Shaft B · Upcast Stack",
    "pir":     "Anchor A4 · Node N4-2 · Zone 4",
}

SENSOR_REGS = {
    "ch4":     "CMR 2017 Reg 169",
    "co":      "DGMS TLV 50 ppm",
    "o2":      "CMR 2017 Reg 153",
    "temp":    "CMR 2017 Reg 156",
    "hum":     "Ergonomic Standard",
    "vib":     "CMR 2017 Reg 137",
    "water":   "Sump Inundation",
    "flame":   "Combustion Detection",
    "pm10":    "DGMS Dust Standard",
    "aqi":     "CPCB Air Quality",
    "airflow": "CMR 2017 Reg 156 / 160",
    "pir":     "Motion Cross-check",
}

# Phase offsets so sensors don't drift in sync
random.seed(26039)
SENSOR_PHASE = {k: random.uniform(0, math.tau) for k in SENSOR_KEYS}


# ─────────────── GLOBAL STATE ───────────────
STATE = {
    "boot_ts": time.time(),
    "emergency": False,
    "emergency_id": None,
    "emergency_start_ts": None,
    "scenario": None,          # e.g. "ch4", "grid", "roof"
    "scenario_start_ts": None,

    "sensors": {k: (BASELINES[k]["value"] if not isinstance(BASELINES[k]["value"], str) else BASELINES[k]["value"]) for k in SENSOR_KEYS},
    "sensor_meta": {k: {"lastContact": int(time.time() * 1000), "stale": False} for k in SENSOR_KEYS},

    "workers": [],             # populated in Part 3
    "vehicles": [],            # populated in Part 3
    "areas": {},               # populated in Part 3

    "rover": {
        "status": "STANDBY",
        "location": "Surface Station",
        "battery": 100,
        "comms": "CONNECTED",
        "ch4": 0.22,
        "thermal": 34.0,
        "humidity": 72,
        "obstacle": "CLEAR",
        "lastUpdate": int(time.time() * 1000),
    },

    "comms": {
        "state": "CONNECTED",
        "signal": 91,
        "latency": 42,
    },

    "ai": {
        "score": 14,
        "level": "LOW",
        "gas": 20,
        "vent": 20,
        "strata": 20,
        "prox": 20,
        "recommendation": "Continue routine monitoring. All statutory parameters within CMR 2017 limits.",
    },

    "alerts": [],
    "timeline": [],

    "weather": {
        "condition": "Clear",
        "surfaceTemp": 28,
        "rainfall": 12,
        "floodRisk": "LOW",
        "affected": "No tunnels currently affected. Sump level nominal.",
    },

    "settings": {
        "aiEngine": True,
        "sensorMonitoring": True,
        "workerTracking": True,
        "rescueRover": True,
        "commsMesh": True,
        "voiceAlerts": True,
        "soundOnCritical": True,
        "operatorName": "Control Room",
        "controlRoomStatus": "Active",
        "systemStatus": "Operational",
    },
}

STATE_LOCK = threading.RLock()


# ─────────────── FLASK APP ───────────────
app = Flask(__name__, static_folder=None)
CORS(app)


# ─────────────── STATIC FILE ROUTES ───────────────
@app.route("/")
def serve_root():
    return send_from_directory(FRONTEND_DIR, "scada_dashboard.html")


@app.route("/scada_dashboard.html")
def serve_dashboard():
    return send_from_directory(FRONTEND_DIR, "scada_dashboard.html")


@app.route("/control_room.css")
def serve_css():
    return send_from_directory(FRONTEND_DIR, "control_room.css")


@app.route("/app.js")
def serve_app_js():
    return send_from_directory(FRONTEND_DIR, "app.js")


@app.route("/tunnel_3d.js")
def serve_tunnel_js():
    return send_from_directory(FRONTEND_DIR, "tunnel_3d.js")


@app.route("/three.min.js")
def serve_three():
    return send_from_directory(FRONTEND_DIR, "three.min.js")


@app.route("/escape_path.js")
def serve_escape_path():
    return send_from_directory(FRONTEND_DIR, "escape_path.js")


@app.route("/map_visuals.js")
def serve_map_visuals():
    return send_from_directory(FRONTEND_DIR, "map_visuals.js")


    # ═══════════════════════════════════════════════════════════════════
# Part 2/5 · Sensor simulation engine — time-driven, correlated
# ═══════════════════════════════════════════════════════════════════

def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def _sensor_status(key, value):
    """Return 'ok' | 'warn' | 'crit' for a sensor value."""
    meta = BASELINES.get(key)
    if not meta or value is None:
        return "unknown"

    warn = meta.get("warn")
    crit = meta.get("crit")
    invert = meta.get("invert", False)

    if warn is None or crit is None:
        return "ok"

    if invert:
        if value < crit:
            return "crit"
        if value < warn:
            return "warn"
        return "ok"
    else:
        if value >= crit:
            return "crit"
        if value >= warn:
            return "warn"
        return "ok"


def _scenario_ramp(key, elapsed_scenario):
    """Return the sensor value driven by the active scenario (or None)."""
    sc = STATE["scenario"]
    if not sc:
        return None

    t = _clamp(elapsed_scenario / 30.0, 0.0, 1.0)   # 30 s ramp to steady state

    if sc == "grid":
        return {
            "airflow": 1.85 - 1.10 * t,      # → 0.75 m/s
            "ch4":     0.22 + 0.35 * t,      # → 0.57 %
            "co":      4.2  + 8.0  * t,      # → 12 ppm
            "o2":      20.8 - 0.60 * t,      # → 20.2 %
        }.get(key)

    if sc == "ch4":
        return {
            "ch4":     0.22 + 1.20 * t,      # → 1.42 %
            "co":      4.2  + 28.0 * t,      # → 32 ppm
            "temp":    27.6 + 14.5 * t,      # → 42.1 °C
            "vib":     0.04 + 4.75 * t,      # → 4.79
            "airflow": 1.85 - 0.23 * t,      # → 1.62 m/s
            "hum":     72.4 + 5.6  * t,      # → 78 %
            "pm10":    0.84 + 0.20 * t,
            "aqi":     42.0 + 20.0 * t,
        }.get(key)

    if sc == "lhd":
        return {
            "vib":     0.04 + 6.15 * t,      # → 6.19
            "co":      4.2  + 12.0 * t,
        }.get(key)

    if sc == "roof":
        return {
            "vib":     0.04 + 0.74 * t,      # → 0.78 g
            "temp":    27.6 + 3.0  * t,
            "hum":     72.4 + 3.0  * t,
        }.get(key)

    if sc == "p2v":
        return {
            "vib":     0.04 + 0.30 * t,
        }.get(key)

    if sc == "mesh":
        # No physical change — handled by marking nodes stale
        return None

    if sc == "buzzer":
        return {
            "ch4":     0.22 + 0.60 * t,
            "temp":    27.6 + 6.0  * t,
        }.get(key)

    if sc == "rover":
        return {
            "ch4":     0.22 + 0.96 * t,
            "thermal": 34.0 + 12.5 * t,      # rover thermal only — handled separately
        }.get(key)

    return None


def _apply_correlations(sensors, dt):
    """Physics-inspired coupling between sensors."""
    s = sensors

    # CH4 rises if airflow drops below 1.6 m/s
    if s.get("airflow", 2.0) < 1.6:
        s["ch4"] = s.get("ch4", 0.22) + 0.002 * dt

    # Temp rises 1 °C per 0.15 % rise in CH4 above 0.5 %
    ch4 = s.get("ch4", 0.22)
    if ch4 > 0.5:
        s["temp"] = s.get("temp", 27.6) + ((ch4 - 0.5) / 0.15) * 0.05 * dt

    # Humidity inversely tracks temperature
    temp_delta = s.get("temp", 27.6) - 27.6
    s["hum"] = _clamp(s.get("hum", 72.4) - temp_delta * 0.05 * dt, 0, 100)

    # CO rises with vibration events
    if s.get("vib", 0.04) > 0.5:
        s["co"] = s.get("co", 4.2) + 0.20 * dt

    # PM10 rises with vehicle activity (approximated as LHD presence)
    s["pm10"] = s.get("pm10", 0.84) + 0.0008 * dt

    # Water level trends during weather events (static baseline otherwise)
    # Handled separately if weather flood risk > LOW

    return s


def tick_simulation():
    """Called once per second from the background thread."""
    with STATE_LOCK:
        now = time.time()
        elapsed_total = now - STATE["boot_ts"]
        dt = TICK_INTERVAL

        sensors = dict(STATE["sensors"])
        sensor_meta = STATE["sensor_meta"]

        scenario_elapsed = (now - STATE["scenario_start_ts"]) if STATE["scenario_start_ts"] else 0

        # ── 1. Apply slow sinusoidal drift + small noise
        for key in SENSOR_KEYS:
            base_def = BASELINES[key]
            base_val = base_def["value"]
            if isinstance(base_val, str):
                continue

            amp = abs(base_val) if base_val > 0.001 else 1.0
            phase = SENSOR_PHASE[key]

            # slow drift, period ~90 s
            drift = math.sin(elapsed_total / 45.0 + phase) * amp * 0.04
            # noise
            noise = random.gauss(0, amp * 0.005)

            sensors[key] = base_val + drift + noise

        # ── 2. Apply scenario ramp (overrides baseline)
        if STATE["scenario"]:
            for key in SENSOR_KEYS:
                override = _scenario_ramp(key, scenario_elapsed)
                if override is not None:
                    sensors[key] = override

        # ── 3. Apply physical correlations
        sensors = _apply_correlations(sensors, dt)

        # ── 4. Clamp all values to physical limits
        for key in SENSOR_KEYS:
            base_def = BASELINES[key]
            if isinstance(base_def["value"], str):
                continue
            lo, hi = base_def["min"], base_def["max"]
            if key == "airflow":
                lo = 0.0
            sensors[key] = round(_clamp(sensors[key], lo, hi), 3)

        # ── 5. Write back into STATE
        STATE["sensors"] = sensors

        # Update lastContact for non-stale sensors
        now_ms = int(now * 1000)
        for key in SENSOR_KEYS:
            meta = sensor_meta.get(key, {})
            if not meta.get("stale"):
                meta["lastContact"] = now_ms
            sensor_meta[key] = meta

        # ── 6. Rover thermal follows scenario
        if STATE["scenario"] == "rover":
            STATE["rover"]["thermal"] = round(34.0 + 12.5 * _clamp(scenario_elapsed / 30.0, 0, 1), 1)
            STATE["rover"]["ch4"] = round(0.22 + 0.96 * _clamp(scenario_elapsed / 30.0, 0, 1), 2)
        else:
            STATE["rover"]["thermal"] = round(34.0 + (sensors["temp"] - 27.6) * 0.3, 1)
            STATE["rover"]["ch4"] = round(sensors["ch4"], 2)

        STATE["rover"]["lastUpdate"] = now_ms

        # ── 7. Comms degradation during mesh scenario
        if STATE["scenario"] == "mesh":
            STATE["comms"]["state"] = "DEGRADED"
            STATE["comms"]["signal"] = 42
            STATE["comms"]["latency"] = 220
        elif not STATE["emergency"]:
            STATE["comms"]["state"] = "CONNECTED"
            STATE["comms"]["signal"] = 91
            STATE["comms"]["latency"] = 42
            # ═══════════════════════════════════════════════════════════════════
# Part 3/5 · Workers, vehicles, areas, rover, comms, anchor-node registry
# ═══════════════════════════════════════════════════════════════════

# ─────────────── WORKER ROSTER (12 underground) ───────────────
WORKER_ROSTER = [
    {"id": "W1",  "name": "Manoj Mahato",   "zone": "Zone 1",   "anchor": "A1", "node": "N1-1", "status": "SAFE",      "hr": 78,  "spo2": 98, "temp": 36.7, "resp": 15, "distance": 0,  "cert": "2026-12-14"},
    {"id": "W2",  "name": "Rajesh Kumar",   "zone": "Zone 5",   "anchor": "A5", "node": "N5-1", "status": "SAFE",      "hr": 82,  "spo2": 97, "temp": 36.8, "resp": 16, "distance": 210,"cert": "2027-02-03"},
    {"id": "W3",  "name": "Sunil Tudu",     "zone": "Zone 3",   "anchor": "A3", "node": "N3-1", "status": "TRAPPED",   "hr": 108, "spo2": 94, "temp": 37.4, "resp": 22, "distance": 0,  "cert": "2026-11-20"},
    {"id": "W4",  "name": "Amit Singh",     "zone": "Zone 1",   "anchor": "A1", "node": "N1-2", "status": "SAFE",      "hr": 74,  "spo2": 99, "temp": 36.6, "resp": 14, "distance": 0,  "cert": "2027-01-08"},
    {"id": "W5",  "name": "Vikash Yadav",   "zone": "Zone 2",   "anchor": "A2", "node": "N2-1", "status": "SAFE",      "hr": 79,  "spo2": 98, "temp": 36.7, "resp": 15, "distance": 0,  "cert": "2026-10-30"},
    {"id": "W6",  "name": "Ravi Mahto",     "zone": "Zone 2",   "anchor": "A2", "node": "N2-2", "status": "SAFE",      "hr": 81,  "spo2": 97, "temp": 36.7, "resp": 16, "distance": 0,  "cert": "2027-03-19"},
    {"id": "W7",  "name": "Sanjay Das",     "zone": "Zone 3",   "anchor": "A3", "node": "N3-3", "status": "SAFE",      "hr": 76,  "spo2": 98, "temp": 36.6, "resp": 15, "distance": 0,  "cert": "2026-09-25"},
    {"id": "W8",  "name": "Dilip Karmakar", "zone": "Zone 3",   "anchor": "A3", "node": "N3-3", "status": "SAFE",      "hr": 83,  "spo2": 97, "temp": 36.8, "resp": 16, "distance": 0,  "cert": "2027-04-11"},
    {"id": "W9",  "name": "Pappu Kumar",    "zone": "Zone 3",   "anchor": "A3", "node": "N3-3", "status": "SAFE",      "hr": 77,  "spo2": 98, "temp": 36.7, "resp": 15, "distance": 0,  "cert": "2026-12-02"},
    {"id": "W10", "name": "Krishna Murmu",  "zone": "Zone 4",   "anchor": "A4", "node": "N4-1", "status": "SAFE",      "hr": 80,  "spo2": 98, "temp": 36.6, "resp": 14, "distance": 0,  "cert": "2027-05-22"},
    {"id": "W11", "name": "Bipin Soren",    "zone": "Zone 4",   "anchor": "A4", "node": "N4-3", "status": "SAFE",      "hr": 75,  "spo2": 99, "temp": 36.7, "resp": 15, "distance": 0,  "cert": "2026-11-07"},
    {"id": "W17", "name": "Ajay Besra",     "zone": "Zone 3",   "anchor": "A3", "node": "N3-2", "status": "HIGH RISK", "hr": 118, "spo2": 96, "temp": 37.0, "resp": 20, "distance": 35, "cert": "2027-01-29"},
]


# ─────────────── VEHICLE ROSTER ───────────────
VEHICLE_ROSTER = [
    {"id": "LHD-01", "type": "Trackless Loader", "location": "Anchor A2 · Node N2-1 · Zone 2",
     "speed": 8,  "operator": "A. Sharma",   "fuel": 68, "fuelUnit": "%", "comms": "CONNECTED", "nearbyHazard": "NONE"},
    {"id": "D-02",   "type": "Mine Dumper",      "location": "Anchor A3 · Node N3-3 · Zone 3",
     "speed": 12, "operator": "R. Singh",    "fuel": 54, "fuelUnit": "%", "comms": "CONNECTED", "nearbyHazard": "NONE"},
    {"id": "J-01",   "type": "Utility Jeep",     "location": "Anchor A1 · Node N1-2 · Zone 1",
     "speed": 22, "operator": "M. Das",      "fuel": 71, "fuelUnit": "%", "comms": "CONNECTED", "nearbyHazard": "NONE"},
    {"id": "ROV-01", "type": "Rescue Rover",     "location": "Surface Station",
     "speed": 0,  "operator": "Autonomous",  "fuel": 94, "fuelUnit": "%", "comms": "CONNECTED", "nearbyHazard": "NONE"},
]


# ─────────────── AREA REGISTRY ───────────────
AREA_REGISTRY = {
    "Tunnel A":  {"anchor": "A1", "zone": "Zone 1", "workers": [], "sensors": ["o2", "airflow"]},
    "Tunnel B":  {"anchor": "A2", "zone": "Zone 2", "workers": [], "sensors": ["vib", "water"]},
    "Tunnel C":  {"anchor": "A3", "zone": "Zone 3", "workers": [], "sensors": ["ch4", "temp", "hum", "flame"]},
    "Tunnel D":  {"anchor": "A4", "zone": "Zone 4", "workers": [], "sensors": ["co", "pm10", "aqi", "pir"]},
    "Junction 1":{"anchor": "A1", "zone": "Zone 1", "workers": [], "sensors": []},
    "Junction 2":{"anchor": "A4", "zone": "Zone 4", "workers": [], "sensors": []},
}


# ─────────────── ANCHOR → NODE REGISTRY ───────────────
ANCHOR_NODE_MAP = {
    "A1": {
        "zone": "Zone 1 — Intake Haulage Drift",
        "nodes": {
            "N1-1": {"type": "Worker W1 Tag",        "entity": "workerW1"},
            "N1-2": {"type": "Hot-Wire Airflow",     "entity": "airflow"},
            "N1-3": {"type": "Galvanic O₂",          "entity": "o2"},
        },
    },
    "A2": {
        "zone": "Zone 2 — 1:10 Incline Haulage",
        "nodes": {
            "N2-1": {"type": "LHD-01 CAS Loader",    "entity": "lhd01"},
            "N2-2": {"type": "Strata Geophone #9",   "entity": "vib"},
            "N2-3": {"type": "Sump Ultrasonic",      "entity": "water"},
        },
    },
    "A3": {
        "zone": "Zone 3 — Longwall Coal Face",
        "nodes": {
            "N3-1": {"type": "Worker W3 Trapped Tag","entity": "workerW3"},
            "N3-2": {"type": "MQ-2 CH₄ Transducer",  "entity": "ch4"},
            "N3-3": {"type": "Face Thermistor",      "entity": "temp"},
        },
    },
    "A4": {
        "zone": "Zone 4 — Cross-Cut Airway",
        "nodes": {
            "N4-1": {"type": "Telemetry Trunk Relay","entity": "relay"},
            "N4-2": {"type": "PIR Motion",           "entity": "pir"},
            "N4-3": {"type": "CO Split #4",          "entity": "co"},
        },
    },
    "A5": {
        "zone": "Zone 5 — Refuge Sanctuary Bay",
        "nodes": {
            "N5-1": {"type": "Worker W2 Safe Tag",   "entity": "workerW2"},
            "N5-2": {"type": "Refuge O₂ Pressure",   "entity": "refuge_o2"},
        },
    },
}


# ─────────────── WORKER-VITALS TIME DRIFT ───────────────
def _drift_worker_vitals(worker, dt):
    """Realistic small drift in HR/SpO₂/respiration over time."""
    base_hr = worker["hr"]
    base_spo2 = worker["spo2"]

    # HR wanders ±3 bpm
    worker["hr"] = int(_clamp(base_hr + math.sin(time.time() / 20 + hash(worker["id"]) % 10) * 3, 60, 140))
    # SpO₂ wanders ±1 %
    worker["spo2"] = int(_clamp(base_spo2 + math.sin(time.time() / 40 + hash(worker["id"]) % 7) * 1, 90, 100))
    # Respiration wanders ±2
    worker["resp"] = int(_clamp(worker["resp"] + math.sin(time.time() / 30) * 1, 10, 30))
    return worker


def refresh_worker_status():
    """Recompute worker safety status from current sensor + emergency state."""
    with STATE_LOCK:
        for w in STATE["workers"]:
            anchor = w["anchor"]
            node = w["node"]

            # Base status from roster
            base_status = next((r["status"] for r in WORKER_ROSTER if r["id"] == w["id"]), "SAFE")
            w["status"] = base_status

            # During emergency, elevate status by proximity to hazard
            if STATE["emergency"]:
                if w["id"] == "W3":
                    w["status"] = "TRAPPED"
                elif w["zone"] == "Zone 3":
                    w["status"] = "HIGH RISK"
                    w["distance"] = min(w.get("distance", 0) or 35, 35)
                elif w["zone"] == "Zone 2" and STATE["scenario"] in ("lhd", "p2v"):
                    w["status"] = "HIGH RISK"

            # Signal-lost handling: if this worker's node is stale
            meta = STATE["sensor_meta"].get(_node_sensor_for(w["node"]), {})
            if meta.get("stale"):
                w["status"] = "UNKNOWN"
                w["stale"] = True
            else:
                w["stale"] = False

            w["anchorNode"] = f"{anchor} · {node}"


def _node_sensor_for(node_id):
    """Map a worker's node → the sensor key that shares that node (for staleness check)."""
    return {
        "N1-1": "pir",
        "N1-2": "airflow",
        "N1-3": "o2",
        "N2-1": "vib",
        "N2-2": "vib",
        "N2-3": "water",
        "N3-1": "ch4",
        "N3-2": "ch4",
        "N3-3": "temp",
        "N4-1": "co",
        "N4-2": "pir",
        "N4-3": "co",
        "N5-1": "pir",
        "N5-2": "pir",
    }.get(node_id, "pir")


# ─────────────── INITIALISE STATE ON BOOT ───────────────
def init_state():
    with STATE_LOCK:
        STATE["workers"] = [dict(w) for w in WORKER_ROSTER]
        STATE["vehicles"] = [dict(v) for v in VEHICLE_ROSTER]
        STATE["areas"] = {k: dict(v) for k, v in AREA_REGISTRY.items()}
        refresh_worker_status()
        _refresh_area_risk()


def _refresh_area_risk():
    """Update each area's aggregated risk from AI + emergency state."""
    with STATE_LOCK:
        score = STATE["ai"]["score"]
        for name, area in STATE["areas"].items():
            # workers currently in this zone
            zone = area.get("zone")
            worker_count = sum(1 for w in STATE["workers"] if w.get("zone") == zone)
            area["workers"] = worker_count

            # rover presence
            area["rover"] = "INSPECTING" if STATE["rover"]["status"] == "INSPECTING" and "Zone 3" in STATE["rover"]["location"] and zone == "Zone 3" else "N/A"

            # comms
            area["comms"] = STATE["comms"]["state"]

            # sensors state
            sensor_oks = True
            for key in area.get("sensors", []):
                meta = STATE["sensor_meta"].get(key, {})
                if meta.get("stale"):
                    sensor_oks = False
                    break
            area["sensors"] = "ONLINE" if sensor_oks else "DEGRADED"

            # risk derived from score + emergency proximity
            if STATE["emergency"] and zone == "Zone 3":
                area["risk"] = "CRITICAL"
            elif score >= 90:
                area["risk"] = "CRITICAL"
            elif score >= 70:
                area["risk"] = "HIGH"
            elif score >= 40:
                area["risk"] = "MEDIUM"
            else:
                area["risk"] = "LOW"
                # ═══════════════════════════════════════════════════════════════════
# Part 4/5 · AI risk engine, XAI explanation, alerts, timeline, emergency
# ═══════════════════════════════════════════════════════════════════

# ─────────────── RISK BAND HELPERS ───────────────
def risk_level_from_score(score):
    for lo, hi, label, _ in RISK_BANDS:
        if lo <= score <= hi:
            return label
    return "LOW"


def risk_color_from_score(score):
    for lo, hi, _, color in RISK_BANDS:
        if lo <= score <= hi:
            return color
    return "green"


# ─────────────── FACTOR NORMALISATION (0.0 → 1.0) ───────────────
def _norm(x, lo, hi):
    if hi <= lo:
        return 0.0
    return _clamp((x - lo) / (hi - lo), 0.0, 1.0)


def _gas_factor():
    ch4 = STATE["sensors"].get("ch4", 0.22)
    co  = STATE["sensors"].get("co", 4.2)
    return max(
        _norm(ch4, 0.22, 1.42),
        _norm(co, 4.2, 50.0),
    )


def _vent_factor():
    af = STATE["sensors"].get("airflow", 1.85)
    o2 = STATE["sensors"].get("o2", 20.8)
    # lower airflow → higher factor
    f1 = _norm(1.85 - af, 0.0, 1.10)
    # lower O₂ → higher factor
    f2 = _norm(20.8 - o2, 0.0, 1.80)
    return max(f1, f2)


def _strata_factor():
    vib  = STATE["sensors"].get("vib", 0.04)
    temp = STATE["sensors"].get("temp", 27.6)
    return max(
        _norm(vib, 0.04, 0.78),
        _norm(temp, 27.6, 42.0),
    )


def _prox_factor():
    """Worker-hazard proximity."""
    score = 0.0
    for w in STATE["workers"]:
        d = w.get("distance", 999) or 999
        if d < 10:
            score = max(score, 1.0)
        elif d < 35:
            score = max(score, 0.7)
        elif d < 60:
            score = max(score, 0.4)
    # LHD P2V proximity
    if STATE["scenario"] == "p2v":
        score = max(score, 0.9)
    return score


# ─────────────── WEIGHTED RISK SCORE ───────────────
WEIGHTS = {
    "gas":    0.35,
    "vent":   0.20,
    "strata": 0.20,
    "prox":   0.25,
}


def compute_risk():
    """Risk Index = Σ (wᵢ · Fᵢ) — deterministic weighted sum."""
    gas = _gas_factor()
    vent = _vent_factor()
    strata = _strata_factor()
    prox = _prox_factor()

    score = (
        WEIGHTS["gas"]    * gas    +
        WEIGHTS["vent"]   * vent   +
        WEIGHTS["strata"] * strata +
        WEIGHTS["prox"]   * prox
    ) * 100.0

    score = int(round(_clamp(score, 0, 100)))
    level = risk_level_from_score(score)

    # If any critical sensor is stale → confidence note, but score still computed
    stale_count = sum(1 for m in STATE["sensor_meta"].values() if m.get("stale"))
    confidence = max(60, 100 - stale_count * 5)

    return {
        "score": score,
        "level": level,
        "color": risk_color_from_score(score),
        "gas":    int(round(gas    * 100)),
        "vent":   int(round(vent   * 100)),
        "strata": int(round(strata * 100)),
        "prox":   int(round(prox   * 100)),
        "confidence": confidence,
        "staleSensors": stale_count,
    }


def build_recommendation(risk):
    """Plain-English statutory directive based on risk state."""
    if risk["level"] == "CRITICAL":
        return ("Isolate heading electrical power (CMR Reg 169). Restrict all personnel entry. "
                "Dispatch autonomous rover for remote gas and thermal inspection. "
                "Do not commit human rescuers until CH₄ < 1.0 % and airflow ≥ 1.85 m/s.")
    if risk["level"] == "HIGH":
        return ("Restrict non-essential personnel. Increase ventilation and monitor CH₄/CO continuously. "
                "Verify refuge bay readiness. Prepare evacuation route to Shaft A.")
    if risk["level"] == "MEDIUM":
        return ("Monitor sensor trends closely. Verify UWB tag health. "
                "Inspect any recent strata anomalies. Confirm comms mesh integrity.")
    return "Continue routine monitoring. All statutory parameters within CMR 2017 limits."


def xai_explanation():
    """Plain-English multi-factor explanation."""
    risk = STATE["ai"]
    ch4 = STATE["sensors"].get("ch4", 0.22)
    temp = STATE["sensors"].get("temp", 27.6)
    vib = STATE["sensors"].get("vib", 0.04)
    af = STATE["sensors"].get("airflow", 1.85)
    co = STATE["sensors"].get("co", 4.2)

    lines = [
        f"The composite risk index of {risk['score']} / 100 is driven primarily by:",
        f"• Gas breach weighting {risk['gas']} % — CH₄ currently {ch4:.2f} % (limit 1.25 %, CMR Reg 169), CO {co:.1f} ppm.",
        f"• Ventilation deficit weighting {risk['vent']} % — Shaft B return flow {af:.2f} m/s (statutory 1.85 m/s, Reg 156).",
        f"• Strata shear weighting {risk['strata']} % — vibration {vib:.2f} g, strata temperature {temp:.1f} °C (ceiling 30.5 °C).",
        f"• Worker-hazard proximity weighting {risk['prox']} % — closest worker within {_nearest_worker_distance()} m.",
    ]
    if STATE["sensor_meta"] and any(m.get("stale") for m in STATE["sensor_meta"].values()):
        lines.append("⚠ One or more sensor nodes are in UNKNOWN state — risk computed with reduced confidence.")
    if STATE["emergency"]:
        lines.append(f"Emergency mode ACTIVE — {STATE['emergency_id']}. Statutory mitigation directive enforced.")
    return lines


def _nearest_worker_distance():
    d = min([w.get("distance", 999) or 999 for w in STATE["workers"]] + [999])
    return int(d)


# ─────────────── ALERTS ───────────────
def push_alert(severity, title, **kwargs):
    with STATE_LOCK:
        alert = {
            "id": f"AL{int(time.time() * 1000)}{random.randint(100, 999)}",
            "time": datetime.now(IST).strftime("%H:%M:%S"),
            "ts": int(time.time() * 1000),
            "severity": severity,
            "title": title,
            "value":     kwargs.get("value"),
            "cause":     kwargs.get("cause"),
            "worker":    kwargs.get("worker"),
            "sensors":   kwargs.get("sensors"),
            "comms":     kwargs.get("comms"),
            "rover":     kwargs.get("rover"),
            "score":     kwargs.get("score"),
            "level":     kwargs.get("level"),
            "location":  kwargs.get("location"),
            "action":    kwargs.get("action"),
            "acknowledged": False,
        }
        STATE["alerts"].insert(0, alert)
        if len(STATE["alerts"]) > MAX_ALERTS:
            STATE["alerts"].pop()

        push_timeline(f"{title}" + (f" — {alert['location']}" if alert.get("location") else ""), severity)
        return alert


def acknowledge_alert(alert_id):
    with STATE_LOCK:
        for a in STATE["alerts"]:
            if a["id"] == alert_id:
                a["acknowledged"] = True
                return True
    return False


def clear_alerts():
    with STATE_LOCK:
        STATE["alerts"] = []


# ─────────────── TIMELINE ───────────────
def push_timeline(text, severity="info"):
    with STATE_LOCK:
        entry = {
            "time": datetime.now(IST).strftime("%H:%M:%S"),
            "ts": int(time.time() * 1000),
            "text": text,
            "severity": severity,
        }
        STATE["timeline"].append(entry)
        if len(STATE["timeline"]) > MAX_TIMELINE:
            STATE["timeline"].pop(0)
        return entry


# ─────────────── SCENARIO DISPATCHER ───────────────
def start_scenario(key):
    """Kick off a cascade scenario. Actual sensor ramp done by tick loop."""
    with STATE_LOCK:
        STATE["scenario"] = key
        STATE["scenario_start_ts"] = time.time()

        if key == "grid":
            enter_emergency("EM-001", "33 kV Grid Blackout · Shaft B Auxiliary")
            push_alert(
                "critical",
                "33 kV Main Grid Failure — ATS Engaged",
                location="Shaft B · Upcast Ventilation",
                value="Auxiliary fan 0.75 m/s (0.9 s cutover)",
                cause="Grid loss · Automatic Transfer Switch <1.2 s (CMR Reg 160)",
                worker="All personnel — 40-minute evacuation window",
                sensors="Airflow 1.85 → 0.75 m/s · CH₄ rising · CO rising",
                rover="STANDBY · Surface Station",
                score=78, level="HIGH",
                action="Begin orderly evacuation. Auxiliary ventilation active (CMR Reg 160).",
            )

        elif key == "ch4":
            enter_emergency("EM-002", "CH₄ Outburst · Zone 3 Longwall Face")
            push_alert(
                "critical",
                "Methane Outburst — Zone 3 Heading Power Tripped",
                location="Anchor A3 · Node N3-2 · Zone 3",
                value="CH₄ 1.42 % (limit 1.25 %)",
                cause="Methane surge · heading power isolated per CMR Reg 169",
                worker="W3 TRAPPED · W17 within 35 m",
                sensors="CH₄ ↑ · CO ↑ · Temp ↑ · Vibration ↑",
                rover="STANDBY",
                score=96, level="CRITICAL",
                action="Heading power isolated. A* escape path to Shaft A. Restrict entry. Deploy rover.",
            )
            push_alert(
                "critical",
                "Worker W3 Marked TRAPPED — Escape Route Active",
                location="Anchor A3 · Node N3-1 · Zone 3",
                value="HR 108 bpm · SpO₂ 94 %",
                worker="W3 — Sunil Tudu",
                rover="STANDBY · armed for dispatch",
                score=96, level="CRITICAL",
                action="Dynamic A* route drawn. Cap-lamp strobe armed. Await rover confirmation.",
            )

        elif key == "lhd":
            enter_emergency("EM-003", "LHD-01 Runaway · 1:10 Incline")
            push_alert(
                "critical",
                "Heavy Vehicle Runaway — LHD-01",
                location="Anchor A2 · Node N2-1 · Zone 2",
                value="Speed 32 km/h · hydraulic 0 bar",
                cause="Hydraulic brake line failure on 1:10 slope",
                worker="All transport roadway personnel — clear immediately",
                sensors="Vibration ↑",
                rover="STANDBY",
                score=88, level="HIGH",
                action="SAHR spring-applied brake engaged (CMR Reg 91). Clear 60 m radius.",
            )

        elif key == "roof":
            enter_emergency("EM-004", "Roof Fracture · Zone 2 Geophone #9")
            push_alert(
                "critical",
                "Strata Collapse Warning — 0.78 g Shear Spike",
                location="Anchor A2 · Node N2-2 · Zone 2",
                value="0.78 g (baseline 0.04 g)",
                cause="High-frequency roof fracture detected",
                worker="Withdraw all personnel within 60 m",
                sensors="Vibration ↑ · Temp ↑",
                rover="STANDBY",
                score=91, level="CRITICAL",
                action="Enforce 60 m clearance. CMR Reg 137 evacuation order active.",
            )

        elif key == "p2v":
            # P2V is not a full emergency — just a critical CAS event
            push_alert(
                "critical",
                "P2V Collision Avoidance — LHD Transmission Clamped",
                location="Anchor A2 · Node N2-1 · Zone 2",
                value="Worker within 6 m blind zone · LHD 0 km/h",
                cause="Proximity Detection (CAS) interlock",
                worker="W1 — Manoj Mahato",
                sensors="UWB P2V distance 5.4 m",
                rover="STANDBY",
                score=84, level="HIGH",
                action="CAS hydraulic clamp enforced. DGMS Circular 06 / 2020 compliant.",
            )

        elif key == "mesh":
            STATE["scenario"] = "mesh"
            for k in ("co", "pm10", "aqi"):
                STATE["sensor_meta"][k]["stale"] = True
                STATE["sensor_meta"][k]["lastContact"] = int(time.time() * 1000) - 30000
            push_alert(
                "critical",
                "Communication Mesh Severed — Telemetry TIMEOUT",
                location="Zone 4 Trunk · Anchor A4",
                value="Nodes N4-1, N4-2, N4-3 → UNKNOWN",
                cause="Rockfall severed fiber trunk between A4 and A5",
                worker="Sensor states → UNKNOWN (fail-safe)",
                sensors="PM₁₀ · AQI · CO marked UNKNOWN",
                rover="DISPATCHED as wireless relay",
                score=82, level="HIGH",
                action="Rover dispatched to bridge mesh. Missing data NOT treated as SAFE.",
            )

        elif key == "buzzer":
            push_alert(
                "critical",
                "Cap-Lamp Strobe & 95 dB Buzzer Dispatched",
                location="Worker W3 Tag · Anchor A3 · Node N3-1",
                value="Bi-directional UWB downlink OK",
                cause="Manual evacuation signal from control room",
                worker="W3 — Sunil Tudu · strobe active",
                sensors="Collar tag downlink confirmed",
                rover="STANDBY",
                score=max(STATE["ai"]["score"], 90), level="CRITICAL",
                action="Strobe + audible buzzer active. Confirm visual acknowledgement via UWB telemetry.",
            )

        elif key == "rover":
            STATE["rover"]["status"] = "INSPECTING"
            STATE["rover"]["location"] = "Zone 3 · Longwall Heading"
            push_alert(
                "critical",
                "Autonomous Rescue Rover Deployed to Zone 3",
                location="Zone 3 · Longwall Heading",
                value="FLIR active · forward CH₄ sniffer",
                cause="Control-room dispatch for remote reconnaissance",
                worker="No humans in Zone 3 (perimeter enforced)",
                sensors="Rover: CH₄ sensor active · Thermal 46.5 °C",
                rover="INSPECTING · Zone 3",
                score=92, level="CRITICAL",
                action="Rover conducting remote recon. Await imagery before committing rescue team.",
            )

        elif key == "reset":
            reset_to_nominal()


# ─────────────── EMERGENCY MANAGEMENT ───────────────
def enter_emergency(eid, title):
    with STATE_LOCK:
        STATE["emergency"] = True
        STATE["emergency_id"] = eid
        STATE["emergency_start_ts"] = time.time()


def exit_emergency():
    with STATE_LOCK:
        STATE["emergency"] = False
        STATE["emergency_id"] = None
        STATE["emergency_start_ts"] = None


def reset_to_nominal():
    """Full reset to baseline + restore standard state."""
    with STATE_LOCK:
        STATE["scenario"] = None
        STATE["scenario_start_ts"] = None

        # Sensors → baselines
        for key in SENSOR_KEYS:
            base_def = BASELINES[key]
            STATE["sensors"][key] = base_def["value"]
            STATE["sensor_meta"][key]["stale"] = False
            STATE["sensor_meta"][key]["lastContact"] = int(time.time() * 1000)

        # Rover → home
        STATE["rover"].update({
            "status": "STANDBY",
            "location": "Surface Station",
            "battery": 100,
            "comms": "CONNECTED",
            "ch4": 0.22,
            "thermal": 34.0,
            "humidity": 72,
            "obstacle": "CLEAR",
            "lastUpdate": int(time.time() * 1000),
        })

        # Comms
        STATE["comms"].update({"state": "CONNECTED", "signal": 91, "latency": 42})

        # AI
        STATE["ai"].update({
            "score": 14, "level": "LOW",
            "gas": 20, "vent": 20, "strata": 20, "prox": 20,
            "recommendation": "Continue routine monitoring. All statutory parameters within CMR 2017 limits.",
        })

        exit_emergency()
        refresh_worker_status()
        _refresh_area_risk()

        push_alert(
            "info",
            "Statutory Nominal Baseline Restored",
            location="Whole Mine",
            value="CH₄ 0.22 % · Airflow 1.85 m/s · All systems green",
            cause="Manual reset by control-room operator",
            score=14, level="LOW",
            action="All CMR 2017 limits satisfied. Normal operations may resume.",
        )


# ─────────────── AUTO-TRIGGER THRESHOLDS ───────────────
def check_auto_trigger():
    """Called after each tick — raises alerts/emergency automatically."""
    with STATE_LOCK:
        if STATE["emergency"]:
            return

        ch4   = STATE["sensors"].get("ch4", 0.22)
        flame = STATE["sensors"].get("flame", 0.0)
        vib   = STATE["sensors"].get("vib", 0.04)

        # Static thresholds — only trigger if no manual scenario is active
        if STATE["scenario"] is None:
            if ch4 >= 2.0:
                start_scenario("ch4")
            elif flame >= 0.5:
                start_scenario("ch4")
            elif vib >= 3.0:
                start_scenario("roof")


# ─────────────── REFRESH AI AFTER TICK ───────────────
def refresh_ai():
    with STATE_LOCK:
        risk = compute_risk()
        STATE["ai"].update({
            "score": risk["score"],
            "level": risk["level"],
            "gas": risk["gas"],
            "vent": risk["vent"],
            "strata": risk["strata"],
            "prox": risk["prox"],
            "confidence": risk["confidence"],
            "recommendation": build_recommendation(risk),
        })
        refresh_worker_status()
        _refresh_area_risk()
        # ═══════════════════════════════════════════════════════════════════
# Part 5/5 · REST API routes, simulation thread, main entry
# ═══════════════════════════════════════════════════════════════════

# ─────────────── STATUS ───────────────
@app.route("/api/status")
def api_status():
    with STATE_LOCK:
        return jsonify({
            "systemStatus": "Operational",
            "emergency": STATE["emergency"],
            "emergencyId": STATE["emergency_id"],
            "scenario": STATE["scenario"],
            "serverTime": datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S IST"),
            "uptimeSeconds": int(time.time() - STATE["boot_ts"]),
        })


# ─────────────── SENSORS ───────────────
@app.route("/api/sensors")
def api_sensors():
    with STATE_LOCK:
        values = {}
        meta = {}
        for key in SENSOR_KEYS:
            m = STATE["sensor_meta"][key]
            stale = m.get("stale", False)
            v = STATE["sensors"][key]

            if stale and not isinstance(v, str):
                values[key] = None      # force UNKNOWN on frontend
            else:
                values[key] = v

            meta[key] = {
                "label": SENSOR_LABELS[key],
                "unit": BASELINES[key]["unit"],
                "location": SENSOR_LOCATIONS[key],
                "regulatory": SENSOR_REGS[key],
                "status": _sensor_status(key, v) if not stale else "unknown",
                "lastContact": m.get("lastContact"),
                "stale": stale,
            }
        return jsonify({"values": values, "meta": meta, "updatedAt": int(time.time() * 1000)})


# ─────────────── AI RISK ───────────────
@app.route("/api/ai-risk")
def api_ai_risk():
    with STATE_LOCK:
        return jsonify({
            **STATE["ai"],
            "explanation": xai_explanation(),
        })


# ─────────────── WORKERS ───────────────
@app.route("/api/workers")
def api_workers():
    with STATE_LOCK:
        workers = []
        for w in STATE["workers"]:
            w2 = dict(w)
            w2["anchorNode"] = f"{w['anchor']} · {w['node']}"
            w2["anchorNumber"] = w["anchor"]
            w2["nodeNumber"] = w["node"]
            workers.append(w2)
        return jsonify({"workers": workers, "total": len(workers)})


# ─────────────── ROVER ───────────────
@app.route("/api/rover")
def api_rover():
    with STATE_LOCK:
        return jsonify(dict(STATE["rover"]))


@app.route("/api/rover/start", methods=["POST"])
def api_rover_start():
    with STATE_LOCK:
        STATE["rover"]["status"] = "INSPECTING"
        STATE["rover"]["location"] = "Zone 3 · Longwall Heading"
        STATE["rover"]["lastUpdate"] = int(time.time() * 1000)
        push_alert(
            "warn",
            "Rescue Rover Dispatched to Zone 3",
            location="Zone 3 · Longwall Heading",
            value="Status: INSPECTING",
            cause="Manual dispatch from control room",
            rover="INSPECTING",
            action="Await rover telemetry before committing humans.",
        )
    return jsonify({"ok": True, "rover": STATE["rover"]})


@app.route("/api/rover/stop", methods=["POST"])
def api_rover_stop():
    with STATE_LOCK:
        STATE["rover"]["status"] = "STANDBY"
        STATE["rover"]["location"] = "Surface Station"
        STATE["rover"]["lastUpdate"] = int(time.time() * 1000)
        push_alert(
            "info",
            "Rover Recalled to Surface Station",
            value="Status: STANDBY",
            rover="STANDBY · Surface Station",
            action="Rover docked. Battery charging.",
        )
    return jsonify({"ok": True, "rover": STATE["rover"]})


# ─────────────── COMMUNICATION ───────────────
@app.route("/api/communication")
def api_communication():
    with STATE_LOCK:
        return jsonify(dict(STATE["comms"]))


# ─────────────── AREAS ───────────────
@app.route("/api/areas")
def api_areas():
    with STATE_LOCK:
        return jsonify({"areas": STATE["areas"]})


@app.route("/api/areas/<path:area_name>")
def api_area_detail(area_name):
    with STATE_LOCK:
        area = STATE["areas"].get(area_name)
        if not area:
            abort(404)

        # add worker list
        zone = area["zone"]
        workers = [
            {"id": w["id"], "name": w["name"], "status": w["status"], "anchorNode": f"{w['anchor']} · {w['node']}"}
            for w in STATE["workers"] if w["zone"] == zone
        ]
        detail = dict(area)
        detail["workers"] = workers
        detail["workerCount"] = len(workers)
        detail["lastUpdate"] = datetime.now(IST).strftime("%H:%M:%S")
        return jsonify(detail)


# ─────────────── ALERTS ───────────────
@app.route("/api/alerts")
def api_alerts():
    with STATE_LOCK:
        return jsonify({"alerts": STATE["alerts"], "count": len(STATE["alerts"])})


@app.route("/api/alerts/ack/<alert_id>", methods=["POST"])
def api_alert_ack(alert_id):
    ok = acknowledge_alert(alert_id)
    return jsonify({"ok": ok})


@app.route("/api/alerts/clear", methods=["POST"])
def api_alerts_clear():
    clear_alerts()
    return jsonify({"ok": True})


# ─────────────── EMERGENCY ───────────────
@app.route("/api/emergency")
def api_emergency_state():
    with STATE_LOCK:
        return jsonify({
            "active": STATE["emergency"],
            "id": STATE["emergency_id"],
            "startedAt": STATE["emergency_start_ts"],
            "scenario": STATE["scenario"],
        })


@app.route("/api/emergency/start", methods=["POST"])
def api_emergency_start():
    payload = request.get_json(silent=True) or {}
    scenario = payload.get("scenario", "ch4")
    start_scenario(scenario)
    return jsonify({"ok": True, "scenario": scenario})


@app.route("/api/emergency/stop", methods=["POST"])
def api_emergency_stop():
    reset_to_nominal()
    return jsonify({"ok": True})


# ─────────────── SCENARIOS (frontend trigger) ───────────────
@app.route("/api/scenario/<key>", methods=["POST"])
def api_scenario(key):
    valid = {"grid", "ch4", "lhd", "roof", "p2v", "mesh", "buzzer", "rover", "reset"}
    if key not in valid:
        return jsonify({"ok": False, "error": "unknown scenario"}), 400
    start_scenario(key)
    return jsonify({"ok": True, "scenario": key})


# ─────────────── VEHICLES ───────────────
@app.route("/api/vehicles")
def api_vehicles():
    with STATE_LOCK:
        # refresh from live rover state
        vehicles = []
        for v in STATE["vehicles"]:
            v2 = dict(v)
            if v["id"] == "ROV-01":
                v2["location"] = STATE["rover"]["location"]
                v2["speed"] = 0 if STATE["rover"]["status"] == "STANDBY" else 1
                v2["fuel"] = STATE["rover"]["battery"]
            if STATE["scenario"] == "p2v" and v["id"] == "LHD-01":
                v2["speed"] = 0
                v2["nearbyHazard"] = "P2V CLAMP"
            vehicles.append(v2)
        return jsonify({"vehicles": vehicles})


# ─────────────── WEATHER ───────────────
@app.route("/api/weather")
def api_weather():
    with STATE_LOCK:
        w = dict(STATE["weather"])
        w["mineWaterLevel"] = STATE["sensors"].get("water", 22)
        return jsonify(w)


# ─────────────── SENSOR HEALTH ───────────────
@app.route("/api/sensor-health")
def api_sensor_health():
    with STATE_LOCK:
        rows = []
        for key in SENSOR_KEYS:
            meta = STATE["sensor_meta"][key]
            stale = meta.get("stale", False)
            status = "unknown" if stale else _sensor_status(key, STATE["sensors"][key])
            rows.append({
                "key": key,
                "label": SENSOR_LABELS[key],
                "location": SENSOR_LOCATIONS[key],
                "reading": STATE["sensors"][key] if not stale else None,
                "status": status,
                "regulatory": SENSOR_REGS[key],
                "lastContact": meta.get("lastContact"),
            })
        return jsonify({"sensors": rows})


# ─────────────── SETTINGS ───────────────
@app.route("/api/settings", methods=["GET", "POST"])
def api_settings():
    with STATE_LOCK:
        if request.method == "POST":
            payload = request.get_json(silent=True) or {}
            for k, v in payload.items():
                if k in STATE["settings"]:
                    STATE["settings"][k] = v
        return jsonify(STATE["settings"])


# ─────────────── HEALTH ───────────────
@app.route("/api/health")
def api_health():
    with STATE_LOCK:
        return jsonify({
            "ok": True,
            "uptime": int(time.time() - STATE["boot_ts"]),
            "sensorsOnline": sum(1 for m in STATE["sensor_meta"].values() if not m.get("stale")),
            "sensorsTotal": len(SENSOR_KEYS),
            "workers": len(STATE["workers"]),
            "vehicles": len(STATE["vehicles"]),
            "emergency": STATE["emergency"],
            "aiScore": STATE["ai"]["score"],
            "aiLevel": STATE["ai"]["level"],
            "comms": STATE["comms"]["state"],
            "rover": STATE["rover"]["status"],
        })


# ─────────────── SIMULATION THREAD ───────────────
_sim_thread = None
_sim_running = False


def _sim_loop():
    global _sim_running
    while _sim_running:
        try:
            tick_simulation()
            refresh_ai()
            check_auto_trigger()
        except Exception as e:
            print(f"[sim] tick error: {e}")
        time.sleep(TICK_INTERVAL)


def start_simulation():
    global _sim_thread, _sim_running
    if _sim_running:
        return
    _sim_running = True
    _sim_thread = threading.Thread(target=_sim_loop, daemon=True, name="sim-tick")
    _sim_thread.start()
    print("[sim] simulation thread started")


# ─────────────── MAIN ───────────────
def main():
    print("═" * 68)
    print("  MINEGUARD AI · Subterranean Autonomous SCADA")
    print("  SIH26039 · Team LABELX · Jharia Seam XI · RL −480 m · BCCL")
    print("═" * 68)
    print(f"  Static files : {FRONTEND_DIR}")
    print(f"  Listening on : http://{HOST}:{PORT}")
    print(f"  Dashboard    : http://localhost:{PORT}/")
    print(f"  Health check : http://localhost:{PORT}/api/health")
    print("═" * 68)

    init_state()
    start_simulation()

    # log a boot entry
    push_timeline("MineGuard AI boot complete — SCADA online", "info")

    app.run(host=HOST, port=PORT, debug=False, use_reloader=False, threaded=True)


@app.route("/<path:filename>")
def serve_static_any(filename):
    if filename.startswith("api/"):
        abort(404)
    return send_from_directory(FRONTEND_DIR, filename)

if __name__ == "__main__":
    main()
