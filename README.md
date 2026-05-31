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
- `/portfolio` holdings tracker with buy price, quantity, live market value, total net worth, P/L, and drawdown flags

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

## Docker

Build and run on Linux or macOS with Docker:

```bash
docker build -t fin-port .
docker run --rm -p 3000:3000 fin-port
```
