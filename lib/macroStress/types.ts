export const ASSETS = ["sp500", "kospi", "treasury"] as const;
export const FACTORS = ["d_fed", "d_ust", "ret_krw", "infl", "ret_cmd", "d_vix"] as const;
export type AssetId = (typeof ASSETS)[number];
export type FactorId = (typeof FACTORS)[number];
export type Vector = Record<FactorId, number>;
export type Weights = Record<AssetId, number>;
export interface MonthlyRow { month:string; assets:Record<AssetId,number>; factors:Vector }
export interface OlsModel { asset:AssetId; alpha:number; betas:Vector; pValues:Vector; r2:number; residualStd:number; sampleStart:string; sampleEnd:string; observations:number }
export interface RiskMetrics { meanReturn:number; volatility:number; worstReturn:number; var95:number; cvar95:number; var99:number; cvar99:number; lossProbability:number; meanMdd:number; worstMdd:number; mdd95:number }
export interface ScenarioResult { id:string; label:string; period:string; months:number; dataStatus:"actual"|"custom"; center:Vector; actualReturn:number|null; actualMdd:number|null; actualAssetMdd:Record<AssetId,number>|null; predictedReturn:number|null; metrics:RiskMetrics; proposedWeights:Weights; proposedMetrics:RiskMetrics; rationale:string; histogram:Array<{mid:number;count:number}>; worst50:Array<{return:number;mdd:number}> }
export interface MacroStressResponse { generatedAt:string; sample:{requestedStart:string;actualStart:string;actualEnd:string;months:number}; models:OlsModel[]; scenario:ScenarioResult; warnings:string[]; sources:Record<string,string> }
