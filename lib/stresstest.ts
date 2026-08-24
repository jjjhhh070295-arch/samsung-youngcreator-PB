import type { MacroFactorId, MacroFactorMeta, ScenarioShock } from "./types";
export const FACTOR_META: MacroFactorMeta[] = [
  {id:"d_fed",label:"\uBBF8\uAD6D \uAE30\uC900\uAE08\uB9AC",labelEn:"Fed Funds",unit:"%p",min:-2,max:2,step:.25,hint:"\uD604\uC7AC \uAE30\uC900\uAE08\uB9AC \uB300\uBE44 \uB204\uC801 \uBCC0\uD654\uD3ED\uC785\uB2C8\uB2E4."},
  {id:"d_ust",label:"\uBBF8\uAD6D 10\uB144\uBB3C \uAE08\uB9AC",labelEn:"UST 10Y",unit:"%p",min:-2,max:2,step:.1,hint:"\uD604\uC7AC 10\uB144\uBB3C \uAE08\uB9AC \uB300\uBE44 \uB204\uC801 \uBCC0\uD654\uD3ED\uC785\uB2C8\uB2E4."},
  {id:"infl",label:"\uC778\uD50C\uB808\uC774\uC158",labelEn:"CPI YoY",unit:"%p",min:-2,max:2,step:.1,hint:"\uC2DC\uB098\uB9AC\uC624\uC758 CPI \uC804\uB144\uB3D9\uC6D4\uBE44 \uC218\uC900\uC785\uB2C8\uB2E4."},
  {id:"ret_krw",label:"\uC6D0\uB2EC\uB7EC \uD658\uC728",labelEn:"USD/KRW",unit:"%",min:-20,max:20,step:1,hint:"\uD604\uC7AC \uC6D0\uB2EC\uB7EC \uD658\uC728 \uB300\uBE44 \uB204\uC801 \uBCC0\uD654\uC728\uC785\uB2C8\uB2E4."},
  {id:"ret_cmd",label:"\uC6D0\uC790\uC7AC \uBB3C\uAC00",labelEn:"Commodity",unit:"%",min:-40,max:40,step:1,hint:"\uD604\uC7AC \uC6D0\uC790\uC7AC \uC9C0\uC218 \uB300\uBE44 \uB204\uC801 \uBCC0\uD654\uC728\uC785\uB2C8\uB2E4."},
  {id:"d_vix",label:"VIX \uC9C0\uC218",labelEn:"VIX",unit:"pt",min:-30,max:60,step:1,hint:"\uD604\uC7AC VIX \uB300\uBE44 \uC9C0\uC218 \uBCC0\uD654\uD3ED\uC785\uB2C8\uB2E4."},
];
export const FACTOR_IDS: MacroFactorId[]=FACTOR_META.map(factor=>factor.id);
export function zeroShock():ScenarioShock{return {d_fed:0,d_ust:0,infl:0,ret_krw:0,ret_cmd:0,d_vix:0};}
export const PRESET_SCENARIOS=[
  {id:"dotcom",name:"\uB2F7\uCEF4\uBC84\uBE14",period:"2000-03 ~ 2002-10"},
  {id:"gfc",name:"\uAE00\uB85C\uBC8C \uAE08\uC735\uC704\uAE30",period:"2007-10 ~ 2009-03"},
  {id:"covid",name:"\uCF54\uB85C\uB098 \uC704\uAE30",period:"2020-02 ~ 2020-04"},
  {id:"inflation_2022",name:"2022 \uC778\uD50C\uB808\uC774\uC158\u00B7\uAE08\uB9AC \uC1FC\uD06C",period:"2022-01 ~ 2022-10"},
] as const;
