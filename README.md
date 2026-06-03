# Fin Port

Next.js financial watch dashboard for US stocks, gold, bitcoin, indices, and personal portfolio tracking.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Pages

- `/` market watch dashboard with TradingView-style chart, watchlist, price alerts, and drawdown-from-top alerts
- `/portfolio` holdings tracker seeded from `public/my-port.csv` with calculated buy price, quantity, live market value, total net worth, P/L, and drawdown flags
- `/watchlist` watchlist tracker with live prices, one-year moves, and drawdown flags
- `/allocation` allocation chart and category table based on `public/my-allocation.csv`

## Symbols

Examples:

- `AAPL`, `MSFT`, `NVDA` for US stocks
- `GC=F` or `GOLD` for gold futures
- `BTC-USD` or `BTC` for bitcoin
- `^GSPC`, `^IXIC`, `^DJI`, `^NDX` for indices

## Alerts

Load a symbol, enter a price threshold or a drawdown percentage from the previous top, choose the top window, and click `Arm alerts`.

Drawdown windows:

- 1 week
- 2 weeks
- 1 month
- 2 months
- 3 months
- 1 year

Browser notifications require enabling the notification toggle and approving the browser permission. They work while the app is open.

## Portfolio CSV

`public/my-port.csv` supports either `holding value` + `% profit`, or `quantity` + `cost basis` + `cost currency` for positions such as bitcoin bought in THB.

`public/my-watchlist.csv` stores one `symbol` per row for `/watchlist` and the market dashboard watchlist.

`public/my-allocation.csv` maps portfolio symbols into allocation categories and can include a `Cash` row with `cash value` + `cash currency`.

Portfolio, watchlist, and allocation pages can display USD values in THB using the Bank of Thailand USD/THB reference rate API. Set `BOT_API_KEY` in your environment before running the app.

## Docker

Build and run on Linux or macOS with Docker:

```bash
docker build -t fin-port .
docker run --rm -p 3000:3000 fin-port
```

Run with Docker Compose when you want portfolio/watchlist CSV edits to persist back to this project:

```bash
LOCAL_UID=$(id -u) LOCAL_GID=$(id -g) docker compose up -d --build
```

The Compose service bind-mounts `./public` to `/app/public`, so updates to `public/my-port.csv` and `public/my-watchlist.csv` from the app are written to the same files in this repo.
The mount is SELinux-labeled for Fedora/RHEL-style hosts, which avoids `EACCES` errors when the container scans `/app/public`.
The service uses Docker's `unless-stopped` restart policy, so it starts again after reboot as long as Docker itself starts on boot.

This machine also has a user systemd unit at `~/.config/systemd/user/fin-port.service` enabled to run `docker compose up -d --no-build` automatically.
