# F1 Telemetry Analysis Tool

A pit wall style dashboard for comparing Formula 1 drivers with real telemetry data from the OpenF1 API.

---

## Features

- Load real F1 sessions from 2023 onward
- Select Grand Prix, session, drivers, and lap
- Speed trace with DRS activation bands and gear shift markers overlaid
- Delta time chart showing exactly where one driver gains or loses time across the lap
- Speed heatmap on the track map so you can see braking zones and full throttle sections on the circuit layout
- Throttle and brake traces using each drivers own color at different opacities so comparisons are actually readable
- Corner and mini sector comparison table across both drivers
- Tyre stint breakdown and lap evolution chart
- Track temperature and session weather data
- Built in request throttling, retries, and 12 hour browser cache to handle OpenF1 rate limits

---

## Tech Stack

- HTML
- CSS
- Vanilla JavaScript
- [OpenF1 API](https://openf1.org/)

---

## Run Locally

Open `index.html` directly in a browser, or serve the folder with Python:

```bash
python -m http.server 5500
```

Then visit:

```
http://localhost:5500
```

---
<img width="763" height="902" alt="image" src="https://github.com/user-attachments/assets/62850b5a-9b13-41f3-8ab2-ab776b166601" />

## Notes

OpenF1 can return `429` errors when too many requests are sent too quickly. This app spaces requests out, retries rate limited calls automatically, and caches all responses in the browser for 12 hours so repeated loads are fast.

All telemetry data is sourced from [OpenF1](https://openf1.org/). No backend, no API key required.
