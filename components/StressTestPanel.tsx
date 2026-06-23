"use client";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MacroFactorId, Portfolio, ScenarioShock } from "@/lib/types";
import type { MacroStressResponse } from "@/lib/macroStress/types";
import { FACTOR_IDS, FACTOR_META, PRESET_SCENARIOS, zeroShock } from "@/lib/stresstest";
import { EmptyView } from "./StateViews";
import type { PortfolioOption } from "@/lib/portfolio";
import { setToMacroApiParams } from "@/lib/assetMapping";

interface Props {
  portfolios: Portfolio[];
  investableKrw?: number;
  assetBaseEstimated?: boolean;
  /**
   * SET 6자산 비중 배열 (optional). 제공 시 convertSetToIndices를 통해
   * sp500/kospi/treasury를 자동 추출하여 macroStress API에 넘김.
   * 없으면 기존 Portfolio.allocations 텍스트 매칭 경로로 폴백.
   */
  portfolioWeights?: Array<PortfolioOption["weights"]>;
}
type MacroLevel = { value:number; asOf:string; source:string; fallback?:boolean };
type MacroLevels = Record<MacroFactorId, MacroLevel>;

const FALLBACK_MACRO_LEVELS: MacroLevels = {
  d_fed:{value:4.5,asOf:"fallback",source:"temporary",fallback:true},
  d_ust:{value:4.3,asOf:"fallback",source:"temporary",fallback:true},
  infl:{value:2.5,asOf:"fallback",source:"temporary",fallback:true},
  ret_krw:{value:1400,asOf:"fallback",source:"temporary",fallback:true},
  ret_cmd:{value:30,asOf:"fallback",source:"GSG",fallback:true},
  d_vix:{value:20,asOf:"fallback",source:"VIX",fallback:true},
};
const LABELS={us:"\uBBF8\uAD6D\uC8FC\uC2DD (S&P 500)",kr:"\uAD6D\uB0B4\uC8FC\uC2DD (KOSPI)",bond:"\uCC44\uAD8C (\uBBF8\uAD6D\uCC44 10\uB144\uBB3C)"} as const;

function normalizePortfolio(portfolio:Portfolio):Portfolio {
  const grouped=new Map<string,number>();
  for(const allocation of portfolio.allocations){
    const value=allocation.assetClass.replace(/\s/g,"").toLowerCase(); let label:string|null=null;
    if(value.includes("\uBBF8\uAD6D\uC8FC\uC2DD")||value.includes("\uD574\uC678\uC8FC\uC2DD")||value.includes("s&p500"))label=LABELS.us;
    else if(value.includes("\uAD6D\uB0B4\uC8FC\uC2DD")||value.includes("kospi"))label=LABELS.kr;
    else if(value.includes("\uCC44\uAD8C")||value.includes("\uBBF8\uAD6D\uCC4410\uB144"))label=LABELS.bond;
    if(label)grouped.set(label,(grouped.get(label)??0)+allocation.weight);
  }
  const total=Array.from(grouped.values()).reduce((sum,value)=>sum+value,0);
  return {...portfolio,allocations:Array.from(grouped,([assetClass,weight])=>({assetClass,weight:total?Math.round(weight/total*1000)/10:0}))};
}
function absoluteFromShock(id:MacroFactorId,base:number,shock:number){
  if(id==="ret_krw"||id==="ret_cmd")return base*(1+shock/100);
  if(id==="d_vix")return Math.max(.01,base+shock);
  return base+shock;
}
function shockFromAbsolute(id:MacroFactorId,base:number,value:number){
  if(id==="ret_krw"||id==="ret_cmd")return base?value/base*100-100:0;
  return value-base;
}
function displayValue(id:MacroFactorId,value:number){
  if(id==="ret_krw")return Math.round(value).toLocaleString("ko-KR")+"\uC6D0";
  if(id==="ret_cmd")return "$"+value.toFixed(2);
  if(id==="d_vix")return value.toFixed(2);
  return value.toFixed(2)+"%";
}
function displayShock(id:MacroFactorId,value:number){
  const unit=id==="d_vix"?"pt":id==="d_fed"||id==="d_ust"||id==="infl"?"%p":"%";
  return (value>=0?"+":"")+value.toFixed(2)+unit;
}
function formatKrw(value:number){
  const amount=Math.abs(value);
  if(amount>=100_000_000)return (amount/100_000_000).toLocaleString("ko-KR",{maximumFractionDigits:1})+"억원";
  if(amount>=10_000)return Math.round(amount/10_000).toLocaleString("ko-KR")+"만원";
  return Math.round(amount).toLocaleString("ko-KR")+"원";
}

