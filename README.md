# F1 Telemetry Analysis Tool

A pit wall style dashboard for comparing Formula 1 drivers with real telemetry data from the OpenF1 API.

## Features

- Load real F1 sessions from 2023 onward
- Select Grand Prix, session, drivers, and lap
- Compare speed traces, throttle, brake, and mini-sector performance
- View driver location traces on a circuit-style canvas
- Inspect tyre stints, lap evolution, and track temperature
- Built-in request throttling, retries, and browser caching to reduce OpenF1 rate-limit errors

## Tech Stack

- HTML
- CSS
- Vanilla JavaScript
- OpenF1 API

## Run Locally

Open `index.html` directly in a browser, or serve the folder locally:

```bash
python -m http.server 5500
```

Then open:

```text
http://localhost:5500
```

## Notes

OpenF1 can return `429` when too many requests are sent quickly. This app spaces requests out, retries rate-limited calls, and caches responses in the browser for 12 hours.

Data source: [OpenF1](https://openf1.org/)
