# Mine-Guard-AI
MineGuard AI — real-time SCADA dashboard for underground coal mine safety. 12 sensor channels, Explainable AI risk engine, 3D mine map with UWB worker tracking, A* escape routing, 9 emergency cascades with voice alerts, and DGMS Form IV-A statutory reports. Built for SIH26039. Offline-first, CMR 2017 compliant.
# ⛏️ MineGuard AI
**MineGuard AI** is a real-time SCADA dashboard designed for underground coal mine safety. It monitors 12 critical sensor channels to provide early warnings, ensure worker safety, and optimize operational efficiency.
## 🚀 Features
- **Real-Time Monitoring:** Live data visualization for 12 sensor channels (e.g., Methane, Carbon Monoxide, Temperature, Humidity, Airflow).
- **SCADA Dashboard:** Interactive and responsive UI for control room operators.
- **Alert System:** Instant notifications when sensor thresholds are breached.
- **Low-Latency Data Streaming:** Built with WebSockets/MQTT for real-time telemetry.
- **Historical Data Analysis:** Track trends and generate safety reports.
## 🛠️ Tech Stack
- **Backend:** Python (FastAPI / Flask), WebSockets, MQTT
- **Frontend:** React, TailwindCSS, Chart.js / Recharts
- **Database:** PostgreSQL / InfluxDB (Time-series data)
- **Deployment:** Render, Docker
- **IoT/Edge:** MQTT Broker (Mosquitto / EMQX)
## 📐 System Architecture
```text
[Sensors] --> [MQTT Broker] --> [Python Backend] --> [Database]
                                                      |
                                                      v
[Control Room Operator] <-- [Frontend Dashboard] <----+
