'use client';

import React, { useState, useEffect } from 'react';
import {
mockClientSummary,
mockMacroReport,
mockPortfolioOptions,
mockAssetSuitability,
calculateSimulatedMetrics,
PortfolioOption
} from '@/lib/portfolio';
import type { Portfolio } from '@/lib/types';

interface PortfolioPanelProps {
pbId: string;
clientId: string;
// 현재 PB가 선택·편집 중인 포트폴리오를 상위로 보고 (최종 확정 저장용)
onSelectionChange?: (portfolio: Portfolio) => void;
}

// 패널 내부 자산키 → 스트레스 엔진이 인식하는 자산군 (국내주식/해외주식/채권/대체투자/현금)
// (lib/sensitivities.ts 의 ASSET_SENSITIVITIES 라벨과 매칭되도록 합산)
const STRESS_ASSET_MAP: Record<string, string> = {
etf: '해외주식', // ETF(지수·테마) → 주식
bond: '채권',
els: '대체투자', // 지수연계증권 → 대체
mmf: '현금',
gold: '대체투자', // 금 → 대체(Gold)
dollar: '현금', // 달러 예치 → 현금성
raw: '대체투자', // 원자재 → 대체
};

export default function PortfolioPanel({ pbId, clientId, onSelectionChange }: PortfolioPanelProps) {
const [selectedBase, setSelectedBase] = useState<'stable' | 'balanced' | 'growth'>('balanced');
const [weights, setWeights] = useState<PortfolioOption['weights']>(mockPortfolioOptions[1].weights);
const [elsIncluded, setElsIncluded] = useState(true);
const [liquidityAmount, setLiquidityAmount] = useState(5000);
const [isSuitabilityOpen, setIsSuitabilityOpen] = useState(false);

const [metrics, setMetrics] = useState({
expectedReturn: 6.8,
volatility: 5.4,
mdd: -6.2,
taxReturn: 6.1
});

const handleBaseChange = (type: 'stable' | 'balanced' | 'growth') => {
setSelectedBase(type);
const target = mockPortfolioOptions.find(p => p.id === type);
if (target) {
setWeights({ ...target.weights });
setElsIncluded(target.weights.els > 0);
}
};

const handleWeightChange = (asset: keyof PortfolioOption['weights'], value: number) => {
const sanitizedValue = Math.max(0, isNaN(value) ? 0 : value);
setWeights(prev => ({
...prev,
[asset]: sanitizedValue
}));
};

useEffect(() => {
const adjustedWeights = { ...weights };
if (!elsIncluded) adjustedWeights.els = 0;
const nextMetrics = calculateSimulatedMetrics(adjustedWeights);
setMetrics(nextMetrics);
}, [weights, elsIncluded]);

// 현재 선택·편집 중인 포트폴리오를 상위로 보고 (최종 확정 저장용)
useEffect(() => {
if (!onSelectionChange) return;
const adjustedWeights = { ...weights };
if (!elsIncluded) adjustedWeights.els = 0;
const name = mockPortfolioOptions.find(p => p.id === selectedBase)?.name || selectedBase;
// 스트레스 엔진 자산군으로 매핑·합산 (ETF→해외주식, 금/ELS/원자재→대체투자, MMF/달러→현금 등)
const agg: Record<string, number> = {};
for (const [k, v] of Object.entries(adjustedWeights)) {
const w = v as number;
if (w <= 0) continue;
const cls = STRESS_ASSET_MAP[k] || k;
agg[cls] = (agg[cls] || 0) + w;
}
const allocations = Object.entries(agg).map(([assetClass, weight]) => ({
assetClass,
weight: Math.round(weight * 10) / 10,
}));
const portfolio: Portfolio = {
id: selectedBase,
label: name,
allocations,
expectedReturn: metrics.expectedReturn,
expectedRisk: metrics.volatility,
taxNote: `세후 예상수익률 ${metrics.taxReturn}%`,
rationale: `${name} 기반 PB 조정안`,
editedByPb: true,
};
onSelectionChange(portfolio);
}, [selectedBase, weights, elsIncluded, metrics, onSelectionChange]);

const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0) - (elsIncluded ? 0 : weights.els);
const weightDiff = 100 - totalWeight;

const getStatusClass = (status: string) => {
switch (status) {
case '적합': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
case '주의': return 'bg-amber-50 text-amber-700 border-amber-200';
case '비추천': return 'bg-rose-50 text-rose-700 border-rose-200';
default: return 'bg-gray-50 text-gray-700 border-gray-200';
}
};