export default function StressTestPanel({portfolios,portfolioWeights,investableKrw=0,assetBaseEstimated=false}:Props){
  const [shock,setShock]=useState<ScenarioShock>(zeroShock());
  const [presetId,setPresetId]=useState("none");
  const [scenarioOpen,setScenarioOpen]=useState(false);
  const [levels,setLevels]=useState<MacroLevels>(FALLBACK_MACRO_LEVELS);
  const [updatedAt,setUpdatedAt]=useState("");
  const [levelsLoading,setLevelsLoading]=useState(false);
  const [levelsRefreshKey,setLevelsRefreshKey]=useState(0);
  const [analysis,setAnalysis]=useState<MacroStressResponse|null>(null);
  const [analysisStatus,setAnalysisStatus]=useState<"idle"|"loading"|"error">("idle");
  const [analysisError,setAnalysisError]=useState("");
  const macroPortfolios=useMemo(()=>portfolios.map(normalizePortfolio).filter(p=>p.allocations.length>0),[portfolios]);
  const target=macroPortfolios[0];

  // SET 6자산 → macroStress 입력 자동 변환 (portfolioWeights 있을 때 우선 적용)
  const autoParams=useMemo(()=>portfolioWeights?.[0]?setToMacroApiParams(portfolioWeights[0]):null,[portfolioWeights]);

  // autoParams 있으면 SET 기반 비중, 없으면 기존 텍스트 매칭 폴백
  const targetWeights=autoParams
    ?{sp500:autoParams.us,kospi:autoParams.kr,treasury:autoParams.bond}
    :{sp500:(target?.allocations.find(item=>item.assetClass===LABELS.us)?.weight??0)/100,kospi:(target?.allocations.find(item=>item.assetClass===LABELS.kr)?.weight??0)/100,treasury:(target?.allocations.find(item=>item.assetClass===LABELS.bond)?.weight??0)/100};

  useEffect(()=>{
    let cancelled=false;
    const load=async()=>{setLevelsLoading(true);try{const response=await fetch("/api/macro-levels?refresh="+Date.now(),{cache:"no-store"});if(!response.ok)throw new Error();const payload=await response.json();if(cancelled)return;setLevels(previous=>{const next={...previous};for(const id of FACTOR_IDS){const level=payload?.levels?.[id];if(level&&Number.isFinite(level.value))next[id]={...level,fallback:Boolean(level.fallback)};}return next;});setUpdatedAt(payload?.updatedAt??new Date().toISOString());}catch{if(!cancelled)setUpdatedAt("");}finally{if(!cancelled)setLevelsLoading(false);}};
    load();const timer=window.setInterval(load,60*60*1000);return()=>{cancelled=true;window.clearInterval(timer)};
  },[levelsRefreshKey]);

  const requestKey=useMemo(()=>{
    // autoParams 있으면 SET 변환 비중 사용, 없으면 기존 텍스트 매칭
    if((!target&&!autoParams)||presetId==="none")return "";
    const usW=autoParams?autoParams.us:(target?.allocations.find(item=>item.assetClass===LABELS.us)?.weight??0)/100;
    const krW=autoParams?autoParams.kr:(target?.allocations.find(item=>item.assetClass===LABELS.kr)?.weight??0)/100;
    const bondW=autoParams?autoParams.bond:(target?.allocations.find(item=>item.assetClass===LABELS.bond)?.weight??0)/100;
    const query=new URLSearchParams({us:String(usW),kr:String(krW),bond:String(bondW),scenario:presetId});
    if(presetId==="custom"){
      query.set("d_fed",String(shock.d_fed));query.set("d_ust",String(shock.d_ust));query.set("ret_krw",String(shock.ret_krw/100));query.set("infl",String((levels.infl.value+shock.infl)/100));query.set("ret_cmd",String(shock.ret_cmd/100));query.set("d_vix",String(shock.d_vix));
    }
    return query.toString();
  },[target,autoParams,presetId,shock,levels.infl.value]);

  useEffect(()=>{
    if(!requestKey){setAnalysis(null);setAnalysisStatus("idle");setAnalysisError("");return;}
    const controller=new AbortController();
    const timer=window.setTimeout(async()=>{try{setAnalysisStatus("loading");setAnalysisError("");const response=await fetch("/api/macro-stress?"+requestKey,{signal:controller.signal,cache:"no-store"});const payload=await response.json();if(!response.ok)throw new Error(payload?.error??"Macro stress request failed");setAnalysis(payload as MacroStressResponse);setAnalysisStatus("idle");if(payload.scenario.dataStatus==="actual"){
      const center=payload.scenario.center,next={d_fed:center.d_fed,d_ust:center.d_ust,ret_krw:center.ret_krw*100,infl:center.infl*100-levels.infl.value,ret_cmd:center.ret_cmd*100,d_vix:center.d_vix};
      setShock(previous=>FACTOR_IDS.every(id=>Math.abs(previous[id]-next[id])<1e-8)?previous:next);
    }}catch(error){if((error as Error).name!=="AbortError"){setAnalysisStatus("error");setAnalysisError(error instanceof Error?error.message:"Unknown analysis error");}}},presetId==="custom"?700:0);
    return()=>{window.clearTimeout(timer);controller.abort();};
  },[requestKey,presetId,levels.infl.value]);

  // autoParams \uC5C6\uACE0 \uD14D\uC2A4\uD2B8 \uB9E4\uCE6D \uACB0\uACFC\uB3C4 \uC5C6\uC73C\uBA74 EmptyView
  if(!macroPortfolios.length&&!autoParams)return <EmptyView title={"\uD14C\uC2A4\uD2B8 \uAC00\uB2A5\uD55C \uC790\uC0B0\uC774 \uC5C6\uC2B5\uB2C8\uB2E4"} hint={"\uBBF8\uAD6D\uC8FC\uC2DD, \uAD6D\uB0B4\uC8FC\uC2DD, \uCC44\uAD8C\uC774 \uD3EC\uD568\uB41C \uD3EC\uD2B8\uD3F4\uB9AC\uC624\uB97C \uBA3C\uC800 \uC0DD\uC131\uD558\uC138\uC694."}/>;

  const applyPreset=(id:string)=>{setPresetId(id);setScenarioOpen(false);};
  const reset=()=>{setPresetId("none");setScenarioOpen(false);setShock(zeroShock())};
  const coverage=Math.max(0,Math.min(1,(autoParams?.equityBondPct??100)/100));
  const assetBase=Math.max(0,investableKrw);
  const scenarioWholeReturn=analysis?(analysis.scenario.actualReturn??analysis.scenario.metrics.meanReturn)*coverage:0;
  const scenarioAmount=assetBase*scenarioWholeReturn;
  const cvar95Loss=analysis?assetBase*Math.max(0,-analysis.scenario.metrics.cvar95*coverage):0;
  const worstLoss=analysis?assetBase*Math.max(0,-analysis.scenario.metrics.worstReturn*coverage):0;
  const excludedAmount=assetBase*(1-coverage);
  const exposureItems=[
    {key:"sp500",label:"미국주식",pct:targetWeights.sp500*coverage,color:"#1f4e79"},
    {key:"kospi",label:"국내주식",pct:targetWeights.kospi*coverage,color:"#d4a017"},
    {key:"treasury",label:"채권",pct:targetWeights.treasury*coverage,color:"#0f766e"},
    {key:"excluded",label:"분석 제외",pct:1-coverage,color:"#cbd5e1"},
  ].filter(item=>item.pct>.0001);

  return <div className="space-y-4">
    <div className="card p-4">
      <h3 className="text-sm font-semibold text-fg">{"\uB9E4\uD06C\uB85C \uC2A4\uD2B8\uB808\uC2A4 \uD14C\uC2A4\uD2B8 \uB300\uC0C1"}</h3>
      <p className="mt-1 text-xs leading-relaxed text-fg-muted">
        {target?.label}
        <span aria-hidden="true" className="mx-1.5 text-fg-muted/50">&middot;</span>
        S&P 500 {(targetWeights.sp500*100).toFixed(1)}%
        <span aria-hidden="true" className="mx-1.5 text-fg-muted/50">&middot;</span>
        KOSPI {(targetWeights.kospi*100).toFixed(1)}%
        <span aria-hidden="true" className="mx-1.5 text-fg-muted/50">&middot;</span>
        {"\uBBF8\uAD6D\uCC44"} {(targetWeights.treasury*100).toFixed(1)}%
        {autoParams&&autoParams.hedgePct>0&&(
          <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
            {"\uD5E4\uC9C0\uC790\uC0B0 "+autoParams.hedgePct.toFixed(1)+"% \uC81C\uC678 (\uAE08/\uB2EC\uB7EC/\uC6D0\uC790\uC7AC/MMF) \u2014 \uC704 \uBE44\uC911\uC740 \uC8FC\uC2DD+\uCC44\uAD8C \uC2AC\uB9AC\uBE0C \uAE30\uC900 \uC7AC\uC815\uADDC\uD654"}
          </span>
        )}
      </p>
    </div>
    <div className="card p-4">
      <div className="mb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="btn-ghost flex items-center gap-2 text-xs" aria-expanded={scenarioOpen} onClick={()=>setScenarioOpen(open=>!open)}>
            <span>{"\uC5ED\uC0AC\uC801 \uC704\uAE30 \uC2DC\uB098\uB9AC\uC624"}</span>
            {presetId!=="none"&&presetId!=="custom"&&<span className="font-semibold text-fg">{PRESET_SCENARIOS.find(item=>item.id===presetId)?.name}</span>}
            <span aria-hidden="true" className={"text-[10px] transition-transform "+(scenarioOpen?"rotate-180":"")}>&#9662;</span>
          </button>
          <div className="flex items-center gap-1">
            <button type="button" className="btn-ghost text-xs" onClick={reset}>{"\uCD08\uAE30\uD654"}</button>
            <button type="button" className="btn-outline text-xs" disabled={levelsLoading} onClick={()=>setLevelsRefreshKey(value=>value+1)}>
              {levelsLoading?"\uC2DC\uC7A5\uAC12 \uCD5C\uC2E0\uD654 \uC911...":"\uC2DC\uC7A5\uAC12 \uC0C8\uB85C\uACE0\uCE68"}
            </button>
          </div>
        </div>
        {scenarioOpen&&<div className="mt-2 flex flex-wrap gap-2 rounded-md border border-border/70 bg-surface-2 p-2">
          {PRESET_SCENARIOS.map(scenario=><button key={scenario.id} type="button" className={presetId===scenario.id?"btn-primary text-xs":"btn-ghost text-xs"} onClick={()=>applyPreset(scenario.id)}>{scenario.name}</button>)}
        </div>}
      </div>
      <div className="mb-4 rounded-md border border-border/70 bg-surface-2 px-3 py-2 text-[11px] text-fg-muted">
        {"\uAC00\uC6B4\uB370\uAC00 \uCD5C\uC2E0 \uC2DC\uC7A5\uAC12\uC785\uB2C8\uB2E4. \uC67C\uCABD\uC740 \uD604\uC7AC\uBCF4\uB2E4 \uD558\uB77D, \uC624\uB978\uCABD\uC740 \uC0C1\uC2B9\uC785\uB2C8\uB2E4."}
        {updatedAt&&<span className="ml-1">{"\uC870\uD68C \uC2DC\uAC01 "}{new Date(updatedAt).toLocaleString("ko-KR")}</span>}
      </div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
        {FACTOR_META.map(meta=>{
          const level=levels[meta.id],absolute=absoluteFromShock(meta.id,level.value,shock[meta.id]);
          const isVix=meta.id==="d_vix";
          const span=Math.max(Math.abs(meta.min),Math.abs(meta.max),presetId!=="custom"?Math.abs(shock[meta.id]):0);
          const range=isVix?{min:-1,max:1}:{min:meta.id==="ret_krw"||meta.id==="ret_cmd"?level.value*(1-span/100):level.value-span,max:meta.id==="ret_krw"||meta.id==="ret_cmd"?level.value*(1+span/100):level.value+span};
          const sliderValue=isVix?Math.max(-1,Math.min(1,Math.log(absolute/level.value)/Math.log(4))):absolute;
          const left=isVix?level.value/4:range.min,right=isVix?level.value*4:range.max;
          return <div key={meta.id}>
            <div className="mb-1 flex items-baseline justify-between"><label className="text-sm font-medium text-fg">{meta.label}<span className="ml-1 text-[11px] font-normal text-fg-muted">{meta.labelEn}</span></label><span className="text-sm font-semibold tabular-nums text-fg">{displayValue(meta.id,absolute)}<span className="ml-1 text-[10px] font-normal text-fg-muted">({displayShock(meta.id,shock[meta.id])})</span></span></div>
            <input type="range" min={range.min} max={range.max} step={isVix?.01:meta.id==="ret_krw"?1:meta.id==="ret_cmd"?.1:meta.step} value={sliderValue} onChange={event=>{const raw=Number(event.target.value),nextAbsolute=isVix?level.value*Math.pow(4,raw):raw;setShock(previous=>({...previous,[meta.id]:shockFromAbsolute(meta.id,level.value,nextAbsolute)}));setPresetId("custom")}} className="w-full accent-gold-500"/>
            <div className="mt-1 grid grid-cols-3 text-[10px] text-fg-muted/70"><span>{displayValue(meta.id,left)}</span><span className="text-center font-semibold text-fg-muted">{"\uD604\uC7AC "}{displayValue(meta.id,level.value)}</span><span className="text-right">{displayValue(meta.id,right)}</span></div>
            <p className="mt-1 text-[10px] text-fg-muted/70">{"\uAE30\uC900\uC77C "}{level.asOf}<span aria-hidden="true" className="mx-1 text-fg-muted/40">&middot;</span>{level.source}{level.fallback?<><span aria-hidden="true" className="mx-1 text-fg-muted/40">&middot;</span>fallback</>:null}</p>
            <p className="mt-1 text-[11px] leading-tight text-fg-muted">{meta.hint}</p>
          </div>})}
      </div>
    </div>
    {analysisStatus==="loading"&&<div className="card p-5 text-center text-sm text-fg-muted">{"\uC7A5\uAE30 \uB370\uC774\uD130\uB97C \uC900\uBE44\uD558\uACE0 50,000\uD68C \uBAAC\uD14C\uCE74\uB97C\uB85C\uB97C \uACC4\uC0B0\uD558\uB294 \uC911\uC785\uB2C8\uB2E4..."}</div>}
    {analysisStatus==="error"&&<div className="card border-red-300 p-4 text-sm text-red-600"><p>{"\uC7A5\uAE30 \uB370\uC774\uD130 \uBD84\uC11D\uC744 \uC644\uB8CC\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD558\uC138\uC694."}</p>{analysisError&&<p className="mt-1 text-xs text-red-500/80">{"\uC624\uB958: "}{analysisError}</p>}</div>}
    {analysis&&<div className="space-y-4">
      <div className="card overflow-hidden p-0">
        <div className="border-b border-border/70 px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-fg">포트폴리오 예상 손실 금액</h3>
              <p className="mt-1 text-[11px] text-fg-muted">
                투자가능자산 {formatKrw(assetBase)} 기준
                <span aria-hidden="true" className="mx-1.5 text-fg-muted/40">&middot;</span>
                분석 커버리지 {(coverage*100).toFixed(1)}%
              </p>
            </div>
            <span className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-fg-muted">
              {assetBaseEstimated?"등록 자산규모 기준":"부동산 제외 운용자산 기준"}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <div className="rounded-md border border-border/70 bg-surface-2 p-3">
              <p className="text-[10px] font-medium text-fg-muted">시나리오 예상 손익</p>
              <p className={"mt-1 text-lg font-bold tabular-nums "+(scenarioAmount<0?"text-red-600":"text-emerald-600")}>
                {formatKrw(scenarioAmount)} {scenarioAmount<0?"손실":"이익"}
              </p>
              <p className="mt-0.5 text-[10px] tabular-nums text-fg-muted">전체 기준 {(scenarioWholeReturn*100).toFixed(1)}%</p>
            </div>
            <div className="rounded-md border border-red-200/70 bg-red-50/50 p-3 dark:border-red-900/40 dark:bg-red-950/10">
              <p className="text-[10px] font-medium text-fg-muted">CVaR 95% 손실액</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-red-600">{formatKrw(cvar95Loss)}</p>
              <p className="mt-0.5 text-[10px] tabular-nums text-fg-muted">전체 기준 {(analysis.scenario.metrics.cvar95*coverage*100).toFixed(1)}%</p>
            </div>
            <div className="rounded-md border border-red-200/70 bg-red-50/50 p-3 dark:border-red-900/40 dark:bg-red-950/10">
              <p className="text-[10px] font-medium text-fg-muted">최악 경로 손실액</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-red-600">{formatKrw(worstLoss)}</p>
              <p className="mt-0.5 text-[10px] tabular-nums text-fg-muted">전체 기준 {(analysis.scenario.metrics.worstReturn*coverage*100).toFixed(1)}%</p>
            </div>
            <div className="rounded-md border border-border/70 bg-surface-2 p-3">
              <p className="text-[10px] font-medium text-fg-muted">이번 모델의 분석 제외 금액</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-fg">{formatKrw(excludedAmount)}</p>
              <p className="mt-0.5 text-[10px] text-fg-muted">금·달러·원자재·MMF 등</p>
            </div>
          </div>
        </div>
        <div className="px-4 py-4 sm:px-5">
          <div className="flex h-3 w-full overflow-hidden rounded-sm bg-surface-2">
            {exposureItems.map(item=><div key={item.key} style={{width:(item.pct*100)+"%",backgroundColor:item.color}} title={item.label+" "+(item.pct*100).toFixed(1)+"%"}/>)}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            {exposureItems.map(item=><div key={item.key} className="flex items-center gap-2 text-[11px]"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{backgroundColor:item.color}}/><span className="min-w-0 text-fg-muted">{item.label}</span><span className="ml-auto font-semibold tabular-nums text-fg">{formatKrw(assetBase*item.pct)}</span></div>)}
          </div>
          <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-[10px] leading-relaxed text-fg-muted">
            국내주식은 KOSPI, 미국주식은 S&amp;P 500, 채권은 미국채 대용 수익률로 추정합니다. 분석 제외 자산은 이번 금액 환산에서 수익률 0%로 두며, 이는 위험이 없다는 뜻이 아니라 현재 모델에서 손익을 추정하지 않았다는 뜻입니다.
          </p>
        </div>
      </div>
      <div className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><h3 className="text-sm font-semibold text-fg">{analysis.scenario.dataStatus==="actual"?"\uC2E4\uC81C \uC5ED\uC0AC \uC2DC\uB098\uB9AC\uC624 \uBD84\uC11D":"\uC0AC\uC6A9\uC790 \uC815\uC758 \uC2DC\uB098\uB9AC\uC624 \uBD84\uC11D"}</h3><p className="mt-1 text-xs text-fg-muted">{analysis.scenario.period}<span aria-hidden="true" className="mx-1 text-fg-muted/40">&middot;</span>{analysis.scenario.months}{"\uAC1C\uC6D4"}<span aria-hidden="true" className="mx-1 text-fg-muted/40">&middot;</span>{"\uD68C\uADC0 \uD45C\uBCF8 "}{analysis.sample.actualStart}~{analysis.sample.actualEnd} ({analysis.sample.months}{"\uAC1C\uC6D4"})</p></div>
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] text-fg-muted">50,000 paths</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          {analysis.scenario.actualReturn!=null&&<div className="rounded-md border border-border/70 p-3"><p className="text-[11px] text-fg-muted">{"\uC2E4\uC81C \uB204\uC801\uC218\uC775\uB960"}</p><p className="mt-1 font-semibold tabular-nums text-fg">{(analysis.scenario.actualReturn*100).toFixed(1)}%</p></div>}
          {analysis.scenario.actualMdd!=null&&<div className="rounded-md border border-border/70 p-3"><p className="text-[11px] text-fg-muted">{"\uC2E4\uC81C MDD"}</p><p className="mt-1 font-semibold tabular-nums text-red-500">{(analysis.scenario.actualMdd*100).toFixed(1)}%</p></div>}
          <div className="rounded-md border border-border/70 p-3"><p className="text-[11px] text-fg-muted">CVaR 95%</p><p className="mt-1 font-semibold tabular-nums text-red-500">{(analysis.scenario.metrics.cvar95*100).toFixed(1)}%</p></div>
          <div className="rounded-md border border-border/70 p-3"><p className="text-[11px] text-fg-muted">CVaR 99%</p><p className="mt-1 font-semibold tabular-nums text-red-500">{(analysis.scenario.metrics.cvar99*100).toFixed(1)}%</p></div>
          <div className="rounded-md border border-border/70 p-3"><p className="text-[11px] text-fg-muted">{"\uD3C9\uADE0 MDD"}</p><p className="mt-1 font-semibold tabular-nums text-red-500">{(analysis.scenario.metrics.meanMdd*100).toFixed(1)}%</p></div>
          <div className="rounded-md border border-border/70 p-3"><p className="text-[11px] text-fg-muted">{"\uCD5C\uC545 MDD"}</p><p className="mt-1 font-semibold tabular-nums text-red-500">{(analysis.scenario.metrics.worstMdd*100).toFixed(1)}%</p></div>
          <div className="rounded-md border border-border/70 p-3"><p className="text-[11px] text-fg-muted">{"\uC190\uC2E4 \uD655\uB960"}</p><p className="mt-1 font-semibold tabular-nums text-fg">{(analysis.scenario.metrics.lossProbability*100).toFixed(1)}%</p></div>
        </div>
        {autoParams&&autoParams.hedgePct>0&&<div className="mt-3 rounded-md border border-amber-200/70 bg-amber-50/60 p-3 dark:border-amber-800/30 dark:bg-amber-900/10">
          <p className="mb-1 text-[11px] font-semibold text-amber-800 dark:text-amber-300">{"\uD5E4\uC9C0\uC790\uC0B0 \uD3EC\uD568 \uC804\uCCB4 \uD3EC\uD2B8\uD3F4\uB9AC\uC624 \uD658\uC0B0"}</p>
          <p className="mb-2 text-[10px] text-fg-muted">{"\uC704 \uC218\uCE58\uB294 \uC8FC\uC2DD+\uCC44\uAD8C \uC2AC\uB9AC\uBE0C("}{autoParams.equityBondPct.toFixed(0)}{"%) \uAE30\uC900\uC785\uB2C8\uB2E4. \uD5E4\uC9C0\uC790\uC0B0 "}{autoParams.hedgePct.toFixed(0)}{"% \uC644\uCDA9 \uD6A8\uACFC\uB97C \uBC18\uC601\uD558\uBA74 \uC2E4\uC81C \uC190\uC2E4\uB294 \uB354 \uC791\uC2B5\uB2C8\uB2E4."}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-md bg-white/50 p-2 dark:bg-white/5"><p className="text-[10px] text-fg-muted">CVaR 95% (\uC804\uCCB4)</p><p className="mt-0.5 text-sm font-semibold tabular-nums text-red-500">{(analysis.scenario.metrics.cvar95*(autoParams.equityBondPct/100)*100).toFixed(1)}%</p><p className="text-[10px] text-fg-muted/70">{"\uC2AC\uB9AC\uBE0C: "}{(analysis.scenario.metrics.cvar95*100).toFixed(1)}%</p></div>
            <div className="rounded-md bg-white/50 p-2 dark:bg-white/5"><p className="text-[10px] text-fg-muted">CVaR 99% (\uC804\uCCB4)</p><p className="mt-0.5 text-sm font-semibold tabular-nums text-red-500">{(analysis.scenario.metrics.cvar99*(autoParams.equityBondPct/100)*100).toFixed(1)}%</p><p className="text-[10px] text-fg-muted/70">{"\uC2AC\uB9AC\uBE0C: "}{(analysis.scenario.metrics.cvar99*100).toFixed(1)}%</p></div>
            <div className="rounded-md bg-white/50 p-2 dark:bg-white/5"><p className="text-[10px] text-fg-muted">{"\uD3C9\uADE0 MDD (\uC804\uCCB4)"}</p><p className="mt-0.5 text-sm font-semibold tabular-nums text-red-500">{(analysis.scenario.metrics.meanMdd*(autoParams.equityBondPct/100)*100).toFixed(1)}%</p><p className="text-[10px] text-fg-muted/70">{"\uC2AC\uB9AC\uBE0C: "}{(analysis.scenario.metrics.meanMdd*100).toFixed(1)}%</p></div>
            <div className="rounded-md bg-white/50 p-2 dark:bg-white/5"><p className="text-[10px] text-fg-muted">{"\uCD5C\uC545 MDD (\uC804\uCCB4)"}</p><p className="mt-0.5 text-sm font-semibold tabular-nums text-red-500">{(analysis.scenario.metrics.worstMdd*(autoParams.equityBondPct/100)*100).toFixed(1)}%</p><p className="text-[10px] text-fg-muted/70">{"\uC2AC\uB9AC\uBE0C: "}{(analysis.scenario.metrics.worstMdd*100).toFixed(1)}%</p></div>
          </div>
        </div>}
      </div>
      {analysis.scenario.actualAssetMdd&&<div className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="text-sm font-semibold text-fg">{"\uC790\uC0B0\uBCC4 \uC2E4\uC81C MDD"}</h4><p className="mt-1 text-[11px] text-fg-muted">{"\uC120\uD0DD\uD55C \uC5ED\uC0AC \uC704\uAE30 \uAE30\uAC04\uC758 \uC6D4\uBCC4 \uC2E4\uC81C \uACBD\uB85C\uC5D0\uC11C \uACE0\uC810 \uB300\uBE44 \uCD5C\uB300 \uD558\uB77D\uD3ED\uC744 \uACC4\uC0B0\uD588\uC2B5\uB2C8\uB2E4."}</p></div><span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] text-fg-muted">{"\uC190\uC2E4\uD3ED \uAE30\uC900"}</span></div>
        <ResponsiveContainer width="100%" height={220}><BarChart layout="vertical" data={[{name:"S&P 500",loss:Math.abs(analysis.scenario.actualAssetMdd.sp500*100),color:"#1f4e79"},{name:"KOSPI",loss:Math.abs(analysis.scenario.actualAssetMdd.kospi*100),color:"#d4a017"},{name:"\uBBF8\uAD6D\uCC44",loss:Math.abs(analysis.scenario.actualAssetMdd.treasury*100),color:"#0f766e"}]} margin={{top:12,right:24,left:8,bottom:0}}><CartesianGrid strokeDasharray="3 3" opacity={.2}/><XAxis type="number" tickFormatter={value=>value+"%"} tick={{fontSize:10}}/><YAxis type="category" dataKey="name" width={72} tick={{fontSize:11}}/><Tooltip formatter={(value:number)=>["-"+value.toFixed(1)+"%","MDD"]}/><Bar dataKey="loss" radius={[0,4,4,0]}>{["#1f4e79","#d4a017","#0f766e"].map(color=><Cell key={color} fill={color}/>)}</Bar></BarChart></ResponsiveContainer>
      </div>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h4 className="text-sm font-semibold text-fg">{"\uC608\uC0C1 \uB099\uD3ED\uACFC \uADFC\uAC70"}</h4>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-md bg-surface-2 p-3"><p className="text-[11px] text-fg-muted">{"\uD3C9\uADE0 \uC608\uC0C1 MDD"}</p><p className="mt-1 text-xl font-semibold tabular-nums text-red-500">{(analysis.scenario.metrics.meanMdd*100).toFixed(1)}%</p></div>
            <div className="rounded-md bg-surface-2 p-3"><p className="text-[11px] text-fg-muted">{"\uBCF4\uC218\uC801 \uC608\uC0C1 MDD (\uD558\uC704 5%)"}</p><p className="mt-1 text-xl font-semibold tabular-nums text-red-500">{(analysis.scenario.metrics.mdd95*100).toFixed(1)}%</p></div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-fg-muted">{"\uC608\uC0C1 MDD\uB294 \uC120\uD0DD\uD55C \uC81C\uC548 \uD3EC\uD2B8\uD3F4\uB9AC\uC624 \uBE44\uC911\uC5D0 \uC704\uAE30 \uCDA9\uACA9\uC744 \uC911\uC2EC\uAC12\uC73C\uB85C \uB193\uACE0, 1990\uB144 \uC774\uD6C4 \uC6D4\uAC04 \uC694\uC778 \uACF5\uBD84\uC0B0\u00B7OLS \uBCA0\uD0C0\u00B7\uC794\uCC28 \uBCC0\uB3D9\uC744 \uBC18\uC601\uD55C 50,000\uAC1C \uACBD\uB85C\uC5D0\uC11C \uACC4\uC0B0\uD569\uB2C8\uB2E4."}</p>
          {analysis.scenario.actualMdd!=null&&<p className="mt-2 text-xs text-fg-muted">{"\uBE44\uAD50\uC6A9 \uC2E4\uC81C \uC704\uAE30 MDD: "}<span className="font-semibold text-fg">{(analysis.scenario.actualMdd*100).toFixed(1)}%</span></p>}
        </div>
        <div className="card p-4">
          <h4 className="text-sm font-semibold text-fg">{"\uB9AC\uBC38\uB7F0\uC2F1 \uC81C\uC548\uACFC \uADFC\uAC70"}</h4>
          <div className="mt-3 space-y-2 text-xs">
            {([{key:"sp500",label:"S&P 500"},{key:"kospi",label:"KOSPI"},{key:"treasury",label:"\uBBF8\uAD6D\uCC44"}] as const).map(item=>{const before=targetWeights[item.key],after=analysis.scenario.proposedWeights[item.key],delta=(after-before)*100;return <div key={item.key} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-border/50 pb-2"><span className="text-fg">{item.label}</span><span className="tabular-nums text-fg-muted">{(before*100).toFixed(0)}% {"\u2192"} {(after*100).toFixed(0)}%</span><span className={delta>0?"text-emerald-600":delta<0?"text-red-500":"text-fg-muted"}>{delta>0?"+":""}{delta.toFixed(0)}%p</span></div>})}
          </div>
          <div className="mt-3 rounded-md bg-surface-2 p-3 text-xs leading-relaxed text-fg-muted"><p>CVaR 95% {(analysis.scenario.metrics.cvar95*100).toFixed(1)}% {"\u2192"} {(analysis.scenario.proposedMetrics.cvar95*100).toFixed(1)}%</p><p className="mt-1">{"\uD3C9\uADE0 MDD "}{(analysis.scenario.metrics.meanMdd*100).toFixed(1)}% {"\u2192"} {(analysis.scenario.proposedMetrics.meanMdd*100).toFixed(1)}%</p></div>
          <p className="mt-3 text-xs leading-relaxed text-fg-muted">{"\uC81C\uC548\uC548\uC740 5%p \uB2E8\uC704 \uBE44\uC911 \uD6C4\uBCF4 \uC911 \uAC01 \uC790\uC0B0\uC758 \uBCC0\uACBD\uD3ED\uC744 \uD604\uC7AC \uB300\uBE44 \uCD5C\uB300 20%p\uB85C \uC81C\uD55C\uD558\uACE0, CVaR\u00B7\uD3C9\uADE0 MDD \uAC1C\uC120\uACFC \uB9E4\uB9E4\uD68C\uC804\uC744 \uD568\uAED8 \uD3C9\uAC00\uD55C \uACB0\uACFC\uC785\uB2C8\uB2E4."}</p>
        </div>
        <div className="card p-4 lg:col-span-2"><h4 className="text-sm font-semibold text-fg">{analysis.scenario.dataStatus==="actual"?"\uC704\uAE30 \uAE30\uAC04 \uC2E4\uCE21 \uB9E4\uD06C\uB85C \uCDA9\uACA9":"\uC0AC\uC6A9\uC790 \uC124\uC815 \uCDA9\uACA9"}</h4><div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-3">{FACTOR_META.map(meta=>{const raw=analysis.scenario.center[meta.id],value=meta.id==="ret_krw"||meta.id==="ret_cmd"||meta.id==="infl"?raw*100:raw;return <div key={meta.id} className="flex justify-between border-b border-border/50 pb-1 text-xs"><span className="text-fg-muted">{meta.label}</span><span className="font-medium tabular-nums text-fg">{value>=0?"+":""}{value.toFixed(2)}{meta.id==="d_vix"?"pt":meta.id==="ret_krw"||meta.id==="ret_cmd"||meta.id==="infl"?"%":"%p"}</span></div>})}</div></div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-4 lg:col-span-2">
          <h4 className="text-sm font-semibold text-fg">{"\uBAAC\uD14C\uCE74\uB97C\uB85C \uD3EC\uD2B8\uD3F4\uB9AC\uC624 \uC218\uC775\uB960 \uBD84\uD3EC"}</h4>
          <p className="mt-1 text-[11px] text-fg-muted">{"\uC591\uB05D 1% \uACBD\uB85C\uB294 \uAC00\uC7A5\uC790\uB9AC \uAD6C\uAC04\uC5D0 \uD3EC\uD568\uD574 tail risk\uB97C \uBCF4\uC5EC\uC90D\uB2C8\uB2E4."}</p>
          <p className="mt-2 rounded-md bg-surface-2 p-2 text-[11px] leading-relaxed text-fg-muted">{"\uD3C9\uC0C1\uC2DC \uBCC0\uB3D9\uC131\uACFC \uC704\uAE30 \uC2DC\uB098\uB9AC\uC624\uC758 MDD\u00B7VaR\u00B7CVaR\uB294 \uCE21\uC815 \uB300\uC0C1\uC774 \uB2E4\uB978 \uC704\uD5D8 \uC9C0\uD45C\uC774\uBBC0\uB85C \uAC12\uC774 \uB2E4\uB974\uAC8C \uB098\uC624\uB294 \uAC83\uC774 \uC815\uC0C1\uC785\uB2C8\uB2E4."}</p>
          <ResponsiveContainer width="100%" height={240}><BarChart data={analysis.scenario.histogram.map(item=>({return:+(item.mid*100).toFixed(1),count:item.count}))} margin={{top:12,right:12,left:0,bottom:0}}><CartesianGrid strokeDasharray="3 3" opacity={.2}/><XAxis dataKey="return" tickFormatter={value=>value+"%"} tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip formatter={(value:number)=>[value.toLocaleString()+"\uAC1C","\uACBD\uB85C \uC218"]} labelFormatter={value=>"\uC218\uC775\uB960 "+value+"%"}/><Bar dataKey="count" fill="#1f4e79" radius={[3,3,0,0]}/></BarChart></ResponsiveContainer>
        </div>
        <div className="card p-4">
          <h4 className="text-sm font-semibold text-fg">{"\uD604\uC7AC \uB300\uBE44 \uB9AC\uBC38\uB7F0\uC2F1 \uC704\uD5D8 \uBE44\uAD50"}</h4>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold"><span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-red-700"><span aria-hidden="true" className="h-2 w-2 rounded-sm bg-red-600"/>{"\uD604\uC7AC \uD3EC\uD2B8\uD3F4\uB9AC\uC624"}</span><span className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-teal-700"><span aria-hidden="true" className="h-2 w-2 rounded-sm bg-teal-700"/>{"\uB9AC\uBC38\uB7F0\uC2F1 \uC81C\uC548"}</span></div>
          <ResponsiveContainer width="100%" height={230}><BarChart data={[{name:"\uD3C9\uADE0 MDD",current:Math.abs(analysis.scenario.metrics.meanMdd*100),proposed:Math.abs(analysis.scenario.proposedMetrics.meanMdd*100)},{name:"CVaR 95%",current:Math.abs(analysis.scenario.metrics.cvar95*100),proposed:Math.abs(analysis.scenario.proposedMetrics.cvar95*100)},{name:"CVaR 99%",current:Math.abs(analysis.scenario.metrics.cvar99*100),proposed:Math.abs(analysis.scenario.proposedMetrics.cvar99*100)}]} margin={{top:18,right:8,left:0,bottom:0}}><CartesianGrid strokeDasharray="3 3" opacity={.2}/><XAxis dataKey="name" tick={{fontSize:11,fontWeight:600,fill:"currentColor"}}/><YAxis tickFormatter={value=>value+"%"} tick={{fontSize:10,fill:"currentColor"}}/><Tooltip contentStyle={{borderRadius:8,fontSize:12}} formatter={(value:number)=>[value.toFixed(1)+"%"]}/><Bar dataKey="current" fill="#dc2626" radius={[3,3,0,0]}/><Bar dataKey="proposed" fill="#0f766e" radius={[3,3,0,0]}/></BarChart></ResponsiveContainer>
        </div>
        <div className="card p-4">
          <h4 className="text-sm font-semibold text-fg">{"\uC2E4\uC81C\uAC12\uACFC \uD68C\uADC0 \uC608\uCE21 \uBE44\uAD50"}</h4>
          {analysis.scenario.actualReturn!=null&&analysis.scenario.predictedReturn!=null?<><div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold"><span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-blue-800"><span aria-hidden="true" className="h-2 w-2 rounded-sm bg-[#1f4e79]"/>{"\uC2E4\uC81C \uC218\uC775\uB960"}</span><span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-800"><span aria-hidden="true" className="h-2 w-2 rounded-sm bg-[#d4a017]"/>{"\uD68C\uADC0 \uC608\uCE21"}</span></div><ResponsiveContainer width="100%" height={230}><BarChart data={[{name:"\uC704\uAE30 \uB204\uC801\uC218\uC775\uB960",actual:analysis.scenario.actualReturn*100,predicted:analysis.scenario.predictedReturn*100}]} margin={{top:18,right:8,left:0,bottom:0}}><CartesianGrid strokeDasharray="3 3" opacity={.2}/><XAxis dataKey="name" tick={{fontSize:11,fontWeight:600,fill:"currentColor"}}/><YAxis tickFormatter={value=>value+"%"} tick={{fontSize:10,fill:"currentColor"}}/><Tooltip contentStyle={{borderRadius:8,fontSize:12}} formatter={(value:number)=>[value.toFixed(1)+"%"]}/><Bar dataKey="actual" fill="#1f4e79" radius={[3,3,0,0]}/><Bar dataKey="predicted" fill="#d4a017" radius={[3,3,0,0]}/></BarChart></ResponsiveContainer></>:<div className="flex h-[230px] items-center justify-center text-xs text-fg-muted">{"\uC0AC\uC6A9\uC790 \uC815\uC758 \uC2DC\uB098\uB9AC\uC624\uB294 \uC2E4\uC81C \uBE44\uAD50\uAC12\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."}</div>}
        </div>
      </div>
      <details className="card p-4"><summary className="cursor-pointer text-sm font-semibold text-fg">{"\uD68C\uADC0 \uC2E0\uB8B0\uB3C4\u00B7\uB370\uC774\uD130 \uADFC\uAC70"}</summary><div className="mt-3 overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-border text-fg-muted"><th className="px-2 py-1 text-left">{"\uC790\uC0B0"}</th><th className="px-2 py-1 text-right">R\u00B2</th><th className="px-2 py-1 text-right">{"\uC794\uCC28 \uD45C\uC900\uD3B8\uCC28"}</th><th className="px-2 py-1 text-right">p&lt;0.05 {"\uC694\uC778 \uC218"}</th></tr></thead><tbody>{analysis.models.map(model=><tr key={model.asset} className="border-b border-border/50"><td className="px-2 py-1">{model.asset}<span className="ml-1 text-[10px] text-fg-muted">{model.sampleStart}~{model.sampleEnd}, n={model.observations}</span></td><td className="px-2 py-1 text-right">{model.r2.toFixed(3)}</td><td className="px-2 py-1 text-right">{(model.residualStd*100).toFixed(2)}%</td><td className="px-2 py-1 text-right">{Object.values(model.pValues).filter(value=>value<.05).length}/6</td></tr>)}</tbody></table></div><div className="mt-3 space-y-1 text-[11px] text-fg-muted">{Object.entries(analysis.sources).map(([key,value])=><p key={key}>{key}: {value}</p>)}{analysis.warnings.map(warning=><p key={warning} className="text-amber-600">{warning}</p>)}</div></details>
    </div>}
  </div>;
}
