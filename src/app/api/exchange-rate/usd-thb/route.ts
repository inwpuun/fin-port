import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BotReferenceRateResponse = {
  result?: {
    data?: {
      data_detail?: Array<{ period?: string; rate?: string }> | { period?: string; rate?: string };
    };
  };
};

const botReferenceRateUrl = "https://gateway.api.bot.or.th/Stat-ReferenceRate/v2/DAILY_REF_RATE/";

export async function GET(request: NextRequest) {
  // Gated so an anonymous visitor cannot spend your Bank of Thailand quota.
  if (!(await isAuthorized(request))) return unauthorized();

  const apiKey = process.env.BOT_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing BOT_API_KEY. Add a Bank of Thailand API key to enable USD to THB conversion." },
      { status: 503 }
    );
  }

  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 14);

  const url = new URL(botReferenceRateUrl);
  url.searchParams.set("start_period", formatDate(startDate));
  url.searchParams.set("end_period", formatDate(endDate));

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        Authorization: apiKey
      },
      cache: "no-store"
    });

    const payload = (await response.json()) as BotReferenceRateResponse;

    if (!response.ok) {
      return NextResponse.json(
        { error: "Bank of Thailand exchange-rate API returned an error." },
        { status: response.status }
      );
    }

    const latestRate = getLatestRate(payload);

    if (!latestRate) {
      return NextResponse.json(
        { error: "Bank of Thailand exchange-rate API did not return a usable USD/THB rate." },
        { status: 502 }
      );
    }

    return NextResponse.json(
      {
        base: "USD",
        quote: "THB",
        rate: latestRate.rate,
        period: latestRate.period,
        source: "Bank of Thailand DAILY_REF_RATE"
      },
      {
        headers: {
          "cache-control": "no-store"
        }
      }
    );
  } catch {
    return NextResponse.json(
      { error: "Unable to fetch USD/THB exchange rate from Bank of Thailand." },
      { status: 502 }
    );
  }
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getLatestRate(payload: BotReferenceRateResponse) {
  const detail = payload.result?.data?.data_detail;
  const items = Array.isArray(detail) ? detail : detail ? [detail] : [];

  return items
    .map((item) => ({
      period: item.period || "",
      rate: Number(item.rate)
    }))
    .filter((item) => item.period && Number.isFinite(item.rate) && item.rate > 0)
    .sort((first, second) => second.period.localeCompare(first.period))[0];
}
