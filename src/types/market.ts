export type AssetType = "equity" | "crypto" | "commodity" | "index";
export type DrawdownRange = "1w" | "2w" | "1mo" | "2mo" | "3mo" | "1y";

export type Candle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type VolumePoint = {
  time: string;
  value: number;
  color: string;
};

export type MarketData = {
  symbol: string;
  name: string;
  type: AssetType;
  currency: string;
  exchange: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  rangeChange: number;
  previousTop: number;
  drawdownPercent: number;
  drawdownRange: DrawdownRange;
  drawdownLabel: string;
  candles: Candle[];
  volume: VolumePoint[];
  marketTime: string | null;
  source: string;
};