const currentPortfolioName = mockPortfolioOptions.find(p => p.id === selectedBase)?.name || '';

return (

  <div className="space-y-8 p-6 bg-gray-50 min-h-screen text-gray-900">
  {/* 0. 최상단 PB 헤더 */}
  <div className="flex justify-between items-center bg-slate-900 text-white p-5 rounded-2xl shadow-sm">
    <div>
      <span className="text-xs font-bold text-blue-400 tracking-wider uppercase">SAMSUNG SECURITIES Young Creator PB Center</span>
      <h1 className="text-xl font-bold tracking-tight mt-0.5">VIP 맞춤형 자산배분 제안 시스템</h1>
    </div>
    <div className="flex items-center space-x-4 text-xs text-slate-400">
      <div className="bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700">
        <span className="text-slate-500 font-medium mr-1.5">PB:</span>
        <span className="text-slate-200 font-semibold">{pbId}</span>
      </div>
      <div className="bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700">
        <span className="text-slate-500 font-medium mr-1.5">고객:</span>
        <span className="text-slate-200 font-semibold">{clientId}</span>
      </div>
    </div>
  </div>

  {/* 1. 핵심 결론 카드 & 고객 요약 태그 영역 */}
  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
    <div className="p-6 bg-gradient-to-br from-slate-900 via-slate-800 to-blue-950 text-white">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-slate-700/60 pb-4 mb-4 gap-4">
        <div>
          <span className="bg-blue-600 text-[11px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider text-white">RECOMMENDED CONCLUSION</span>
          <h2 className="text-2xl font-black text-white mt-2">{currentPortfolioName} 조율안</h2>
          <p className="text-sm text-slate-300 mt-1.5 leading-relaxed max-w-3xl">
            하반기 글로벌 금리 인하 기대감과 매크로 변동성을 방어하기 위해 설계된 최적 자산배분 모델입니다. 
            고객님의 적극투자형 성향을 반영한 핵심 ETF 자산 성장 동력과 더불어, 요청하신 단기 스타트업 출자를 위한 유동성 계좌 격리 배치가 완벽하게 설계되었습니다.
          </p>
        </div>
        
        {/* 2. 고객 요약 태그 */}
        <div className="flex flex-wrap gap-1.5 md:max-w-xs justify-start md:justify-end">
          <span className="text-[11px] bg-slate-800 text-slate-200 border border-slate-700 px-2 py-1 rounded-md font-medium">#{mockClientSummary.clientType}</span>
          <span className="text-[11px] bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2 py-1 rounded-md font-bold">#{mockClientSummary.riskPropensity.split(' ')[0]}</span>
          <span className="text-[11px] bg-slate-800 text-slate-200 border border-slate-700 px-2 py-1 rounded-md font-medium">#{mockClientSummary.investmentPeriod}</span>
          <span className="text-[11px] bg-slate-800 text-slate-200 border border-slate-700 px-2 py-1 rounded-md font-medium">#유동성:{mockClientSummary.liquidityNeed}</span>
          <span className="text-[11px] bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2 py-1 rounded-md font-bold">#절세필수</span>
        </div>
      </div>

      {/* KPI 4개 스코어보드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
        <div className="bg-slate-800/40 border border-slate-700/50 p-4 rounded-xl text-center">
          <span className="text-xs text-slate-400 font-medium block">최적화 기대수익률</span>
          <span className="text-2xl font-black text-emerald-400 mt-1 block">{metrics.expectedReturn}%</span>
        </div>
        <div className="bg-slate-800/40 border border-slate-700/50 p-4 rounded-xl text-center">
          <span className="text-xs text-slate-400 font-medium block">세후 가상수익률</span>
          <span className="text-2xl font-black text-blue-400 mt-1 block">{metrics.taxReturn}%</span>
        </div>
        <div className="bg-slate-800/40 border border-slate-700/50 p-4 rounded-xl text-center">
          <span className="text-xs text-slate-400 font-medium block">포트폴리오 변동성</span>
          <span className="text-2xl font-black text-slate-200 mt-1 block">{metrics.volatility}%</span>
        </div>
        <div className="bg-slate-800/40 border border-slate-700/50 p-4 rounded-xl text-center">
          <span className="text-xs text-slate-400 font-medium block">시뮬레이션 MDD</span>
          <span className="text-2xl font-black text-rose-400 mt-1 block">{metrics.mdd}%</span>
        </div>
      </div>
    </div>
  </div>

  {/* 3. 중간 영역: 2열 구성 (왼쪽: 비중 바 시각화 / 오른쪽: 매크로 요약) */}
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
    
    {/* 왼쪽: 현재 선택 자산배분 비중 바 시각화 */}
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between">
      <div>
        <div className="flex items-center space-x-2 pb-3 border-b border-slate-100 mb-4">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-600"></span>
          <h3 className="font-bold text-base text-slate-800">현재 포트폴리오 자산 비중 프리뷰</h3>
        </div>
        
        <div className="space-y-3.5 pt-1">
          {/* 주식/ETF */}
          <div>
            <div className="flex justify-between text-xs font-semibold text-slate-600 mb-1">
              <span>주식 / ETF</span>
              <span>{weights.etf}%</span>
            </div>
            <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
              <div className="bg-blue-600 h-full rounded-full transition-all" style={{ width: `${weights.etf}%` }}></div>
            </div>
          </div>

          {/* 채권 */}
          <div>
            <div className="flex justify-between text-xs font-semibold text-slate-600 mb-1">
              <span>고정금리형 채권</span>
              <span>{weights.bond}%</span>
            </div>
            <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
              <div className="bg-sky-500 h-full rounded-full transition-all" style={{ width: `${weights.bond}%` }}></div>
            </div>
          </div>

          {/* MMF/RP (유동성) */}
          <div>
            <div className="flex justify-between text-xs font-semibold text-slate-600 mb-1">
              <span>단기 유동성 (MMF/RP)</span>
              <span>{weights.mmf}%</span>
            </div>
            <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
              <div className="bg-indigo-600 h-full rounded-full transition-all" style={{ width: `${weights.mmf}%` }}></div>
            </div>
          </div>

          {/* ELS */}
          {elsIncluded && (
            <div>
              <div className="flex justify-between text-xs font-semibold text-slate-600 mb-1">
                <span>구조화 자산 (ELS/ELB)</span>
                <span>{weights.els}%</span>
              </div>
              <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                <div className="bg-amber-500 h-full rounded-full transition-all" style={{ width: `${weights.els}%` }}></div>
              </div>
            </div>
          )}

          {/* 대안자산 (달러 + 금) */}
          <div>
            <div className="flex justify-between text-xs font-semibold text-slate-600 mb-1">
              <span>안전 대안자산 (달러 및 금 실물)</span>
              <span>{weights.dollar + weights.gold}%</span>
            </div>
            <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
              <div className="bg-slate-600 h-full rounded-full transition-all" style={{ width: `${weights.dollar + weights.gold}%` }}></div>
            </div>
          </div>
        </div>
      </div>

      <div className="text-[11px] text-slate-400 bg-slate-50 p-2.5 rounded-xl border border-slate-100 mt-4 text-center">
        실시간 커스텀 배분 조정 시 위 비중 상태 바에 즉시 피드백됩니다.
      </div>
    </div>

    {/* 오른쪽: 매크로 리포트 시사점 요약 */}
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
      <div className="flex justify-between items-center pb-3 border-b border-slate-100 mb-4">
        <div className="flex items-center space-x-2">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-600"></span>
          <h3 className="font-bold text-base text-slate-800">하반기 핵심 매크로 시사점 요약</h3>
        </div>
        <span className="text-[11px] text-slate-400 font-medium">삼성증권 전략 리포트</span>
      </div>

      <div className="space-y-3">
        <div className="p-3 bg-slate-50/60 border border-slate-100 rounded-xl">
          <span className="text-xs font-bold text-slate-700 block mb-0.5">금리 변동성 국면</span>
          <p className="text-xs text-slate-600 leading-relaxed">{mockMacroReport.factors.interestRate.implication}</p>
        </div>
        <div className="p-3 bg-slate-50/60 border border-slate-100 rounded-xl">
          <span className="text-xs font-bold text-slate-700 block mb-0.5">환율 및 글로벌 통화 전략</span>
          <p className="text-xs text-slate-600 leading-relaxed">{mockMacroReport.factors.exchangeRate.implication}</p>
        </div>
        <div className="p-3 bg-slate-50/60 border border-slate-100 rounded-xl">
          <span className="text-xs font-bold text-slate-700 block mb-0.5">인프라 및 실물 자산 헤지</span>
          <p className="text-xs text-slate-600 leading-relaxed">{mockMacroReport.factors.inflation.implication}</p>
        </div>
      </div>
    </div>

  </div>

  {/* 4. 포트폴리오 3개 비교 카드 (현재 선택된 안만 시각적으로 볼드하게 강조) */}
  <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
    <div className="flex items-center space-x-2 pb-3 border-b border-slate-100 mb-5">
      <span className="w-2.5 h-2.5 rounded-full bg-emerald-600"></span>
      <h3 className="font-bold text-base text-slate-800">삼성 표준 포트폴리오 모델 3개안 비교</h3>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
      {mockPortfolioOptions.map((opt) => {
        const isSelected = selectedBase === opt.id;
        return (
          <div 
            key={opt.id} 
            onClick={() => handleBaseChange(opt.id)}
            className={`cursor-pointer p-5 rounded-2xl border transition-all ${
              isSelected 
                ? 'border-blue-600 ring-4 ring-blue-50 bg-blue-50/10 shadow-md transform -translate-y-0.5' 
                : 'border-slate-200 hover:border-slate-300 bg-white opacity-60 hover:opacity-90'
            }`}
          >
            <div className="flex justify-between items-start mb-3">
              <h4 className="font-bold text-sm text-slate-800">{opt.name}</h4>
              {isSelected && (
                <span className="bg-blue-600 text-white text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Active Base
                </span>
              )}
            </div>
            
            <table className="w-full text-xs text-left mb-3">
              <tbody>
                <tr className="border-b border-slate-100"><td className="py-1 text-slate-400">기대수익률</td><td className="py-1 text-right font-bold text-emerald-600">{opt.expectedReturn}%</td></tr>
                <tr className="border-b border-slate-100"><td className="py-1 text-slate-400">세후수익률</td><td className="py-1 text-right text-blue-600 font-bold">{opt.taxReturn}%</td></tr>
                <tr className="border-b border-slate-100"><td className="py-1 text-slate-400">최대낙폭(MDD)</td><td className="py-1 text-right text-rose-500">{opt.mdd}%</td></tr>
              </tbody>
            </table>

            <div className="flex flex-wrap gap-1">
              {opt.mainProducts.slice(0, 2).map((p, i) => (
                <span key={i} className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded border border-slate-200">
                  {p}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  </div>

  {/* 5. 상품 적합성 표 (아코디언 구조로 하단 배치하여 레이아웃 최적화) */}
  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
    <button 
      onClick={() => setIsSuitabilityOpen(!isSuitabilityOpen)}
      className="w-full flex justify-between items-center p-4 bg-slate-50 border-b border-slate-200 hover:bg-slate-100 transition-colors"
    >
      <div className="flex items-center space-x-2">
        <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
        <h3 className="font-bold text-sm text-slate-800">현재 투자 적합성 필터 / 리스크 점검 가이드</h3>
        <span className="text-xs font-normal text-slate-400">(클릭 시 상품 목록 활성화)</span>
      </div>
      <span className="text-xs font-bold text-blue-600">
        {isSuitabilityOpen ? '▼ 접기' : '▲ 펼쳐서 보기'}
      </span>
    </button>
    
    {isSuitabilityOpen && (
      <div className="overflow-x-auto p-4">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-100/60 text-xs text-slate-500 border-b border-slate-200">
              <th className="p-3 font-semibold">자산군</th>
              <th className="p-3 font-semibold w-24 text-center">적합도</th>
              <th className="p-3 font-semibold">판단 근거 사유</th>
            </tr>
          </thead>
          <tbody className="text-xs divide-y divide-slate-100">
            {mockAssetSuitability.map((suit, idx) => (
              <tr key={idx} className="hover:bg-slate-50/50">
                <td className="p-3 font-bold text-slate-700">{suit.category}</td>
                <td className="p-3 text-center">
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${getStatusClass(suit.status)}`}>
                    {suit.status}
                  </span>
                </td>
                <td className="p-3 text-slate-600 font-medium">{suit.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>

  {/* 6. PB 실시간 자산배분 커스텀 편집 및 실시간 스크립트 (가장 하단에 일체화 구성) */}
  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
    
    {/* 왼쪽 2열: 슬라이더 & 직접 숫자 입력 인풋 조합 구조 */}
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 lg:col-span-2">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 mb-5 gap-3">
        <div className="flex items-center space-x-2">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-600"></span>
          <h3 className="font-bold text-base text-slate-800">5. PB 커스텀 세부 비중 조율</h3>
        </div>
        
        {/* 비중 배지 알림 */}
        <div className={`text-xs font-bold px-3 py-1.5 rounded-xl border ${
          totalWeight === 100 
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
            : 'bg-rose-50 text-rose-600 border-rose-200'
        }`}>
          <span>비중 총합: {totalWeight}%</span>
          <span className="mx-2 text-slate-300">|</span>
          <span>
            {weightDiff === 0 
              ? '정확히 일치함' 
              : weightDiff > 0 
                ? `남은 비중: ${weightDiff}%` 
                : `초과 비중: ${Math.abs(weightDiff)}%`}
          </span>
        </div>
      </div>

      <div className="space-y-5">
        {/* 주식 */}
        <div>
          <div className="text-xs font-bold text-slate-700 mb-1">주식 / ETF 자산군 비중</div>
          <div className="flex items-center space-x-4">
            <input 
              type="range" min="0" max="100" step="1"
              value={weights.etf}
              onChange={(e) => handleWeightChange('etf', Number(e.target.value))}
              className="flex-1 h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
            <div className="relative flex items-center w-24">
              <input 
                type="number" min="0" max="100"
                value={weights.etf}
                onChange={(e) => handleWeightChange('etf', Math.min(100, Number(e.target.value)))}
                className="w-full text-right pr-6 pl-2 py-1 text-sm font-semibold border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="absolute right-2 text-xs font-semibold text-slate-400">%</span>
            </div>
          </div>
        </div>

        {/* 채권 */}
        <div>
          <div className="text-xs font-bold text-slate-700 mb-1">채권 인컴형 자산군 비중</div>
          <div className="flex items-center space-x-4">
            <input 
              type="range" min="0" max="100" step="1"
              value={weights.bond}
              onChange={(e) => handleWeightChange('bond', Number(e.target.value))}
              className="flex-1 h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
            <div className="relative flex items-center w-24">
              <input 
                type="number" min="0" max="100"
                value={weights.bond}
                onChange={(e) => handleWeightChange('bond', Math.min(100, Number(e.target.value)))}
                className="w-full text-right pr-6 pl-2 py-1 text-sm font-semibold border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="absolute right-2 text-xs font-semibold text-slate-400">%</span>
            </div>
          </div>
        </div>

        {/* 달러 및 금 분할 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <div className="text-xs font-bold text-slate-600 mb-1">달러 포지션 비중</div>
            <div className="flex items-center space-x-3">
              <input 
                type="range" min="0" max="30" step="1"
                value={weights.dollar}
                onChange={(e) => handleWeightChange('dollar', Number(e.target.value))}
                className="flex-1 h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-slate-600"
              />
              <div className="relative flex items-center w-20 flex-shrink-0">
                <input 
                  type="number" min="0" max="30"
                  value={weights.dollar}
                  onChange={(e) => handleWeightChange('dollar', Math.min(30, Number(e.target.value)))}
                  className="w-full text-right pr-5 pl-2 py-1 text-xs font-semibold border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="absolute right-1.5 text-[10px] font-semibold text-slate-400">%</span>
              </div>
            </div>
          </div>

          <div>
            <div className="text-xs font-bold text-slate-600 mb-1">금 실물 자산 비중</div>
            <div className="flex items-center space-x-3">
              <input 
                type="range" min="0" max="30" step="1"
                value={weights.gold}
                onChange={(e) => handleWeightChange('gold', Number(e.target.value))}
                className="flex-1 h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-slate-600"
              />
              <div className="relative flex items-center w-20 flex-shrink-0">
                <input 
                  type="number" min="0" max="30"
                  value={weights.gold}
                  onChange={(e) => handleWeightChange('gold', Math.min(30, Number(e.target.value)))}
                  className="w-full text-right pr-5 pl-2 py-1 text-xs font-semibold border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="absolute right-1.5 text-[10px] font-semibold text-gray-400">%</span>
              </div>
            </div>
          </div>
        </div>

        {/* 유동성 확보 금액 및 파생 조건 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
            <div>
              <span className="text-xs font-bold text-slate-700 block">구조화 지수 ELS/ELB 자산군 포함</span>
              <span className="text-[10px] text-slate-400">비활성화 시 ELS 비중 0% 고정</span>
            </div>
            <input 
              type="checkbox" 
              checked={elsIncluded}
              onChange={(e) => setElsIncluded(e.target.checked)}
              className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
            />
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
            <div className="text-xs font-bold text-slate-700 mb-1">단기 유동성 분리 확보액</div>
            <div className="flex items-center space-x-3">
              <input 
                type="range" min="1000" max="30000" step="500"
                value={liquidityAmount}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setLiquidityAmount(val);
                  const calculatedMmfWeight = Math.min(Math.round((val / 100000) * 100), 40);
                  handleWeightChange('mmf', calculatedMmfWeight);
                }}
                className="flex-1 h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
              <div className="relative flex items-center w-28 flex-shrink-0">
                <input 
                  type="number" min="1000" max="30000"
                  value={liquidityAmount}
                  onChange={(e) => {
                    const val = Math.min(30000, Number(e.target.value));
                    setLiquidityAmount(val);
                    const calculatedMmfWeight = Math.min(Math.round((val / 100000) * 100), 40);
                    handleWeightChange('mmf', calculatedMmfWeight);
                  }}
                  className="w-full text-right pr-8 pl-2 py-1 text-xs font-semibold border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="absolute right-1.5 text-[10px] font-semibold text-slate-400">만원</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* 오른쪽 1열: 대면 브리핑 스크립트 & 제안서 확정 액션 버튼 */}
    <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-lg flex flex-col justify-between lg:col-span-1">
      <div>
        <div className="flex items-center space-x-2 pb-3 border-b border-slate-800 mb-4">
          <span className="w-2.5 h-2.5 rounded-full bg-orange-400"></span>
          <h3 className="font-bold text-sm text-slate-200">6. AI 기반 브리핑 스크립트 변환</h3>
        </div>

        <div className="space-y-3.5 text-xs text-slate-300 bg-slate-800/40 p-4 rounded-xl border border-slate-800/60 leading-relaxed max-h-[320px] overflow-y-auto">
          <p className="font-bold text-orange-400 tracking-wide text-[11px] uppercase">Client Presentation Script</p>
          
          {weights.bond > 40 ? (
            <p>
              "현재 금융소득종합과세에 민감하신 절세 니즈를 최우선 방어하기 위해 우량 채권 자산 비중을 <span className="text-white font-bold">{weights.bond}%</span>까지 과감히 넓혀 자본차익과 확정 배당 인컴 흐름을 완벽히 잡았습니다."
            </p>
          ) : (
            <p>
              "자산의 듀레이션을 중장기로 조율하는 관점에서 주식/알파 자산 ETF 비중을 <span className="text-white font-bold">{weights.etf}%</span> 위주로 압축 배치하여 적극적인 글로벌 증시 트렌드 기회를 잡도록 구성했습니다."
            </p>
          )}

          <p>
            "또한 향후 1년 내 스타트업 추가 자금 출자가 발생할 수 있는 특수 목적 유동성을 위해 즉시 인출 가능한 안전자산 계좌에 정확히 <span className="text-orange-400 font-bold">{liquidityAmount.toLocaleString()}만 원</span>의 유동성 버퍼 계좌를 독립 분리해 설계했습니다."
          </p>
          
          {elsIncluded ? (
            <p className="text-[11px] text-slate-400 border-t border-slate-800 pt-2">
              ※ 기초자산 하방 방어력이 우수한 구조화 파생 지수 상품(ELS/ELB)을 가미하여 보수적 추가 알파수익 대안을 마련했습니다.
            </p>
          ) : (
            <p className="text-[11px] text-slate-400 border-t border-slate-800 pt-2">
              ※ 파생상품에 대한 오염을 원천 배제하여 포트폴리오의 구조적 단순성과 절대적 직관성을 견고히 다졌습니다.
            </p>
          )}
        </div>
      </div>

      <button 
        disabled={totalWeight !== 100}
        onClick={() => alert('영업점 프리젠테이션 보고서 및 모바일 자산 제안서 원장 반영 처리가 성공적으로 이루어졌습니다.')}
        className={`w-full mt-5 py-3 rounded-xl text-xs font-bold tracking-wide transition-all ${
          totalWeight === 100 
            ? 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer shadow-md' 
            : 'bg-slate-800 text-slate-500 cursor-not-allowed'
        }`}
      >
        {totalWeight === 100 ? '이 편집 조율안으로 제안 리포트 확정' : '자산 비중의 총합을 100%로 맞춰주세요'}
      </button>
    </div>

  </div>

</div>


);
}