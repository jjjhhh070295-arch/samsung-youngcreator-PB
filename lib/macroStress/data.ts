import { unstable_cache } from "next/cache";
import type { AssetId, FactorId, MonthlyRow } from "./types";
const UA = "Mozilla/5.0 macro-stress/2.0";
type Point = { month:string; value:number };
const START = "1989-01-01";
const TIMEOUT_MS = 12_000;
function monthFromUnix(unix:number){ return new Date(unix*1000).toISOString().slice(0,7); }
async function yahooMonthly(symbol:string):Promise<Point[]> {
  const p1=Math.floor(new Date(START).getTime()/1000),p2=Math.floor(Date.now()/1000);
  let lastError="request failed";
  for(const host of ["query1.finance.yahoo.com","query2.finance.yahoo.com"]){
    try{
      const url="https://"+host+"/v8/finance/chart/"+encodeURIComponent(symbol)+"?period1="+p1+"&period2="+p2+"&interval=1mo&events=history";
      const response=await fetch(url,{headers:{"user-agent":UA,accept:"application/json"},next:{revalidate:86400},signal:AbortSignal.timeout(TIMEOUT_MS)});
      if(!response.ok) throw new Error("HTTP "+response.status);
      const payload=await response.json(),result=payload?.chart?.result?.[0],timestamps:number[]=result?.timestamp??[],prices:number[]=result?.indicators?.adjclose?.[0]?.adjclose??result?.indicators?.quote?.[0]?.close??[];
      const points=timestamps.map((time,index)=>({month:monthFromUnix(time),value:Number(prices[index])})).filter(point=>Number.isFinite(point.value));
      if(!points.length) throw new Error("no values");
      return points;
    }catch(error){lastError=error instanceof Error?error.message:"request failed";}
  }
  throw new Error("Yahoo "+symbol+": "+lastError);
}
async function fredMonthly(id:string):Promise<Point[]> {
  const response=await fetch("https://fred.stlouisfed.org/graph/fredgraph.csv?id="+id+"&cosd="+START,{headers:{"user-agent":UA,accept:"text/csv"},next:{revalidate:86400},signal:AbortSignal.timeout(TIMEOUT_MS)});
  if(!response.ok) throw new Error("FRED "+id+": "+response.status);
  const byMonth=new Map<string,number>();
  for(const line of (await response.text()).trim().split(/\r?\n/).slice(1)){
    const [date,raw]=line.split(","),value=Number(raw);
    if(date&&Number.isFinite(value)) byMonth.set(date.slice(0,7),value);
  }
  return Array.from(byMonth,([month,value])=>({month,value}));
}
function map(points:Point[]){ return new Map(points.map(point=>[point.month,point.value])); }
function monthlyReturn(values:Map<string,number>,months:string[],index:number){ const before=values.get(months[index-1]),after=values.get(months[index]); return before&&after?after/before-1:NaN; }
async function loadMonthlyRowsUncached():Promise<{rows:MonthlyRow[];warnings:string[]; sources:Record<string,string>}> {
  const [sp500,kospi,fx,commodity,fed,us10y,cpi,vix]=await Promise.all([
    yahooMonthly("^GSPC"),yahooMonthly("^KS11"),fredMonthly("DEXKOUS"),fredMonthly("PPIACO"),fredMonthly("FEDFUNDS"),fredMonthly("DGS10"),fredMonthly("CPIAUCSL"),fredMonthly("VIXCLS"),
  ]);
  const maps={sp500:map(sp500),kospi:map(kospi),fx:map(fx),commodity:map(commodity),fed:map(fed),us10y:map(us10y),cpi:map(cpi),vix:map(vix)};
  const months=Array.from(new Set([sp500,kospi,fx,commodity,fed,us10y,cpi,vix].flatMap(series=>series.map(point=>point.month)))).sort();
  const rows:MonthlyRow[]=[];
  for(let index=12;index<months.length;index++){
    const current=months[index],previous=months[index-1],yearAgo=months[index-12];
    if(current<"1990-01") continue;
    const fedNow=maps.fed.get(current),fedBefore=maps.fed.get(previous),yieldNow=maps.us10y.get(current),yieldBefore=maps.us10y.get(previous),vixNow=maps.vix.get(current),vixBefore=maps.vix.get(previous),cpiNow=maps.cpi.get(current),cpiBefore=maps.cpi.get(yearAgo);
    const dYield=yieldNow!-yieldBefore!;
    const treasuryReturn=Number.isFinite(dYield)&&Number.isFinite(yieldBefore)?-8.5*(dYield/100)+(yieldBefore!/100/12):NaN;
    const assets={sp500:monthlyReturn(maps.sp500,months,index),kospi:monthlyReturn(maps.kospi,months,index),treasury:treasuryReturn} as Record<AssetId,number>;
    const factors={d_fed:fedNow!-fedBefore!,d_ust:dYield,ret_krw:monthlyReturn(maps.fx,months,index),infl:cpiNow!/cpiBefore!-1,ret_cmd:monthlyReturn(maps.commodity,months,index),d_vix:vixNow!-vixBefore!} as Record<FactorId,number>;
    if([assets.sp500,assets.treasury,...Object.values(factors)].every(Number.isFinite)) rows.push({month:current,assets,factors});
  }
  if(!rows.length) throw new Error("No common monthly observations after 1990 alignment.");
  return {rows,warnings:["US Treasury return is a duration-8.5 approximation from DGS10, not an ETF return.","Commodity factor uses FRED PPIACO to preserve 1990 history."],sources:{sp500:"Yahoo Finance ^GSPC adjusted close",kospi:"Yahoo Finance ^KS11 adjusted close",treasury:"FRED DGS10 duration 8.5 proxy",fed:"FRED FEDFUNDS",us10y:"FRED DGS10",usdkrw:"FRED DEXKOUS",cpi:"FRED CPIAUCSL YoY",commodity:"FRED PPIACO",vix:"FRED VIXCLS"}};
}

// Vercel 인스턴스가 바뀌어도 일별 정제 결과를 재사용해 첫 요청의 외부 호출을 줄인다.
export const loadMonthlyRows=unstable_cache(loadMonthlyRowsUncached,["macro-stress-monthly-v3"],{revalidate:86_400,tags:["macro-stress-monthly"]});
