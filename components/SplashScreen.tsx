"use client";

import { useEffect, useState } from "react";

const LINES = [
  "우리는 꿈꿉니다.",
  "당신의 평화로운 노후와 인생 2막을 시작할 수 있는 삶을 꿈꿉니다.",
  "당신이 목표했던 바를 이루고 정상에서 인생의 스포트라이트를 받길 꿈꿉니다.",
  "안락한 보금자리에서 추억을 채워나가는 당신을 꿈꿉니다.",
  "사랑하는 사람과의 더할 나위 없는 행복한 출발과",
  "삶의 주도권을 갖고, 차근차근 이루어갈 성장을 꿈꿉니다.",
  "그 꿈을 위해 언제나 당신과 함께 합니다.",
  "우리는 고객의 더 나은 삶에 기여하고 고객과 함께 성장합니다.",
];

// 사이트 최초 구동 시 약 2초간 뜨는 인트로(스플래시) 화면.
export default function SplashScreen() {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setFading(true), 2000); // 2초 표시
    const t2 = setTimeout(() => setVisible(false), 2600); // 페이드아웃 후 제거
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    setFading(true);
    setTimeout(() => setVisible(false), 400);
  };

  return (
    <div
      onClick={dismiss}
      className={`fixed inset-0 z-[100] flex cursor-pointer flex-col items-center justify-center bg-gradient-to-br from-navy-950 via-navy-900 to-navy-800 px-6 text-center text-white transition-opacity duration-500 ${
        fading ? "opacity-0" : "opacity-100"
      }`}
    >
      <p className="mb-6 flex items-center gap-2 text-xs font-medium tracking-widest text-gold-300">
        <span className="h-px w-6 bg-gold-400" />
        SAMSUNG SECURITIES · PRIVATE BANKING
      </p>

      <div className="max-w-2xl space-y-2 text-[15px] leading-relaxed text-white/85 sm:text-lg">
        {LINES.map((line, i) => (
          <p
            key={i}
            className="animate-[fadeUp_0.6s_ease-out_both]"
            style={{ animationDelay: `${i * 0.18}s` }}
          >
            {line}
          </p>
        ))}
        <p
          className="animate-[fadeUp_0.6s_ease-out_both] pt-4 text-gold-300"
          style={{ animationDelay: `${LINES.length * 0.18}s` }}
        >
          당신의 꿈이 우리의 꿈이 되도록
        </p>
        <p
          className="animate-[fadeUp_0.6s_ease-out_both] text-3xl font-bold tracking-tight text-gold-400"
          style={{ animationDelay: `${(LINES.length + 1) * 0.18}s` }}
        >
          삼성증권
        </p>
      </div>

      <p className="absolute bottom-8 text-[11px] text-white/40">
        화면을 누르면 바로 시작합니다
      </p>

      <style jsx>{`
        @keyframes fadeUp {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
