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

interface PortfolioPanelProps {
  pbId: string;
  clientId: string;
}

export default function PortfolioPanel({ pbId, clientId }: PortfolioPanelProps) {
  // PB 편집 포인트용 상태 관리 (초기값은 '균형형' 기준)
  const [selectedBase, setSelectedBase] = useState<'stable' | 'balanced' | 'growth'>('balanced');
  const [weights, setWeights] = useState<PortfolioOption['weights']>(mockPortfolioOptions[1].weights);
  const [elsIncluded, setElsIncluded] = useState<boolean>(true);
  const [liquidityAmount, setLiquidityAmount] = useState<number>(5000); // 단위: 만원

  // 실시간 시뮬레이션 결과 지표
  const [metrics, setMetrics] = useState({
    expectedReturn: 6.8,
    volatility: 5.4,
    mdd: -6.2,
    taxReturn: 6.1
  });

  // 기저 포트폴리오 변경 시 수치 동기화
  const handleBaseChange = (type: 'stable' | 'balanced' | 'growth') => {
    setSelectedBase(type);
    const target = mockPortfolioOptions.find(p => p.id === type);
    if (target) {
      setWeights({ ...target.weights });
      setElsIncluded(target.weights.els > 0);
    }
  };

  // 가중치 슬라이더 변경 핸들러
  const handleWeightChange = (asset: keyof PortfolioOption['weights'], value: number) => {
    setWeights(prev => {
      const updated = { ...prev, [asset]: value };
      // MVP 단계이므로 100% 검증은 가볍게 안내 처리 혹은 간단 유지
      return updated;
    });
  };

  // 가중치 변동 시 실시간 지표 재계산
  useEffect(() => {
    const adjustedWeights = { ...weights };
    if (!elsIncluded) adjustedWeights.els = 0;
    const nextMetrics = calculateSimulatedMetrics(adjustedWeights);
    setMetrics(nextMetrics);
  }, [weights, elsIncluded]);

  // 총합 가중치 계산
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0) - (elsIncluded ? 0 : weights.els);

  // 배지 컬러 유틸리티
  const getStatusClass = (status: string) => {
    switch (status) {
      case '적합': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case '주의': return 'bg-amber-50 text-amber-700 border-amber-200';
      case '비추천': return 'bg-rose-50 text-rose-700 border-rose-200';
      default: return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

  return (
    <div className="space-y-8 p-6 bg-gray-50 min-h-screen text-gray-900">
      
      {/* 상단 타이틀 바 */}
      <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">포트폴리오 제안 및 시뮬레이션 시트</h1>
          <p className="text-sm text-gray-500 mt-1">고객 맞춤형 제안서 작성을 위한 PB 검토 및 편집 대시보드</p>
        </div>
        <div className="text-right text-xs text-gray-400">
          <p>PB ID: {pbId}</p>
          <p>고객 ID: {clientId}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* 1. 고객 요약 카드 */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 lg:col-span-1 flex flex-col justify-between">
          <div>
            <div className="flex items-center space-x-2 pb-4 border-b border-gray-100 mb-4">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-600"></span>
              <h2 className="font-bold text-lg text-slate-800">1. 고객 profile 요약</h2>
            </div>
            
            <div className="space-y-3">
              <div>
                <span className="text-xs text-gray-400 block">고객 유형</span>
                <span className="text-sm font-semibold text-gray-700">{mockClientSummary.clientType}</span>
              </div>
              <div>
                <span className="text-xs text-gray-400 block">위험성향</span>
                <span className="text-sm font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md inline-block mt-0.5">
                  {mockClientSummary.riskPropensity}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <span className="text-xs text-gray-400 block">투자기간</span>
                  <span className="text-xs font-medium text-gray-700">{mockClientSummary.investmentPeriod}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-400 block">유동성 필요</span>
                  <span className="text-xs font-medium text-gray-700">{mockClientSummary.liquidityNeed}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-400 block">세금 민감도</span>
                  <span className="text-xs font-medium text-rose-600">{mockClientSummary.taxSensitivity}</span>
                </div>
              </div>
            </div>

            <div className="mt-5 pt-4 border-t border-gray-100">
              <span className="text-xs text-gray-500 font-bold block mb-2">핵심 요구사항</span>
              <ul className="text-xs space-y-1.5 text-gray-600 list-disc list-inside">
                {mockClientSummary.keyRequirements.map((req, i) => (
                  <li key={i} className="leading-relaxed">{req}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* 2. 매크로 리포트 반영 영역 */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 lg:col-span-2">
          <div className="flex justify-between items-center pb-4 border-b border-gray-100 mb-4">
            <div className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-600"></span>
              <h2 className="font-bold text-lg text-slate-800">2. 삼성증권 매크로 리포트 요약 및 시사점</h2>
            </div>
            <span className="text-xs text-gray-400">{mockMacroReport.title} ({mockMacroReport.date})</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.values(mockMacroReport.factors).map((factor, index) => (
              <div key={index} className="p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                <div className="text-xs font-bold text-slate-700 mb-1">{factor.label}</div>
                <p className="text-xs text-gray-600 mb-2 line-clamp-1">🔍 {factor.outlook}</p>
                <div className="text-[11px] bg-white p-2 rounded border border-indigo-100 text-indigo-800 font-medium">
                  💡 시사점: {factor.implication}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* 3. 추천 포트폴리오 3개 비교 */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div className="flex items-center space-x-2 pb-4 border-b border-gray-100 mb-5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-600"></span>
          <h2 className="font-bold text-lg text-slate-800">3. 기본 추천 포트폴리오 3개안 비교 및 기저 선택</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {mockPortfolioOptions.map((opt) => {
            const isSelected = selectedBase === opt.id;
            return (
              <div 
                key={opt.id} 
                onClick={() => handleBaseChange(opt.id)}
                className={`cursor-pointer p-5 rounded-2xl border transition-all relative ${
                  isSelected 
                    ? 'border-blue-600 ring-2 ring-blue-100 bg-blue-50/20' 
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                {isSelected && (
                  <span className="absolute top-4 right-4 bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                    편집 기저로 선택됨
                  </span>
                )}
                <h3 className="font-bold text-base text-gray-800 mb-3">{opt.name}</h3>
                
                <table className="w-full text-xs text-left mb-4">
                  <tbody>
                    <tr className="border-b border-gray-100"><td className="py-1.5 text-gray-400">기대수익률</td><td className="py-1.5 text-right font-bold text-emerald-600">{opt.expectedReturn}%</td></tr>
                    <tr className="border-b border-gray-100"><td className="py-1.5 text-gray-400">변동성</td><td className="py-1.5 text-right font-medium">{opt.volatility}%</td></tr>
                    <tr className="border-b border-gray-100"><td className="py-1.5 text-gray-400">최대 낙폭(MDD)</td><td className="py-1.5 text-right text-rose-500 font-medium">{opt.mdd}%</td></tr>
                    <tr className="border-b border-gray-100"><td className="py-1.5 text-gray-400">세후수익률</td><td className="py-1.5 text-right text-blue-600 font-bold">{opt.taxReturn}%</td></tr>
                  </tbody>
                </table>

                <div className="pt-2">
                  <span className="text-[11px] font-bold text-gray-500 block mb-1">핵심 편입 상품</span>
                  <div className="flex flex-wrap gap-1">
                    {opt.mainProducts.map((p, i) => (
                      <span key={i} className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. 상품 구성 적합도 매트릭스 */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div className="flex items-center space-x-2 pb-4 border-b border-gray-100 mb-4">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
          <h2 className="font-bold text-lg text-slate-800">4. 현재 고객 유형별 상품군 투자 적합성 필터</h2>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-xs text-gray-500 border-b border-gray-200">
                <th className="p-3 font-semibold">자산군</th>
                <th className="p-3 font-semibold w-24 text-center">적합도</th>
                <th className="p-3 font-semibold">삼성증권 PB 가이드 및 판단 사유</th>
              </tr>
            </thead>
            <tbody className="text-xs divide-y divide-gray-100">
              {mockAssetSuitability.map((suit, idx) => (
                <tr key={idx} className="hover:bg-slate-50/50">
                  <td className="p-3 font-bold text-slate-700">{suit.category}</td>
                  <td className="p-3 text-center">
                    <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${getStatusClass(suit.status)}`}>
                      {suit.status}
                    </span>
                  </td>
                  <td className="p-3 text-gray-600 font-medium">{suit.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. PB 편집 포인트 & 6. 고객 설명 문구 실시간 연동 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* 5. PB 편집 패널 */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 lg:col-span-2">
          <div className="flex justify-between items-center pb-4 border-b border-gray-100 mb-5">
            <div className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-600"></span>
              <h2 className="font-bold text-lg text-slate-800">5. PB 실시간 자산배분 커스텀 편집</h2>
            </div>
            <div className={`text-xs font-bold px-2 py-1 rounded-md ${totalWeight === 100 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>
              비중 총합: {totalWeight}% {totalWeight !== 100 && '(100% 조정 필요)'}
            </div>
          </div>

          <div className="space-y-5">
            {/* 주식/ETF 비중 */}
            <div>
              <div className="flex justify-between text-xs font-medium mb-1.5">
                <span className="text-gray-700 font-bold">주식 / ETF 편입 비중</span>
                <span className="text-blue-600 font-bold">{weights.etf}%</span>
              </div>
              <input 
                type="range" min="0" max="100" step="5"
                value={weights.etf}
                onChange={(e) => handleWeightChange('etf', Number(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
            </div>

            {/* 채권 비중 */}
            <div>
              <div className="flex justify-between text-xs font-medium mb-1.5">
                <span className="text-gray-700 font-bold">채권 고정금리형 자산 비중</span>
                <span className="text-blue-600 font-bold">{weights.bond}%</span>
              </div>
              <input 
                type="range" min="0" max="100" step="5"
                value={weights.bond}
                onChange={(e) => handleWeightChange('bond', Number(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
            </div>

            {/* 안전/대안 자산 (달러/금) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="flex justify-between text-xs font-medium mb-1.5">
                  <span className="text-gray-600">달러(USD) 비중</span>
                  <span className="font-bold">{weights.dollar}%</span>
                </div>
                <input 
                  type="range" min="0" max="30" step="5"
                  value={weights.dollar}
                  onChange={(e) => handleWeightChange('dollar', Number(e.target.value))}
                  className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-slate-700"
                />
              </div>
              <div>
                <div className="flex justify-between text-xs font-medium mb-1.5">
                  <span className="text-gray-600">금(GOLD) 실물 비중</span>
                  <span className="font-bold">{weights.gold}%</span>
                </div>
                <input 
                  type="range" min="0" max="30" step="5"
                  value={weights.gold}
                  onChange={(e) => handleWeightChange('gold', Number(e.target.value))}
                  className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-slate-700"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-gray-100">
              {/* ELS 포함 여부 */}
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                <div>
                  <span className="text-xs font-bold text-gray-700 block">구조화 상품(ELS/ELB) 포함</span>
                  <span className="text-[11px] text-gray-400">미포함 시 해당 가중치 0% 처리</span>
                </div>
                <input 
                  type="checkbox" 
                  checked={elsIncluded}
                  onChange={(e) => setElsIncluded(e.target.checked)}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
              </div>

              {/* 단기 유동성 확보 금액 */}
              <div className="p-3 bg-slate-50 rounded-xl">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-bold text-gray-700">단기 유동성 확보액 (MMF/RP)</span>
                  <span className="text-xs font-bold text-indigo-600">{(liquidityAmount).toLocaleString()}만 원</span>
                </div>
                <input 
                  type="range" min="1000" max="30000" step="1000"
                  value={liquidityAmount}
                  onChange={(e) => {
                    setLiquidityAmount(Number(e.target.value));
                    // 시뮬레이션을 위해 MMF 비중도 연동하여 조절 노출
                    const calculatedMmfWeight = Math.min(Math.round((Number(e.target.value) / 100000) * 100), 40);
                    handleWeightChange('mmf', calculatedMmfWeight);
                  }}
                  className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
              </div>
            </div>
          </div>
        </div>

        {/* 6. 시뮬레이션 결과 및 고객 대면용 스크립트 변환 영역 */}
        <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-lg flex flex-col justify-between lg:col-span-1">
          <div>
            <div className="flex items-center space-x-2 pb-4 border-b border-slate-800 mb-4">
              <span className="w-2.5 h-2.5 rounded-full bg-orange-400"></span>
              <h2 className="font-bold text-base text-slate-200">6. PB 조율안 실시간 대면 브리핑 스크립트</h2>
            </div>

            {/* 실시간 지표 박스 */}
            <div className="grid grid-cols-2 gap-2 mb-5">
              <div className="bg-slate-800/60 p-2.5 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 block">예상 수익률</span>
                <span className="text-sm font-bold text-emerald-400">{metrics.expectedReturn}%</span>
              </div>
              <div className="bg-slate-800/60 p-2.5 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 block">세후 가상 수익률</span>
                <span className="text-sm font-bold text-cyan-400">{metrics.taxReturn}%</span>
              </div>
              <div className="bg-slate-800/60 p-2.5 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 block">포트폴리오 변동성</span>
                <span className="text-sm font-medium text-slate-300">{metrics.volatility}%</span>
              </div>
              <div className="bg-slate-800/60 p-2.5 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 block">시뮬레이션 MDD</span>
                <span className="text-sm font-medium text-rose-400">{metrics.mdd}%</span>
              </div>
            </div>

            {/* 변환 스크립트 본문 */}
            <div className="space-y-3 text-xs text-slate-300 bg-slate-800/40 p-4 rounded-xl border border-slate-800/60 leading-relaxed">
              <p className="font-bold text-orange-300">📢 고객 설명 가이드 문구 :</p>
              
              {weights.bond > 40 ? (
                <p>
                  "현재 시장의 금리 인하 사이클 국면을 활용하기 위해 안심할 수 있는 우량 채권 자산의 비중을 <span className="text-white font-bold">{weights.bond}%</span>까지 든든하게 높였습니다. 이를 통해 절세 효과와 이자 수익을 동시에 방어합니다."
                </p>
              ) : (
                <p>
                  "수익 다각화를 위해 글로벌 핵심 주식/ETF 비중을 <span className="text-white font-bold">{weights.etf}%</span> 수준으로 중심 배치하여 적극적인 자산 성장을 추구하는 구조로 커스텀했습니다."
                </p>
              )}

              <p>
                "고객님이 요청하신 단기 스타트업 출자 및 유동성 대기 자금 목적을 완벽히 충족하기 위해, 상시 출금이 가능한 MMF/RP 계좌에 별도로 <span className="text-orange-400 font-bold">{(liquidityAmount).toLocaleString()}만 원</span>의 유동성 버퍼를 완벽히 격리 보관해두는 안을 완성했습니다."
              </p>
              
              {elsIncluded ? (
                <p className="text-[11px] text-slate-400 border-t border-slate-800 pt-2 mt-1">
                  ※ 지수형 노낙인 ELS 상품을 일부 혼합하여 횡보 장세에서도 추가 인컴 흐름이 나올 수 있도록 조율했습니다.
                </p>
              ) : (
                <p className="text-[11px] text-slate-400 border-t border-slate-800 pt-2 mt-1">
                  ※ 변동성이 모호한 구조화 파생상품(ELS)은 원천 배제하여 포트폴리오의 직관성과 안정성을 극대화했습니다.
                </p>
              )}
            </div>
          </div>

          <button 
            disabled={totalWeight !== 100}
            onClick={() => alert('조율된 자산 배분 비중 및 요약 스크립트가 고객 제안서 초안 리포트로 원활하게 반영되었습니다.')}
            className={`w-full mt-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
              totalWeight === 100 
                ? 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer shadow-md' 
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            {totalWeight === 100 ? '이 편집안으로 제안서 반영 확정' : '자산 비중의 총합을 100%로 맞추어 주세요'}
          </button>
        </div>

      </div>

    </div>
  );
}